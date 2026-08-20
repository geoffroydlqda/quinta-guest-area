// Notifie hello@quintamor.com quand un guest ajoute un ou plusieurs trips
// (pour demander une quote aux drivers au plus vite). Appel fire-and-forget
// depuis la page Transportation (jamais en mode admin/impersonation).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";
import { z } from "https://esm.sh/zod@3.23.8";

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);
const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const NOTIFY_TO = "hello@quintamor.com";
const FROM_EMAIL = "Quinta do Amor <hello@quintamor.com>";
const ADMIN_URL = "https://guest.quintamor.com/admin/transportation";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BodySchema = z.object({
  trip_ids: z.array(z.string().uuid()).min(1).max(6),
});

const esc = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);

    const { data: trips } = await admin.from("transportation_trips")
      .select("id,user_id,booking_id,trip_date,trip_time,pickup_location,dropoff_location,passengers_count,price_estimate,custom_price,trip_direction")
      .in("id", parsed.data.trip_ids);
    if (!trips?.length) return json({ error: "Trips not found" }, 404);
    // Sécurité : uniquement ses propres trips
    if (trips.some((t) => t.user_id !== user.id)) return json({ error: "Forbidden" }, 403);

    const bookingId = trips[0].booking_id;
    let guestLabel = user.email ?? "Guest";
    if (bookingId) {
      const { data: bk } = await admin.from("bookings")
        .select("retreat_name,first_name,last_name,email,is_test")
        .eq("id", bookingId).maybeSingle();
      if (bk?.is_test) return json({ skipped: "test_booking" });
      if (bk) {
        guestLabel = bk.retreat_name ||
          [bk.first_name, bk.last_name].filter(Boolean).join(" ").trim() ||
          bk.email || guestLabel;
      }
    }

    const rows = trips.map((t) => {
      const price = t.custom_price != null
        ? `${Number(t.custom_price)}€`
        : (t.price_estimate || "Custom offer");
      const needsQuote = t.custom_price == null && !/€\s*\d/.test(String(t.price_estimate || ""));
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap;">${esc(t.trip_date)} ${esc(String(t.trip_time).slice(0, 5))}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${esc(t.pickup_location)} → ${esc(t.dropoff_location)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;">${t.passengers_count}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap;">${esc(price)}${needsQuote ? " ⚠️ quote needed" : ""}</td>
      </tr>`;
    }).join("");

    const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#222;max-width:640px;">
      <p><strong>${esc(guestLabel)}</strong> just added ${trips.length > 1 ? `${trips.length} trips` : "a trip"} in the Guest Area.</p>
      <table style="border-collapse:collapse;margin:10px 0;">
        <tr>
          <th style="padding:6px 10px;text-align:left;border-bottom:2px solid #ccc;">When</th>
          <th style="padding:6px 10px;text-align:left;border-bottom:2px solid #ccc;">Route</th>
          <th style="padding:6px 10px;border-bottom:2px solid #ccc;">Pax</th>
          <th style="padding:6px 10px;text-align:left;border-bottom:2px solid #ccc;">Price</th>
        </tr>
        ${rows}
      </table>
      <p>Request a quote from the drivers, then set the price in the admin:</p>
      <p><a href="${ADMIN_URL}" style="color:#35532A;font-weight:bold;">Open Transportation admin</a></p>
    </div>`;

    const sent = await resend.emails.send({
      from: FROM_EMAIL,
      to: [NOTIFY_TO],
      subject: `New trip${trips.length > 1 ? "s" : ""} — ${guestLabel} (${trips.length > 1 ? `${trips.length} trips` : trips[0].trip_date})`,
      html,
    });
    if (sent.error) {
      console.error("notify-trip-added resend error:", sent.error);
      return json({ error: String(sent.error.message ?? sent.error) }, 502);
    }
    return json({ sent: true });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    console.error("notify-trip-added error:", msg);
    return json({ error: msg }, 500);
  }
});
