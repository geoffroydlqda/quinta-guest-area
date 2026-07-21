import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};


serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const _admins = await getAdminEmails();
    const isAdmin = (email?: string | null) =>
      !!email && _admins.includes((email ?? "").normalize("NFC").toLowerCase().trim());
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

    const [profiles, rooms, trips, passengers, food, bookings] = await Promise.all([
      admin.from("guest_profiles").select("*"),
      admin.from("room_setups").select("*"),
      admin.from("transportation_trips").select("*"),
      admin.from("transportation_passengers").select("*"),
      admin.from("food_plans").select("*"),
      admin.from("bookings").select("*").order("created_at", { ascending: false }),
    ]);

    // Filter out admin user profiles and their related rows
    const allProfiles = profiles.data || [];
    const adminUserIds = new Set(
      allProfiles.filter((p: any) => isAdmin(p.email)).map((p: any) => p.user_id)
    );
    const filteredProfiles = allProfiles.filter((p: any) => !adminUserIds.has(p.user_id));
    const filteredRooms = rooms.data || [];
    const filteredTripsRaw = trips.data || [];
    const filteredPassengers = passengers.data || [];
    const filteredFood = food.data || [];
    const filteredBookings = (bookings.data || []).filter(
      (b: any) => !isAdmin(b.email) && (!b.user_id || !adminUserIds.has(b.user_id))
    );

    // Attach passengers to their trips (preserve creation order)
    const paxByTrip = new Map<string, any[]>();
    for (const p of [...filteredPassengers].sort((a: any, b: any) =>
      String(a.created_at || "").localeCompare(String(b.created_at || ""))
    )) {
      const list = paxByTrip.get(p.trip_id) || [];
      list.push(p);
      paxByTrip.set(p.trip_id, list);
    }
    const filteredTrips = filteredTripsRaw.map((t: any) => ({
      ...t,
      passengers: paxByTrip.get(t.id) || [],
    }));

    return new Response(JSON.stringify({
      profiles: filteredProfiles,
      rooms: filteredRooms,
      trips: filteredTrips,
      food: filteredFood,
      bookings: filteredBookings,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
