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

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const [profiles, rooms, trips, food] = await Promise.all([
      admin.from("guest_profiles").select("*"),
      admin.from("room_setups").select("*"),
      admin.from("transportation_trips").select("*"),
      admin.from("food_plans").select("*"),
    ]);

    // Filter out admin user profiles and their related rows
    const allProfiles = profiles.data || [];
    const adminUserIds = new Set(
      allProfiles.filter((p: any) => isAdmin(p.email)).map((p: any) => p.user_id)
    );
    const filteredProfiles = allProfiles.filter((p: any) => !adminUserIds.has(p.user_id));
    const filteredRooms = (rooms.data || []).filter((r: any) => !adminUserIds.has(r.user_id));
    const filteredTrips = (trips.data || []).filter((t: any) => !adminUserIds.has(t.user_id));
    const filteredFood = (food.data || []).filter((f: any) => !adminUserIds.has(f.user_id));

    return new Response(JSON.stringify({
      profiles: filteredProfiles,
      rooms: filteredRooms,
      trips: filteredTrips,
      food: filteredFood,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
