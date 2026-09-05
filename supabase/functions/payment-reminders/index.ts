// payment-reminders — rappels de paiement automatiques (Phase 1)
//
// Déclencheurs :
//  - Cron quotidien (pg_cron -> header x-cron-key, vérifié contre app_settings.internal.cron_key)
//  - Admin connecté (JWT vérifié contre admin_users) — utilisé par le panneau
//    d'aperçu de l'admin avec { preview: true }
//
// Sécurité d'envoi :
//  - app_settings.payment_reminders.enabled = false  => AUCUN email ne part, jamais.
//    La fonction retourne seulement la liste de ce qui serait envoyé.
//  - Dédoublonnage : un rappel automatique (type, échéance) n'est envoyé qu'une
//    fois (index unique sur reminder_log + vérification applicative).
//  - { send_installment: id } : rappel MANUEL explicite (admin), indépendant de
//    l'interrupteur global, journalisé en type 'payment_manual' (renvoyable).
//  - payment_installments.payment_link : si présent, bouton "Pay now" dans l'email.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
};

const FROM_EMAIL = "Quinta do Amor <hello@quintamor.com>";
const ADMIN_EMAIL = "hello@quintamor.com";
const GUEST_AREA_URL = "https://guest.quintamor.com/dashboard";

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

interface ReminderCandidate {
  type: "payment_upcoming" | "payment_overdue";
  installment_id: string;
  booking_id: string;
  recipient: string;
  first_name: string;
  retreat_name: string;
  label: string;
  amount_due: number;
  due_date: string;
  payment_link?: string | null;
}

function lisbonToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(new Date());
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Rappel MANUEL depuis un template editable (onglet Emails, 4 sept 2026) :
// cles email_templates 'payment_reminder' (a venir) / 'payment_reminder_overdue'
// (en retard). Corps TEXTE avec variables {{first_name}} {{label}} {{amount}}
// {{due_date}} et marqueurs [[details]] (encadre montant/date, reinsere s'il
// manque) et [[button]] (bouton Pay now, seulement si payment_link existe).
// "Guest Area" dans le texte devient automatiquement un lien.
// Repli sur ces defauts si la ligne a disparu — miroir de src/lib/emailTemplates.ts.
// ---------------------------------------------------------------------------
const MANUAL_FALLBACK: Record<"payment_upcoming" | "payment_overdue", { subject: string; body: string }> = {
  payment_upcoming: {
    subject: "Payment reminder — {{label}} — Quinta do Amor",
    body: "Hi {{first_name}},\n\nThis is a friendly reminder that the payment below is due on {{due_date}}.\n\n[[details]]\n\n[[button]]\n\nYou can review your payment details anytime in your Guest Area.\n\nIf you have already made this payment, please disregard this message — it can take us a little time to reconcile transfers.\n\nWarm regards,\nQuinta do Amor",
  },
  payment_overdue: {
    subject: "Payment follow-up — {{label}} — Quinta do Amor",
    body: "Hi {{first_name}},\n\nThis is a friendly follow-up: the payment below was due on {{due_date}} and is still marked as pending.\n\n[[details]]\n\n[[button]]\n\nYou can review your payment details anytime in your Guest Area.\n\nIf you have already made this payment, please disregard this message — it can take us a little time to reconcile transfers.\n\nWarm regards,\nQuinta do Amor",
  },
};

async function manualEmailFromTemplate(c: ReminderCandidate): Promise<{ subject: string; html: string }> {
  const key = c.type === "payment_overdue" ? "payment_reminder_overdue" : "payment_reminder";
  const fallback = MANUAL_FALLBACK[c.type];
  let tplSubject = fallback.subject;
  let tplBody = fallback.body;
  try {
    const { data } = await admin.from("email_templates").select("subject,body").eq("key", key).maybeSingle();
    if (data?.subject?.trim()) tplSubject = data.subject;
    if (data?.body?.trim()) tplBody = data.body;
  } catch { /* repli */ }
  const vars: Record<string, string> = {
    first_name: c.first_name || "there",
    label: c.label,
    amount: `€${Number(c.amount_due).toFixed(2)}`,
    due_date: c.due_date,
  };
  const render = (t: string) => t.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => vars[k] ?? "");
  const subject = render(tplSubject);
  let body = render(tplBody);
  if (!body.includes("[[details]]")) body += "\n\n[[details]]"; // l'encadre doit toujours partir
  const detailsHtml = `
    <table width="100%" style="background:#f6efea;border-radius:8px;margin:16px 0;">
      <tr><td style="padding:12px 16px;font-weight:bold;">${escapeHtml(c.label)}</td></tr>
      <tr><td style="padding:0 16px 4px;">Amount: <strong>€${Number(c.amount_due).toFixed(2)}</strong></td></tr>
      <tr><td style="padding:0 16px 12px;">Due date: ${escapeHtml(c.due_date)}</td></tr>
    </table>`;
  const buttonHtml = c.payment_link && /^https?:\/\//i.test(c.payment_link) ? `
    <p style="margin:20px 0;">
      <a href="${escapeHtml(c.payment_link)}"
         style="background:#6d7855;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:6px;display:inline-block;">
        Pay now
      </a>
    </p>` : "";
  const paragraphs = body.split(/\n\s*\n/).map((p) => {
    const t = p.trim();
    if (t === "[[details]]") return detailsHtml;
    if (t === "[[button]]") return buttonHtml;
    return `<p>${escapeHtml(t).replace(/\n/g, "<br/>")
      .replace(/Guest Area/, `<a href="${GUEST_AREA_URL}" style="color:#6d7855;">Guest Area</a>`)}</p>`;
  }).filter(Boolean);
  const html = `
  <div style="font-family: Georgia, 'Times New Roman', serif; max-width: 560px; margin: 0 auto; color: #222;">
    <h2 style="color:#6d7855;">Quinta do Amor</h2>
    ${paragraphs.join("\n")}
  </div>`;
  return { subject, html };
}

function reminderHtml(c: ReminderCandidate): string {
  const isOverdue = c.type === "payment_overdue";
  const intro = !c.due_date || c.due_date === "—"
    ? `This is a friendly reminder about the payment below.`
    : isOverdue
    ? `This is a friendly follow-up: the payment below was due on <strong>${escapeHtml(c.due_date)}</strong> and is still marked as pending.`
    : `This is a friendly reminder that the payment below is due on <strong>${escapeHtml(c.due_date)}</strong>.`;
  return `
  <div style="font-family: Georgia, 'Times New Roman', serif; max-width: 560px; margin: 0 auto; color: #222;">
    <h2 style="color:#6d7855;">Quinta do Amor</h2>
    <p>Hi ${escapeHtml(c.first_name || "there")},</p>
    <p>${intro}</p>
    <table width="100%" style="background:#f6efea;border-radius:8px;margin:16px 0;">
      <tr><td style="padding:12px 16px;font-weight:bold;">${escapeHtml(c.label)}</td></tr>
      <tr><td style="padding:0 16px 4px;">Amount: <strong>€${Number(c.amount_due).toFixed(2)}</strong></td></tr>
      <tr><td style="padding:0 16px 12px;">Due date: ${escapeHtml(c.due_date)}</td></tr>
    </table>
    ${c.payment_link && /^https?:\/\//i.test(c.payment_link) ? `
    <p style="margin:20px 0;">
      <a href="${escapeHtml(c.payment_link)}"
         style="background:#6d7855;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:6px;display:inline-block;">
        Pay now
      </a>
    </p>` : ""}
    <p>You can review your payment details anytime in your
      <a href="${GUEST_AREA_URL}" style="color:#6d7855;">Guest Area</a>.</p>
    <p>If you have already made this payment, please disregard this message — it can
      take us a little time to reconcile transfers.</p>
    <p>Warm regards,<br/>Quinta do Amor</p>
  </div>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    // ------------------------------------------------------------------ auth
    let isCron = false;
    const cronKey = req.headers.get("x-cron-key");
    if (cronKey) {
      const { data } = await admin.from("app_settings").select("value").eq("key", "internal").maybeSingle();
      const expected = (data?.value as Record<string, string> | null)?.cron_key;
      if (!expected || cronKey !== expected) return json({ error: "Unauthorized" }, 401);
      isCron = true;
    } else {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user }, error } = await userClient.auth.getUser();
      if (error || !user || !(await isAdminEmailDb(user.email))) return json({ error: "Forbidden" }, 403);
    }

    let preview = false;
    let sendInstallment: string | null = null;
    try {
      const body = await req.json();
      preview = body?.preview === true;
      if (typeof body?.send_installment === "string") sendInstallment = body.send_installment;
    } catch { /* corps vide */ }

    // ------------------------------------------------- rappel manuel (admin)
    // Action explicite depuis la page Payments : envoie UN rappel pour UNE
    // échéance, indépendamment de l'interrupteur global (qui ne gouverne que
    // les envois automatiques). Jamais accessible au cron.
    if (sendInstallment) {
      if (isCron) return json({ error: "Manual send is admin-only" }, 403);
      const { data: inst, error: instErr } = await admin
        .from("payment_installments")
        .select("id, booking_id, label, amount_due, due_date, status, payment_link, bookings:booking_id (id, email, first_name)")
        .eq("id", sendInstallment)
        .maybeSingle();
      if (instErr) return json({ error: instErr.message }, 500);
      if (!inst) return json({ error: "Installment not found" }, 404);
      if (inst.status === "paid") return json({ error: "This installment is already paid" }, 400);
      const b = (inst as any).bookings;
      if (!b?.email) return json({ error: "No email on this booking" }, 400);
      if (/^internal\+/i.test(String(b.email))) {
        return json({ error: "Internal booking (no real client email)" }, 400);
      }
      const today = lisbonToday();
      const due = inst.due_date ? String(inst.due_date) : "—";
      const c: ReminderCandidate = {
        type: due !== "—" && due < today ? "payment_overdue" : "payment_upcoming",
        installment_id: String(inst.id),
        booking_id: String(b.id),
        recipient: String(b.email),
        first_name: String(b.first_name ?? ""),
        retreat_name: "",
        label: String(inst.label ?? "Payment"),
        amount_due: Number(inst.amount_due ?? 0),
        due_date: due,
        payment_link: (inst as any).payment_link ?? null,
      };
      // Sujet + corps depuis le template editable (onglet Emails)
      const { subject, html: manualHtml } = await manualEmailFromTemplate(c);
      try {
        const ccList = await ccEmailsFor(admin, c.booking_id, c.recipient);
        const res = await resend.emails.send({
          from: FROM_EMAIL, to: [c.recipient], ...(ccList.length ? { cc: ccList } : {}), reply_to: ADMIN_EMAIL,
          subject, html: manualHtml,
        });
        if ((res as any)?.error) throw new Error(JSON.stringify((res as any).error));
        await admin.from("reminder_log").insert({
          type: "payment_manual", installment_id: c.installment_id, booking_id: c.booking_id,
          recipient: c.recipient, subject, status: "sent", body_html: manualHtml,
        });
        return json({ mode: "manual", sent: 1, recipient: c.recipient });
      } catch (e) {
        await admin.from("reminder_log").insert({
          type: "payment_manual", installment_id: c.installment_id, booking_id: c.booking_id,
          recipient: c.recipient, subject, status: "error", error: String(e).slice(0, 500), body_html: manualHtml,
        });
        return json({ error: `Send failed: ${String(e).slice(0, 200)}` }, 500);
      }
    }

    // -------------------------------------------------------------- settings
    const { data: settingsRow } = await admin
      .from("app_settings").select("value").eq("key", "payment_reminders").maybeSingle();
    const settings = (settingsRow?.value ?? {}) as { enabled?: boolean; days_before?: number; days_overdue?: number };
    const enabled = settings.enabled === true;
    const daysBefore = settings.days_before ?? 7;
    const daysOverdue = settings.days_overdue ?? 3;

    // ------------------------------------------------------------ candidates
    const today = lisbonToday();
    const upcomingWindowEnd = addDays(today, daysBefore);
    const overdueCutoff = addDays(today, -daysOverdue);

    const { data: installments, error: instErr } = await admin
      .from("payment_installments")
      .select("id, booking_id, label, amount_due, due_date, status, payment_link, bookings:booking_id (id, email, first_name, retreat_name, invitation_claimed, cancelled_at)")
      .eq("status", "pending")
      .not("due_date", "is", null);
    if (instErr) return json({ error: instErr.message }, 500);

    const raw: ReminderCandidate[] = [];
    for (const inst of installments ?? []) {
      const b = (inst as any).bookings;
      if (!b?.email) continue;
      // Bookings annulés : plus aucun rappel automatique
      if (b.cancelled_at) continue;
      // Bookings gérés en interne (email internal+xxx@quintamor.com) : jamais de
      // rappel automatique — il n'y a pas de vrai client derrière cette adresse.
      if (/^internal\+/i.test(String(b.email))) continue;
      const due = String(inst.due_date);
      let type: ReminderCandidate["type"] | null = null;
      // Rappel "à venir" : échéance dans la fenêtre [demain .. J+days_before]
      if (due > today && due <= upcomingWindowEnd) type = "payment_upcoming";
      // Relance "retard" : échéance dépassée d'au moins days_overdue jours
      else if (due <= overdueCutoff) type = "payment_overdue";
      if (!type) continue;
      raw.push({
        type,
        installment_id: String(inst.id),
        booking_id: String(b.id),
        recipient: String(b.email),
        first_name: String(b.first_name ?? ""),
        retreat_name: String(b.retreat_name ?? ""),
        label: String(inst.label ?? "Payment"),
        amount_due: Number(inst.amount_due ?? 0),
        due_date: due,
        payment_link: (inst as any).payment_link ?? null,
      });
    }

    // Dédoublonnage contre le journal (un envoi par type et par échéance)
    const { data: sentRows } = await admin
      .from("reminder_log")
      .select("type, installment_id")
      .eq("status", "sent")
      .in("type", ["payment_upcoming", "payment_overdue"]);
    const alreadySent = new Set((sentRows ?? []).map((r) => `${r.type}:${r.installment_id}`));
    const candidates = raw.filter((c) => !alreadySent.has(`${c.type}:${c.installment_id}`));

    // ------------------------------------------------------- dry-run / envoi
    if (!enabled || preview) {
      return json({
        mode: !enabled ? "disabled" : "preview",
        enabled,
        settings: { days_before: daysBefore, days_overdue: daysOverdue },
        today,
        would_send: candidates,
        count: candidates.length,
      });
    }

    const sent: string[] = [];
    const failed: string[] = [];
    for (const c of candidates) {
      const subject = c.type === "payment_overdue"
        ? `Payment follow-up — ${c.label} — Quinta do Amor`
        : `Payment reminder — ${c.label} — Quinta do Amor`;
      try {
        const autoHtml = reminderHtml(c);
        const ccList = await ccEmailsFor(admin, c.booking_id, c.recipient);
        const res = await resend.emails.send({
          from: FROM_EMAIL,
          to: [c.recipient],
          ...(ccList.length ? { cc: ccList } : {}),
          reply_to: ADMIN_EMAIL,
          subject,
          html: autoHtml,
        });
        if ((res as any)?.error) throw new Error(JSON.stringify((res as any).error));
        await admin.from("reminder_log").insert({
          type: c.type, installment_id: c.installment_id, booking_id: c.booking_id,
          recipient: c.recipient, subject, status: "sent", body_html: autoHtml,
        });
        sent.push(`${c.type} ${c.recipient} (${c.label})`);
      } catch (e) {
        await admin.from("reminder_log").insert({
          type: c.type, installment_id: c.installment_id, booking_id: c.booking_id,
          recipient: c.recipient, subject, status: "error", error: String(e).slice(0, 500),
        });
        failed.push(`${c.type} ${c.recipient} (${c.label}): ${String(e).slice(0, 120)}`);
      }
    }

    // Digest admin (uniquement s'il s'est passé quelque chose)
    if (sent.length > 0 || failed.length > 0) {
      const digest = `
        <div style="font-family: Georgia, serif; max-width: 560px; margin: 0 auto;">
          <h3>Payment reminders — daily run (${today})</h3>
          ${sent.length ? `<p><strong>Sent (${sent.length})</strong></p><ul>${sent.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>` : ""}
          ${failed.length ? `<p><strong>Failed (${failed.length})</strong></p><ul>${failed.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>` : ""}
        </div>`;
      try {
        await resend.emails.send({
          from: FROM_EMAIL, to: [ADMIN_EMAIL],
          subject: `Payment reminders: ${sent.length} sent${failed.length ? `, ${failed.length} failed` : ""} — ${today}`,
          html: digest,
        });
      } catch (e) {
        console.error("[payment-reminders] digest failed", e);
      }
    }

    return json({ mode: "sent", enabled, today, sent: sent.length, failed: failed.length, source: isCron ? "cron" : "manual" });
  } catch (e) {
    console.error("[payment-reminders] error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
