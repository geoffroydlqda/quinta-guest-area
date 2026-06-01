import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ADMIN_EMAILS = ["hello@quintamor.com", "loïs@quintamor.com", "lois@quintamor.com", "977luisferreira@gmail.com"].map((e) =>
  e.normalize("NFC").toLowerCase().trim()
);
const isAdmin = (email?: string | null) =>
  !!email && ADMIN_EMAILS.includes(email.normalize("NFC").toLowerCase().trim());

const UUID_RE = /^[0-9a-f-]{36}$/i;

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
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user || !isAdmin(user.email)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const guestId: string | undefined = body?.guest_id;
    const bookingId: string | undefined = body?.booking_id;

    if ((!guestId || !UUID_RE.test(guestId)) && (!bookingId || !UUID_RE.test(bookingId))) {
      return new Response(JSON.stringify({ error: "Invalid guest_id or booking_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Resolve target user_id and booking
    let booking: any = null;
    let targetUserId: string | null = null;

    if (bookingId && UUID_RE.test(bookingId)) {
      const bRes = await admin.from("bookings").select("*").eq("id", bookingId).maybeSingle();
      if (!bRes.data) {
        return new Response(JSON.stringify({ error: "Booking not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      booking = bRes.data;
      targetUserId = booking.user_id || null;
    } else if (guestId) {
      targetUserId = guestId;
      const bRes = await admin
        .from("bookings")
        .select("*")
        .eq("user_id", guestId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      booking = bRes.data || null;
    }

    let profile: any = null;
    let room: any = null;
    let food: any = null;
    let trips: any[] = [];
    let passengers: any[] = [];

    const resolvedBookingId: string | null = booking?.id ?? null;

    if (targetUserId) {
      const pRes = await admin
        .from("guest_profiles").select("*")
        .eq("user_id", targetUserId).maybeSingle();
      profile = pRes.data || null;
    }

    if (resolvedBookingId) {
      const [rRes, fRes, tRes, paxRes] = await Promise.all([
        admin.from("room_setups").select("*").eq("booking_id", resolvedBookingId).maybeSingle(),
        admin.from("food_plans").select("*").eq("booking_id", resolvedBookingId).maybeSingle(),
        admin.from("transportation_trips").select("*").eq("booking_id", resolvedBookingId),
        admin.from("transportation_passengers").select("*").eq("booking_id", resolvedBookingId),
      ]);
      room = rRes.data || null;
      food = fRes.data || null;
      trips = tRes.data || [];
      passengers = paxRes.data || [];
    }

    if (!room && targetUserId) {
      const r = await admin.from("room_setups").select("*").eq("user_id", targetUserId).maybeSingle();
      room = r.data || null;
    }
    if (!food && targetUserId) {
      const f = await admin.from("food_plans").select("*").eq("user_id", targetUserId).maybeSingle();
      food = f.data || null;
    }
    if (trips.length === 0 && targetUserId) {
      const t = await admin.from("transportation_trips").select("*").eq("user_id", targetUserId);
      trips = t.data || [];
      const pax = await admin.from("transportation_passengers").select("*").eq("user_id", targetUserId);
      passengers = pax.data || [];
    }

    if (!booking && !profile) {
      return new Response(JSON.stringify({ error: "Guest not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      booking,
      profile,
      room,
      food,
      trips,
      passengers,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
