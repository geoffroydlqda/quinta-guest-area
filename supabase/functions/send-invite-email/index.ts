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

const FROM_EMAIL = "Quinta do Amor <hello@quintamor.com>";
const ADMIN_EMAIL = "hello@quintamor.com";
const GUEST_AREA_ORIGIN = "https://guest.quintamor.com";

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);
const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
// CC : adresses secondaires de la fiche client (client_profiles.cc_emails,
// 31 aout 2026) — le mail part au principal, les secondaires en copie.
async function ccEmailsFor(CLIENT: ReturnType<typeof createClient>, bookingId: string | null, primaryEmail: string | null): Promise<string[]> {
  try {
    let cc: string[] | null = null;
    if (bookingId) {
      const { data: b } = await CLIENT.from("bookings").select("email,client_id").eq("id", bookingId).maybeSingle();
      if (b?.client_id) {
        const { data } = await CLIENT.from("client_profiles").select("cc_emails").eq("id", b.client_id).maybeSingle();
        cc = (data?.cc_emails as string[] | null) ?? null;
      }
      primaryEmail = primaryEmail ?? (b?.email as string | null) ?? null;
    }
    if (!cc && primaryEmail) {
      const { data } = await CLIENT.from("client_profiles").select("cc_emails").eq("email", primaryEmail.toLowerCase()).maybeSingle();
      cc = (data?.cc_emails as string[] | null) ?? null;
    }
    const main = (primaryEmail ?? "").toLowerCase();
    return [...new Set((cc ?? []).map((e) => String(e).trim()).filter((e) => /^\S+@\S+\.\S+$/.test(e) && e.toLowerCase() !== main))].slice(0, 5);
  } catch { return []; }
}


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

    // 1er sept 2026 : l'admin peut relire/modifier l'email avant envoi.
    // { preview: true } -> renvoie sujet + corps texte par défaut (variables
    // déjà substituées) sans rien envoyer ; { subject, body_text } -> envoi
    // avec le texte modifié. Le corps est du TEXTE (paragraphes séparés par
    // une ligne vide) ; le marqueur [[button]] positionne le bouton d'accès
    // (ajouté à la fin s'il est retiré — l'email doit toujours porter le lien).
    const { booking_id, preview, subject: subjectOverride, body_text: bodyOverride } = await req.json();
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
    const firstName = booking.first_name || "there";

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

    // Template editable dans l'onglet Emails (table email_templates, cle
    // 'invitation', 4 sept 2026) — repli sur le texte historique si la ligne
    // a disparu. Variables : {{first_name}}, {{stay_line}}, {{retreat_name}}.
    const FALLBACK_SUBJECT = "Your invitation to the Quinta do Amor Guest Area";
    const FALLBACK_BODY = [
      `Hi {{first_name}},`,
      `We're happy to support you in creating magical moments {{stay_line}}.`,
      `Your personal Guest Area is ready. It's where you can choose your room setup, plan your meals and arrange your transportation.`,
      `[[button]]`,
      `Please let me know if you have any questions!`,
      `Geo\nQuinta do Amor`,
    ].join("\n\n");
    const { data: tplRow } = await admin.from("email_templates")
      .select("subject,body").eq("key", "invitation").maybeSingle();
    const vars: Record<string, string> = {
      first_name: firstName,
      stay_line: stayLine,
      retreat_name: booking.retreat_name ?? "",
    };
    const render = (t: string) => t.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => vars[k] ?? "");
    const defaultSubject = render(tplRow?.subject?.trim() ? tplRow.subject : FALLBACK_SUBJECT);
    const defaultBody = render(tplRow?.body?.trim() ? tplRow.body : FALLBACK_BODY);

    const ccList = await ccEmailsFor(admin, booking_id, booking.email);

    if (preview === true) {
      return json({
        to: booking.email, cc: ccList,
        subject: defaultSubject, body_text: defaultBody, invite_url: inviteUrl,
      });
    }

    const subject = (typeof subjectOverride === "string" && subjectOverride.trim()) ? subjectOverride.trim() : defaultSubject;
    let bodyText = (typeof bodyOverride === "string" && bodyOverride.trim()) ? bodyOverride : defaultBody;
    // Le lien d'invitation doit TOUJOURS figurer dans l'email
    if (!bodyText.includes("[[button]]")) bodyText = `${bodyText}\n\n[[button]]`;

    const FONT = "font-family: Helvetica, Arial, sans-serif; font-size: 12pt; line-height: 1.5; color: #000;";
    const buttonHtml = `
      <p style="margin: 20px 0;">
        <a href="${inviteUrl}"
           style="${FONT} background: #6d7855; color: #ffffff; padding: 10px 22px; border-radius: 6px; text-decoration: none; display: inline-block;">
          Open my Guest Area
        </a>
      </p>
      <p style="margin: 0 0 14px; font-size: 10pt; color: #555;">If the button doesn't work, copy this link into your browser:<br/>
        <a href="${inviteUrl}" style="color: #6d7855; word-break: break-all;">${inviteUrl}</a></p>`;
    const paragraphs = bodyText.split(/\n\s*\n/).map((p) =>
      p.trim() === "[[button]]"
        ? buttonHtml
        : `<p style="margin: 0 0 14px;">${escapeHtml(p.trim()).replace(/\n/g, "<br/>")}</p>`
    );
    const html = `
    <div style="${FONT} text-align: left;">
      ${paragraphs.join("\n")}
    </div>`;
    const res = await resend.emails.send({
      from: FROM_EMAIL,
      to: [booking.email],
      ...(ccList.length ? { cc: ccList } : {}),
      reply_to: ADMIN_EMAIL,
      subject,
      html,
    });
    if ((res as any)?.error) {
      await admin.from("reminder_log").insert({
        type: "invitation", booking_id, recipient: booking.email, subject,
        status: "error", error: JSON.stringify((res as any).error).slice(0, 500), body_html: html,
      });
      return json({ error: "Email send failed", detail: (res as any).error }, 502);
    }

    await admin.from("reminder_log").insert({
      type: "invitation", booking_id, recipient: booking.email, subject, status: "sent", body_html: html,
    });

    return json({ ok: true, sent_to: booking.email });
  } catch (e) {
    console.error("[send-invite-email] error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
