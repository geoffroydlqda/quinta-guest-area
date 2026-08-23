// Moteur d'emails automatiques configurables (23 aout 2026).
// Les regles vivent dans public.email_rules (creees depuis l'admin) :
//   trigger check_in | check_out | due_date, offset_days (negatif = avant),
//   event_type_filter optionnel, sujet + corps avec variables {{...}},
//   bouton optionnel (guest_area | pay).
// Appels :
//   { run: true }                    -> envoie les emails du jour (cron quotidien, x-cron-key)
//   { preview: true }                -> dry-run : liste les correspondances du jour (admin)
//   { test: { rule_id, to } }        -> envoie un exemple rendu a `to` (admin)
// Dedoublonnage : email_rule_log.dedup_key unique = `${rule_id}|${booking_id}|${installment_id ?? ""}`
// -> une regle n'envoie jamais deux fois pour le meme booking / la meme echeance.
// Exclusions : bookings test, annules, emails internal+…@.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";
import { z } from "https://esm.sh/zod@3.23.8";

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);
const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const FROM_EMAIL = "Geo — Quinta do Amor <hello@quintamor.com>";
const REPLY_TO = "hello@quintamor.com";
const FUNCTIONS_BASE = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
const GUEST_AREA_URL = "https://guest.quintamor.com/dashboard";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const BodySchema = z.object({
  run: z.boolean().optional(),
  preview: z.boolean().optional(),
  test: z.object({
    rule_id: z.string().uuid(),
    to: z.string().email(),
  }).optional(),
});

async function isAdminEmailDb(email?: string | null): Promise<boolean> {
  if (!email) return false;
  const { data } = await admin.from("admin_users").select("email");
  return (data ?? []).map((r: { email: string }) => String(r.email).toLowerCase().trim())
    .includes(email.toLowerCase().trim());
}

async function internalKey(): Promise<string> {
  const { data } = await admin.from("app_settings").select("value").eq("key", "internal").maybeSingle();
  const key = (data?.value as Record<string, string> | null)?.cron_key;
  if (!key) throw new Error("CRON_KEY_MISSING");
  return key;
}

// Meme lien de paiement signe que payment-emails : la session Stripe est creee
// au clic, le lien ne perime jamais.
async function signInstallment(installmentId: string): Promise<string> {
  const secret = await internalKey();
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`pay:${installmentId}`));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function paras(text: string): string {
  return text.trim().split(/\n\s*\n/).map((p) =>
    `<p style="margin:0 0 14px 0;">${esc(p.trim()).replace(/\n/g, "<br>")}</p>`
  ).join("\n");
}

const SIGNATURE = `
<p style="margin:22px 0 0 0;color:#222222;">
  <a href="https://www.quintamor.com" style="color:#1155cc;">www.quintamor.com</a><br>
  +351 931 377 682
</p>
<p style="margin:14px 0 0 0;">
  📅 <a href="https://www.quintamor.com/retreats#calendar" style="color:#1155cc;">Check our availabilities</a><br>
  📸 <a href="https://quintadoamor.pixieset.com/quintadoamor/" style="color:#1155cc;">More pictures of our venue</a>
</p>`;

function emailShell(inner: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#ffffff;">
<div style="max-width:560px;margin:0;padding:28px 24px;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.55;color:#222222;">
${inner}
${SIGNATURE}
</div></body></html>`;
}

const fmtEur = (n: number) => `€${Number(n).toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;

function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

// "Aujourd'hui" au fuseau de la Quinta (Europe/Lisbon), en YYYY-MM-DD.
function todayLisbon(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(new Date());
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type Rule = {
  id: string; name: string; enabled: boolean; trigger: string; offset_days: number;
  event_type_filter: string | null; subject: string; body: string; cta: string;
  cta_label: string | null; cta_url: string | null;
};
type Booking = {
  id: string; email: string | null; first_name: string | null; last_name: string | null;
  retreat_name: string | null; check_in_date: string | null; check_out_date: string | null;
  event_type: string | null; is_test: boolean | null; cancelled_at: string | null;
};
type Inst = {
  id: string; booking_id: string; label: string | null; amount_due: number;
  due_date: string | null; status: string | null; is_cash: boolean | null; category: string | null;
};

type Match = {
  rule: Rule;
  booking: Booking;
  installment: Inst | null;
  dedupKey: string;
};

function skipBooking(b: Booking): boolean {
  if (!b.email) return true;
  if (b.is_test) return true;
  if (b.cancelled_at) return true;
  if (/^internal\+/i.test(b.email)) return true;
  return false;
}

function renderTemplate(tpl: string, m: { booking: Booking; installment: Inst | null }): string {
  const b = m.booking;
  const i = m.installment;
  const first = (b.first_name ?? "").trim() || "there";
  const fullName = [b.first_name, b.last_name].filter(Boolean).join(" ").trim() || first;
  const vars: Record<string, string> = {
    first_name: first,
    name: fullName,
    retreat_name: (b.retreat_name ?? "").trim() || "your stay",
    check_in_date: fmtDate(b.check_in_date),
    check_out_date: fmtDate(b.check_out_date),
    amount: i ? fmtEur(Number(i.amount_due || 0)) : "",
    label: i?.label ?? "",
    due_date: i ? fmtDate(i.due_date) : "",
  };
  return tpl.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k: string) => vars[k.toLowerCase()] ?? "");
}

// Bouton CTA optionnel. Pour "pay" : lien signe vers l'echeance de la regle
// (trigger due_date) ou, a defaut, la prochaine echeance impayee du booking.
async function ctaHtml(rule: Rule, booking: Booking, installment: Inst | null): Promise<string> {
  // Bouton personnalise : feedback form, guide d'arrivee, etc.
  if (rule.cta === "custom") {
    const url = (rule.cta_url ?? "").trim();
    if (!/^https?:\/\//i.test(url)) return "";
    const label = (rule.cta_label ?? "").trim() || "Open link";
    return `<p style="margin:18px 0 18px 0;"><a href="${esc(url)}" style="display:inline-block;background:#6d7855;color:#ffffff;text-decoration:none;font-weight:bold;padding:11px 26px;border-radius:8px;font-family:Helvetica,Arial,sans-serif;font-size:13px;">${esc(label)}</a></p>`;
  }
  if (rule.cta === "guest_area") {
    return `<p style="margin:18px 0 18px 0;"><a href="${GUEST_AREA_URL}" style="display:inline-block;background:#6d7855;color:#ffffff;text-decoration:none;font-weight:bold;padding:11px 26px;border-radius:8px;font-family:Helvetica,Arial,sans-serif;font-size:13px;">Open your Guest Area</a></p>`;
  }
  if (rule.cta === "pay") {
    let inst = installment;
    if (!inst) {
      const { data } = await admin.from("payment_installments")
        .select("id,booking_id,label,amount_due,due_date,status,is_cash,category")
        .eq("booking_id", booking.id)
        .neq("status", "paid")
        .order("due_date", { ascending: true, nullsFirst: false });
      inst = ((data ?? []) as Inst[]).find((x) => !x.is_cash && x.category !== "discount") ?? null;
    }
    if (!inst) return "";
    const token = await signInstallment(inst.id);
    const payUrl = `${FUNCTIONS_BASE}/stripe-checkout?installment=${inst.id}&t=${token}`;
    return `<p style="margin:18px 0 6px 0;"><a href="${payUrl}" style="display:inline-block;background:#6d7855;color:#ffffff;text-decoration:none;font-weight:bold;padding:11px 26px;border-radius:8px;font-family:Helvetica,Arial,sans-serif;font-size:13px;">Pay ${esc(fmtEur(Number(inst.amount_due || 0)))}</a></p>
<p style="margin:0 0 18px 0;font-size:11px;color:#888888;">Secure bank payment (debit or transfer), powered by Stripe.</p>`;
  }
  return "";
}

// Correspondances du jour pour une regle : la date d'envoi = ancre + offset_days,
// donc on cherche les ancres telles que ancre = aujourd'hui - offset_days.
async function findMatches(rule: Rule, today: string): Promise<Match[]> {
  const anchor = addDays(today, -rule.offset_days);
  const matches: Match[] = [];

  if (rule.trigger === "check_in" || rule.trigger === "check_out") {
    const col = rule.trigger === "check_in" ? "check_in_date" : "check_out_date";
    const { data } = await admin.from("bookings")
      .select("id,email,first_name,last_name,retreat_name,check_in_date,check_out_date,event_type,is_test,cancelled_at")
      .eq(col, anchor);
    for (const b of (data ?? []) as Booking[]) {
      if (skipBooking(b)) continue;
      if (rule.event_type_filter && b.event_type !== rule.event_type_filter) continue;
      matches.push({ rule, booking: b, installment: null, dedupKey: `${rule.id}|${b.id}|` });
    }
    return matches;
  }

  if (rule.trigger === "due_date") {
    const { data } = await admin.from("payment_installments")
      .select("id,booking_id,label,amount_due,due_date,status,is_cash,category")
      .eq("due_date", anchor)
      .neq("status", "paid");
    const insts = ((data ?? []) as Inst[]).filter((i) => !i.is_cash && i.category !== "discount");
    if (!insts.length) return matches;
    const bookingIds = [...new Set(insts.map((i) => i.booking_id))];
    const { data: bks } = await admin.from("bookings")
      .select("id,email,first_name,last_name,retreat_name,check_in_date,check_out_date,event_type,is_test,cancelled_at")
      .in("id", bookingIds);
    const byId = new Map(((bks ?? []) as Booking[]).map((b) => [b.id, b]));
    for (const i of insts) {
      const b = byId.get(i.booking_id);
      if (!b || skipBooking(b)) continue;
      if (rule.event_type_filter && b.event_type !== rule.event_type_filter) continue;
      matches.push({ rule, booking: b, installment: i, dedupKey: `${rule.id}|${b.id}|${i.id}` });
    }
    return matches;
  }

  return matches;
}

async function alreadySent(dedupKeys: string[]): Promise<Set<string>> {
  if (!dedupKeys.length) return new Set();
  const { data } = await admin.from("email_rule_log")
    .select("dedup_key,status")
    .in("dedup_key", dedupKeys);
  return new Set((data ?? []).filter((r: any) => r.status === "sent").map((r: any) => r.dedup_key));
}

async function sendMatch(m: Match): Promise<{ sent: boolean; error?: string }> {
  const subject = renderTemplate(m.rule.subject, m);
  const bodyText = renderTemplate(m.rule.body, m);
  const cta = await ctaHtml(m.rule, m.booking, m.installment);
  const html = emailShell(`${paras(bodyText)}\n${cta}`);
  const to = m.booking.email!;

  const sent = await resend.emails.send({
    from: FROM_EMAIL, to: [to], reply_to: REPLY_TO, subject, html,
  });
  const errMsg = sent.error ? String((sent.error as any).message ?? sent.error) : null;

  // Journal + dedoublonnage. En cas d'erreur d'envoi on journalise quand meme
  // (status 'error') mais avec une cle suffixee pour ne pas bloquer une
  // nouvelle tentative le lendemain.
  const { error: logErr } = await admin.from("email_rule_log").insert({
    rule_id: m.rule.id,
    booking_id: m.booking.id,
    installment_id: m.installment?.id ?? null,
    recipient: to,
    subject,
    status: errMsg ? "error" : "sent",
    error: errMsg,
    dedup_key: errMsg ? `${m.dedupKey}|err:${Date.now()}` : m.dedupKey,
  });
  if (logErr) console.error("[email-rules] log insert failed:", logErr.message);

  return errMsg ? { sent: false, error: errMsg } : { sent: true };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    // Auth : x-cron-key (cron quotidien) OU JWT admin (preview / test / run manuel).
    let internalCall = false;
    const cronHeader = req.headers.get("x-cron-key");
    if (cronHeader) {
      internalCall = cronHeader === (await internalKey().catch(() => null));
    }
    if (!internalCall) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user } } = await userClient.auth.getUser();
      if (!user || !(await isAdminEmailDb(user.email))) return json({ error: "Forbidden" }, 403);
    }

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
    const body = parsed.data;
    const today = todayLisbon();

    // ---- TEST : envoie un exemple rendu a l'adresse donnee (jamais journalise)
    if (body.test) {
      const { data: rule } = await admin.from("email_rules")
        .select("*").eq("id", body.test.rule_id).maybeSingle();
      if (!rule) return json({ error: "Rule not found" }, 404);

      // Donnees d'exemple : premiere correspondance du jour si elle existe,
      // sinon un booking recent, sinon des valeurs factices.
      const todays = await findMatches(rule as Rule, today);
      let sample: { booking: Booking; installment: Inst | null } | null = todays[0] ?? null;
      if (!sample) {
        const { data: bks } = await admin.from("bookings")
          .select("id,email,first_name,last_name,retreat_name,check_in_date,check_out_date,event_type,is_test,cancelled_at")
          .is("cancelled_at", null)
          .order("check_in_date", { ascending: false })
          .limit(20);
        const b = ((bks ?? []) as Booking[]).find((x) => !x.is_test && x.email) ?? null;
        if (b && (rule as Rule).trigger === "due_date") {
          const { data: insts } = await admin.from("payment_installments")
            .select("id,booking_id,label,amount_due,due_date,status,is_cash,category")
            .eq("booking_id", b.id)
            .not("due_date", "is", null)
            .order("due_date", { ascending: true })
            .limit(5);
          const i = ((insts ?? []) as Inst[]).find((x) => !x.is_cash && x.category !== "discount") ?? null;
          sample = { booking: b, installment: i };
        } else if (b) {
          sample = { booking: b, installment: null };
        }
      }
      if (!sample) {
        sample = {
          booking: {
            id: "00000000-0000-0000-0000-000000000000", email: body.test.to,
            first_name: "Alex", last_name: "Sample", retreat_name: "Sample Retreat",
            check_in_date: today, check_out_date: addDays(today, 5),
            event_type: "retreat", is_test: false, cancelled_at: null,
          },
          installment: null,
        };
      }
      const m: Match = { rule: rule as Rule, ...sample, dedupKey: "" };
      const subject = `[TEST] ${renderTemplate(m.rule.subject, m)}`;
      const bodyText = renderTemplate(m.rule.body, m);
      const cta = await ctaHtml(m.rule, m.booking, m.installment);
      const html = emailShell(`${paras(bodyText)}\n${cta}`);
      const sent = await resend.emails.send({
        from: FROM_EMAIL, to: [body.test.to], reply_to: REPLY_TO, subject, html,
      });
      if (sent.error) return json({ error: String((sent.error as any).message ?? sent.error) }, 502);
      return json({ sent: true, to: body.test.to, subject, sample_booking: m.booking.retreat_name ?? m.booking.email });
    }

    // ---- PREVIEW / RUN : correspondances du jour pour toutes les regles actives
    const { data: rulesData } = await admin.from("email_rules")
      .select("*")
      .eq("enabled", true)
      .order("created_at", { ascending: true });
    const rules = (rulesData ?? []) as Rule[];

    const allMatches: Match[] = [];
    for (const rule of rules) {
      allMatches.push(...await findMatches(rule, today));
    }
    const sentKeys = await alreadySent(allMatches.map((m) => m.dedupKey));

    if (body.preview || !body.run) {
      return json({
        today,
        rules: rules.length,
        matches: allMatches.map((m) => ({
          rule_id: m.rule.id,
          rule_name: m.rule.name,
          booking_id: m.booking.id,
          recipient: m.booking.email,
          label: m.booking.retreat_name || [m.booking.first_name, m.booking.last_name].filter(Boolean).join(" ") || m.booking.email,
          installment_id: m.installment?.id ?? null,
          installment_label: m.installment?.label ?? null,
          amount: m.installment ? Number(m.installment.amount_due || 0) : null,
          subject: renderTemplate(m.rule.subject, m),
          already_sent: sentKeys.has(m.dedupKey),
        })),
      });
    }

    // ---- RUN
    let sentCount = 0, skipped = 0, errors = 0;
    const details: unknown[] = [];
    for (const m of allMatches) {
      if (sentKeys.has(m.dedupKey)) { skipped++; continue; }
      const res = await sendMatch(m);
      if (res.sent) sentCount++; else errors++;
      details.push({
        rule: m.rule.name, booking: m.booking.id, to: m.booking.email,
        installment: m.installment?.id ?? null, ...res,
      });
    }
    console.log(`[email-rules] run ${today}: ${allMatches.length} matches, ${sentCount} sent, ${skipped} deduped, ${errors} errors`);
    return json({ today, matches: allMatches.length, sent: sentCount, skipped, errors, details });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    console.error("[email-rules] error:", msg);
    return json({ error: msg }, 500);
  }
});
