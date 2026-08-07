// Sync bookings -> calendrier Google "Events" de la Quinta.
// Un booking = un événement all-day (check-in -> check-out inclus), heures de
// check-in/out dans la description. Les événements existants créés à la main
// ont été liés (bookings.google_calendar_event_id) : on ne touche alors qu'aux
// dates + description, jamais au titre choisi par Geoffroy. Les événements créés
// par cette fonction portent le titre du booking et sont renommés à jour.
// Actions: upsert (un booking), delete (event d'un booking supprimé), backfill (tous).
// No-op propre ("skipped") tant que le service account n'est pas configuré.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

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
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CALENDAR_ID =
  "c_24f56a0e81b689ed29405467bd2c1dad86e041a95ee5a24a1156b14edeecb304@group.calendar.google.com";
const TZ = "Europe/Lisbon";
const CAL_API = "https://www.googleapis.com/calendar/v3";

const BodySchema = z.object({
  action: z.enum(["upsert", "delete", "backfill"]).default("upsert"),
  booking_id: z.string().uuid().optional(),
  event_id: z.string().min(1).max(1024).optional(),
});

// ---- OAuth2 service account (JWT RS256 -> access token, mis en cache) ------
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
  if (!email || !key) throw new Error("SA_NOT_CONFIGURED");
  return { email, key: key.replace(/\\n/g, "\n") };
}

let _gTok: { token: string; exp: number } | null = null;
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

type BookingRow = {
  id: string;
  retreat_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string;
  guest_count: number | null;
  check_in_date: string | null;
  check_out_date: string | null;
  check_in_time: string | null;
  check_out_time: string | null;
  event_type: string | null;
  google_calendar_event_id: string | null;
};

function bookingTitle(b: BookingRow): string {
  const name = b.retreat_name || `${b.first_name ?? ""} ${b.last_name ?? ""}`.trim() || b.email;
  const suffix: Record<string, string> = {
    wedding: " - Wedding", day_retreat: " - Day event", other: "", retreat: " - Retreat",
  };
  return `${name}${suffix[b.event_type ?? "retreat"] ?? ""}`;
}

function bookingDescription(b: BookingRow): string {
  const hhmm = (t: string | null, dflt: string) => (t ?? dflt).slice(0, 5);
  return [
    `Check-in ${hhmm(b.check_in_time, "15:00")} · Check-out ${hhmm(b.check_out_time, "11:00")}`,
    b.guest_count ? `${b.guest_count} guests` : null,
    `Admin: https://guest.quintamor.com/admin/guest/${b.id}`,
  ].filter(Boolean).join("\n");
}

// All-day: end.date est exclusif chez Google -> check_out + 1 jour.
function datePlusOne(d: string): string {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

async function upsertBooking(admin: ReturnType<typeof createClient>, b: BookingRow) {
  if (!b.check_in_date || !b.check_out_date) return { id: b.id, skipped: "no_dates" };
  const token = await googleAccessToken();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const dates = {
    start: { date: b.check_in_date },
    end: { date: datePlusOne(b.check_out_date) },
  };
  let eventId = b.google_calendar_event_id;
  let ok = false;
  if (eventId) {
    // Événement existant. S'il a été créé à la main par Geoffroy (description
    // libre, liens Notion…), on ne touche QUE les dates — jamais son titre ni
    // sa description. On ne réécrit la description que si elle est vide ou
    // qu'elle vient de cette fonction (marqueur "guest.quintamor.com/admin").
    const getR = await fetch(`${CAL_API}/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${encodeURIComponent(eventId)}`, { headers });
    if (getR.status === 404 || getR.status === 410) {
      eventId = null; // événement supprimé côté Google -> recréer
    } else if (!getR.ok) {
      throw new Error(`GET ${getR.status}: ${(await getR.text()).slice(0, 200)}`);
    } else {
      const ev = await getR.json();
      const ownDescription = !ev.description || String(ev.description).includes("guest.quintamor.com/admin/guest/");
      const patch: Record<string, unknown> = { ...dates };
      if (ownDescription) patch.description = bookingDescription(b);
      const r = await fetch(`${CAL_API}/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${encodeURIComponent(eventId)}`, {
        method: "PATCH", headers, body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error(`PATCH ${r.status}: ${(await r.text()).slice(0, 200)}`);
      ok = true;
    }
  }
  if (!eventId) {
    const r = await fetch(`${CAL_API}/calendars/${encodeURIComponent(CALENDAR_ID)}/events`, {
      method: "POST", headers,
      body: JSON.stringify({ ...dates, summary: bookingTitle(b), description: bookingDescription(b), transparency: "transparent" }),
    });
    if (!r.ok) throw new Error(`POST ${r.status}: ${(await r.text()).slice(0, 200)}`);
    eventId = (await r.json()).id as string;
    ok = true;
  }
  await admin.from("bookings").update({
    google_calendar_event_id: eventId,
    calendar_sync_status: ok ? "synced" : "error",
    calendar_synced_at: new Date().toISOString(),
  }).eq("id", b.id);
  return { id: b.id, event_id: eventId, synced: ok };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user || !(await isAdminEmailDb(user.email))) return json({ error: "Forbidden" }, 403);

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
    const { action, booking_id, event_id } = parsed.data;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const SELECT = "id,retreat_name,first_name,last_name,email,guest_count,check_in_date,check_out_date,check_in_time,check_out_time,event_type,google_calendar_event_id,is_test";

    if (action === "delete") {
      if (!event_id) return json({ error: "event_id required" }, 400);
      const token = await googleAccessToken();
      const r = await fetch(`${CAL_API}/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${encodeURIComponent(event_id)}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok && r.status !== 404 && r.status !== 410) throw new Error(`DELETE ${r.status}`);
      return json({ deleted: true });
    }

    if (action === "backfill") {
      const { data, error } = await admin.from("bookings").select(SELECT).not("check_in_date", "is", null);
      if (error) throw error;
      const results = [];
      for (const b of (data ?? []) as (BookingRow & { is_test?: boolean | null })[]) {
        if (b.is_test) continue; // les bookings de test ne vont jamais au calendrier
        try { results.push(await upsertBooking(admin, b)); }
        catch (e) { results.push({ id: b.id, error: String(e).slice(0, 200) }); }
      }
      return json({ results });
    }

    // upsert
    if (!booking_id) return json({ error: "booking_id required" }, 400);
    const { data: b, error } = await admin.from("bookings").select(SELECT).eq("id", booking_id).maybeSingle();
    if (error) throw error;
    if (!b) return json({ error: "Booking not found" }, 404);
    if ((b as { is_test?: boolean | null }).is_test) return json({ skipped: "test_booking" });
    return json(await upsertBooking(admin, b as BookingRow));
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (msg.includes("SA_NOT_CONFIGURED")) {
      // Service account pas encore créé : on sort proprement, l'admin n'affiche pas d'erreur.
      return json({ skipped: "service_account_not_configured" });
    }
    console.error("sync-booking-calendar error:", msg);
    return json({ error: msg }, 500);
  }
});
