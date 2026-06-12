// Sync transportation trips to the Quinta Transportation Google Calendar.
// Actions: upsert (create/update for one trip), delete (one event), backfill (admin only).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CALENDAR_ID =
  "c_df9857682cb149faf3d73da4798ccc4f246c69fd587faa7bafd56f133005f1a6@group.calendar.google.com";
const TZ = "Europe/Lisbon";
const CAL_GW = "https://connector-gateway.lovable.dev/google_calendar/calendar/v3";
const MAPS_GW = "https://connector-gateway.lovable.dev/google_maps";
const FALLBACK_MINUTES = 60;

const ADMIN_EMAILS = [
  "hello@quintamor.com",
  "loïs@quintamor.com",
  "lois@quintamor.com",
  "977luisferreira@gmail.com",
].map((e) => e.normalize("NFC").toLowerCase().trim());
const isAdmin = (e?: string | null) =>
  !!e && ADMIN_EMAILS.includes(e.normalize("NFC").toLowerCase().trim());

const BodySchema = z.object({
  action: z.enum(["upsert", "delete", "backfill", "force_resync"]),
  tripId: z.string().uuid().optional(),
  eventId: z.string().min(1).max(1024).optional(),
});

function calendarHeaders() {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const GCAL_KEY = Deno.env.get("GOOGLE_CALENDAR_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
  if (!GCAL_KEY) throw new Error("GOOGLE_CALENDAR_API_KEY is not configured");
  return {
    Authorization: `Bearer ${LOVABLE_API_KEY}`,
    "X-Connection-Api-Key": GCAL_KEY,
    "Content-Type": "application/json",
  };
}

function mapsHeaders(extra: Record<string, string> = {}) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const MAPS_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!LOVABLE_API_KEY || !MAPS_KEY) return null;
  return {
    Authorization: `Bearer ${LOVABLE_API_KEY}`,
    "X-Connection-Api-Key": MAPS_KEY,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function computeDriveMinutes(origin: string, destination: string): Promise<number> {
  if (!origin || !destination) return FALLBACK_MINUTES;
  const headers = mapsHeaders({ "X-Goog-FieldMask": "routes.duration" });
  if (!headers) return FALLBACK_MINUTES;
  try {
    const r = await fetch(`${MAPS_GW}/routes/directions/v2:computeRoutes`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        origin: { address: origin },
        destination: { address: destination },
        travelMode: "DRIVE",
      }),
    });
    if (!r.ok) {
      console.warn("routes failed", r.status, await r.text());
      return FALLBACK_MINUTES;
    }
    const data = await r.json();
    const dur: string | undefined = data?.routes?.[0]?.duration;
    if (!dur) return FALLBACK_MINUTES;
    const seconds = parseInt(String(dur).replace("s", ""), 10);
    if (!Number.isFinite(seconds) || seconds <= 0) return FALLBACK_MINUTES;
    return Math.max(15, Math.round(seconds / 60));
  } catch (e) {
    console.warn("routes error", e);
    return FALLBACK_MINUTES;
  }
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
    `🚜 Vehicle: ${trip.taxi_size}\n\n` +
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
  const headers = calendarHeaders();
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
      `${CAL_GW}/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${encodeURIComponent(eventId)}`,
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
      `${CAL_GW}/calendars/${encodeURIComponent(CALENDAR_ID)}/events`,
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
  const headers = calendarHeaders();
  const r = await fetch(
    `${CAL_GW}/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE", headers },
  );
  if (!r.ok && r.status !== 404 && r.status !== 410) {
    const txt = await r.text();
    throw new Error(`Calendar delete ${r.status}: ${String(txt).slice(0, 200)}`);
  }
}

async function purgeAllCalendarEvents(): Promise<number> {
  const headers = calendarHeaders();
  let pageToken: string | undefined = undefined;
  let deleted = 0;
  do {
    const url = new URL(`${CAL_GW}/calendars/${encodeURIComponent(CALENDAR_ID)}/events`);
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

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten() }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { action, tripId, eventId } = parsed.data;
    const userIsAdmin = isAdmin(user.email);

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

      let synced = 0, failed = 0;
      const results: Array<{ trip_id: string; trip_date: string; guest: string; ok: boolean; event_id?: string; error?: string }> = [];

      for (const trip of (trips || [])) {
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
