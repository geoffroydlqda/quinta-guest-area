import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

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

const FROM_EMAIL = "Quinta do Amor <noreply@quintamor.com>";
const GUEST_AREA_URL = "https://quinta-guest-area.lovable.app/dashboard";
const ADMIN_BCC = "hello@quintamor.com";

const BodySchema = z.object({ user_id: z.string().uuid() });

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function fixedPrice(pickup: string, dropoff: string, taxi: string): number | null {
  const std = ["Lisbon", "Lisbon Airport", "Quinta do Amor"];
  const ok = std.includes(pickup) && std.includes(dropoff) && pickup !== dropoff;
  if (!ok) return null;
  if (taxi === "4 seats") return 80;
  if (taxi === "6 seats") return 90;
  if (taxi === "8 seats") return 100;
  return null;
}

function effectivePrice(t: any): number | null {
  const f = fixedPrice(t.pickup_location, t.dropoff_location, t.taxi_size);
  if (f !== null) return f;
  if (t.custom_price !== null && t.custom_price !== undefined && !Number.isNaN(Number(t.custom_price))) return Number(t.custom_price);
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user || !isAdmin(user.email)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid body" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { user_id } = parsed.data;

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const [{ data: profile }, { data: trips }] = await Promise.all([
      admin.from("guest_profiles").select("full_name, first_name, email").eq("user_id", user_id).maybeSingle(),
      admin.from("transportation_trips").select("*").eq("user_id", user_id),
    ]);
    if (!profile?.email) {
      return new Response(JSON.stringify({ error: "Guest not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const sorted = [...(trips || [])].sort((a, b) => `${a.trip_date} ${a.trip_time}`.localeCompare(`${b.trip_date} ${b.trip_time}`));
    let total = 0;
    let pending = 0;
    const rowsHtml = sorted.map((t, i) => {
      const p = effectivePrice(t);
      if (p !== null) total += p; else pending++;
      const taxiLabel = t.taxi_size === "4 seats" ? "4-seat taxi" : t.taxi_size === "6 seats" ? "6-seat taxi" : t.taxi_size === "8 seats" ? "8-seat taxi" : t.taxi_size;
      const priceLabel = p !== null ? `${p}€` : "Custom offer (pending)";
      return `<tr><td style="padding: 8px 0;">
        <table width="100%" style="background-color:#f6efea;border-radius:8px;">
          <tr><td style="padding:10px 14px 4px;color:#000;font-weight:700;font-size:14px;">Trip ${i + 1}</td></tr>
          <tr><td style="padding:2px 14px;color:#333;font-size:13px;">${escapeHtml(t.pickup_location)} → ${escapeHtml(t.dropoff_location)}</td></tr>
          <tr><td style="padding:2px 14px;color:#333;font-size:13px;">${escapeHtml(t.trip_date)} at ${escapeHtml(t.trip_time)}</td></tr>
          <tr><td style="padding:2px 14px;color:#333;font-size:13px;">Vehicle: ${escapeHtml(taxiLabel)}</td></tr>
          <tr><td style="padding:2px 14px 10px;color:#000;font-size:13px;font-weight:700;">Price: ${priceLabel}</td></tr>
        </table>
      </td></tr>`;
    }).join("");

    const greeting = escapeHtml(profile.first_name || profile.full_name?.split(" ")[0] || "Guest");

    const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:Georgia,serif;background-color:#f6efea;color:#000;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6efea;padding:32px 16px;">
        <tr><td align="center">
          <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
            <tr><td style="background-color:#5e6d3f;padding:24px 32px;border-radius:12px 12px 0 0;text-align:center;">
              <h1 style="margin:0;color:#fff;font-size:24px;font-weight:400;">Transportation pricing update</h1>
            </td></tr>
            <tr><td style="background-color:#fff;padding:28px 32px;">
              <p style="margin:0 0 12px;font-size:15px;">Hello ${greeting},</p>
              <p style="margin:0 0 18px;font-size:14px;color:#333;">Your transportation pricing has been updated. Here is the latest summary of your trips:</p>
              <table width="100%">${rowsHtml || '<tr><td style="color:#666;font-size:13px;">No trips yet.</td></tr>'}</table>
              <p style="margin:18px 0 0;font-size:15px;"><strong>Transportation subtotal:</strong> ${total}€${pending > 0 ? ` <span style="color:#a16207;">(${pending} custom offer${pending !== 1 ? "s" : ""} pending)</span>` : ""}</p>
              <p style="margin:18px 0 0;text-align:center;">
                <a href="${GUEST_AREA_URL}" style="display:inline-block;background-color:#5e6d3f;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:14px;">Open Guest Area</a>
              </p>
            </td></tr>
            <tr><td style="background-color:#5e6d3f;padding:18px;border-radius:0 0 12px 12px;text-align:center;color:rgba(255,255,255,0.85);font-size:12px;">Quinta do Amor</td></tr>
          </table>
        </td></tr>
      </table>
    </body></html>`;

    const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [profile.email],
      bcc: [ADMIN_BCC],
      subject: "Your transportation pricing has been updated — Quinta do Amor",
      html,
    });
    if (error) {
      return new Response(JSON.stringify({ error: String(error) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: true, total, pending }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
