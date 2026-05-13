import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_sheets/v4";

interface Profile {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  email: string;
  check_in_date: string | null;
  check_out_date: string | null;
  guests_count: number;
  status_overall: string;
  submitted_at: string | null;
}

async function writeSheet(spreadsheetId: string, lovableKey: string, sheetsKey: string, sheetName: string, values: any[][]) {
  // Ensure sheet exists, then clear and write
  await fetch(`${GATEWAY_URL}/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": sheetsKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title: sheetName } } }],
    }),
  }).catch(() => {});

  await fetch(`${GATEWAY_URL}/spreadsheets/${spreadsheetId}/values/${sheetName}!A1:Z10000:clear`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": sheetsKey,
      "Content-Type": "application/json",
    },
  });

  const res = await fetch(
    `${GATEWAY_URL}/spreadsheets/${spreadsheetId}/values/${sheetName}!A1?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": sheetsKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values }),
    }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Sheets write failed [${sheetName}] ${res.status}: ${t}`);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    const sheetsKey = Deno.env.get("GOOGLE_SHEETS_API_KEY");
    const spreadsheetId = Deno.env.get("GOOGLE_SHEETS_SPREADSHEET_ID");

    if (!lovableKey || !sheetsKey || !spreadsheetId) {
      return new Response(JSON.stringify({ error: "Sheets sync not configured" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const [profilesRes, roomsRes, tripsRes, foodRes] = await Promise.all([
      admin.from("guest_profiles").select("*"),
      admin.from("room_setups").select("*"),
      admin.from("transportation_trips").select("*"),
      admin.from("food_plans").select("*"),
    ]);

    const ADMIN_EMAILS = ['hello@quintamor.com', 'loïs@quintamor.com', 'lois@quintamor.com', '977luisferreira@gmail.com']
      .map((e) => e.normalize('NFC').toLowerCase().trim());
    const isAdminEmail = (email?: string | null) =>
      !!email && ADMIN_EMAILS.includes(email.normalize('NFC').toLowerCase().trim());

    const allProfiles: Profile[] = profilesRes.data || [];
    const adminUserIds = new Set(allProfiles.filter((p: any) => isAdminEmail(p.email)).map((p: any) => p.user_id));
    const profiles: Profile[] = allProfiles.filter((p: any) => !adminUserIds.has(p.user_id));
    const rooms = (roomsRes.data || []).filter((r: any) => !adminUserIds.has(r.user_id));
    const trips = (tripsRes.data || []).filter((t: any) => !adminUserIds.has(t.user_id));
    const foodPlans = (foodRes.data || []).filter((f: any) => !adminUserIds.has(f.user_id));

    const profileById = new Map(profiles.map((p) => [p.user_id, p]));
    const guestName = (uid: string) => {
      const p = profileById.get(uid);
      if (!p) return "Unknown";
      return p.full_name || `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || p.email;
    };

    // Guests Overview
    const guestsRows: any[][] = [
      ["First name", "Last name", "Email", "Check-in", "Check-out", "Guests", "Status", "Submitted at"],
      ...profiles.map((p) => [
        p.first_name || "", p.last_name || "", p.email,
        p.check_in_date || "", p.check_out_date || "",
        p.guests_count, p.status_overall, p.submitted_at || "",
      ]),
    ];

    // Food
    const foodRows: any[][] = [["Guest", "Date", "Meals", "Diet", "Guests count"]];
    for (const fp of foodPlans) {
      const sels = Array.isArray(fp.selections) ? fp.selections : [];
      const p = profileById.get(fp.user_id);
      const gc = p?.guests_count ?? 1;
      for (const s of sels as any[]) {
        const meals = s.fullBoard
          ? "Full board"
          : ["breakfast", "lunch", "dinner"].filter((m) => s[m]).join(", ") || "—";
        if (meals === "—") continue;
        foodRows.push([guestName(fp.user_id), s.date, meals, fp.diet_preference || "", gc]);
      }
    }

    // Transport
    const transportRows: any[][] = [
      ["Date", "Time", "Guest", "Direction", "Pickup", "Dropoff", "Taxi", "Passengers", "Price"],
      ...trips
        .sort((a: any, b: any) => `${a.trip_date} ${a.trip_time}`.localeCompare(`${b.trip_date} ${b.trip_time}`))
        .map((t: any) => [
          t.trip_date, t.trip_time, guestName(t.user_id), t.trip_direction,
          t.pickup_location, t.dropoff_location, t.taxi_size, t.passengers_count, t.price_estimate,
        ]),
    ];

    // Rooms
    const roomRows: any[][] = [
      ["Guest", "Email", "Queen shared", "Twin shared", "Queen ensuite", "Twin ensuite", "Remarks"],
      ...rooms.map((r: any) => [
        guestName(r.user_id), r.email,
        r.queen_shared_qty, r.twins_shared_qty, r.queen_ensuite_qty, r.twins_ensuite_qty,
        r.remarks_roomsetup || r.remarks || "",
      ]),
    ];

    await writeSheet(spreadsheetId, lovableKey, sheetsKey, "Guests Overview", guestsRows);
    await writeSheet(spreadsheetId, lovableKey, sheetsKey, "Food Planning", foodRows);
    await writeSheet(spreadsheetId, lovableKey, sheetsKey, "Transportation", transportRows);
    await writeSheet(spreadsheetId, lovableKey, sheetsKey, "Room Setup", roomRows);

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("sync-google-sheets error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
