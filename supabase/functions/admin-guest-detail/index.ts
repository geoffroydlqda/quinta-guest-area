import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ADMIN_EMAILS = ["hello@quintamor.com", "loïs@quintamor.com"].map((e) =>
  e.normalize("NFC").toLowerCase().trim()
);
const isAdmin = (email?: string | null) =>
  !!email && ADMIN_EMAILS.includes(email.normalize("NFC").toLowerCase().trim());

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
    if (!guestId || !/^[0-9a-f-]{36}$/i.test(guestId)) {
      return new Response(JSON.stringify({ error: "Invalid guest_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const [profile, room, food, trips, passengers] = await Promise.all([
      admin.from("guest_profiles").select("*").eq("user_id", guestId).maybeSingle(),
      admin.from("room_setups").select("*").eq("user_id", guestId).maybeSingle(),
      admin.from("food_plans").select("*").eq("user_id", guestId).maybeSingle(),
      admin.from("transportation_trips").select("*").eq("user_id", guestId),
      admin.from("transportation_passengers").select("*").eq("user_id", guestId),
    ]);

    if (!profile.data) {
      return new Response(JSON.stringify({ error: "Guest not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      profile: profile.data,
      room: room.data || null,
      food: food.data || null,
      trips: trips.data || [],
      passengers: passengers.data || [],
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
