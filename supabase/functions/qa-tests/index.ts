/**
 * QA endpoint: runs Phase 1 backfill + booking-link integrity checks against
 * the live database using the service role. Admin-only.
 *
 * GET/POST -> { ok: boolean, checks: Array<{ name, ok, detail }> }
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ADMIN_EMAILS = [
  "hello@quintamor.com",
  "loïs@quintamor.com",
  "lois@quintamor.com",
  "977luisferreira@gmail.com",
].map((e) => e.normalize("NFC").toLowerCase().trim());

type Check = { name: string; ok: boolean; detail?: string };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: aErr } = await userClient.auth.getUser();
    const email = (user?.email || "").normalize("NFC").toLowerCase().trim();
    if (aErr || !user || !ADMIN_EMAILS.includes(email)) {
      return json({ error: "Forbidden" }, 403);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const checks: Check[] = [];
    const add = (name: string, ok: boolean, detail?: string) =>
      checks.push({ name, ok, ...(detail ? { detail } : {}) });

    // 1. Every guest_profile has a matching booking by user_id
    const { data: profiles } = await admin.from("guest_profiles").select("user_id, email");
    const { data: bookings } = await admin
      .from("bookings")
      .select("id, user_id, email, invitation_token");
    const bookingUserIds = new Set((bookings ?? []).map((b: any) => b.user_id).filter(Boolean));
    const missing = (profiles ?? []).filter((p: any) => !bookingUserIds.has(p.user_id));
    add(
      "every guest_profile has a booking",
      missing.length === 0,
      missing.length ? `Missing: ${missing.map((m: any) => m.email).join(", ")}` : undefined
    );

    // 2. Every booking has user_id
    const orphans = (bookings ?? []).filter((b: any) => !b.user_id);
    add(
      "every booking has user_id",
      orphans.length === 0,
      orphans.length ? `${orphans.length} orphan(s)` : undefined
    );

    // 3. Invitation tokens are unique
    const tokens = (bookings ?? []).map((b: any) => b.invitation_token).filter(Boolean);
    add(
      "invitation_token uniqueness",
      new Set(tokens).size === tokens.length,
      undefined
    );

    // 4. Child rows agree with their booking's user_id
    const ownerByBooking = new Map(
      (bookings ?? []).map((b: any) => [b.id, b.user_id])
    );
    const tables = [
      "food_plans",
      "transportation_requests",
      "transportation_trips",
      "transportation_passengers",
      "room_setups",
      "docs_ack",
    ];
    for (const t of tables) {
      const { data: rows } = await admin.from(t).select("id, user_id, booking_id");
      const mismatches: string[] = [];
      for (const r of (rows ?? []) as any[]) {
        if (!r.booking_id) continue;
        const owner = ownerByBooking.get(r.booking_id);
        if (!owner) mismatches.push(`${r.id}: booking missing`);
        else if (owner !== r.user_id) mismatches.push(`${r.id}: user_id mismatch`);
      }
      add(
        `${t}: child rows match booking owner`,
        mismatches.length === 0,
        mismatches.length ? mismatches.slice(0, 5).join("; ") : undefined
      );
    }

    // 5. At most one room_setup per (user_id, booking_id)
    const { data: rs } = await admin.from("room_setups").select("user_id, booking_id");
    const seen = new Map<string, number>();
    for (const r of (rs ?? []) as any[]) {
      const key = `${r.user_id}::${r.booking_id ?? "_"}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const dupes = [...seen.entries()].filter(([, n]) => n > 1);
    add(
      "room_setups: at most one per (user, booking)",
      dupes.length === 0,
      dupes.length ? dupes.map(([k]) => k).join(", ") : undefined
    );

    const ok = checks.every((c) => c.ok);
    return json({ ok, checks }, ok ? 200 : 409);
  } catch (e: any) {
    console.error("[qa-tests] error", e);
    return new Response(JSON.stringify({ error: e.message ?? String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
