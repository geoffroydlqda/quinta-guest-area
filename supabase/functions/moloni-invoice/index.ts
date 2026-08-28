// Facturation Moloni ON (GraphQL) — step 1 : bouton "Generate invoice".
// Actions (admin uniquement) :
//   { action: "gql", query, variables? }      -> passthrough GraphQL (outil d'admin/debug)
//   { action: "generate", installment_id }    -> crée la fatura-recibo FR2026 chez
//     Moloni pour l'échéance, récupère le PDF, l'attache au paiement.
// Config : app_settings key='moloni' (company_id, document_set_id,
// payment_method_id, products par catégorie/taux). Clé API : app_settings
// key='internal'.moloni_api_key (service role only).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const _adminAuthClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);
let _adminEmailsCache: string[] | null = null;
async function getAdminEmails(): Promise<string[]> {
  if (_adminEmailsCache) return _adminEmailsCache;
  const { data } = await _adminAuthClient.from("admin_users").select("email");
  _adminEmailsCache = (data ?? []).map((r: { email: string }) =>
    String(r.email).normalize("NFC").toLowerCase().trim()
  );
  return _adminEmailsCache;
}
async function isAdminEmailDb(email?: string | null): Promise<boolean> {
  if (!email) return false;
  return (await getAdminEmails()).includes(email.normalize("NFC").toLowerCase().trim());
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MOLONI_API = "https://api.molonion.pt/v1";
const MEDIA_BASE = "https://mediaapi.moloni.org";

const BodySchema = z.object({
  action: z.enum(["gql", "generate", "pdf", "attach_doc", "bar_month"]),
  query: z.string().max(20000).optional(),
  variables: z.record(z.unknown()).optional(),
  installment_id: z.string().uuid().optional(),
  // bar_month : fatura mensuelle Consumidor Final du honesty bar
  // (mois YYYY-MM ; défaut = mois précédent, heure Lisbonne)
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  // attach_doc : rapatrie le PDF d'un document Moloni (nota de credito,
  // fatura...) dans purchase_docs, lie a une fin_transaction (25 aout 2026).
  document_id: z.number().int().positive().optional(),
  tx_id: z.string().uuid().optional(),
  file_label: z.string().max(120).optional(),
});

async function moloniKey(): Promise<string> {
  const { data } = await _adminAuthClient.from("app_settings").select("value").eq("key", "internal").maybeSingle();
  const key = (data?.value as Record<string, string> | null)?.moloni_api_key;
  if (!key) throw new Error("MOLONI_KEY_MISSING");
  return key;
}

async function gql(query: string, variables?: Record<string, unknown>) {
  const key = await moloniKey();
  const r = await fetch(MOLONI_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, variables: variables ?? {} }),
  });
  const body = await r.json().catch(async () => ({ raw: await r.text() }));
  if (!r.ok) throw new Error(`Moloni HTTP ${r.status}: ${JSON.stringify(body).slice(0, 400)}`);
  return body;
}

type MoloniCfg = {
  company_id: number;
  document_set_id: number;
  payment_method_id: number;
  // Produits Moloni par (catégorie -> productId). Les taux de TVA viennent du produit.
  products: Record<string, number>;
};

async function moloniCfg(): Promise<MoloniCfg> {
  const { data } = await _adminAuthClient.from("app_settings").select("value").eq("key", "moloni").maybeSingle();
  const v = data?.value as MoloniCfg | null;
  if (!v?.company_id || !v?.document_set_id || !v?.products) throw new Error("MOLONI_CONFIG_MISSING");
  return v;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const fmtDatePt = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

// Taux (%) -> taxId Moloni (IVA 23/13/6)
const TAX_IDS: Record<number, number> = { 23: 1923, 13: 1924, 6: 1925 };
const DEFAULT_RATE: Record<string, number> = { rental: 23, catering: 13, extra: 23 };

type InstRow = {
  id: string; booking_id: string; label: string; amount_due: number;
  amount_excl_vat: number | null; category: string | null; status: string;
  is_cash: boolean | null; moloni_document_id: number | null; invoice_number: string | null;
  invoice_file_url: string | null; vat_rate: number | null; stripe_session_id: string | null;
  paid_usd: number | null; usd_rate: number | null; notes: string | null;
};

const INST_COLS = "id,booking_id,label,amount_due,amount_excl_vat,category,status,is_cash,moloni_document_id,invoice_number,invoice_file_url,vat_rate,stripe_session_id,paid_bank_tx_id,paid_usd,usd_rate,notes";

function rateFor(inst: InstRow): number {
  const r = inst.vat_rate ?? DEFAULT_RATE[inst.category ?? "rental"] ?? 23;
  return TAX_IDS[r] ? r : 23;
}

function netHt(inst: InstRow): number {
  if (inst.amount_excl_vat != null) return Math.abs(Number(inst.amount_excl_vat));
  const rate = rateFor(inst);
  return Math.abs(Number(inst.amount_due)) / (1 + rate / 100);
}

async function generateInvoice(installmentId: string) {
  const cfg = await moloniCfg();
  const admin = _adminAuthClient;

  // 1. Charge l'échéance + booking + fiche client
  const { data: inst, error: instErr } = await admin.from("payment_installments")
    .select(INST_COLS)
    .eq("id", installmentId).maybeSingle() as { data: InstRow | null; error: unknown };
  if (instErr) throw instErr;
  if (!inst) throw new Error("Installment not found");
  if (inst.is_cash) throw new Error("Cash payment — no invoice");
  if (inst.category === "discount") throw new Error("Discounts are handled with credit notes, not invoices");
  if (inst.moloni_document_id) throw new Error(`Invoice already generated (${inst.invoice_number ?? inst.moloni_document_id})`);
  if (!(Number(inst.amount_due) > 0)) throw new Error("Amount must be positive");
  // Garde-fou : jamais de vrai document fiscal pour un paiement Stripe de TEST.
  if (inst.stripe_session_id?.startsWith("cs_test_")) {
    throw new Error("This payment was made in Stripe TEST mode — no real invoice will be created for it");
  }

  // Échéances payées dans la même session Stripe OU par le même virement
  // bancaire (paid_bank_tx_id, 27 août 2026) et pas encore facturées
  // -> une seule fatura-recibo à plusieurs lignes.
  let group: InstRow[] = [inst];
  // Honesty bar (27 août 2026) : les lignes bar ne se facturent PAS par
  // événement — une fatura mensuelle "Consumidor Final" est générée
  // automatiquement depuis bar_sales (action bar_month, cron le 1er du mois).
  const isBar = (inst.category ?? "") === "bar";
  if (isBar) {
    throw new Error("Bar sales are invoiced automatically: one monthly Consumidor Final fatura (generated on the 1st for the previous month) — nothing to do here");
  }
  const groupKey: [string, string] | null = inst.stripe_session_id
    ? ["stripe_session_id", inst.stripe_session_id]
    : (inst as InstRow & { paid_bank_tx_id?: string | null }).paid_bank_tx_id
      ? ["paid_bank_tx_id", (inst as InstRow & { paid_bank_tx_id?: string | null }).paid_bank_tx_id as string]
      : null;
  if (!isBar && groupKey) {
    const { data: siblings } = await admin.from("payment_installments")
      .select(INST_COLS)
      .eq(groupKey[0], groupKey[1])
      .eq("booking_id", inst.booking_id) as { data: InstRow[] | null };
    group = (siblings ?? [inst]).filter((s) =>
      !s.moloni_document_id && !s.is_cash && s.category !== "discount" && Number(s.amount_due) > 0
    );
    if (!group.find((s) => s.id === inst.id)) group = [inst];
  }
  // Ordre stable : rental d'abord, puis catering, puis extras
  const catOrder: Record<string, number> = { rental: 0, catering: 1, extra: 2 };
  group.sort((a, b) => (catOrder[a.category ?? "rental"] ?? 3) - (catOrder[b.category ?? "rental"] ?? 3));

  const { data: booking, error: bErr } = await admin.from("bookings")
    .select("id,retreat_name,first_name,last_name,email,check_in_date,check_out_date,client_id,total_rental_price,rental_discount")
    .eq("id", inst.booking_id).maybeSingle();
  if (bErr) throw bErr;
  if (!booking) throw new Error("Booking not found");

  let profile: any = null;
  if (booking.client_id) {
    const { data } = await admin.from("client_profiles").select("*").eq("id", booking.client_id).maybeSingle();
    profile = data;
  }
  if (!profile) {
    const { data } = await admin.from("client_profiles").select("*").eq("email", (booking.email || "").toLowerCase()).maybeSingle();
    profile = data;
  }

  const clientName = `${profile?.first_name ?? booking.first_name ?? ""} ${profile?.last_name ?? booking.last_name ?? ""}`.trim()
    || booking.retreat_name || booking.email;
  const vatRaw = (profile?.tax_number ?? "").replace(/[^0-9A-Za-z]/g, "");
  const isPtNif = /^[1235689]\d{8}$/.test(vatRaw);
  const email = (profile?.email ?? booking.email ?? "").toLowerCase();

  // 2. Cherche le client Moloni (par NIF, sinon par email), sinon le crée.
  let customerId: number | null = null;
  const searchValue = isPtNif ? vatRaw : email;
  if (searchValue) {
    const res = await gql(`query($c: Int!, $s: String!) {
      customers(companyId: $c, options: { search: { field: ALL, value: $s }, pagination: { page: 1, qty: 5 } }) {
        data { customerId name vat email }
        errors { field msg }
      }
    }`, { c: cfg.company_id, s: searchValue });
    const hits = res?.data?.customers?.data ?? [];
    const exact = hits.find((h: any) =>
      (isPtNif && h.vat === vatRaw) || (!isPtNif && (h.email ?? "").toLowerCase() === email)
    ) ?? hits[0];
    if (exact) customerId = exact.customerId;
  }

  if (!customerId) {
    // Nom facturé : société si renseignée, sinon la personne.
    const invoiceName = (profile?.company_name ?? "").trim() || clientName;
    // Pays : lookup Moloni par nom (fiche guest), défaut Portugal.
    let countryId = 1;
    const countryName = (profile?.country ?? "").trim();
    if (countryName) {
      try {
        const cRes = await gql(`query($s: String!) { countries(options: { search: { field: ALL, value: $s }, pagination: { page: 1, qty: 5 } }) { data { countryId name } errors { msg } } }`, { s: countryName });
        const hit = (cRes?.data?.countries?.data ?? [])[0];
        if (hit?.countryId) countryId = hit.countryId;
      } catch (_e) { /* défaut PT */ }
    }
    const next = await gql(`query($c: Int!) { customerNextNumber(companyId: $c) { data errors { msg } } }`,
      { c: cfg.company_id });
    const number = next?.data?.customerNextNumber?.data ?? `C${Date.now()}`;
    const created = await gql(`mutation($c: Int!, $d: CustomerInsert!) {
      customerCreate(companyId: $c, data: $d) {
        data { customerId }
        errors { field msg }
      }
    }`, {
      c: cfg.company_id,
      d: {
        number: String(number),
        name: invoiceName,
        countryId,
        // Requis par l'API Moloni : 1 = portugais (clients PT), 2 = anglais (etrangers)
        languageId: countryId === 1 ? 1 : 2,
        ...(isPtNif ? { vat: vatRaw } : {}),
        ...(email ? { email } : {}),
        ...(profile?.address ? { address: profile.address } : {}),
        ...(profile?.zip_code ? { zipCode: profile.zip_code } : {}),
        ...(profile?.city ? { city: profile.city } : {}),
      },
    });
    const errs = created?.data?.customerCreate?.errors;
    if (errs?.length) throw new Error(`Moloni customerCreate: ${JSON.stringify(errs).slice(0, 300)}`);
    customerId = created?.data?.customerCreate?.data?.customerId;
    if (!customerId) throw new Error(`customerCreate returned no id: ${JSON.stringify(created).slice(0, 300)}`);
  }

  // 3. Lignes du document : une par échéance du groupe.
  // TVA par ligne (vat_rate de l'échéance, taxId forcé sur la ligne) ;
  // remise rental répartie au prorata via le % de remise du booking.
  let stayLine = booking.check_in_date && booking.check_out_date
    ? ` · Check-in ${fmtDatePt(booking.check_in_date)} → Check-out ${fmtDatePt(booking.check_out_date)}`
    : "";
  // Paiement présenté en USD : la facture reste en EUR, mais la mention du
  // montant payé en dollars et du taux figé apparaît sur la première ligne.
  const usdPaid = group.reduce((s, g) => s + Number(g.paid_usd ?? 0), 0);
  const usdRate = group.find((g) => g.usd_rate)?.usd_rate;
  if (usdPaid > 0 && usdRate) {
    stayLine += ` · Paid in USD: $${usdPaid.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (1 EUR = ${Number(usdRate).toFixed(4)} USD)`;
  }

  // % de remise sur le rental. Convention : total_rental_price = prix de base
  // (catalogue) ; le client paie total − discount. d% = discount / total,
  // appliqué à chaque ligne rental -> prorata automatique.
  const rentalDiscount = Math.abs(Number(booking.rental_discount ?? 0));
  let discountPct = 0;
  if (rentalDiscount > 0) {
    // Fallback si le total n'est pas rempli : les échéances somment au net,
    // donc catalogue = somme des échéances rental + remise.
    const catalog = Number(booking.total_rental_price ?? 0) ||
      (group.filter((g) => (g.category ?? "rental") === "rental").reduce((s, g) => s + Number(g.amount_due), 0) + rentalDiscount);
    if (catalog > 0) discountPct = Math.round((rentalDiscount / catalog) * 10000) / 100;
  }

  // Total location TTC du booking (toutes échéances rental, payées ou non) —
  // sert à afficher "30% of €4,000" sur chaque ligne rental de la facture.
  const { data: allRentalInsts } = await admin.from("payment_installments")
    .select("id,amount_due,category,status,due_date")
    .eq("booking_id", inst.booking_id) as { data: { id: string; amount_due: number; category: string | null; status: string; due_date: string | null }[] | null };
  const rentalTotalTtc = (allRentalInsts ?? [])
    .filter((r) => (r.category ?? "rental") === "rental")
    .reduce((s, r) => s + Number(r.amount_due || 0), 0);
  const fmtPct = (part: number) => {
    if (!(rentalTotalTtc > 0)) return null;
    const pct = (Math.abs(part) / rentalTotalTtc) * 100;
    const rounded = Math.round(pct * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  };
  const fmtEurInt = (n: number) =>
    `${Number.isInteger(n) ? n.toLocaleString("en-GB") : n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}€`;

  const products = group.map((g, idx) => {
    // bar : produit dédié si configuré (app_settings.moloni.products.bar), sinon extra
    const productId = cfg.products[g.category ?? "rental"]
      ?? (g.category === "bar" ? cfg.products["extra"] : undefined)
      ?? cfg.products["rental"];
    if (!productId) throw new Error(`No Moloni product configured for category ${g.category}`);
    const rate = rateFor(g);
    const net = netHt(g);
    const isRental = (g.category ?? "rental") === "rental";
    const d = isRental ? discountPct : 0;
    // Moloni calcule net = price × (1 − d/100) : on remonte au prix catalogue HT.
    const price = d > 0 ? net / (1 - d / 100) : net;
    // Description de ligne :
    // - rental : "30% of 4,000€" (part de cette échéance dans le prix de
    //   location total TTC — demande Geoffroy, 20 août 2026), + note éventuelle
    // - autres catégories : la note prime, sinon le label, sinon la catégorie
    const pct = isRental ? fmtPct(Number(g.amount_due)) : null;
    const note = (g.notes ?? "").trim();
    const desc = isRental && pct !== null
      ? `${pct}% of ${fmtEurInt(rentalTotalTtc)}${note ? ` · ${note}` : ""}`
      : (note || g.label || g.category);
    return {
      productId,
      qty: 1,
      ordering: idx + 1,
      price: Math.round(price * 1e6) / 1e6,
      ...(d > 0 ? { discount: d } : {}),
      summary: `${booking.retreat_name || clientName} — ${desc}${idx === 0 ? stayLine : ""}`,
      taxes: [{ taxId: TAX_IDS[rate], ordering: 1, cumulative: false }],
    };
  });

  // Note de bas de document (demande Geoffroy, 20 août 2026) :
  // - facture d'acompte rental -> solde restant + échéance
  // - facture qui solde le rental -> mention "accommodation settled", en
  //   précisant que catering/transport/extras sont facturés à part.
  let docNotes: string | null = null;
  const groupIds2 = new Set(group.map((g) => g.id));
  const hasRentalLine = group.some((g) => (g.category ?? "rental") === "rental");
  if (hasRentalLine && rentalTotalTtc > 0) {
    const remainingRows = (allRentalInsts ?? []).filter((r) =>
      (r.category ?? "rental") === "rental" && r.status !== "paid" && !groupIds2.has(r.id) && Number(r.amount_due) > 0
    );
    const remaining = remainingRows.reduce((s, r) => s + Number(r.amount_due || 0), 0);
    if (remaining > 0.005) {
      const nextDue = remainingRows.map((r) => r.due_date).filter(Boolean).sort()[0] as string | undefined;
      docNotes = `Remaining accommodation balance: ${fmtEurInt(Math.round(remaining * 100) / 100)}${nextDue ? ` due ${fmtDatePt(nextDue)}` : ""}.`;
    } else {
      // Le rental est soldé. Nuance : la facture peut aussi grouper du
      // catering/des extras — dans ce cas on ne dit pas qu'ils sont "à part".
      const hasOtherLines = group.some((g) => (g.category ?? "rental") !== "rental");
      docNotes = hasOtherLines
        ? "Accommodation is now fully settled. This invoice also covers the additional services listed above; any other services not listed here are invoiced separately."
        : "Accommodation is now fully settled. Please note this does not cover catering, transportation or other extras, which are invoiced separately.";
    }
  }

  // 4. Crée la fatura-recibo, finalisée, payée (total = somme des échéances).
  const totalTtc = Math.round(group.reduce((s, g) => s + Math.abs(Number(g.amount_due)), 0) * 100) / 100;
  const docData: Record<string, unknown> = {
    documentSetId: cfg.document_set_id,
    customerId,
    date: new Date().toISOString(),
    expirationDate: new Date().toISOString().slice(0, 10),
    status: 1,
    products,
    payments: [{ paymentMethodId: cfg.payment_method_id, value: totalTtc }],
    ...(docNotes ? { notes: docNotes } : {}),
  };
  const createMutation = `mutation($c: Int!, $d: InvoiceReceiptInsert!) {
    invoiceReceiptCreate(companyId: $c, data: $d) {
      data { documentId number date totalValue grossValue taxesValue status }
      errors { field msg }
    }
  }`;
  let created = await gql(createMutation, { c: cfg.company_id, d: docData }).catch((e: unknown) => ({ __err: String(e) }));
  // Filet : si le champ notes n'existe pas dans ce schéma Moloni, on réessaie sans.
  const firstErr = (created as any)?.__err ?? JSON.stringify((created as any)?.errors ?? "");
  if (docNotes && /notes/i.test(String(firstErr))) {
    console.error("[moloni] 'notes' rejected by schema — retrying without document note:", String(firstErr).slice(0, 200));
    delete docData.notes;
    created = await gql(createMutation, { c: cfg.company_id, d: docData });
  } else if ((created as any)?.__err) {
    throw new Error(String((created as any).__err));
  }
  const cErrs = created?.data?.invoiceReceiptCreate?.errors;
  if (cErrs?.length) throw new Error(`Moloni invoiceReceiptCreate: ${JSON.stringify(cErrs).slice(0, 400)}`);
  const doc = created?.data?.invoiceReceiptCreate?.data;
  if (!doc?.documentId) throw new Error(`invoiceReceiptCreate returned no document: ${JSON.stringify(created).slice(0, 400)}`);

  // Sauvegarde immédiate de la référence sur TOUTES les échéances du groupe
  // (même si le PDF échoue ensuite)
  const groupIds = group.map((g) => g.id);
  await admin.from("payment_installments").update({
    moloni_document_id: doc.documentId,
    invoice_number: doc.number ?? null,
  }).in("id", groupIds);

  // 5. PDF : génération -> token -> téléchargement -> bucket invoices
  const pdf = await attachPdf(cfg, doc.documentId, booking.id, inst.id, groupIds, `${doc.number ?? doc.documentId}.pdf`);
  if (!pdf.stored) console.error("PDF attach failed:", pdf.error);

  return {
    document_id: doc.documentId,
    number: doc.number,
    total: doc.totalValue,
    taxes: doc.taxesValue,
    lines: group.length,
    discount_pct: discountPct || undefined,
    pdf_attached: pdf.stored,
    pdf_error: pdf.error,
  };
}

// ---------------------------------------------------------------------------
// Honesty bar — fatura MENSUELLE "Consumidor Final" (27 août 2026).
// Générée le 1er du mois (cron bar-invoice-monthly) pour le mois écoulé :
// toutes les ventes bar_sales classées du mois pas encore facturées, groupées
// en lignes wine (23 %), why not / beer (23 %), coconut water (6 %).
// L'analytique par événement reste portée par les échéances bar par booking —
// cette fatura est purement fiscale (aucun lien aux installments).
// ---------------------------------------------------------------------------
const BAR_PRICE = { wine: 22, soft: 3, coconut: 4 };

async function consumidorFinalId(cfg: MoloniCfg): Promise<number> {
  const res = await gql(`query($c: Int!, $s: String!) {
    customers(companyId: $c, options: { search: { field: ALL, value: $s }, pagination: { page: 1, qty: 5 } }) {
      data { customerId name vat }
      errors { field msg }
    }
  }`, { c: cfg.company_id, s: "999999990" });
  const hit = (res?.data?.customers?.data ?? []).find((h: { vat?: string }) => h.vat === "999999990")
    ?? (res?.data?.customers?.data ?? [])[0];
  if (hit?.customerId) return hit.customerId;
  const next = await gql(`query($c: Int!) { customerNextNumber(companyId: $c) { data errors { msg } } }`,
    { c: cfg.company_id });
  const number = next?.data?.customerNextNumber?.data ?? `C${Date.now()}`;
  const created = await gql(`mutation($c: Int!, $d: CustomerInsert!) {
    customerCreate(companyId: $c, data: $d) { data { customerId } errors { field msg } }
  }`, {
    c: cfg.company_id,
    d: { number: String(number), name: "Consumidor Final", vat: "999999990", countryId: 1, languageId: 1 },
  });
  const errs = created?.data?.customerCreate?.errors;
  if (errs?.length) throw new Error(`Moloni customerCreate (Consumidor Final): ${JSON.stringify(errs).slice(0, 300)}`);
  const id = created?.data?.customerCreate?.data?.customerId;
  if (!id) throw new Error("Could not resolve the Consumidor Final customer in Moloni");
  return id;
}

const lisbonDay = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(new Date(iso));

async function barMonthInvoice(monthArg?: string) {
  const cfg = await moloniCfg();
  const admin = _adminAuthClient;
  // Mois cible : paramètre YYYY-MM, sinon le mois PRÉCÉDENT (heure Lisbonne)
  let month = monthArg ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) {
    const now = lisbonDay(new Date().toISOString()); // YYYY-MM-DD
    const d = new Date(`${now.slice(0, 7)}-01T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 1);
    month = d.toISOString().slice(0, 7);
  }

  const { data: salesRaw } = await admin.from("bar_sales")
    .select("id,paid_at,amount,qty_wine,qty_coconut,qty_soft,state,moloni_document_id")
    .eq("state", "classified").is("moloni_document_id", null);
  const sales = (salesRaw ?? []).filter((s) => lisbonDay(s.paid_at).slice(0, 7) === month);
  if (!sales.length) return { month, skipped: true, reason: "no uninvoiced classified sales" };

  const wine = sales.reduce((t, s) => t + (s.qty_wine ?? 0), 0);
  const soft = sales.reduce((t, s) => t + (s.qty_soft ?? 0), 0);
  const coconut = sales.reduce((t, s) => t + (s.qty_coconut ?? 0), 0);
  const totalTtc = Math.round(sales.reduce((t, s) => t + Number(s.amount), 0) * 100) / 100;

  const customerId = await consumidorFinalId(cfg);
  const productId = cfg.products["bar"] ?? cfg.products["extra"] ?? cfg.products["rental"];
  const monthLabel = new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  type Line = { label: string; qty: number; unitTtc: number; rate: number };
  const lines: Line[] = [
    { label: "wine", qty: wine, unitTtc: BAR_PRICE.wine, rate: 23 },
    { label: "why not / beer", qty: soft, unitTtc: BAR_PRICE.soft, rate: 23 },
    { label: "coconut water", qty: coconut, unitTtc: BAR_PRICE.coconut, rate: 6 },
  ].filter((l) => l.qty > 0);

  const products = lines.map((l, idx) => ({
    productId,
    qty: l.qty,
    ordering: idx + 1,
    price: Math.round((l.unitTtc / (1 + l.rate / 100)) * 1e6) / 1e6,
    summary: `Honesty bar ${monthLabel} — ${l.label} (€${l.unitTtc} incl. VAT)`,
    taxes: [{ taxId: TAX_IDS[l.rate], ordering: 1, cumulative: false }],
  }));

  const docData: Record<string, unknown> = {
    documentSetId: cfg.document_set_id,
    customerId,
    date: new Date().toISOString(),
    expirationDate: new Date().toISOString().slice(0, 10),
    status: 1,
    products,
    payments: [{ paymentMethodId: cfg.payment_method_id, value: totalTtc }],
    notes: `Honesty bar — self-service sales collected via Revolut Merchant, ${monthLabel} (${sales.length} payment(s)).`,
  };
  const createMutation = `mutation($c: Int!, $d: InvoiceReceiptInsert!) {
    invoiceReceiptCreate(companyId: $c, data: $d) {
      data { documentId number date totalValue grossValue taxesValue status }
      errors { field msg }
    }
  }`;
  let created = await gql(createMutation, { c: cfg.company_id, d: docData }).catch((e: unknown) => ({ __err: String(e) }));
  const firstErr = (created as { __err?: string })?.__err ?? JSON.stringify((created as { errors?: unknown })?.errors ?? "");
  if (/notes/i.test(String(firstErr))) {
    delete docData.notes;
    created = await gql(createMutation, { c: cfg.company_id, d: docData });
  } else if ((created as { __err?: string })?.__err) {
    throw new Error(String((created as { __err?: string }).__err));
  }
  const cErrs = created?.data?.invoiceReceiptCreate?.errors;
  if (cErrs?.length) throw new Error(`Moloni invoiceReceiptCreate (bar): ${JSON.stringify(cErrs).slice(0, 400)}`);
  const doc = created?.data?.invoiceReceiptCreate?.data;
  if (!doc?.documentId) throw new Error(`bar invoiceReceiptCreate returned no document: ${JSON.stringify(created).slice(0, 400)}`);

  // Estampille les ventes couvertes (anti double facturation)
  await admin.from("bar_sales").update({
    moloni_document_id: doc.documentId, invoice_number: doc.number ?? null,
  }).in("id", sales.map((s) => s.id));

  // PDF -> bucket invoices, chemin bar/{numero}.pdf (consultation/archive)
  let pdfStored = false, pdfError: string | undefined;
  try {
    await gql(`mutation($c: Int!, $d: Int!) { invoiceReceiptGetPDF(companyId: $c, documentId: $d) }`,
      { c: cfg.company_id, d: doc.documentId });
    let tok: { token?: string; path?: string } | null = null;
    for (let i = 0; i < 10 && !tok?.path; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      const t = await gql(`query($d: Int!) { invoiceReceiptGetPDFToken(documentId: $d) { data { token path filename } errors { msg } } }`,
        { d: doc.documentId });
      tok = t?.data?.invoiceReceiptGetPDFToken?.data ?? null;
    }
    if (tok?.path && tok?.token) {
      const pdfRes = await fetch(`${MEDIA_BASE}${tok.path}?jwt=${tok.token}`);
      if (pdfRes.ok) {
        const bytes = new Uint8Array(await pdfRes.arrayBuffer());
        const path = `bar/${String(doc.number ?? doc.documentId).replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
        const up = await admin.storage.from("invoices").upload(path, bytes, { contentType: "application/pdf", upsert: true });
        if (up.error) pdfError = up.error.message; else pdfStored = true;
      } else pdfError = `mediaapi HTTP ${pdfRes.status}`;
    } else pdfError = "PDF not ready after ~25s";
  } catch (e) { pdfError = String((e as Error)?.message ?? e); }

  console.log(`[bar-month] ${month}: fatura ${doc.number ?? doc.documentId} — ${sales.length} sale(s), €${totalTtc}${pdfStored ? "" : ` (pdf: ${pdfError})`}`);
  return {
    month, document_id: doc.documentId, number: doc.number, total: doc.totalValue,
    sales: sales.length, wine, soft, coconut, pdf_stored: pdfStored, pdf_error: pdfError,
  };
}

// Récupère le PDF d'un document Moloni (patience : la génération d'un document
// final prend ~10 s) et l'attache aux échéances du groupe.
async function attachPdf(
  cfg: MoloniCfg,
  documentId: number,
  bookingId: string,
  anchorInstId: string,
  groupIds: string[],
  fallbackName: string,
): Promise<{ stored: boolean; error?: string }> {
  const admin = _adminAuthClient;
  // Le document peut être une fatura-recibo (générée par l'app) OU une fatura
  // simple (série Invoices, liée a posteriori — 25 août 2026) : on tente les
  // deux familles de requêtes, la mauvaise échoue silencieusement.
  try {
    await gql(`mutation($c: Int!, $d: Int!) { invoiceReceiptGetPDF(companyId: $c, documentId: $d) }`,
      { c: cfg.company_id, d: documentId });
  } catch (e) {
    console.error("invoiceReceiptGetPDF:", e); // la génération peut déjà être en file
  }
  try {
    await gql(`mutation($c: Int!, $d: Int!) { invoiceGetPDF(companyId: $c, documentId: $d) }`,
      { c: cfg.company_id, d: documentId });
  } catch (e) {
    console.error("invoiceGetPDF:", e);
  }
  let tok: { token?: string; path?: string; filename?: string } | null = null;
  for (let i = 0; i < 10 && !tok?.path; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    try {
      const t = await gql(`query($d: Int!) { invoiceReceiptGetPDFToken(documentId: $d) { data { token path filename } errors { msg } } }`,
        { d: documentId });
      tok = t?.data?.invoiceReceiptGetPDFToken?.data ?? null;
    } catch (e) {
      console.error("invoiceReceiptGetPDFToken:", e);
    }
    if (!tok?.path) {
      try {
        const t = await gql(`query($d: Int!) { invoiceGetPDFToken(documentId: $d) { data { token path filename } errors { msg } } }`,
          { d: documentId });
        tok = t?.data?.invoiceGetPDFToken?.data ?? null;
      } catch (e) {
        console.error("invoiceGetPDFToken:", e);
      }
    }
  }
  if (!tok?.path || !tok?.token) return { stored: false, error: "PDF not ready after ~25s — retry with action 'pdf'" };
  const pdfRes = await fetch(`${MEDIA_BASE}${tok.path}?jwt=${tok.token}`);
  if (!pdfRes.ok) return { stored: false, error: `mediaapi HTTP ${pdfRes.status}` };
  const bytes = new Uint8Array(await pdfRes.arrayBuffer());
  const niceName = (tok.filename || fallbackName).replace(/[^A-Za-z0-9._-]/g, "_");
  const path = `${bookingId}/${anchorInstId}/${niceName}`;
  const up = await admin.storage.from("invoices").upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (up.error) return { stored: false, error: up.error.message };
  await admin.from("payment_installments").update({
    invoice_file_url: path,
    invoice_file_name: niceName,
  }).in("id", groupIds);
  return { stored: true };
}

// Rattrapage : (re)attache le PDF d'une facture déjà générée.
async function attachPdfFor(installmentId: string) {
  const cfg = await moloniCfg();
  const admin = _adminAuthClient;
  const { data: inst } = await admin.from("payment_installments")
    .select(INST_COLS).eq("id", installmentId).maybeSingle() as { data: InstRow | null };
  if (!inst) throw new Error("Installment not found");
  if (!inst.moloni_document_id) throw new Error("No Moloni invoice on this payment yet");
  const { data: group } = await admin.from("payment_installments")
    .select("id").eq("booking_id", inst.booking_id).eq("moloni_document_id", inst.moloni_document_id) as { data: { id: string }[] | null };
  const groupIds = (group ?? [{ id: inst.id }]).map((g) => g.id);
  const pdf = await attachPdf(cfg, inst.moloni_document_id, inst.booking_id, inst.id, groupIds,
    `${inst.invoice_number ?? inst.moloni_document_id}.pdf`);
  if (!pdf.stored) throw new Error(pdf.error ?? "PDF attach failed");
  return { document_id: inst.moloni_document_id, pdf_attached: true };
}

// Token PDF pour n'importe quel type de document (nota de credito, fatura,
// fatura-recibo) — on essaie les trois familles de requetes.
async function anyDocPdfToken(documentId: number): Promise<{ token?: string; path?: string; filename?: string } | null> {
  const queries = [
    ["creditNoteGetPDF", "creditNoteGetPDFToken"],
    ["invoiceGetPDF", "invoiceGetPDFToken"],
    ["invoiceReceiptGetPDF", "invoiceReceiptGetPDFToken"],
  ];
  const cfg = await moloniCfg();
  for (const [genQ] of queries) {
    try {
      await gql(`mutation($c: Int!, $d: Int!) { ${genQ}(companyId: $c, documentId: $d) }`, { c: cfg.company_id, d: documentId });
    } catch (_e) { /* mauvais type de document — normal */ }
  }
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    for (const [, tokQ] of queries) {
      try {
        const t = await gql(`query($d: Int!) { ${tokQ}(documentId: $d) { data { token path filename } errors { msg } } }`, { d: documentId });
        const tok = t?.data?.[tokQ]?.data ?? null;
        if (tok?.path && tok?.token) return tok;
      } catch (_e) { /* type suivant */ }
    }
  }
  return null;
}

// Rapatrie le PDF d'un document Moloni dans purchase_docs, lie a une transaction.
async function attachDocToTx(documentId: number, txId: string, label?: string) {
  const admin = _adminAuthClient;
  const { data: tx } = await admin.from("fin_transactions").select("id").eq("id", txId).maybeSingle();
  if (!tx) throw new Error("Transaction not found");
  const storagePath = `moloni/${documentId}.pdf`;
  const { data: existing } = await admin.from("purchase_docs").select("id,tx_id").eq("storage_path", storagePath).maybeSingle();
  if (existing) {
    if (existing.tx_id !== txId) {
      await admin.from("purchase_docs").update({ tx_id: txId, status: "matched", updated_at: new Date().toISOString() }).eq("id", existing.id);
    }
    return { doc_id: existing.id, storage_path: storagePath, already_ingested: true };
  }
  const tok = await anyDocPdfToken(documentId);
  if (!tok?.path || !tok?.token) throw new Error("PDF not ready — retry attach_doc");
  const pdfRes = await fetch(`${MEDIA_BASE}${tok.path}?jwt=${tok.token}`);
  if (!pdfRes.ok) throw new Error(`mediaapi HTTP ${pdfRes.status}`);
  const bytes = new Uint8Array(await pdfRes.arrayBuffer());
  const niceName = (label || tok.filename || `moloni_${documentId}`).replace(/[^A-Za-z0-9._-]/g, "_").replace(/\.pdf$/i, "") + ".pdf";
  const up = await admin.storage.from("purchase-docs").upload(storagePath, bytes, { contentType: "application/pdf", upsert: true });
  if (up.error) throw new Error(up.error.message);
  const { data: row, error: insErr } = await admin.from("purchase_docs")
    .insert({ storage_path: storagePath, file_name: niceName, mime_type: "application/pdf", status: "matched", tx_id: txId })
    .select("id").single();
  if (insErr) throw new Error(insErr.message);
  return { doc_id: row.id, storage_path: storagePath, file_name: niceName, linked_tx: txId };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    // Appel interne (stripe-webhook -> génération auto après paiement) :
    // authentifié par x-cron-key = app_settings.internal.cron_key.
    let internalCall = false;
    const cronHeader = req.headers.get("x-cron-key");
    if (cronHeader) {
      const { data } = await _adminAuthClient.from("app_settings").select("value").eq("key", "internal").maybeSingle();
      internalCall = !!cronHeader && cronHeader === (data?.value as Record<string, string> | null)?.cron_key;
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
    const { action, query, variables, installment_id } = parsed.data;

    if (action === "gql") {
      if (internalCall) return json({ error: "gql is admin-only" }, 403);
      if (!query) return json({ error: "query required" }, 400);
      return json(await gql(query, variables as Record<string, unknown> | undefined));
    }

    if (action === "attach_doc") {
      if (!parsed.data.document_id || !parsed.data.tx_id) return json({ error: "document_id and tx_id required" }, 400);
      return json(await attachDocToTx(parsed.data.document_id, parsed.data.tx_id, parsed.data.file_label));
    }

    if (action === "bar_month") {
      return json(await barMonthInvoice(parsed.data.month));
    }

    if (!installment_id) return json({ error: "installment_id required" }, 400);
    if (action === "pdf") return json(await attachPdfFor(installment_id));
    return json(await generateInvoice(installment_id));
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    console.error("moloni-invoice error:", msg);
    return json({ error: msg }, 500);
  }
});
