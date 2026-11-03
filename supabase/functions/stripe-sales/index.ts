// Ventes Stripe hors bookings (tickets festival, events, add-ons) -> fatura-recibo
// Moloni serie TERRA, une par charge Stripe reussie. (2 nov 2026, demande Geoffroy ;
// TVA validee BDO : billets 6 % / entrees de spectacles, le reste 23 %.)
//
// Trois portes d'entree :
//   1. Webhook Stripe (header stripe-signature, verify_jwt=false) : les comptes
//      Quinta ET Terra pointent un endpoint chacun vers cette fonction. Le
//      compte est identifie par le signing secret qui matche. Sessions de
//      checkout SANS installment_ids (les bookings restent sur stripe-webhook).
//   2. { action: "sync", account, dry_run? } (admin JWT ou x-cron-key) :
//      backfill — scanne les charges du compte, remplit stripe_sales en
//      pending_review, ne facture RIEN. Rapport pour validation.
//   3. { action: "invoice", ids? | all_pending? } : facture les lignes
//      pending_review (client Moloni nom/email/NIF Stripe, lignes produits
//      ticket 6 % / standard 23 %, PDF -> bucket invoices/stripe-sales/).
//
// Config : app_settings.stripe_sales (document_set_id TERRA, products, patterns).
// Cles : app_settings.internal.stripe_secret_key (quinta),
//        .stripe_terra_secret_key (terra),
//        .stripe_sales_webhook_secret_quinta / _terra (webhooks de CE endpoint).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
};
const MOLONI_API = "https://api.molonion.pt/v1";
const MEDIA_BASE = "https://mediaapi.moloni.org";
// Taux (%) -> taxId Moloni. NE JAMAIS utiliser 1923 (reconfiguree en 1 % — voir CLAUDE.md).
const TAX_IDS: Record<number, number> = { 23: 22469, 13: 1924, 6: 1925 };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Account = "quinta" | "terra";
type Internal = Record<string, string>;
let _internal: Internal | null = null;
async function internal(): Promise<Internal> {
  if (_internal) return _internal;
  const { data } = await admin.from("app_settings").select("value").eq("key", "internal").maybeSingle();
  _internal = (data?.value ?? {}) as Internal;
  return _internal;
}
async function stripeKey(account: Account): Promise<string> {
  const v = await internal();
  const key = account === "terra" ? v.stripe_terra_secret_key : v.stripe_secret_key;
  if (!key) throw new Error(`Stripe key missing for account '${account}' (app_settings.internal.${account === "terra" ? "stripe_terra_secret_key" : "stripe_secret_key"})`);
  return key;
}

type SalesCfg = {
  document_set_id: number;
  payment_method_id: number;
  products: { ticket: number; standard: number };
  ticket_patterns: string[];
  // Prioritaires sur ticket_patterns ("Non-ticket purchases" contient "ticket"
  // mais doit rester 23 % ; retraites/add-ons = regime normal, 2 nov 2026).
  standard_patterns?: string[];
  // Routage par lieu (3 nov 2026, demande Geoffroy) : les ventes Dia do Amor
  // appartiennent a Quinta do Amor -> serie FT2026 (document set 596), pas
  // TERRA. Meme entite juridique, seule la serie change.
  quinta_document_set_id?: number;
  quinta_patterns?: string[];
};
async function salesCfg(): Promise<SalesCfg> {
  const { data } = await admin.from("app_settings").select("value").eq("key", "stripe_sales").maybeSingle();
  const v = data?.value as SalesCfg | null;
  if (!v?.document_set_id || !v?.products) throw new Error("STRIPE_SALES_CONFIG_MISSING");
  return v;
}

async function gql(query: string, variables?: Record<string, unknown>) {
  const key = (await internal()).moloni_api_key;
  if (!key) throw new Error("MOLONI_KEY_MISSING");
  const r = await fetch(MOLONI_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, variables: variables ?? {} }),
  });
  const body = await r.json().catch(async () => ({ raw: await r.text() }));
  if (!r.ok) throw new Error(`Moloni HTTP ${r.status}: ${JSON.stringify(body).slice(0, 400)}`);
  return body;
}

async function stripeGet(account: Account, path: string): Promise<Record<string, unknown>> {
  const key = await stripeKey(account);
  const r = await fetch(`https://api.stripe.com${path}`, { headers: { Authorization: `Bearer ${key}` } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Stripe ${path} HTTP ${r.status}: ${JSON.stringify((body as { error?: { message?: string } })?.error?.message ?? body).slice(0, 300)}`);
  return body as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Extraction d'une vente depuis Stripe : session (line items, client, NIF)
// retrouvee via le payment_intent de la charge. Fallback : 1 ligne standard
// au montant de la charge.
// ---------------------------------------------------------------------------
type LineItem = { name: string; qty: number; unit_ttc: number; kind: "ticket" | "standard" };
type SaleRow = {
  account: Account; charge_id: string; payment_intent: string | null; session_id: string | null;
  paid_at: string; amount: number; currency: string; email: string | null;
  customer_name: string | null; nif: string | null; line_items: LineItem[];
  livemode: boolean; country: string | null;
};

const BOOKING_META = ["installment_ids", "installment_id", "booking_id"];
const isBookingMeta = (m: Record<string, unknown> | null | undefined) =>
  !!m && BOOKING_META.some((k) => k in m);

function classify(name: string, cfg: SalesCfg): "ticket" | "standard" {
  const n = name.toLowerCase();
  if ((cfg.standard_patterns ?? []).some((p) => n.includes(p.toLowerCase()))) return "standard";
  return cfg.ticket_patterns.some((p) => n.includes(p.toLowerCase())) ? "ticket" : "standard";
}

function extractNif(cd: Record<string, unknown> | null | undefined): string | null {
  const ids = (cd?.tax_ids ?? []) as { type?: string; value?: string }[];
  for (const t of ids) {
    const raw = String(t?.value ?? "").replace(/[^0-9A-Za-z]/g, "").replace(/^PT/i, "");
    if (/^[1235689]\d{8}$/.test(raw)) return raw; // NIF portugais plausible
  }
  return null;
}

async function saleFromCharge(account: Account, charge: Record<string, unknown>, cfg: SalesCfg): Promise<{ sale?: SaleRow; skip?: string }> {
  const c = charge as {
    id: string; amount: number; amount_refunded?: number; currency: string; created: number;
    paid: boolean; status: string; livemode: boolean; refunded?: boolean; invoice?: string | null;
    payment_intent?: string | null; metadata?: Record<string, unknown>;
    billing_details?: { name?: string; email?: string };
    receipt_email?: string | null; description?: string | null;
  };
  if (c.status !== "succeeded" || !c.paid) return { skip: "not succeeded" };
  if (c.refunded || (c.amount_refunded ?? 0) > 0) return { skip: "refunded (handle manually)" };
  if (c.invoice) return { skip: "stripe invoice payment (likely booking — check manually)" };
  if (isBookingMeta(c.metadata)) return { skip: "booking installment" };
  if ((c.currency ?? "eur").toLowerCase() !== "eur") return { skip: `currency ${c.currency} (handle manually)` };

  // Session de checkout liee (Payment Links & Checkout) -> lignes + client + NIF
  let session: Record<string, unknown> | null = null;
  if (c.payment_intent) {
    try {
      const s = await stripeGet(account, `/v1/checkout/sessions?payment_intent=${c.payment_intent}&limit=1`);
      session = ((s as { data?: Record<string, unknown>[] })?.data ?? [])[0] ?? null;
    } catch (e) {
      console.error(`[sale] session lookup failed for ${c.id}:`, String((e as Error)?.message ?? e));
    }
  }
  if (isBookingMeta((session as { metadata?: Record<string, unknown> } | null)?.metadata)) return { skip: "booking installment (session)" };

  let lines: LineItem[] = [];
  const cd = (session as { customer_details?: Record<string, unknown> } | null)?.customer_details ?? null;
  if (session) {
    try {
      const li = await stripeGet(account, `/v1/checkout/sessions/${(session as { id: string }).id}/line_items?limit=100`);
      lines = (((li as { data?: Record<string, unknown>[] })?.data ?? []) as {
        description?: string; quantity?: number; amount_total?: number;
      }[]).filter((l) => (l.amount_total ?? 0) !== 0).map((l) => {
        const qty = Number(l.quantity ?? 1) || 1;
        const totalTtc = Number(l.amount_total ?? 0) / 100;
        return {
          name: String(l.description ?? "Sale"),
          qty,
          unit_ttc: Math.round((totalTtc / qty) * 1e6) / 1e6,
          kind: classify(String(l.description ?? ""), cfg),
        };
      });
    } catch (e) {
      console.error(`[sale] line_items failed for ${c.id}:`, String((e as Error)?.message ?? e));
    }
  }
  const amount = Math.round(c.amount) / 100;
  if (!lines.length) {
    const name = c.description || "Stripe sale";
    lines = [{ name, qty: 1, unit_ttc: amount, kind: classify(name, cfg) }];
  }
  // Coherence : si la somme des lignes devie du paye (remises Stripe...), on met a l'echelle.
  const sum = lines.reduce((s, l) => s + l.qty * l.unit_ttc, 0);
  if (sum > 0 && Math.abs(sum - amount) > 0.01) {
    const ratio = amount / sum;
    lines = lines.map((l) => ({ ...l, unit_ttc: Math.round(l.unit_ttc * ratio * 1e6) / 1e6 }));
  }

  return {
    sale: {
      account,
      charge_id: c.id,
      payment_intent: c.payment_intent ?? null,
      session_id: (session as { id?: string } | null)?.id ?? null,
      paid_at: new Date(c.created * 1000).toISOString(),
      amount,
      currency: (c.currency ?? "eur").toLowerCase(),
      email: String((cd as { email?: string } | null)?.email ?? c.billing_details?.email ?? c.receipt_email ?? "").toLowerCase() || null,
      customer_name: String((cd as { name?: string } | null)?.name ?? c.billing_details?.name ?? "").trim() || null,
      nif: extractNif(cd),
      line_items: lines,
      livemode: !!c.livemode,
      country: String((cd as { address?: { country?: string } } | null)?.address?.country ?? "") || null,
    },
  };
}

// ---------------------------------------------------------------------------
// action sync — backfill : scanne toutes les charges du compte, upsert en
// pending_review. Ne facture rien ; renvoie un rapport.
// ---------------------------------------------------------------------------
async function sync(account: Account) {
  const cfg = await salesCfg();
  const report = { account, scanned: 0, new_pending: 0, already_known: 0, test_mode: 0, skipped: {} as Record<string, number> };
  let startingAfter: string | null = null;
  for (let page = 0; page < 40; page++) {
    const path = `/v1/charges?limit=100${startingAfter ? `&starting_after=${startingAfter}` : ""}`;
    const res = await stripeGet(account, path) as { data?: Record<string, unknown>[]; has_more?: boolean };
    const charges = res.data ?? [];
    for (const ch of charges) {
      report.scanned++;
      if (!(ch as { livemode?: boolean }).livemode) { report.test_mode++; continue; }
      const { sale, skip } = await saleFromCharge(account, ch, cfg);
      if (skip) { report.skipped[skip] = (report.skipped[skip] ?? 0) + 1; continue; }
      if (!sale) continue;
      const { data: ins, error } = await admin.from("stripe_sales")
        .upsert({ ...sale, updated_at: new Date().toISOString() }, { onConflict: "charge_id", ignoreDuplicates: true })
        .select("id");
      if (error) throw new Error(`stripe_sales upsert: ${error.message}`);
      if ((ins ?? []).length > 0) report.new_pending++; else report.already_known++;
    }
    if (!res.has_more || !charges.length) break;
    startingAfter = (charges[charges.length - 1] as { id: string }).id;
  }
  return report;
}

// ---------------------------------------------------------------------------
// action enrich — complete les lignes pending sans detail : les ventes Ticket
// Tailor (festival/retraites Terra) sont des PaymentIntents SANS session
// Checkout, mais la charge porte tout en metadata (TicketTailor, event_name,
// order_id, name, email_address). Recalcule aussi le kind de TOUTES les
// lignes pending avec les patterns a jour. (2 nov 2026)
// ---------------------------------------------------------------------------
async function enrich(account: Account, limit: number) {
  const cfg = await salesCfg();
  const { data: rows } = await admin.from("stripe_sales")
    .select("id,charge_id,email,customer_name,line_items,amount")
    .eq("account", account).eq("status", "pending_review")
    .order("paid_at", { ascending: true });
  const all = rows ?? [];
  // Converge : on ne re-fetche que les noms generiques. Une ligne renommee
  // (meme sans email trouvable) ne repasse plus — sinon les ventes sans
  // aucune donnee client seraient re-fetchees a chaque run.
  const needsFetch = (r: typeof all[number]) => {
    const lines = (r.line_items ?? []) as LineItem[];
    return lines.length === 1 && (lines[0].name === "Stripe sale" || /^Order for /.test(lines[0].name));
  };
  const report = { account, reclassified: 0, fetched: 0, enriched: 0, errors: 0, remaining_to_fetch: 0 };
  let budget = limit;
  for (const r of all) {
    let lines = (r.line_items ?? []) as LineItem[];
    let email = r.email, name = r.customer_name;
    if (needsFetch(r)) {
      if (budget <= 0) { report.remaining_to_fetch++; continue; }
      budget--;
      report.fetched++;
      try {
        type ChargeBits = {
          description?: string | null;
          metadata?: Record<string, string> | null;
          billing_details?: { name?: string; email?: string };
          receipt_email?: string | null;
          customer?: { email?: string | null; name?: string | null } | null;
          payment_intent?: string | null;
        };
        // expand[]=customer exige la permission Customers Read sur la cle
        // restreinte — fallback sans expand si refuse (2 nov 2026).
        let c: ChargeBits;
        try {
          c = await stripeGet(account, `/v1/charges/${r.charge_id}?expand[]=customer`) as ChargeBits;
        } catch (_e) {
          c = await stripeGet(account, `/v1/charges/${r.charge_id}`) as ChargeBits;
        }
        let m = c.metadata ?? {};
        let desc = c.description ?? null;
        // Ticket Tailor pose parfois les metadata sur le PaymentIntent et pas
        // sur la charge (variable selon la periode) — fallback PI (2 nov 2026).
        if (!m.event_name && c.payment_intent) {
          try {
            const pi = await stripeGet(account, `/v1/payment_intents/${c.payment_intent}`) as ChargeBits;
            if (pi.metadata && Object.keys(pi.metadata).length) m = { ...pi.metadata, ...m };
            desc = desc || pi.description || null;
          } catch (_e) { /* best effort */ }
        }
        email = (m.email_address ?? c.billing_details?.email ?? c.receipt_email ?? c.customer?.email ?? email ?? "")
          .toLowerCase() || null;
        name = (m.name ?? c.billing_details?.name ?? c.customer?.name ?? name ?? "").trim() || null;
        // Nom de ligne TOUJOURS non generique pour converger :
        // event_name — order N > description sans "Order for " > Typeform <form> > ref charge.
        const lineName = m.event_name
          ? `${m.event_name}${m.order_id ? ` — order ${m.order_id}` : ""}`
          : desc
            ? desc.replace(/^Order for /, "")
            : m.typeform_form_id
              ? `Typeform ${m.typeform_form_id}`
              : `Stripe payment ${r.charge_id}`;
        if (lines.length <= 1) {
          lines = [{ name: lineName, qty: 1, unit_ttc: Number(r.amount), kind: classify(lineName, cfg) }];
        }
        report.enriched++;
      } catch (e) {
        report.errors++;
        console.error(`[enrich] ${r.charge_id}:`, String((e as Error)?.message ?? e));
        continue;
      }
    }
    const reclassed = lines.map((l) => ({ ...l, kind: classify(l.name, cfg) }));
    const changed = JSON.stringify(reclassed) !== JSON.stringify(r.line_items) || email !== r.email || name !== r.customer_name;
    if (changed) {
      report.reclassified++;
      const { error } = await admin.from("stripe_sales").update({
        email, customer_name: name, line_items: reclassed, updated_at: new Date().toISOString(),
      }).eq("id", r.id);
      if (error) { report.errors++; console.error(`[enrich] update ${r.charge_id}:`, error.message); }
    }
  }
  return report;
}

// ---------------------------------------------------------------------------
// Facturation Moloni d'une ligne stripe_sales.
// ---------------------------------------------------------------------------
async function moloniCustomer(cfg: SalesCfg, sale: { customer_name: string | null; email: string | null; nif: string | null; country: string | null }): Promise<number> {
  const companyId = await moloniCompanyId();
  const isNif = !!sale.nif;
  // Vente anonyme (ni NIF, ni email, ni nom) -> LE client Consumidor Final
  // (NIF 999999990), jamais un doublon par vente (2 nov 2026).
  if (!sale.nif && !sale.email && !sale.customer_name) {
    const res = await gql(`query($c: Int!, $s: String!) {
      customers(companyId: $c, options: { search: { field: ALL, value: $s }, pagination: { page: 1, qty: 5 } }) {
        data { customerId name vat } errors { field msg }
      }
    }`, { c: companyId, s: "999999990" });
    const hit = ((res?.data?.customers?.data ?? []) as { customerId: number; vat?: string }[])
      .find((h) => h.vat === "999999990");
    if (hit) return hit.customerId;
  }
  // Nom sans email : recherche par nom exact pour reutiliser la fiche d'un
  // acheteur recurrent au lieu d'en creer une par vente.
  const search = sale.nif ?? sale.email ?? sale.customer_name ?? "";
  if (search) {
    const res = await gql(`query($c: Int!, $s: String!) {
      customers(companyId: $c, options: { search: { field: ALL, value: $s }, pagination: { page: 1, qty: 5 } }) {
        data { customerId name vat email } errors { field msg }
      }
    }`, { c: companyId, s: search });
    const hits = (res?.data?.customers?.data ?? []) as { customerId: number; vat?: string; email?: string; name?: string }[];
    const exact = hits.find((h) =>
      (isNif && h.vat === sale.nif) ||
      (!isNif && !!sale.email && (h.email ?? "").toLowerCase() === sale.email) ||
      (!isNif && !sale.email && !!sale.customer_name && (h.name ?? "").trim().toLowerCase() === sale.customer_name.trim().toLowerCase())
    ) ?? (isNif ? hits[0] : undefined);
    if (exact) return exact.customerId;
  }
  // Pays : code ISO2 Stripe -> nom anglais -> lookup Moloni (defaut Portugal)
  let countryId = 1;
  if (sale.country && sale.country !== "PT") {
    try {
      const name = new Intl.DisplayNames(["en"], { type: "region" }).of(sale.country);
      if (name) {
        const cRes = await gql(`query($s: String!) { countries(options: { search: { field: ALL, value: $s }, pagination: { page: 1, qty: 5 } }) { data { countryId } errors { msg } } }`, { s: name });
        const hit = (cRes?.data?.countries?.data ?? [])[0];
        if (hit?.countryId) countryId = hit.countryId;
      }
    } catch (_e) { /* defaut PT */ }
  }
  const next = await gql(`query($c: Int!) { customerNextNumber(companyId: $c) { data errors { msg } } }`, { c: companyId });
  const number = next?.data?.customerNextNumber?.data ?? `C${Date.now()}`;
  const created = await gql(`mutation($c: Int!, $d: CustomerInsert!) {
    customerCreate(companyId: $c, data: $d) { data { customerId } errors { field msg } }
  }`, {
    c: companyId,
    d: {
      number: String(number),
      name: sale.customer_name || sale.email || "Consumidor Final",
      countryId,
      languageId: countryId === 1 ? 1 : 3,
      ...(sale.nif ? { vat: sale.nif } : {}),
      ...(sale.email ? { email: sale.email } : {}),
    },
  });
  const errs = created?.data?.customerCreate?.errors;
  if (errs?.length) throw new Error(`customerCreate: ${JSON.stringify(errs).slice(0, 300)}`);
  const id = created?.data?.customerCreate?.data?.customerId;
  if (!id) throw new Error(`customerCreate returned no id: ${JSON.stringify(created).slice(0, 300)}`);
  return id;
}

let _companyId: number | null = null;
async function moloniCompanyId(): Promise<number> {
  if (_companyId) return _companyId;
  const { data } = await admin.from("app_settings").select("value").eq("key", "moloni").maybeSingle();
  const id = (data?.value as { company_id?: number } | null)?.company_id;
  if (!id) throw new Error("MOLONI_CONFIG_MISSING");
  _companyId = id;
  return id;
}

const fmtDatePt = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

async function invoiceSale(saleId: string, withPdf = true): Promise<Record<string, unknown>> {
  const cfg = await salesCfg();
  const companyId = await moloniCompanyId();
  const { data: sale, error } = await admin.from("stripe_sales").select("*").eq("id", saleId).maybeSingle();
  if (error) throw error;
  if (!sale) throw new Error("sale not found");
  if (sale.status === "invoiced" || sale.moloni_document_id) {
    return { already_invoiced: sale.invoice_number ?? sale.moloni_document_id };
  }
  if (!sale.livemode) throw new Error("test-mode charge — no real invoice");
  try {
    const customerId = await moloniCustomer(cfg, sale);
    const lines = (sale.line_items ?? []) as LineItem[];
    if (!lines.length) throw new Error("no line items");
    const products = lines.map((l, i) => {
      const rate = l.kind === "ticket" ? 6 : 23;
      return {
        productId: l.kind === "ticket" ? cfg.products.ticket : cfg.products.standard,
        qty: l.qty,
        ordering: i + 1,
        price: Math.round((l.unit_ttc / (1 + rate / 100)) * 1e6) / 1e6,
        summary: `${l.name} — paid via Stripe ${fmtDatePt(sale.paid_at)}`,
        taxes: [{ taxId: TAX_IDS[rate], ordering: 1, cumulative: false }],
      };
    });
    const totalTtc = Math.round(Number(sale.amount) * 100) / 100;
    // Serie par lieu : Dia do Amor (quinta_patterns) -> FT2026, sinon TERRA.
    const isQuinta = (cfg.quinta_patterns ?? []).some((p) =>
      lines.some((l) => l.name.toLowerCase().includes(p.toLowerCase())));
    const docData: Record<string, unknown> = {
      documentSetId: isQuinta && cfg.quinta_document_set_id ? cfg.quinta_document_set_id : cfg.document_set_id,
      customerId,
      date: new Date().toISOString(),
      expirationDate: new Date().toISOString().slice(0, 10),
      status: 1,
      products,
      payments: [{ paymentMethodId: cfg.payment_method_id, value: totalTtc }],
      notes: `Paid online via Stripe on ${fmtDatePt(sale.paid_at)} (ref ${sale.charge_id}).`,
    };
    const createMutation = `mutation($c: Int!, $d: InvoiceReceiptInsert!) {
      invoiceReceiptCreate(companyId: $c, data: $d) {
        data { documentId number totalValue taxesValue } errors { field msg }
      }
    }`;
    let created = await gql(createMutation, { c: companyId, d: docData }).catch((e: unknown) => ({ __err: String(e) }));
    const firstErr = (created as { __err?: string })?.__err ?? JSON.stringify((created as { errors?: unknown })?.errors ?? "");
    if (/notes/i.test(String(firstErr))) {
      delete docData.notes;
      created = await gql(createMutation, { c: companyId, d: docData });
    } else if ((created as { __err?: string })?.__err) {
      throw new Error(String((created as { __err?: string }).__err));
    }
    const cErrs = created?.data?.invoiceReceiptCreate?.errors;
    if (cErrs?.length) throw new Error(`invoiceReceiptCreate: ${JSON.stringify(cErrs).slice(0, 400)}`);
    const doc = created?.data?.invoiceReceiptCreate?.data;
    if (!doc?.documentId) throw new Error(`invoiceReceiptCreate returned no document: ${JSON.stringify(created).slice(0, 400)}`);

    // Numero prefixe par la serie (TERRA/3 vs FT2026/41) — les deux series
    // numerotent a partir de 1, le prefixe evite toute ambiguite.
    const fullNumber = doc.number != null ? `${isQuinta ? "FT2026" : "TERRA"}/${doc.number}` : null;
    await admin.from("stripe_sales").update({
      status: "invoiced", moloni_document_id: doc.documentId,
      invoice_number: fullNumber, error: null, updated_at: new Date().toISOString(),
    }).eq("id", saleId);

    // PDF -> bucket invoices (best effort ; saute en mode lot — l'attente de
    // generation Moloni (~10-25 s/doc) ferait exploser le temps d'execution.
    // Rattrapage : action 'pdf').
    let pdfPath: string | null = null;
    if (withPdf) pdfPath = await storePdf(saleId, companyId, doc.documentId, fullNumber);
    console.log(`[invoice] ${sale.charge_id} -> ${doc.number ?? doc.documentId} (€${totalTtc})`);
    return { charge_id: sale.charge_id, number: doc.number, document_id: doc.documentId, total: doc.totalValue, pdf: !!pdfPath, set: isQuinta ? "quinta" : "terra" };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 500);
    await admin.from("stripe_sales").update({ status: "error", error: msg, updated_at: new Date().toISOString() }).eq("id", saleId);
    return { charge_id: sale.charge_id, error: msg };
  }
}

// Genere le PDF Moloni d'une fatura stripe_sales et l'archive dans le bucket
// invoices (stripe-sales/{numero}.pdf). Renvoie le chemin ou null.
async function storePdf(saleId: string, companyId: number, documentId: number, number: string | null): Promise<string | null> {
  try {
    await gql(`mutation($c: Int!, $d: Int!) { invoiceReceiptGetPDF(companyId: $c, documentId: $d) }`, { c: companyId, d: documentId });
    let tok: { token?: string; path?: string } | null = null;
    for (let i = 0; i < 8 && !tok?.path; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      const t = await gql(`query($d: Int!) { invoiceReceiptGetPDFToken(documentId: $d) { data { token path filename } errors { msg } } }`, { d: documentId });
      tok = t?.data?.invoiceReceiptGetPDFToken?.data ?? null;
    }
    if (!tok?.path || !tok?.token) return null;
    const pdfRes = await fetch(`${MEDIA_BASE}${tok.path}?jwt=${tok.token}`);
    if (!pdfRes.ok) return null;
    const bytes = new Uint8Array(await pdfRes.arrayBuffer());
    const pdfPath = `stripe-sales/${String(number ?? documentId).replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
    const up = await admin.storage.from("invoices").upload(pdfPath, bytes, { contentType: "application/pdf", upsert: true });
    if (up.error) { console.error("[pdf] upload:", up.error.message); return null; }
    await admin.from("stripe_sales").update({ invoice_pdf_path: pdfPath }).eq("id", saleId);
    return pdfPath;
  } catch (e) {
    console.error("[pdf]", String((e as Error)?.message ?? e));
    return null;
  }
}

// ---------------------------------------------------------------------------
// Webhook Stripe (endpoint dedie ventes — comptes quinta & terra).
// ---------------------------------------------------------------------------
function hexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyWebhook(payload: string, header: string | null): Promise<Account | null> {
  if (!header) return null;
  const pairs = header.split(",").map((p) => p.split("=", 2) as [string, string]);
  const t = pairs.find(([k]) => k.trim() === "t")?.[1];
  const v1s = pairs.filter(([k]) => k.trim() === "v1").map(([, v]) => v).filter(Boolean);
  if (!t || !v1s.length) return null;
  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(age) || age > 600) return null;
  const v = await internal();
  const secrets: [Account, string | undefined][] = [
    ["quinta", v.stripe_sales_webhook_secret_quinta],
    ["terra", v.stripe_sales_webhook_secret_terra],
  ];
  for (const [account, secret] of secrets) {
    if (!secret) continue;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`));
    const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
    if (v1s.some((v1) => hexEqual(hex, v1))) return account;
  }
  return null;
}

async function handleWebhookEvent(account: Account, event: Record<string, unknown>) {
  const type = String((event as { type?: string }).type ?? "");
  const obj = ((event as { data?: { object?: Record<string, unknown> } }).data?.object ?? {}) as Record<string, unknown>;
  const relevant = type === "checkout.session.completed" || type === "checkout.session.async_payment_succeeded";
  if (!relevant) return;
  if ((obj as { payment_status?: string }).payment_status !== "paid") return;
  if (isBookingMeta((obj as { metadata?: Record<string, unknown> }).metadata)) {
    console.log(`[webhook] booking session ${(obj as { id?: string }).id} — handled by stripe-webhook, ignored here`);
    return;
  }
  if (!(event as { livemode?: boolean }).livemode) { console.log("[webhook] test event — ignored"); return; }
  const piId = (obj as { payment_intent?: string }).payment_intent;
  if (!piId) { console.log("[webhook] session without payment_intent — ignored"); return; }
  const cfg = await salesCfg();
  // La charge porte la verite (montant capture) : on repart d'elle.
  const pi = await stripeGet(account, `/v1/payment_intents/${piId}?expand[]=latest_charge`);
  const charge = (pi as { latest_charge?: Record<string, unknown> }).latest_charge;
  if (!charge?.id) { console.error(`[webhook] no charge on PI ${piId}`); return; }
  const { sale, skip } = await saleFromCharge(account, charge, cfg);
  if (skip || !sale) { console.log(`[webhook] charge ${(charge as { id?: string }).id} skipped: ${skip}`); return; }
  const { data: row, error } = await admin.from("stripe_sales")
    .upsert({ ...sale, updated_at: new Date().toISOString() }, { onConflict: "charge_id", ignoreDuplicates: false })
    .select("id,status").maybeSingle();
  if (error) { console.error("[webhook] upsert:", error.message); return; }
  if (!row || row.status === "invoiced") return;
  const res = await invoiceSale(row.id);
  console.log(`[webhook] ${sale.charge_id}:`, JSON.stringify(res).slice(0, 200));
}

// ---------------------------------------------------------------------------

const BodySchema = z.object({
  action: z.enum(["sync", "invoice", "status", "enrich", "pdf"]),
  account: z.enum(["quinta", "terra"]).optional(),
  ids: z.array(z.string().uuid()).max(500).optional(),
  all_pending: z.boolean().optional(),
  limit: z.number().int().positive().max(500).optional(),
  skip_pdf: z.boolean().optional(),
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const payload = await req.text();

    // Porte 1 : webhook Stripe (signature) — repond vite, traite ensuite.
    const sigHeader = req.headers.get("stripe-signature");
    if (sigHeader) {
      const account = await verifyWebhook(payload, sigHeader);
      if (!account) return json({ error: "Invalid signature" }, 400);
      const event = JSON.parse(payload);
      const task = handleWebhookEvent(account, event).catch((e) =>
        console.error("[webhook] error:", String((e as Error)?.message ?? e)));
      const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
      if (rt?.waitUntil) rt.waitUntil(task); else await task;
      return json({ received: true });
    }

    // Porte 2/3 : actions admin (JWT admin) ou internes (x-cron-key).
    let authorized = false;
    const cronHeader = req.headers.get("x-cron-key");
    if (cronHeader) authorized = cronHeader === (await internal()).cron_key;
    if (!authorized) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user?.email) return json({ error: "Forbidden" }, 403);
      const { data: adminRow } = await admin.from("admin_users").select("email").ilike("email", user.email).maybeSingle();
      if (!adminRow) return json({ error: "Forbidden" }, 403);
    }

    const parsed = BodySchema.safeParse(JSON.parse(payload || "{}"));
    if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
    const { action, account, ids, all_pending, limit, skip_pdf } = parsed.data;

    if (action === "sync") {
      return json(await sync(account ?? "quinta"));
    }
    if (action === "enrich") {
      return json(await enrich(account ?? "terra", limit ?? 60));
    }
    if (action === "pdf") {
      // Rattrapage des PDF manquants sur les lignes deja facturees.
      const companyId = await moloniCompanyId();
      const { data: rows } = await admin.from("stripe_sales")
        .select("id,moloni_document_id,invoice_number")
        .eq("status", "invoiced").is("invoice_pdf_path", null)
        .order("paid_at", { ascending: true }).limit(limit ?? 10);
      let stored = 0;
      for (const r of rows ?? []) {
        if (await storePdf(r.id, companyId, Number(r.moloni_document_id), r.invoice_number)) stored++;
      }
      return json({ processed: (rows ?? []).length, stored });
    }
    if (action === "status") {
      const { data } = await admin.from("stripe_sales")
        .select("account,status")
        .order("paid_at", { ascending: false });
      const agg: Record<string, number> = {};
      for (const r of data ?? []) agg[`${r.account}:${r.status}`] = (agg[`${r.account}:${r.status}`] ?? 0) + 1;
      return json(agg);
    }
    if (action === "invoice") {
      let targetIds = ids ?? [];
      if (all_pending) {
        const { data } = await admin.from("stripe_sales").select("id")
          .eq("status", "pending_review").order("paid_at", { ascending: true }).limit(limit ?? 200);
        targetIds = (data ?? []).map((r) => r.id);
      }
      if (!targetIds.length) return json({ error: "ids or all_pending required" }, 400);
      const results: Record<string, unknown>[] = [];
      for (const id of targetIds) results.push(await invoiceSale(id, !skip_pdf));
      const ok = results.filter((r) => r.number).length;
      const failed = results.filter((r) => r.error).length;
      return json({ invoiced: ok, failed, results });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    console.error("stripe-sales error:", msg);
    return json({ error: msg }, 500);
  }
});
