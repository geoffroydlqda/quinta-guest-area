// Sync housekeeping_sessions -> calendrier Google "Housekeeping" dédié.
// Une session = un événement (horaire si start_time est renseignée, sinon
// all-day) : "Housekeeping — {event}" avec équipe et notes en description.
// Actions : upsert {session_id}, delete {event_id}.
// Service account : mêmes identifiants que sync-booking-calendar — le
// calendrier Housekeeping doit être partagé avec le SA (Make changes).
// Auth : JWT admin (déclenché depuis l'onglet Housekeeping uniquement).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const CALENDAR_ID =
  "c_4895f757dd0e751ce2493d925a8fa416ef346b8f616dae3777bffb234c396174@group.calendar.google.com";
const TZ = "Europe/Lisbon";
const CAL_API = "https://www.googleapis.com/calendar/v3";

const BodySchema = z.object({
  action: z.enum(["upsert", "delete"]).default("upsert"),
  session_id: z.string().uuid().optional(),
  event_id: z.string().min(1).max(1024).optional(),
});

async function isAdminEmailDb(email?: string | null): Promise<boolean> {
  if (!email) return false;
  const { data } = await admin.from("admin_users").select("email");
  return (data ?? []).map((r: { email: string }) => String(r.email).toLowerCase().trim())
    .includes(email.toLowerCase().trim());
}

// ---- OAuth2 service account (identique à sync-booking-calendar) -----------
async function getSaCreds(): Promise<{ email: string; key: string }> {
  let email = Deno.env.get("GOOGLE_SA_EMAIL") ?? "";
  let key = Deno.env.get("GOOGLE_SA_PRIVATE_KEY") ?? "";
  if (!email || !key) {
    const { data } = await admin.from("app_settings").select("value").eq("key", "internal").maybeSingle();
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

function datePlusOne(d: string): string {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
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
    const { action } = parsed.data;

    let token: string;
    try {
      token = await googleAccessToken();
    } catch (e) {
      if (String((e as Error).message).includes("SA_NOT_CONFIGURED")) {
        return json({ skipped: "sa_not_configured" });
      }
      throw e;
    }
    const gHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    // Erreurs Google renvoyées en 200 + {error} : supabase.functions.invoke ne
    // lit pas le corps des non-2xx, le toast afficherait "non-2xx status code".
    const saEmail = (await getSaCreds()).email;
    const gError = async (verb: string, r: Response) => {
      const body = (await r.text()).slice(0, 200);
      const hint = r.status === 404 || r.status === 403
        ? ` — the Housekeeping calendar is probably not shared with ${saEmail} ("Make changes to events").`
        : "";
      return json({ error: `Calendar ${verb} ${r.status}: ${body}${hint}` });
    };

    if (action === "delete") {
      const eventId = parsed.data.event_id;
      if (!eventId) return json({ error: "event_id required" }, 400);
      const r = await fetch(`${CAL_API}/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${encodeURIComponent(eventId)}`, {
        method: "DELETE", headers: gHeaders,
      });
      if (!r.ok && r.status !== 404 && r.status !== 410) {
        return await gError("delete", r);
      }
      return json({ deleted: true });
    }

    // ---- upsert ------------------------------------------------------------
    const sessionId = parsed.data.session_id;
    if (!sessionId) return json({ error: "session_id required" }, 400);
    const { data: s } = await admin.from("housekeeping_sessions")
      .select("id,booking_id,date,start_time,end_time,team,notes,gcal_event_id")
      .eq("id", sessionId).maybeSingle();
    if (!s) return json({ error: "Session not found" }, 404);
    const { data: b } = await admin.from("bookings")
      .select("id,retreat_name,first_name,last_name,email,guest_count,check_in_date,check_out_date")
      .eq("id", s.booking_id).maybeSingle();
    if (!b) return json({ error: "Booking not found" }, 404);

    const eventName = b.retreat_name || `${b.first_name ?? ""} ${b.last_name ?? ""}`.trim() || b.email;
    const team = (s.team ?? []) as string[];
    const summary = `Housekeeping — ${eventName}${team.length ? ` · ${team.join(", ")}` : ""}`;
    const description = [
      team.length ? `Team: ${team.join(", ")}` : null,
      `Stay: ${b.check_in_date} → ${b.check_out_date}${b.guest_count ? ` · ${b.guest_count} guests` : ""}`,
      s.notes ? `Notes: ${s.notes}` : null,
      `Admin: https://guest.quintamor.com/admin/guest/${b.id}`,
    ].filter(Boolean).join("\n");

    const hhmm = (t: string | null) => (t ?? "").slice(0, 5);
    let start: Record<string, string>, end: Record<string, string>;
    if (s.start_time) {
      const endTime = s.end_time && s.end_time > s.start_time
        ? hhmm(s.end_time)
        : `${String(Math.min(23, Number(hhmm(s.start_time).slice(0, 2)) + 2)).padStart(2, "0")}${hhmm(s.start_time).slice(2)}`;
      start = { dateTime: `${s.date}T${hhmm(s.start_time)}:00`, timeZone: TZ };
      end = { dateTime: `${s.date}T${endTime}:00`, timeZone: TZ };
    } else {
      start = { date: s.date };
      end = { date: datePlusOne(s.date) };
    }

    const payload = { summary, description, start, end };
    const base = `${CAL_API}/calendars/${encodeURIComponent(CALENDAR_ID)}/events`;

    let eventId = s.gcal_event_id as string | null;
    if (eventId) {
      const r = await fetch(`${base}/${encodeURIComponent(eventId)}`, {
        method: "PATCH", headers: gHeaders, body: JSON.stringify(payload),
      });
      if (r.status === 404 || r.status === 410) eventId = null; // recréer
      else if (!r.ok) return await gError("update", r);
    }
    if (!eventId) {
      const r = await fetch(base, { method: "POST", headers: gHeaders, body: JSON.stringify(payload) });
      if (!r.ok) return await gError("create", r);
      const d = await r.json();
      eventId = d.id;
      await admin.from("housekeeping_sessions").update({ gcal_event_id: eventId, updated_at: new Date().toISOString() }).eq("id", s.id);
    }

    return json({ synced: true, event_id: eventId });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    console.error("sync-housekeeping-calendar error:", msg);
    return json({ error: msg }, 500);
  }
});
