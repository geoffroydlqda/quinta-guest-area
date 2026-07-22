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
const GUEST_AREA_ORIGIN = "https://quinta-guest-area.vercel.app";

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
      .select("id, email, first_name, retreat_name, check_in_date, invitation_token, invitation_claimed")
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
    const retreat = escapeHtml(booking.retreat_name || "your stay");
    const subject = `Your invitation to the Quinta do Amor Guest Area`;
    const html = `
    <div style="font-family: Georgia, 'Times New Roman', serif; max-width: 560px; margin: 0 auto; color: #222;">
      <h2 style="color:#4a5a3a;">Quinta do Amor</h2>
      <p>Hi ${firstName},</p>
      <p>We're delighted to welcome you for <strong>${retreat}</strong>${booking.check_in_date ? ` starting on <strong>${escapeHtml(String(booking.check_in_date))}</strong>` : ""}.</p>
      <p>Your personal Guest Area is ready: it's where you can set your stay dates,
        choose your room setup, plan your meals and arrange transportation.</p>
      <p style="text-align:center;margin:24px 0;">
        <a href="${inviteUrl}"
           style="background:#4a5a3a;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;">
          Open my Guest Area
        </a>
      </p>
      <p style="font-size:13px;color:#555;">If the button doesn't work, copy this link into your browser:<br/>
        <a href="${inviteUrl}" style="color:#4a5a3a;">${inviteUrl}</a></p>
      <p>See you soon,<br/>Quinta do Amor</p>
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
