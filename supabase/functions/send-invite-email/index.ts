// send-invite-email — envoi manuel du lien d'invitation par email (Phase 1)
// Action explicitement déclenchée par un admin depuis le tableau de bord :
// rien ne part jamais automatiquement.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FROM_EMAIL = "Quinta do Amor <noreply@quintamor.com>";
const ADMIN_EMAIL = "hello@quintamor.com";
const GUEST_AREA_ORIGIN = "https://guest.quintamor.com";

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);
const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

async function isAdminEmailDb(email?: string | null): Promise<boolean> {
  if (!email) return false;
  const norm = email.normalize("NFC").toLowerCase().trim();
  const { data } = await admin.from("admin_users").select("email").eq("email", norm).maybeSingle();
  return !!data;
}

function hexToken(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

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
    if (authErr || !user || !(await isAdminEmailDb(user.email))) return json({ error: "Forbidden" }, 403);

    const { booking_id } = await req.json();
    if (typeof booking_id !== "string" || !booking_id) return json({ error: "booking_id required" }, 400);

    const { data: booking, error: findErr } = await admin
      .from("bookings")
      .select("id, email, first_name, retreat_name, check_in_date, check_out_date, invitation_token, invitation_claimed")
      .eq("id", booking_id)
      .maybeSingle();
    if (findErr) return json({ error: findErr.message }, 500);
    if (!booking) return json({ error: "Booking not found" }, 404);
    if (booking.invitation_claimed) return json({ error: "Booking already claimed" }, 409);
    if (!booking.email) return json({ error: "This booking has no email address" }, 400);

    let token = booking.invitation_token;
    if (!token) {
      token = hexToken(32);
      const { error: updErr } = await admin
        .from("bookings").update({ invitation_token: token }).eq("id", booking_id);
      if (updErr) return json({ error: updErr.message }, 500);
    }

    const inviteUrl = `${GUEST_AREA_ORIGIN}/invite/${token}`;
    const firstName = escapeHtml(booking.first_name || "there");

    // "from 1 to 8 January 2027" — plage humaine, robuste aux dates manquantes
    const fmtDay = (iso: string) => new Date(iso + "T12:00:00Z").getUTCDate();
    const fmtFull = (iso: string) =>
      new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
        .format(new Date(iso + "T12:00:00Z"));
    let stayLine = "at Quinta do Amor";
    const ci = booking.check_in_date ? String(booking.check_in_date) : null;
    const co = booking.check_out_date ? String(booking.check_out_date) : null;
    if (ci && co) {
      const sameMonth = ci.slice(0, 7) === co.slice(0, 7);
      stayLine = sameMonth
        ? `at Quinta do Amor from ${fmtDay(ci)} to ${fmtFull(co)}`
        : `at Quinta do Amor from ${fmtFull(ci)} to ${fmtFull(co)}`;
    } else if (ci) {
      stayLine = `at Quinta do Amor from ${fmtFull(ci)}`;
    }

    const subject = `Your invitation to the Quinta do Amor Guest Area`;
    const FONT = "font-family: Helvetica, Arial, sans-serif; font-size: 12pt; line-height: 1.5; color: #000;";
    const html = `
    <div style="${FONT} text-align: left;">
      <p style="margin: 0 0 14px;">Hi ${firstName},</p>
      <p style="margin: 0 0 14px;">We're happy to support you in creating magical moments ${stayLine}.</p>
      <p style="margin: 0 0 14px;">Your personal Guest Area is ready. It's where you can choose your room
        setup, plan your meals and arrange your transportation.</p>
      <p style="margin: 20px 0;">
        <a href="${inviteUrl}"
           style="${FONT} background: #4a5a3a; color: #ffffff; padding: 10px 22px; border-radius: 6px; text-decoration: none; display: inline-block;">
          Open my Guest Area
        </a>
      </p>
      <p style="margin: 0 0 14px; font-size: 10pt; color: #555;">If the button doesn't work, copy this link into your browser:<br/>
        <a href="${inviteUrl}" style="color: #4a5a3a; word-break: break-all;">${inviteUrl}</a></p>
      <p style="margin: 0 0 14px;">Please let me know if you have any questions!</p>
      <p style="margin: 0;">Geo<br/>Quinta do Amor</p>
    </div>`;

    const res = await resend.emails.send({
      from: FROM_EMAIL,
      to: [booking.email],
      reply_to: ADMIN_EMAIL,
      subject,
      html,
    });
    if ((res as any)?.error) {
      await admin.from("reminder_log").insert({
        type: "invitation", booking_id, recipient: booking.email, subject,
        status: "error", error: JSON.stringify((res as any).error).slice(0, 500),
      });
      return json({ error: "Email send failed", detail: (res as any).error }, 502);
    }

    await admin.from("reminder_log").insert({
      type: "invitation", booking_id, recipient: booking.email, subject, status: "sent",
    });

    return json({ ok: true, sent_to: booking.email });
  } catch (e) {
    console.error("[send-invite-email] error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
