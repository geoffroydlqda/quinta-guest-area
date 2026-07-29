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
  action: z.enum(["gql", "generate"]),
  query: z.string().max(20000).optional(),
  variables: z.record(z.unknown()).optional(),
  installment_id: z.string().uuid().optional(),
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

async function generateInvoice(installmentId: string) {
  const cfg = await moloniCfg();
  const admin = _adminAuthClient;

  // 1. Charge l'échéance + booking + fiche client
  const { data: inst, error: instErr } = await admin.from("payment_installments")
    .select("id,booking_id,label,amount_due,amount_excl_vat,category,status,is_cash,moloni_document_id,invoice_number,invoice_file_url")
    .eq("id", installmentId).maybeSingle();
  if (instErr) throw instErr;
  if (!inst) throw new Error("Installment not found");
  if (inst.is_cash) throw new Error("Cash payment — no invoice");
  if (inst.category === "discount") throw new Error("Discounts are handled with credit notes, not invoices");
  if (inst.moloni_document_id) throw new Error(`Invoice already generated (${inst.invoice_number ?? inst.moloni_document_id})`);
  if (!(Number(inst.amount_due) > 0)) throw new Error("Amount must be positive");

  const { data: booking, error: bErr } = await admin.from("bookings")
    .select("id,retreat_name,first_name,last_name,email,check_in_date,check_out_date,client_id")
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

  // 3. Produit selon la catégorie (la TVA vient du produit Moloni)
  const productId = cfg.products[inst.category ?? "rental"] ?? cfg.products["rental"];
  if (!productId) throw new Error(`No Moloni product configured for category ${inst.category}`);

  // Prix unitaire HT : champ excl. VAT si présent, sinon dérivé du produit ?
  // On exige le HT explicite pour une facture exacte.
  if (inst.amount_excl_vat == null) {
    throw new Error("Amount excl. VAT is missing on this payment — set it before generating the invoice");
  }
  const priceHt = Math.abs(Number(inst.amount_excl_vat));

  const stayLine = booking.check_in_date && booking.check_out_date
    ? ` · Check-in ${fmtDatePt(booking.check_in_date)} → Check-out ${fmtDatePt(booking.check_out_date)}`
    : "";
  const description = `${booking.retreat_name || clientName} — ${inst.label || inst.category}${stayLine}`;

  // 4. Crée la fatura-recibo (série FR2026), finalisée, payée par virement.
  const totalTtc = Math.abs(Number(inst.amount_due));
  const created = await gql(`mutation($c: Int!, $d: InvoiceReceiptInsert!) {
    invoiceReceiptCreate(companyId: $c, data: $d) {
      data { documentId number date totalValue grossValue taxesValue status }
      errors { field msg }
    }
  }`, {
    c: cfg.company_id,
    d: {
      documentSetId: cfg.document_set_id,
      customerId,
      date: new Date().toISOString(),
      expirationDate: new Date().toISOString().slice(0, 10),
      status: 1,
      products: [{
        productId,
        qty: 1,
        ordering: 1,
        price: priceHt,
        summary: description,
      }],
      payments: [{ paymentMethodId: cfg.payment_method_id, value: totalTtc }],
    },
  });
  const cErrs = created?.data?.invoiceReceiptCreate?.errors;
  if (cErrs?.length) throw new Error(`Moloni invoiceReceiptCreate: ${JSON.stringify(cErrs).slice(0, 400)}`);
  const doc = created?.data?.invoiceReceiptCreate?.data;
  if (!doc?.documentId) throw new Error(`invoiceReceiptCreate returned no document: ${JSON.stringify(created).slice(0, 400)}`);

  // Sauvegarde immédiate de la référence (même si le PDF échoue ensuite)
  await admin.from("payment_installments").update({
    moloni_document_id: doc.documentId,
    invoice_number: doc.number ?? null,
  }).eq("id", inst.id);

  // 5. PDF : génération -> token -> téléchargement -> bucket invoices
  let pdfStored = false;
  try {
    await gql(`mutation($c: Int!, $d: Int!) { invoiceReceiptGetPDF(companyId: $c, documentId: $d) }`,
      { c: cfg.company_id, d: doc.documentId });
    // petit délai de génération
    await new Promise((r) => setTimeout(r, 1500));
    let tok: any = null;
    for (let i = 0; i < 3 && !tok?.path; i++) {
      const t = await gql(`query($d: Int!) { invoiceReceiptGetPDFToken(documentId: $d) { data { token path filename } errors { msg } } }`,
        { d: doc.documentId });
      tok = t?.data?.invoiceReceiptGetPDFToken?.data;
      if (!tok?.path) await new Promise((r) => setTimeout(r, 1500));
    }
    if (tok?.path && tok?.token) {
      const pdfRes = await fetch(`${MEDIA_BASE}${tok.path}?jwt=${tok.token}`);
      if (pdfRes.ok) {
        const bytes = new Uint8Array(await pdfRes.arrayBuffer());
        const path = `${booking.id}/${inst.id}/${(doc.number ?? `moloni-${doc.documentId}`).replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
        const up = await admin.storage.from("invoices").upload(path, bytes, { contentType: "application/pdf", upsert: true });
        if (!up.error) {
          await admin.from("payment_installments").update({
            invoice_file_url: path,
            invoice_file_name: `${doc.number ?? doc.documentId}.pdf`,
          }).eq("id", inst.id);
          pdfStored = true;
        }
      }
    }
  } catch (e) {
    console.error("PDF fetch failed:", e);
  }

  return {
    document_id: doc.documentId,
    number: doc.number,
    total: doc.totalValue,
    taxes: doc.taxesValue,
    pdf_attached: pdfStored,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user || !(await isAdminEmailDb(user.email))) return json({ error: "Forbidden" }, 403);

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
    const { action, query, variables, installment_id } = parsed.data;

    if (action === "gql") {
      if (!query) return json({ error: "query required" }, 400);
      return json(await gql(query, variables as Record<string, unknown> | undefined));
    }

    if (!installment_id) return json({ error: "installment_id required" }, 400);
    return json(await generateInvoice(installment_id));
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    console.error("moloni-invoice error:", msg);
    return json({ error: msg }, 500);
  }
});
