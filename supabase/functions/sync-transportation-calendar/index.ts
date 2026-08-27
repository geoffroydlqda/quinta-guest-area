// Sync transportation trips to the Quinta Transportation Google Calendar.
// Actions: upsert (create/update for one trip), delete (one event), backfill (admin only).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

// Admin emails are centralized in the public.admin_users table (Phase 0).
const _adminAuthClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);
let _adminEmailsCache: string[] | null = null;
async function getAdminEmails(): Promise<string[]> {
  if (_adminEmailsCache) return _adminEmailsCache;
  const { data } = await _adminAuthClient.from("admin_users").select("email");
  _adminEmailsCache = (data ?? []).map((r: { email: string }) =>
    String(r.email).normalize("NFC").toLowerCase().trim()
  );
  return _adminEmailsCache;
}
async function isAdminEmailDb(email?: string | null): Promise<boolean> {
  if (!email) return false;
  return (await getAdminEmails()).includes(email.normalize("NFC").toLowerCase().trim());
}


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
};

const CALENDAR_ID =
  "c_df9857682cb149faf3d73da4798ccc4f246c69fd587faa7bafd56f133005f1a6@group.calendar.google.com";
const TZ = "Europe/Lisbon";
// API Google directes (la passerelle Lovable est morte — migration juillet 2026).
// Auth calendrier : service account (secrets GOOGLE_SA_EMAIL + GOOGLE_SA_PRIVATE_KEY),
// le calendrier doit être partagé avec l'email du service account.
const CAL_API = "https://www.googleapis.com/calendar/v3";
const FALLBACK_MINUTES = 60;


const BodySchema = z.object({
  action: z.enum(["upsert", "delete", "backfill", "force_resync", "probe_duration"]),
  tripId: z.string().uuid().optional(),
  eventId: z.string().min(1).max(1024).optional(),
  origin: z.string().max(500).optional(),
  destination: z.string().max(500).optional(),
});

// ---- Résolution d'adresses pour le calcul d'itinéraire -----------------------
// Les locations de l'app ("Quinta do Amor", "Lisbon"...) sont trop vagues pour
// un géocodage fiable. Overrides configurables dans app_settings key
// 'transport_calendar' -> value.addresses = { "Quinta do Amor": "<adresse ou lat,lng>", ... }
const DEFAULT_ADDRESSES: Record<string, string> = {
  "lisbon": "Lisbon, Portugal",
  "lisbon airport": "Humberto Delgado Airport, Lisbon, Portugal",
  "quinta do amor": "Quinta do Amor, Portugal",
};
let _addrOverrides: Record<string, string> | null = null;
async function getAddressOverrides(): Promise<Record<string, string>> {
  if (_addrOverrides) return _addrOverrides;
  const map: Record<string, string> = {};
  try {
    const { data } = await _adminAuthClient
      .from("app_settings").select("value").eq("key", "transport_calendar").maybeSingle();
    const src = ((data?.value as any)?.addresses ?? {}) as Record<string, unknown>;
    for (const k of Object.keys(src)) map[k.toLowerCase().trim()] = String(src[k]);
  } catch (_e) { /* pas d'overrides */ }
  _addrOverrides = map;
  return map;
}
async function resolveAddress(loc: string): Promise<string> {
  const key = String(loc || "").toLowerCase().trim();
  if (!key) return loc;
  const overrides = await getAddressOverrides();
  return overrides[key] || DEFAULT_ADDRESSES[key] || loc;
}

// ---- OAuth2 service account (JWT RS256 -> access token, mis en cache) ------
let _gTok: { token: string; exp: number } | null = null;
// Identifiants : env (GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY) ou, à défaut,
// app_settings key='internal' (google_sa_email / google_sa_private_key —
// lisible uniquement par le service role, comme cron_key).
async function getSaCreds(): Promise<{ email: string; key: string }> {
  let email = Deno.env.get("GOOGLE_SA_EMAIL") ?? "";
  let key = Deno.env.get("GOOGLE_SA_PRIVATE_KEY") ?? "";
  if (!email || !key) {
    const { data } = await _adminAuthClient.from("app_settings").select("value").eq("key", "internal").maybeSingle();
    const v = (data?.value ?? {}) as Record<string, string>;
    email = email || v.google_sa_email || "";
    key = key || v.google_sa_private_key || "";
  }
  if (!email || !key) {
    throw new Error("Google service account not configured (secrets GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY)");
  }
  return { email, key: key.replace(/\\n/g, "\n") };
}

async function googleAccessToken(): Promise<string> {
  const { email, key } = await getSaCreds();
  const now = Math.floor(Date.now() / 1000);
  if (_gTok && _gTok.exp - 60 > now) return _gTok.token;
  const b64url = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const encJson = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const header = encJson({ alg: "RS256", typ: "JWT" });
  const claims = encJson({
    iss: email,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  });
  const pem = key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(`${header}.${claims}`)),
  );
  const jwt = `${header}.${claims}.${b64url(sig)}`;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!r.ok) throw new Error(`Google token ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  _gTok = { token: d.access_token, exp: now + Number(d.expires_in ?? 3600) };
  return _gTok.token;
}

async function calendarHeaders() {
  return {
    Authorization: `Bearer ${await googleAccessToken()}`,
    "Content-Type": "application/json",
  };
}

interface DriveDetail {
  minutes: number;
  fallback: boolean;
  mapsKeyConfigured: boolean;
  resolvedOrigin: string;
  resolvedDestination: string;
  error?: string;
}

async function computeDriveDetail(origin: string, destination: string): Promise<DriveDetail> {
  const mapsKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
  const base: DriveDetail = {
    minutes: FALLBACK_MINUTES,
    fallback: true,
    mapsKeyConfigured: !!mapsKey,
    resolvedOrigin: origin,
    resolvedDestination: destination,
  };
  if (!origin || !destination) return { ...base, error: "missing origin/destination" };
  // Clé API Google Maps classique (Routes API activée). Optionnelle :
  // sans clé, durée par défaut de 60 minutes.
  if (!mapsKey) return { ...base, error: "GOOGLE_MAPS_API_KEY not set" };
  const from = await resolveAddress(origin);
  const to = await resolveAddress(destination);
  base.resolvedOrigin = from;
  base.resolvedDestination = to;
  try {
    const r = await fetch(`https://routes.googleapis.com/directions/v2:computeRoutes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": mapsKey,
        "X-Goog-FieldMask": "routes.duration",
      },
      body: JSON.stringify({
        origin: { address: from },
        destination: { address: to },
        travelMode: "DRIVE",
      }),
    });
    if (!r.ok) {
      const txt = await r.text();
      console.warn("routes failed", r.status, txt);
      return { ...base, error: `routes ${r.status}: ${String(txt).slice(0, 200)}` };
    }
    const data = await r.json();
    const dur: string | undefined = data?.routes?.[0]?.duration;
    if (!dur) return { ...base, error: "no route in response" };
    const seconds = parseInt(String(dur).replace("s", ""), 10);
    if (!Number.isFinite(seconds) || seconds <= 0) return { ...base, error: "bad duration" };
    // Arrondi aux 5 min supérieures, minimum 15 min
    const minutes = Math.max(15, Math.ceil(seconds / 60 / 5) * 5);
    return { ...base, minutes, fallback: false, error: undefined };
  } catch (e) {
    console.warn("routes error", e);
    return { ...base, error: String(e).slice(0, 200) };
  }
}

async function computeDriveMinutes(origin: string, destination: string): Promise<number> {
  return (await computeDriveDetail(origin, destination)).minutes;
}

// Add minutes to a local "YYYY-MM-DDTHH:mm:ss" string without timezone conversion.
function addMinutes(local: string, minutes: number): string {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return local;
  const y = +m[1], mo = +m[2] - 1, d = +m[3], h = +m[4], mi = +m[5], s = m[6] ? +m[6] : 0;
  const totalMin = h * 60 + mi + minutes;
  const dayOffset = Math.floor(totalMin / (60 * 24));
  const remMin = ((totalMin % (60 * 24)) + 60 * 24) % (60 * 24);
  const nh = Math.floor(remMin / 60);
  const nm = remMin % 60;
  // Use UTC math just to roll the calendar date safely.
  const base = Date.UTC(y, mo, d) + dayOffset * 86400000;
  const bd = new Date(base);
  const yy = bd.getUTCFullYear();
  const mm = String(bd.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(bd.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}T${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function effectivePriceOf(trip: any): number | null {
  if (trip.custom_price !== null && trip.custom_price !== undefined) {
    const n = Number(trip.custom_price);
    if (Number.isFinite(n)) return n;
  }
  const fixed = String(trip.price_estimate || "").match(/€\s*(\d+(?:\.\d+)?)/);
  if (fixed) return Number(fixed[1]);
  return null;
}

function buildEvent(opts: { guestName: string; trip: any; durationMin: number; passengers: any[] }) {
  const { guestName, trip, durationMin, passengers } = opts;
  const time = /^\d{2}:\d{2}$/.test(trip.trip_time) ? `${trip.trip_time}:00` : trip.trip_time;
  const start = `${trip.trip_date}T${time}`;
  const end = addMinutes(start, durationMin);
  const pickupLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trip.pickup_location || "")}`;
  const dropoffLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trip.dropoff_location || "")}`;

  let passengerBlock = "";
  if (passengers && passengers.length > 0) {
    passengerBlock = "ℹ️ Passengers infos :\n\n";
    passengers.forEach((p, i) => {
      passengerBlock += `Passenger ${i + 1}\n- Name: ${p.first_name || ""}\n`;
      if (p.phone) passengerBlock += `- Phone number: ${p.phone}\n`;
      if (p.flight_number) passengerBlock += `- Flight number: ${p.flight_number}\n`;
      passengerBlock += "\n";
    });
  }

  const description =
    passengerBlock +
    `🔢 Passengers: ${trip.passengers_count}\n\n` +
    `📍 Pickup: ${trip.pickup_location}\n${pickupLink}\n\n` +
    `📍 Drop-off: ${trip.dropoff_location}\n${dropoffLink}`;

  return {
    summary: `${guestName} — Transportation`,
    location: `${trip.pickup_location} → ${trip.dropoff_location}`,
    description,
    start: { dateTime: start, timeZone: TZ },
    end: { dateTime: end, timeZone: TZ },
  };
}

async function syncOne(admin: any, trip: any): Promise<string> {
  const headers = await calendarHeaders();
  const durationMin = await computeDriveMinutes(trip.pickup_location, trip.dropoff_location);
  const { data: passengers } = await admin
    .from("transportation_passengers")
    .select("first_name,phone,flight_number,created_at")
    .eq("trip_id", trip.id)
    .order("created_at", { ascending: true });

  const paxNames = (passengers || [])
    .map((p: any) => (p.first_name || "").trim())
    .filter(Boolean);
  let guestName = "";
  if (paxNames.length > 0) {
    guestName = paxNames.join(", ");
  }
  if (!guestName && trip.booking_id) {
    const { data: bk } = await admin
      .from("bookings")
      .select("first_name,last_name,retreat_name,email")
      .eq("id", trip.booking_id)
      .maybeSingle();
    if (bk) {
      guestName =
        [bk.first_name, bk.last_name].filter(Boolean).join(" ").trim() ||
        bk.retreat_name || bk.email || "";
    }
  }
  if (!guestName) guestName = "Guest";

  const body = buildEvent({ guestName, trip, durationMin, passengers: passengers || [] });

  let eventId = (trip.google_calendar_event_id as string | null) || null;
  let response: Response | null = null;

  if (eventId) {
    response = await fetch(
      `${CAL_API}/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${encodeURIComponent(eventId)}`,
      { method: "PATCH", headers, body: JSON.stringify(body) },
    );
    // Upstream event was deleted — fall through to create.
    if (response.status === 404 || response.status === 410) {
      eventId = null;
      response = null;
    }
  }
  if (!eventId) {
    response = await fetch(
      `${CAL_API}/calendars/${encodeURIComponent(CALENDAR_ID)}/events`,
      { method: "POST", headers, body: JSON.stringify(body) },
    );
  }
  if (!response || !response.ok) {
    const txt = response ? await response.text() : "no response";
    throw new Error(`Calendar API ${response?.status ?? "?"}: ${String(txt).slice(0, 300)}`);
  }
  const data = await response.json();
  const newId: string = data.id || eventId!;
  await admin.from("transportation_trips").update({
    google_calendar_event_id: newId,
    last_synced_at: new Date().toISOString(),
    sync_status: "synced",
    sync_error: null,
  }).eq("id", trip.id);
  return newId;
}

async function deleteEvent(eventId: string) {
  const headers = await calendarHeaders();
  const r = await fetch(
    `${CAL_API}/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE", headers },
  );
  if (!r.ok && r.status !== 404 && r.status !== 410) {
    const txt = await r.text();
    throw new Error(`Calendar delete ${r.status}: ${String(txt).slice(0, 200)}`);
  }
}

async function purgeAllCalendarEvents(): Promise<number> {
  const headers = await calendarHeaders();
  let pageToken: string | undefined = undefined;
  let deleted = 0;
  do {
    const url = new URL(`${CAL_API}/calendars/${encodeURIComponent(CALENDAR_ID)}/events`);
    url.searchParams.set("maxResults", "250");
    url.searchParams.set("showDeleted", "false");
    url.searchParams.set("singleEvents", "true");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const r = await fetch(url.toString(), { method: "GET", headers });
    if (!r.ok) {
      const txt = await r.text();
      throw new Error(`Calendar list ${r.status}: ${String(txt).slice(0, 300)}`);
    }
    const data = await r.json();
    const items: any[] = data.items || [];
    for (const ev of items) {
      if (!ev.id) continue;
      try { await deleteEvent(ev.id); deleted++; }
      catch (e) { console.warn("purge delete failed", ev.id, e); }
    }
    pageToken = data.nextPageToken || undefined;
  } while (pageToken);
  return deleted;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten() }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { action, tripId, eventId } = parsed.data;

    // probe_duration : diagnostic du calcul de durée (admin JWT ou x-cron-key interne)
    if (action === "probe_duration") {
      let allowed = false;
      const cronKeyHeader = req.headers.get("x-cron-key");
      if (cronKeyHeader) {
        const { data: st } = await _adminAuthClient
          .from("app_settings").select("value").eq("key", "internal").maybeSingle();
        const expected = (st?.value as any)?.cron_key;
        allowed = !!expected && cronKeyHeader === expected;
      }
      if (!allowed) {
        const probeClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY")!,
          { global: { headers: { Authorization: authHeader } } },
        );
        const { data: { user: probeUser } } = await probeClient.auth.getUser();
        allowed = !!probeUser && await isAdminEmailDb(probeUser.email);
      }
      if (!allowed) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const detail = await computeDriveDetail(parsed.data.origin || "", parsed.data.destination || "");
      return new Response(JSON.stringify(detail), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userIsAdmin = await isAdminEmailDb(user.email);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (action === "delete") {
      if (!eventId) {
        return new Response(JSON.stringify({ error: "eventId required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Contrôle de propriété : l'eventId doit appartenir à un trip de
      // l'appelant (ou l'appelant est admin) — sinon n'importe quel guest
      // connecté pourrait supprimer des événements du calendrier chauffeur.
      if (!userIsAdmin) {
        const { data: ownedTrip } = await admin
          .from("transportation_trips")
          .select("id")
          .eq("google_calendar_event_id", eventId)
          .eq("user_id", user.id)
          .maybeSingle();
        if (!ownedTrip) {
          return new Response(JSON.stringify({ error: "Forbidden" }), {
            status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
      await deleteEvent(eventId);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "upsert") {
      if (!tripId) {
        return new Response(JSON.stringify({ error: "tripId required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: trip } = await admin.from("transportation_trips").select("*").eq("id", tripId).maybeSingle();
      if (!trip) {
        return new Response(JSON.stringify({ error: "Trip not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!userIsAdmin && trip.user_id !== user.id) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Les trips d'un booking de test OU annule ne vont jamais au calendrier
      // chauffeur (annule : sinon un resync recreait les pickups d'un sejour
      // annule — corrige le 25 aout 2026).
      if (trip.booking_id) {
        const { data: tb } = await admin.from("bookings").select("is_test,cancelled_at").eq("id", trip.booking_id).maybeSingle();
        if (tb?.is_test || tb?.cancelled_at) {
          return new Response(JSON.stringify({ skipped: tb?.is_test ? "test_booking" : "cancelled_booking" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
      try {
        const newId = await syncOne(admin, trip);
        return new Response(JSON.stringify({ ok: true, eventId: newId }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e: any) {
        const msg = String(e?.message || e).slice(0, 500);
        console.error("upsert failed", msg);
        await admin.from("transportation_trips").update({
          sync_status: "failed",
          sync_error: msg,
        }).eq("id", trip.id);
        return new Response(JSON.stringify({ ok: false, error: msg }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (action === "backfill" || action === "force_resync") {
      if (!userIsAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // backfill: ALL trips missing an event id or previously failed (past + future).
      // force_resync: ALL trips — delete existing events first, then recreate.
      let query = admin.from("transportation_trips").select("*");
      if (action === "backfill") {
        query = query.or("google_calendar_event_id.is.null,sync_status.eq.failed");
      }
      const { data: trips } = await query;

      let purged = 0;
      if (action === "force_resync") {
        purged = await purgeAllCalendarEvents();
        await admin.from("transportation_trips")
          .update({ google_calendar_event_id: null })
          .not("id", "is", null);
        for (const t of (trips || [])) {
          (t as any).google_calendar_event_id = null;
        }
      }

      // Les trips des bookings de test ou annules ne vont jamais au calendrier
      const { data: skippedBookings } = await admin.from("bookings").select("id,is_test,cancelled_at")
        .or("is_test.eq.true,cancelled_at.not.is.null");
      const testIds = new Set((skippedBookings ?? []).map((b: { id: string }) => b.id));

      let synced = 0, failed = 0;
      const results: Array<{ trip_id: string; trip_date: string; guest: string; ok: boolean; event_id?: string; error?: string }> = [];

      for (const trip of (trips || [])) {
        if (trip.booking_id && testIds.has(trip.booking_id)) continue;
        try {
          const newId = await syncOne(admin, trip);
          synced++;
          console.log(`[sync] OK trip=${trip.id} date=${trip.trip_date} event=${newId}`);
          results.push({ trip_id: trip.id, trip_date: trip.trip_date, guest: "", ok: true, event_id: newId });
        } catch (e: any) {
          failed++;
          const msg = String(e?.message || e).slice(0, 500);
          console.error(`[sync] FAIL trip=${trip.id} date=${trip.trip_date} err=${msg}`);
          await admin.from("transportation_trips").update({
            sync_status: "failed",
            sync_error: msg,
          }).eq("id", trip.id);
          results.push({ trip_id: trip.id, trip_date: trip.trip_date, guest: "", ok: false, error: msg });
        }
      }
      return new Response(
        JSON.stringify({ ok: true, action, purged, synced, failed, total: (trips || []).length, results }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
