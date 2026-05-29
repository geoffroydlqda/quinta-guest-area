import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BodySchema = z.object({
  booking_id: z.string().uuid(),
});

const ADMIN_EMAILS = [
  "hello@quintamor.com",
  "loïs@quintamor.com",
  "lois@quintamor.com",
  "977luisferreira@gmail.com",
];

const norm = (e?: string | null) =>
  (e || "").normalize("NFC").toLowerCase().trim();

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
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
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);
    if (!ADMIN_EMAILS.includes(norm(user.email))) return json({ error: "Forbidden" }, 403);

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);

    const { booking_id } = parsed.data;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: booking, error: findErr } = await admin
      .from("bookings")
      .select("id, user_id, invitation_claimed, admin_managed")
      .eq("id", booking_id)
      .maybeSingle();
    if (findErr) return json({ error: findErr.message }, 500);
    if (!booking) return json({ error: "Booking not found" }, 404);

    // Idempotent: already claimed by this admin
    if (booking.invitation_claimed && booking.user_id === user.id) {
      return json({ ok: true, already: true, booking_id });
    }

    // Claimed by someone else
    if (booking.invitation_claimed && booking.user_id && booking.user_id !== user.id) {
      return json({ error: "Already claimed by another user" }, 409);
    }

    const { error: updErr } = await admin
      .from("bookings")
      .update({
        user_id: user.id,
        invitation_claimed: true,
        admin_managed: true,
        invitation_token: null,
      })
      .eq("id", booking_id);
    if (updErr) return json({ error: updErr.message }, 500);

    return json({ ok: true, booking_id });
  } catch (e: any) {
    console.error("[admin-claim-booking] error", e);
    return json({ error: e.message ?? String(e) }, 500);
  }
});
