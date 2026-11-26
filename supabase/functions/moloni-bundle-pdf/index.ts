// Bundle de PDFs Moloni → une seule PJ sur une échéance (26 nov 2026).
// Cas d'usage : Silêncio (Terra da Paz) — 26 fatura-recibos de la série TERRA
// déjà émises dans Moloni, fusionnées en un seul PDF attaché à l'échéance
// récapitulative du booking (invoice_file_url, bucket privé `invoices`).
// ⚠️ NE CRÉE AUCUN document Moloni — lecture de PDFs existants uniquement.
// Auth : x-cron-key (= app_settings.internal.cron_key).
// Body : { document_ids: number[], installment_id: uuid, filename?: string }
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

const MOLONI_API = "https://api.molonion.pt/v1";
const MEDIA_BASE = "https://mediaapi.moloni.org";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
};

const BodySchema = z.object({
  document_ids: z.array(z.number().int().positive()).min(1).max(40),
  installment_id: z.string().uuid(),
  filename: z.string().max(120).regex(/^[A-Za-z0-9._-]+\.pdf$/).optional(),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function internalValue(key: string): Promise<string | null> {
  const { data } = await admin.from("app_settings").select("value").eq("key", "internal").maybeSingle();
  return (data?.value as Record<string, string> | null)?.[key] ?? null;
}

async function gql(query: string, variables?: Record<string, unknown>) {
  const key = await internalValue("moloni_api_key");
  if (!key) throw new Error("MOLONI_KEY_MISSING");
  const r = await fetch(MOLONI_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, variables: variables ?? {} }),
  });
  const body = await r.json().catch(async () => ({ raw: await r.text() }));
  if (!r.ok) throw new Error(`Moloni HTTP ${r.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

type Tok = { token?: string; path?: string; filename?: string } | null;

async function pdfToken(documentId: number): Promise<Tok> {
  // Les docs visés sont des fatura-recibos ; le token existe souvent déjà
  // (documents émis/imprimés). On tente d'abord sans régénérer.
  const read = async (): Promise<Tok> => {
    try {
      const t = await gql(
        `query($d: Int!) { invoiceReceiptGetPDFToken(documentId: $d) { data { token path filename } errors { msg } } }`,
        { d: documentId });
      return t?.data?.invoiceReceiptGetPDFToken?.data ?? null;
    } catch (_e) { return null; }
  };
  let tok = await read();
  if (tok?.path && tok?.token) return tok;
  const companyId = Number((await admin.from("app_settings").select("value").eq("key", "moloni").maybeSingle())
    .data?.value?.company_id ?? 0);
  try {
    await gql(`mutation($c: Int!, $d: Int!) { invoiceReceiptGetPDF(companyId: $c, documentId: $d) }`,
      { c: companyId, d: documentId });
  } catch (_e) { /* peut déjà être en file */ }
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    tok = await read();
    if (tok?.path && tok?.token) return tok;
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const cronKey = await internalValue("cron_key");
    if (!cronKey || req.headers.get("x-cron-key") !== cronKey) return json({ error: "Forbidden" }, 403);

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
    const { document_ids, installment_id, filename } = parsed.data;

    const { data: inst } = await admin.from("payment_installments")
      .select("id,booking_id").eq("id", installment_id).maybeSingle();
    if (!inst) return json({ error: "Installment not found" }, 404);

    const merged = await PDFDocument.create();
    const failed: { document_id: number; error: string }[] = [];
    let ok = 0;
    for (const docId of document_ids) {
      try {
        const tok = await pdfToken(docId);
        if (!tok?.path || !tok?.token) { failed.push({ document_id: docId, error: "PDF token not ready" }); continue; }
        const pdfRes = await fetch(`${MEDIA_BASE}${tok.path}?jwt=${tok.token}`);
        if (!pdfRes.ok) { failed.push({ document_id: docId, error: `mediaapi HTTP ${pdfRes.status}` }); continue; }
        const src = await PDFDocument.load(new Uint8Array(await pdfRes.arrayBuffer()));
        const pages = await merged.copyPages(src, src.getPageIndices());
        for (const p of pages) merged.addPage(p);
        ok++;
      } catch (e) {
        failed.push({ document_id: docId, error: String((e as Error)?.message ?? e).slice(0, 200) });
      }
    }
    if (ok === 0) return json({ error: "No PDF could be fetched", failed }, 502);

    const bytes = await merged.save();
    const niceName = filename ?? `moloni_bundle_${installment_id.slice(0, 8)}.pdf`;
    const path = `${inst.booking_id}/${installment_id}/${niceName}`;
    const up = await admin.storage.from("invoices").upload(path, new Uint8Array(bytes), {
      contentType: "application/pdf", upsert: true,
    });
    if (up.error) return json({ error: up.error.message }, 500);
    await admin.from("payment_installments").update({
      invoice_file_url: path, invoice_file_name: niceName,
    }).eq("id", installment_id);

    console.log(`[moloni-bundle-pdf] ${ok}/${document_ids.length} docs merged -> ${path}`);
    return json({ merged: ok, failed, path, file_name: niceName });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    console.error("moloni-bundle-pdf error:", msg);
    return json({ error: msg }, 500);
  }
});
