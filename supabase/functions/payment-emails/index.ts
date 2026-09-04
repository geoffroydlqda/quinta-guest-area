// Emails de paiement manuels (admin) — textes validés par Geoffroy, Helvetica 12.
// { kind: "request", installment_id, subject, body_top, body_bottom }
//   -> email "demande de paiement" avec bouton Pay €X (lien signé, session
//      Stripe créée au clic — jamais périmé) + ligne rassurance Stripe.
// { kind: "confirmation", installment_id, subject, body }
//   -> email "paiement reçu" avec la fatura-recibo en pièce jointe (bucket invoices).
// Tout envoi est journalisé dans reminder_log (payment_request / payment_receipt).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

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


const FROM_EMAIL = "Geo — Quinta do Amor <hello@quintamor.com>";
const REPLY_TO = "hello@quintamor.com";
const FUNCTIONS_BASE = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;

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
  kind: z.enum(["request", "confirmation"]),
  // Renvoie le PDF pro forma en base64 SANS envoyer d'email (bouton
  // "Preview PDF" de la fenetre d'envoi, 27 aout 2026).
  preview_proforma: z.boolean().optional(),
  installment_id: z.string().uuid().optional(),
  // Demande groupée : plusieurs échéances du même booking, un seul lien de
  // paiement (une session Stripe -> une fatura-recibo multi-lignes).
  installment_ids: z.array(z.string().uuid()).min(1).max(20).optional(),
  // subject/body optionnels : pour une confirmation sans texte (appel interne
  // du webhook), le template validé par Geoffroy est appliqué côté serveur.
  subject: z.string().min(1).max(200).optional(),
  body_top: z.string().max(5000).optional(),
  body_bottom: z.string().max(5000).optional(),
  body: z.string().max(5000).optional(),
  // Pièces jointes libres (base64) — en plus de la facture auto sur les
  // confirmations. ~10 MB au total (14M chars base64), 5 fichiers max.
  attachments: z.array(z.object({
    filename: z.string().min(1).max(200),
    content: z.string().min(1).max(14_000_000),
  })).max(5).optional(),
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

// Texte brut (paragraphes séparés par des lignes vides) -> HTML Helvetica 12pt
function paras(text: string): string {
  return text.trim().split(/\n\s*\n/).map((p) =>
    `<p style="margin:0 0 14px 0;">${esc(p.trim()).replace(/\n/g, "<br>")}</p>`
  ).join("\n");
}

// Signature ajoutée à tous les emails de paiement (modèle validé par Geoffroy).
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

// ---------------------------------------------------------------------------
// Pro forma PDF (27 aout 2026) — joint a chaque email de demande de paiement.
// Detaille ce que le guest paie (lignes produits quand elles existent) et,
// pour tout le sejour, l'echeancier : deja paye / cette demande / a venir.
// Ce n'est PAS un document fiscal — la fatura-recibo Moloni arrive au paiement.
// ---------------------------------------------------------------------------
type PfInst = {
  id: string; label: string | null; amount_due: number; amount_excl_vat: number | null;
  status: string; category: string | null; due_date: string | null; paid_on: string | null;
  is_cash: boolean | null; vat_rate: number | null;
  product_lines: { name: string; qty: number; unit_price: number; vat: number }[] | null;
};

const OLIVE = rgb(0.427, 0.471, 0.333);
const INK = rgb(0.13, 0.13, 0.13);
const GREY = rgb(0.45, 0.45, 0.45);
const LIGHT = rgb(0.955, 0.945, 0.92);

const pfDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};
const pfEur = (n: number) =>
  `${n < 0 ? "-" : ""}€${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const CAT_LABEL: Record<string, string> = {
  rental: "Accommodation", catering: "Catering", extra: "Extras", discount: "Discounts",
};
const CAT_ORDER: Record<string, number> = { rental: 0, catering: 1, extra: 2, discount: 3 };
// Les lignes catering sont nommees "Fri 4 Sep — Dinner (...)" : on extrait le
// jour pour le rendre en sous-titre de section (UX validee 27 aout 2026).
const DAY_RE = /^([A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2,5})\s+[—-]\s+(.+)$/;

async function buildProFormaPdf(opts: {
  guestName: string; retreatName: string | null;
  checkIn: string | null; checkOut: string | null;
  requested: PfInst[]; all: PfInst[];
}): Promise<string> {
  // ------------------------------------------------------------------
  // 1. DONNEES d'abord : lignes par categorie, jours fusionnes, comptage
  //    — pour choisir la densite AVANT de dessiner (tout sur UNE page).
  // ------------------------------------------------------------------
  type Row = { name: string; day: string | null; qty: number | null; unit: number | null; vat: number; total: number };
  const byCat = new Map<string, Row[]>();
  let totalIncl = 0, totalExcl = 0;
  for (const inst of opts.requested) {
    const cat = inst.category ?? "extra";
    const rows = byCat.get(cat) ?? [];
    const amount = Number(inst.amount_due);
    totalIncl += amount;
    const lines = (inst.product_lines ?? []).filter((l) => Number(l.qty) && Number(l.unit_price) !== 0);
    if (lines.length) {
      const linesSum = lines.reduce((sm, l) => sm + Number(l.qty) * Number(l.unit_price), 0);
      const ratio = linesSum !== 0 ? amount / linesSum : 1; // montant ajuste a la main
      for (const l of lines) {
        const tot = Number(l.qty) * Number(l.unit_price) * ratio;
        totalExcl += tot / (1 + Number(l.vat || 0) / 100);
        const m = DAY_RE.exec(l.name);
        rows.push({ name: m ? m[2] : l.name, day: m ? m[1] : null, qty: Number(l.qty), unit: Number(l.unit_price), vat: Number(l.vat || 0), total: tot });
      }
    } else {
      const vat = inst.is_cash ? 0 : Number(inst.vat_rate ?? 23);
      totalExcl += inst.amount_excl_vat != null ? Number(inst.amount_excl_vat) : amount / (1 + vat / 100);
      rows.push({ name: inst.label || "Payment", day: null, qty: null, unit: null, vat, total: amount });
    }
    byCat.set(cat, rows);
  }

  // Jours consecutifs au contenu identique -> une seule section
  // "Fri 4 Sep – Sun 6 Sep · 3 days" avec les quantites multipliees.
  type DayGroup = { label: string | null; rows: Row[] };
  const groupDays = (rows: Row[]): DayGroup[] => {
    type Block = { day: string | null; rows: Row[] };
    const blocks: Block[] = [];
    for (const r of rows) {
      const last = blocks[blocks.length - 1];
      if (last && last.day === r.day) last.rows.push(r);
      else blocks.push({ day: r.day, rows: [r] });
    }
    const sig = (b: Block) => JSON.stringify(b.rows.map((r) => [r.name, r.qty, r.unit, r.vat]));
    const out: DayGroup[] = [];
    let i = 0;
    while (i < blocks.length) {
      const b = blocks[i];
      if (!b.day) { out.push({ label: null, rows: b.rows }); i++; continue; }
      let j = i + 1;
      while (j < blocks.length && blocks[j].day && sig(blocks[j]) === sig(b)) j++;
      const span = j - i;
      if (span >= 3) {
        const first = b.day, last = blocks[j - 1].day as string;
        out.push({
          label: `${first} - ${last}  ·  ${span} days`,
          rows: b.rows.map((r) => ({ ...r, qty: (r.qty ?? 0) * span, total: r.total * span })),
        });
        i = j;
      } else {
        for (let k = i; k < j; k++) out.push({ label: blocks[k].day, rows: blocks[k].rows });
        i = j;
      }
    }
    return out;
  };
  const cats: [string, DayGroup[]][] = [...byCat.entries()]
    .sort((a, b) => (CAT_ORDER[a[0]] ?? 9) - (CAT_ORDER[b[0]] ?? 9))
    .map(([cat, rows]) => [cat, groupDays(rows)]);
  const multiCat = cats.length > 1;

  const sched = opts.all
    .filter((i) => i.category !== "bar")
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
  const withSched = sched.length > 1;

  // Densite : nombre reel de lignes a dessiner apres fusion des jours
  let nRows = 0;
  for (const [, groups] of cats) for (const g of groups) nRows += g.rows.length + (g.label ? 1 : 0);
  if (withSched) nRows += sched.length;
  const rowH = nRows > 52 ? 9.6 : nRows > 40 ? 10.8 : 12.5;
  const fs = nRows > 52 ? 8.2 : nRows > 40 ? 8.6 : 9;
  const dense = nRows > 40;

  // ------------------------------------------------------------------
  // 2. DESSIN
  // ------------------------------------------------------------------
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const PAGE_W = 595.28, PAGE_H = 841.89, M = 52;
  const W = PAGE_W - 2 * M;
  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - 46;
  const FOOTER_LIMIT = 96; // l'espace reserve au pied de page

  const ensure = (need: number) => {
    if (y - need < FOOTER_LIMIT) { page = doc.addPage([PAGE_W, PAGE_H]); y = PAGE_H - 56; }
  };
  // Les polices standard (WinAnsi) ne couvrent pas →, ’, etc. — on translittere.
  const safe = (str: string) => str
    .replace(/→/g, "-").replace(/[’‘]/g, "'").replace(/[“”]/g, '"')
    .replace(/…/g, "...").replace(/[−]/g, "-")
    // deno-lint-ignore no-control-regex
    .replace(/[^\x20-\x7E\xA0-\xFF€–—·]/g, "?");
  const text = (raw: string, x: number, size: number, opt: { font?: typeof helv; color?: ReturnType<typeof rgb>; right?: number; center?: boolean; atY?: number } = {}) => {
    const str = safe(raw);
    const f = opt.font ?? helv;
    let drawX = x;
    if (opt.center) drawX = (PAGE_W - f.widthOfTextAtSize(str, size)) / 2;
    else if (opt.right != null) drawX = opt.right - f.widthOfTextAtSize(str, size);
    page.drawText(str, { x: drawX, y: opt.atY ?? y, size, font: f, color: opt.color ?? INK });
  };
  const rule = (color = OLIVE, thickness = 0.6, x1 = M, x2 = M + W, atY?: number) =>
    page.drawLine({ start: { x: x1, y: atY ?? y }, end: { x: x2, y: atY ?? y }, thickness, color });

  // ---- en-tete centre
  text("QUINTA DO AMOR", 0, 16, { font: bold, color: OLIVE, center: true });
  y -= 13;
  text(`Payment details  ·  issued ${pfDate(new Date().toISOString().slice(0, 10))}`, 0, 9, { color: GREY, center: true });
  y -= 24;

  // ---- bloc sejour
  text(opts.retreatName || opts.guestName, M, 13, { font: bold });
  if (opts.checkIn || opts.checkOut) {
    text(`Stay  ${pfDate(opts.checkIn)} - ${pfDate(opts.checkOut)}`, 0, 9.5, { color: GREY, right: M + W });
  }
  y -= 13;
  if (opts.retreatName && opts.guestName && opts.retreatName !== opts.guestName) {
    text(opts.guestName, M, 9.5, { color: GREY }); y -= 13;
  }
  y -= 13;

  // ---- section "This payment"
  text("THIS PAYMENT", M, 10, { font: bold, color: OLIVE });
  y -= 8; rule(OLIVE, 1); y -= (dense ? 12 : 14);
  const c = { desc: M + 2, qty: M + W - 196, unit: M + W - 134, vat: M + W - 84, tot: M + W - 2 };
  text("Description", c.desc, 8, { font: bold, color: GREY });
  text("Qty", 0, 8, { font: bold, color: GREY, right: c.qty + 20 });
  text("Unit", 0, 8, { font: bold, color: GREY, right: c.unit + 28 });
  text("VAT", 0, 8, { font: bold, color: GREY, right: c.vat + 20 });
  text("Total", 0, 8, { font: bold, color: GREY, right: c.tot });
  y -= (dense ? 12 : 14);

  for (const [cat, groups] of cats) {
    ensure(44);
    if (!dense) y -= 2;
    const catTotal = groups.reduce((sm, g) => sm + g.rows.reduce((s2, r) => s2 + r.total, 0), 0);
    text(CAT_LABEL[cat] ?? cat, M, 10.5, { font: bold });
    if (multiCat) text(pfEur(Math.round(catTotal * 100) / 100), 0, fs, { color: GREY, right: c.tot });
    y -= 5; rule(rgb(0.85, 0.85, 0.8), 0.5); y -= (dense ? 11 : 13);
    for (const g of groups) {
      if (g.label) {
        ensure(26);
        text(g.label, M + 6, fs, { font: bold, color: rgb(0.3, 0.33, 0.24) });
        y -= rowH;
      }
      for (const r of g.rows) {
        ensure(14);
        const indent = g.label ? 16 : 6;
        text(r.name.slice(0, 58), M + indent, fs, { color: r.total < 0 ? OLIVE : INK });
        if (r.qty != null) {
          text(String(r.qty), 0, fs, { right: c.qty + 20 });
          text(pfEur(r.unit as number), 0, fs, { right: c.unit + 28 });
        }
        text(`${r.vat}%`, 0, fs, { right: c.vat + 20 });
        text(pfEur(r.total), 0, fs, { right: c.tot });
        y -= rowH;
      }
    }
    y -= (dense ? 3 : 6);
  }

  // ---- totaux
  ensure(64);
  rule(OLIVE, 0.8); y -= (dense ? 13 : 15);
  text("Subtotal excl. VAT", 0, fs, { color: GREY, right: c.vat + 20 });
  text(pfEur(Math.round(totalExcl * 100) / 100), 0, fs, { right: c.tot });
  y -= rowH;
  text("VAT", 0, fs, { color: GREY, right: c.vat + 20 });
  text(pfEur(Math.round((totalIncl - totalExcl) * 100) / 100), 0, fs, { right: c.tot });
  y -= (dense ? 15 : 19);
  page.drawRectangle({ x: M, y: y - 6, width: W, height: 22, color: LIGHT });
  text("Total due", M + 8, 11, { font: bold });
  text(pfEur(totalIncl), 0, 11, { font: bold, color: OLIVE, right: c.tot });
  y -= (dense ? 18 : 24);

  // ---- echeancier complet du sejour
  if (withSched) {
    ensure(70);
    text("YOUR PAYMENT SCHEDULE", M, 10, { font: bold, color: OLIVE });
    y -= 8; rule(OLIVE, 1); y -= (dense ? 12 : 14);
    text("Payment", c.desc, 8, { font: bold, color: GREY });
    text("Due date", M + W - 216, 8, { font: bold, color: GREY });
    text("Status", M + W - 128, 8, { font: bold, color: GREY });
    text("Amount", 0, 8, { font: bold, color: GREY, right: c.tot });
    y -= (dense ? 12 : 14);
    const requestedIds = new Set(opts.requested.map((r) => r.id));
    let paidSum = 0, totalSum = 0;
    for (const i of sched) {
      ensure(14);
      const amount = Number(i.amount_due);
      totalSum += amount;
      if (i.status === "paid") paidSum += amount;
      const isReq = requestedIds.has(i.id);
      const status = i.category === "discount" ? "Discount"
        : i.status === "paid" ? `Paid${i.paid_on ? ` ${pfDate(i.paid_on)}` : ""}`
        : isReq ? "This request" : "Upcoming";
      const f = isReq ? bold : helv;
      text((i.label || "Payment").slice(0, 40), c.desc + 4, fs, { font: f, color: i.status === "paid" && !isReq ? GREY : INK });
      text(i.category === "discount" ? "—" : pfDate(i.due_date), M + W - 216, fs, { font: f, color: i.status === "paid" ? GREY : INK });
      text(status, M + W - 128, fs, { font: f, color: i.status === "paid" ? GREY : isReq ? OLIVE : INK });
      text(pfEur(amount), 0, fs, { font: f, right: c.tot });
      y -= rowH;
    }
    y -= 4;
    ensure(64); // le bloc de totaux ne doit jamais mordre sur le pied de page
    rule(OLIVE, 0.8); y -= (dense ? 13 : 15);
    const remaining = totalSum - paidSum - totalIncl;
    text("Total for your stay", 0, fs, { color: GREY, right: M + W - 136 });
    text(pfEur(totalSum), 0, fs, { right: c.tot });
    y -= rowH;
    text("Already paid", 0, fs, { color: GREY, right: M + W - 136 });
    text(pfEur(paidSum), 0, fs, { right: c.tot });
    y -= rowH;
    text("This payment", 0, fs, { font: bold, right: M + W - 136 });
    text(pfEur(totalIncl), 0, fs, { font: bold, color: OLIVE, right: c.tot });
    y -= rowH;
    text("Remaining after this payment", 0, fs, { color: GREY, right: M + W - 136 });
    text(pfEur(Math.max(0, Math.round(remaining * 100) / 100)), 0, fs, { right: c.tot });
  }

  // ---- pied de page centre, fixe en bas de la derniere page
  rule(rgb(0.85, 0.85, 0.8), 0.5, M + 150, M + W - 150, 82);
  text("This document is not an invoice. Your official invoice-receipt (fatura-recibo)", 0, 8, { color: GREY, center: true, atY: 66 });
  text("will be issued and emailed to you as soon as your payment is received.", 0, 8, { color: GREY, center: true, atY: 55 });
  text("Quinta do Amor  ·  www.quintamor.com  ·  hello@quintamor.com  ·  +351 931 377 682", 0, 8, { color: GREY, center: true, atY: 37 });

  return await doc.saveAsBase64();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    // Appel interne (stripe-webhook -> email de confirmation auto) :
    // authentifié par x-cron-key = app_settings.internal.cron_key.
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
    const { kind } = parsed.data;
    if (kind === "request" && !parsed.data.subject && !parsed.data.preview_proforma) {
      return json({ error: "subject required" }, 400);
    }
    const ids = parsed.data.installment_ids?.length
      ? [...new Set(parsed.data.installment_ids)]
      : (parsed.data.installment_id ? [parsed.data.installment_id] : []);
    if (!ids.length) return json({ error: "installment_id or installment_ids required" }, 400);
    if (kind === "confirmation" && ids.length > 1) {
      return json({ error: "confirmation takes a single installment_id" }, 400);
    }

    const { data: instsData } = await admin.from("payment_installments")
      .select("id,booking_id,label,amount_due,amount_excl_vat,status,is_cash,category,due_date,paid_on,vat_rate,product_lines,invoice_file_url,invoice_file_name,invoice_number,stripe_session_id")
      .in("id", ids);
    const insts = (instsData ?? []);
    if (insts.length !== ids.length) return json({ error: "Installment not found" }, 404);
    if (new Set(insts.map((i) => i.booking_id)).size !== 1) {
      return json({ error: "All installments must belong to the same booking" }, 400);
    }
    // Ancre du groupe = la première échéance demandée
    const inst = insts.find((i) => i.id === ids[0])!;

    const { data: booking } = await admin.from("bookings")
      .select("id,email,first_name,last_name,retreat_name,check_in_date,check_out_date")
      .eq("id", inst.booking_id).maybeSingle();
    if (!booking?.email) return json({ error: "Booking has no email" }, 400);
    const to = booking.email;

    // Prévisualisation du pro forma : on renvoie le PDF, rien n'est envoyé.
    if (kind === "request" && parsed.data.preview_proforma) {
      const { data: allInsts } = await admin.from("payment_installments")
        .select("id,label,amount_due,amount_excl_vat,status,is_cash,category,due_date,paid_on,vat_rate,product_lines")
        .eq("booking_id", inst.booking_id);
      const guestName = `${booking.first_name ?? ""} ${booking.last_name ?? ""}`.trim() || booking.email;
      const pdfB64 = await buildProFormaPdf({
        guestName,
        retreatName: booking.retreat_name ?? null,
        checkIn: booking.check_in_date, checkOut: booking.check_out_date,
        requested: insts as unknown as PfInst[],
        all: (allInsts ?? []) as unknown as PfInst[],
      });
      return json({ proforma: pdfB64, filename: "Payment details - Quinta do Amor.pdf" });
    }

    // Sujet / corps par défaut (template validé) pour la confirmation —
    // utilisé par l'automatisation du webhook, éditable dans l'admin sinon.
    let subject = parsed.data.subject ?? "";
    let bodyText = parsed.data.body ?? "";
    if (kind === "confirmation" && (!subject || !bodyText)) {
      const { data: sibs } = await admin.from("payment_installments")
        .select("id,amount_due,status,category,stripe_session_id,is_cash")
        .eq("booking_id", inst.booking_id);
      const group = inst.stripe_session_id
        ? (sibs ?? []).filter((s) => s.stripe_session_id === inst.stripe_session_id)
        : [inst];
      const amount = group.reduce((s, g) => s + Math.abs(Number(g.amount_due)), 0);
      const allSettled = (sibs ?? []).filter((s) => s.category !== "discount")
        .every((s) => s.status === "paid");
      const first = (booking.first_name ?? "").trim() || "there";
      // Template editable depuis l'onglet Emails (table email_templates) —
      // repli sur le texte historique si la ligne a disparu.
      const { data: tplRow } = await admin.from("email_templates")
        .select("subject,body").eq("key", "payment_confirmation").maybeSingle();
      const vars: Record<string, string> = {
        first_name: first,
        amount: fmtEur(amount),
        settled_note: allSettled ? " Your stay is now fully settled." : "",
        retreat_name: booking.retreat_name ?? "",
      };
      const render = (t: string) => t.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? "");
      subject = subject || (tplRow?.subject ? render(tplRow.subject) : "Payment received — you're all set");
      bodyText = bodyText || (tplRow?.body ? render(tplRow.body) :
`Hi ${first},

Good news, your payment of ${fmtEur(amount)} has arrived safely.${allSettled ? " Your stay is now fully settled." : ""}

If you have any questions at all, I'm always happy to help. Just reply here.

See you very soon at the Quinta.

Warmly,
Geo`);
    }

    // Récap solde du séjour (2 sept 2026, demande Geoffroy) : chaque email de
    // paiement dit ce qui est déjà payé et ce qui restera à payer — évite les
    // confusions de montant (cas Michael / Max / Shandra). Hors lignes bar
    // (admin-only) ; les discounts négatifs sont inclus dans le total dû.
    const { data: balRows } = await admin.from("payment_installments")
      .select("id,amount_due,status,category,label,due_date")
      .eq("booking_id", inst.booking_id);
    const balAll = (balRows ?? []).filter((r) => r.category !== "bar");
    const balTotal = balAll.reduce((s, r) => s + Number(r.amount_due || 0), 0);
    const balPaid = balAll.filter((r) => r.status === "paid").reduce((s, r) => s + Number(r.amount_due || 0), 0);

    let html = "";
    const attachments: { filename: string; content: string }[] = [];

    if (kind === "request") {
      for (const i of insts) {
        if (i.status === "paid") return json({ error: `"${i.label ?? "A payment"}" is already settled` }, 400);
        if (i.is_cash) return json({ error: `"${i.label ?? "A payment"}" is a cash payment — no online link` }, 400);
        if (i.category === "discount") return json({ error: "Discount lines cannot be requested" }, 400);
      }
      let payUrl: string;
      if (ids.length > 1) {
        const token = await signInstallment([...ids].sort().join(","));
        payUrl = `${FUNCTIONS_BASE}/stripe-checkout?installments=${ids.join(",")}&t=${token}`;
      } else {
        const token = await signInstallment(inst.id);
        payUrl = `${FUNCTIONS_BASE}/stripe-checkout?installment=${inst.id}&t=${token}`;
      }
      const amount = fmtEur(insts.reduce((s, i) => s + Number(i.amount_due || 0), 0));

      // Pro forma PDF joint : detail de ce paiement + echeancier du sejour.
      // Best-effort — si la generation echoue, l'email part sans PDF.
      let proFormaAttached = false;
      try {
        const { data: allInsts } = await admin.from("payment_installments")
          .select("id,label,amount_due,amount_excl_vat,status,is_cash,category,due_date,paid_on,vat_rate,product_lines")
          .eq("booking_id", inst.booking_id);
        const guestName = `${booking.first_name ?? ""} ${booking.last_name ?? ""}`.trim() || booking.email;
        const pdfB64 = await buildProFormaPdf({
          guestName,
          retreatName: booking.retreat_name ?? null,
          checkIn: booking.check_in_date, checkOut: booking.check_out_date,
          requested: insts as unknown as PfInst[],
          all: (allInsts ?? []) as unknown as PfInst[],
        });
        attachments.push({ filename: "Payment details - Quinta do Amor.pdf", content: pdfB64 });
        proFormaAttached = true;
      } catch (e) {
        console.error("[pro-forma] generation failed (email sent without PDF):", e);
      }

      // Mise en page sobre façon mail personnel, mais avec un vrai bouton
      // (aligné à gauche, pas de bloc centré marketing).
      html = emailShell(`
${paras(parsed.data.body_top ?? "")}
<p style="margin:18px 0 6px 0;"><a href="${payUrl}" style="display:inline-block;background:#6d7855;color:#ffffff;text-decoration:none;font-weight:bold;padding:11px 26px;border-radius:8px;font-family:Helvetica,Arial,sans-serif;font-size:13px;">Pay ${esc(amount)}</a></p>
<p style="margin:0 0 6px 0;font-size:11px;color:#888888;">Secure bank payment (debit or transfer), powered by Stripe.${proFormaAttached ? " The full details of this payment are attached." : ""}</p>
<p style="margin:0 0 18px 0;font-size:11px;color:#555555;">${(() => {
  const thisPay = insts.reduce((s, i) => s + Number(i.amount_due || 0), 0);
  const after = Math.max(0, Math.round((balTotal - balPaid - thisPay) * 100) / 100);
  const paidPart = balPaid > 0.005 ? `${fmtEur(balPaid)} already received · ` : "";
  const afterPart = after > 0.005 ? `${fmtEur(after)} will remain for later` : "after it, your stay is fully settled";
  return `Where you stand: ${paidPart}this payment ${fmtEur(thisPay)} · ${afterPart}.`;
})()}</p>
${(() => {
  // Échéancier structuré dans l'email (2 sept 2026, demande Geoffroy) : le
  // client voit tout le calendrier — payé ✓, ce paiement →, à venir ○.
  // Hors lignes bar (admin-only) ; discounts affichés en ligne neutre.
  const fmtD = (d: string | null) => d
    ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    : "";
  const idSet = new Set(insts.map((i) => i.id));
  const rows = [...balAll]
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"))
    .map((r) => {
      const isThis = idSet.has(r.id);
      const isPaid = r.status === "paid";
      const isDisc = r.category === "discount";
      const mark = isDisc ? "&nbsp;" : isPaid ? "✓" : isThis ? "→" : "○";
      const col = isPaid ? "#178A3F" : isThis ? "#35532A" : "#888888";
      const w = isThis ? "font-weight:bold;" : "";
      const note = isPaid ? "paid" : isThis ? "this payment" : (fmtD(r.due_date) ? `due ${fmtD(r.due_date)}` : "upcoming");
      return `<tr>
        <td style="padding:5px 8px 5px 0;color:${col};font-size:12px;width:14px;">${mark}</td>
        <td style="padding:5px 8px 5px 0;color:${isDisc ? "#888888" : "#31352E"};font-size:12px;${w}">${esc(r.label || (isDisc ? "Discount" : "Payment"))}</td>
        <td style="padding:5px 8px;color:${col};font-size:11px;white-space:nowrap;">${isDisc ? "" : note}</td>
        <td style="padding:5px 0;color:${isDisc ? "#888888" : "#31352E"};font-size:12px;text-align:right;white-space:nowrap;${w}">${fmtEur(Number(r.amount_due))}</td>
      </tr>`;
    }).join("");
  const hasCateringLines = balAll.some((r) => ["catering", "extra", "transport"].includes(r.category ?? ""));
  const cateringNote = hasCateringLines ? "" :
    `<p style="margin:8px 0 0 0;font-size:11px;color:#888888;">Catering &amp; extras are invoiced separately, one week before check-in.</p>`;
  return `
<div style="margin:4px 0 18px 0;border:1px solid #E5D9C8;border-radius:10px;padding:12px 16px;background:#FDFCF8;">
  <p style="margin:0 0 6px 0;font-size:10px;font-weight:bold;letter-spacing:.08em;color:#35532A;">PAYMENT SCHEDULE — YOUR STAY</p>
  <table style="width:100%;border-collapse:collapse;">${rows}</table>
  ${cateringNote}
</div>`;
})()}
${paras(parsed.data.body_bottom ?? "")}
`);
    } else {
      // confirmation : facture en pièce jointe obligatoire
      if (!inst.invoice_file_url) {
        return json({ error: "No invoice attached to this payment — generate it first" }, 400);
      }
      const dl = await admin.storage.from("invoices").download(inst.invoice_file_url);
      if (dl.error || !dl.data) return json({ error: `Could not read invoice file: ${dl.error?.message}` }, 500);
      const buf = new Uint8Array(await dl.data.arrayBuffer());
      let bin = "";
      const chunk = 0x8000;
      for (let i = 0; i < buf.length; i += chunk) {
        bin += String.fromCharCode(...buf.subarray(i, i + chunk));
      }
      attachments.push({
        filename: inst.invoice_file_name ?? `${(inst.invoice_number ?? "invoice").replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`,
        content: btoa(bin),
      });
      // Récap solde en pied de confirmation (balPaid inclut déjà ce paiement)
      const remaining = Math.max(0, Math.round((balTotal - balPaid) * 100) / 100);
      html = emailShell(paras(bodyText)
        + `<p style="margin:18px 0 0 0;font-size:11px;color:#888888;">Payment overview: ${fmtEur(balPaid)} received of ${fmtEur(balTotal)}${remaining > 0.005 ? ` · ${fmtEur(remaining)} remaining` : " — your stay is fully settled"}.</p>`);
    }

    // Pièces jointes fournies par l'admin (les deux kinds)
    const extra = parsed.data.attachments ?? [];
    const totalB64 = extra.reduce((s, a) => s + a.content.length, 0);
    if (totalB64 > 14_000_000) return json({ error: "Attachments too large — keep the total under 10 MB" }, 400);
    for (const a of extra) {
      attachments.push({ filename: a.filename.replace(/[/\\]/g, "_"), content: a.content });
    }

    const ccList = await ccEmailsFor(admin, inst.booking_id, to);
    const sent = await resend.emails.send({
      from: FROM_EMAIL,
      to: [to],
      ...(ccList.length ? { cc: ccList } : {}),
      reply_to: REPLY_TO,
      subject,
      html,
      ...(attachments.length ? { attachments } : {}),
    });
    if (sent.error) {
      const { error: logErr } = await admin.from("reminder_log").insert(insts.map((i) => ({
        type: kind === "request" ? "payment_request" : "payment_receipt",
        installment_id: i.id, booking_id: booking.id, recipient: to, subject,
        status: "error", error: String(sent.error!.message ?? sent.error), body_html: html,
      })));
      if (logErr) console.error("reminder_log insert failed:", logErr.message);
      return json({ error: String(sent.error.message ?? sent.error) }, 502);
    }

    // ⚠️ Ne jamais laisser cet insert échouer en silence : c'est lui qui
    // alimente la mention "Payment email sent" dans l'admin (cause du bug du
    // 18 août 2026 — contrainte CHECK qui refusait payment_request).
    const { error: logErr } = await admin.from("reminder_log").insert(insts.map((i) => ({
      type: kind === "request" ? "payment_request" : "payment_receipt",
      installment_id: i.id, booking_id: booking.id, recipient: to, subject,
      status: "sent", error: null, body_html: html,
    })));
    if (logErr) console.error("reminder_log insert failed (email WAS sent):", logErr.message);

    return json({ sent: true, to, kind, attachment: attachments[0]?.filename ?? null });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    console.error("payment-emails error:", msg);
    return json({ error: msg }, 500);
  }
});
