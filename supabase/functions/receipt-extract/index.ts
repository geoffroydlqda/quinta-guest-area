// receipt-extract (18 août 2026) — lit un justificatif d'achat (photo/PDF)
// avec l'API Claude (vision), extrait fournisseur/date/TTC/ventilation TVA/NIF,
// puis tente le rapprochement avec une dépense fin_transactions sans doc :
// même montant (±0,02 €), date ±5 jours, bonus si le fournisseur apparaît
// dans la description/payer. Un seul candidat sûr -> lien auto + TVA appliquée
// sur la transaction (amount_net positif, convention revolut-sync).
// Actions (JWT admin) :
//   { doc_id }                        -> extraction + matching
//   { link: { doc_id, tx_id } }       -> lien manuel + application TVA
//   { unlink: { doc_id } }            -> retire le lien (statut review)
//   { ingest: {...} }                 -> PJ Gmail (auth x-ingest-key)
//   { rematch: true }                 -> re-rapprochement des docs no_match/review
//                                        recents SANS re-extraction (cron quotidien :
//                                        les transactions carte arrivent souvent 1-2 j
//                                        apres la facture, le matching a l'ingestion
//                                        tombait alors dans le vide — 24 aout 2026)
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ingest-key",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const BodySchema = z.object({
  doc_id: z.string().uuid().optional(),
  link: z.object({ doc_id: z.string().uuid(), tx_id: z.string().uuid() }).optional(),
  unlink: z.object({ doc_id: z.string().uuid() }).optional(),
  // Ingestion depuis Gmail (Apps Script de Geoffroy) : PJ en base64.
  // Auth dédiée : header x-ingest-key = app_settings.internal.ingest_key.
  ingest: z.object({
    filename: z.string().min(1).max(200),
    mime_type: z.string().min(3).max(100),
    content: z.string().min(100).max(14_000_000),
  }).optional(),
  // Re-rapprochement en masse (sans re-extraction) — cron ou admin
  rematch: z.boolean().optional(),
  days: z.number().int().min(1).max(365).optional(),
});

async function isAdminEmailDb(email?: string | null): Promise<boolean> {
  if (!email) return false;
  const { data } = await admin.from("admin_users").select("email");
  return (data ?? []).map((r: { email: string }) => String(r.email).toLowerCase().trim())
    .includes(email.toLowerCase().trim());
}

type Extract = {
  vendor: string | null; doc_date: string | null; total_ttc: number | null;
  nif: string | null; currency: string | null;
  vat_breakdown: { rate: number; base: number; vat: number }[] | null;
};

async function callClaude(b64: string, mime: string): Promise<Extract> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY secret is not set (Supabase → Edge Functions → Secrets)");
  const isPdf = mime === "application/pdf";
  const content: unknown[] = [
    isPdf
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
      : { type: "image", source: { type: "base64", media_type: mime, data: b64 } },
    { type: "text", text:
`This is a purchase receipt or supplier invoice (likely Portuguese). Extract and return ONLY a JSON object, no prose:
{
  "vendor": "supplier name as printed",
  "doc_date": "YYYY-MM-DD or null",
  "total_ttc": total amount including VAT as a number,
  "nif": "supplier tax number (NIF/NIPC) or null",
  "currency": "EUR" (or actual),
  "vat_breakdown": [{ "rate": 23, "base": 10.5, "vat": 2.42 }, ...] per VAT rate found (IVA 6/13/23 in Portugal), or null if not printed
}
Amounts use dot as decimal separator. If a field is unreadable, use null.` },
  ];
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5", max_tokens: 1000, messages: [{ role: "user", content }] }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`Anthropic API ${r.status}: ${JSON.stringify(body).slice(0, 300)}`);
  const text: string = (body.content ?? []).map((c: { text?: string }) => c.text ?? "").join("");
  // Extraction JSON robuste : premier objet équilibré (le modèle ajoute
  // parfois du texte ou plusieurs blocs après — cause des erreurs de parse
  // sur les faturas Amazon, 19 août 2026).
  const start = text.indexOf("{");
  if (start < 0) throw new Error(`No JSON in model output: ${text.slice(0, 200)}`);
  let end = -1, depth = 0, inStr = false, escNext = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escNext) escNext = false;
      else if (ch === "\\") escNext = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) throw new Error(`Unbalanced JSON in model output: ${text.slice(0, 200)}`);
  const parsed = JSON.parse(text.slice(start, end + 1));
  return {
    vendor: parsed.vendor ?? null,
    doc_date: parsed.doc_date ?? null,
    total_ttc: parsed.total_ttc != null ? Number(parsed.total_ttc) : null,
    nif: parsed.nif != null ? String(parsed.nif) : null,
    currency: parsed.currency ?? "EUR",
    vat_breakdown: Array.isArray(parsed.vat_breakdown) ? parsed.vat_breakdown : null,
  };
}

// Applique la TVA extraite sur la transaction : amount_net POSITIF
// (convention revolut-sync), vat_rate = taux unique ou null si mixte.
async function applyVat(txId: string, ex: { total_ttc: number | null; vat_breakdown: Extract["vat_breakdown"] }) {
  if (!ex.vat_breakdown?.length || ex.total_ttc == null) return false;
  const vatTotal = ex.vat_breakdown.reduce((s, v) => s + (Number(v.vat) || 0), 0);
  const net = Math.round((ex.total_ttc - vatTotal) * 100) / 100;
  if (!(net > 0)) return false;
  const rates = [...new Set(ex.vat_breakdown.filter((v) => (Number(v.vat) || 0) > 0).map((v) => Number(v.rate)))];
  const singleRate = rates.length === 1 ? rates[0] : null;
  await admin.from("fin_transactions").update({
    amount_net: net,
    ...(singleRate != null ? { vat_rate: singleRate } : {}),
  }).eq("id", txId);
  return true;
}

async function extractAndMatch(docId: string) {
  const { data: doc } = await admin.from("purchase_docs").select("*").eq("id", docId).maybeSingle();
  if (!doc) throw new Error("Doc not found");
  await admin.from("purchase_docs").update({ status: "extracting", error: null, updated_at: new Date().toISOString() }).eq("id", docId);

  const dl = await admin.storage.from("purchase-docs").download(doc.storage_path);
  if (dl.error || !dl.data) throw new Error(`Storage: ${dl.error?.message}`);
  const buf = new Uint8Array(await dl.data.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  const b64 = btoa(bin);

  const ex = await callClaude(b64, doc.mime_type || "image/jpeg");

  // Si le doc a déjà été lié à la main (porte "2 clics"), on garde le lien :
  // extraction -> TVA sur la transaction, pas de matching.
  if (doc.tx_id) {
    const vatApplied = await applyVat(doc.tx_id, ex);
    await admin.from("purchase_docs").update({
      ...ex, vat_breakdown: ex.vat_breakdown, status: "matched", updated_at: new Date().toISOString(),
    }).eq("id", docId);
    return { doc_id: docId, status: "matched", linked_tx: doc.tx_id, vat_applied: vatApplied, ...ex };
  }

  return await runMatching(docId, ex);
}

// ---- Matching : dépenses sans justificatif, montant ±0,02 €, date ±5 j.
// Séparé de l'extraction pour pouvoir re-rapprocher sans rappeler Claude
// (les transactions carte arrivent souvent apres la facture).
async function runMatching(docId: string, ex: Extract) {
  const linkedIds = new Set(
    ((await admin.from("purchase_docs").select("tx_id").not("tx_id", "is", null)).data ?? [])
      .map((r: { tx_id: string }) => r.tx_id)
  );
  let q = admin.from("fin_transactions")
    .select("id,date,description,payer,amount,category")
    .eq("kind", "expense").lt("amount", 0);
  if (ex.doc_date) {
    const d = new Date(`${ex.doc_date}T12:00:00`);
    const lo = new Date(d.getTime() - 10 * 86400000).toISOString().slice(0, 10);
    const hi = new Date(d.getTime() + 10 * 86400000).toISOString().slice(0, 10);
    q = q.gte("date", lo).lte("date", hi);
  } else {
    q = q.gte("date", new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10));
  }
  const { data: txs } = await q;
  const vendorTokens = (ex.vendor ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
  const hayOf = (t: { description?: string | null; payer?: string | null }) =>
    `${t.description ?? ""} ${t.payer ?? ""}`.toLowerCase();
  let cands = (txs ?? [])
    .filter((t) => ex.total_ttc != null && Math.abs(Math.abs(Number(t.amount)) - ex.total_ttc) <= 0.02)
    .map((t) => {
      const vendorHit = vendorTokens.some((tok) => hayOf(t).includes(tok));
      const dayDiff = ex.doc_date ? Math.abs((new Date(t.date).getTime() - new Date(ex.doc_date).getTime()) / 86400000) : 99;
      const score = 50 + (vendorHit ? 30 : 0) + Math.max(0, 20 - dayDiff * 4) + (linkedIds.has(t.id) ? -40 : 0);
      return { tx_id: t.id, date: t.date, description: t.description, amount: t.amount, category: t.category, score: Math.round(score) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  // Repli fournisseur (24 août 2026) : aucun montant exact (paiement groupé
  // facture + caution, acompte, virement partiel — cas Alugue Aqui) -> on
  // propose quand même les transactions du même fournisseur dans la fenêtre,
  // en 'review'. Score plafonné < 60 : JAMAIS de lien automatique sans
  // montant exact, c'est l'admin qui confirme d'un clic.
  if (!cands.length && vendorTokens.length && ex.total_ttc != null) {
    cands = (txs ?? [])
      .filter((t) => vendorTokens.some((tok) => hayOf(t).includes(tok)))
      .map((t) => {
        const dayDiff = ex.doc_date ? Math.abs((new Date(t.date).getTime() - new Date(ex.doc_date).getTime()) / 86400000) : 99;
        const score = 40 + Math.max(0, 15 - dayDiff * 1.5) + (linkedIds.has(t.id) ? -15 : 0);
        return { tx_id: t.id, date: t.date, description: t.description, amount: t.amount, category: t.category, score: Math.round(score) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }

  const best = cands[0];
  const autoLink = best && best.score >= 60 && (!cands[1] || cands[1].score <= best.score - 15);

  if (autoLink) {
    const vatApplied = await applyVat(best.tx_id, ex);
    await admin.from("purchase_docs").update({
      ...ex, vat_breakdown: ex.vat_breakdown, tx_id: best.tx_id, candidates: cands,
      status: "matched", updated_at: new Date().toISOString(),
    }).eq("id", docId);
    return { doc_id: docId, status: "matched", linked_tx: best.tx_id, vat_applied: vatApplied, ...ex };
  }

  await admin.from("purchase_docs").update({
    ...ex, vat_breakdown: ex.vat_breakdown, candidates: cands,
    status: cands.length ? "review" : "no_match", updated_at: new Date().toISOString(),
  }).eq("id", docId);
  return { doc_id: docId, status: cands.length ? "review" : "no_match", candidates: cands, ...ex };
}

// Re-rapprochement en masse des docs récents restés sans transaction :
// réutilise l'extraction stockée (vendor/date/montant), zéro appel Claude.
// `review` inclus : une meilleure transaction arrivée depuis peut débloquer
// l'auto-lien (le seuil de confiance reste identique).
async function rematchRecent(days: number) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data: docs } = await admin.from("purchase_docs")
    .select("id,vendor,doc_date,total_ttc,nif,currency,vat_breakdown,status")
    .is("tx_id", null)
    .in("status", ["no_match", "review"])
    .not("total_ttc", "is", null)
    .gte("created_at", since)
    .order("created_at", { ascending: true });
  let matched = 0, review = 0, still = 0;
  const links: unknown[] = [];
  for (const d of docs ?? []) {
    const res = await runMatching(d.id, {
      vendor: d.vendor, doc_date: d.doc_date, total_ttc: d.total_ttc != null ? Number(d.total_ttc) : null,
      nif: d.nif, currency: d.currency, vat_breakdown: (d.vat_breakdown as Extract["vat_breakdown"]) ?? null,
    });
    if (res.status === "matched") { matched++; links.push({ doc_id: d.id, tx_id: (res as { linked_tx?: string }).linked_tx }); }
    else if (res.status === "review") review++;
    else still++;
  }
  console.log(`[rematch] ${days}d: ${(docs ?? []).length} docs -> ${matched} matched, ${review} review, ${still} no_match`);
  return { checked: (docs ?? []).length, matched, review, no_match: still, links };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  let raw: Record<string, unknown> = {};
  try {
    raw = await req.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);

    // --- Auth : clé dédiée (Apps Script Gmail / retraitement serveur) ------
    const ingestKeyHeader = req.headers.get("x-ingest-key");
    let ingestKeyOk = false;
    if (ingestKeyHeader) {
      const { data: internal } = await admin.from("app_settings").select("value").eq("key", "internal").maybeSingle();
      ingestKeyOk = ingestKeyHeader === (internal?.value as Record<string, string> | null)?.ingest_key && !!ingestKeyHeader;
    }
    // Retraitement d'un doc existant via la clé (bulk retry serveur)
    if (ingestKeyOk && parsed.data.doc_id && !parsed.data.ingest) {
      return json(await extractAndMatch(parsed.data.doc_id));
    }
    // Re-rapprochement quotidien (cron avec x-ingest-key) — l'admin JWT passe
    // aussi par le bloc auth plus bas.
    if (ingestKeyOk && parsed.data.rematch) {
      return json(await rematchRecent(parsed.data.days ?? 60));
    }
    if (parsed.data.ingest) {
      if (!ingestKeyOk) return json({ error: "Unauthorized" }, 401);

      const ing = parsed.data.ingest;
      const isPdf = ing.mime_type.includes("pdf");
      if (!isPdf && !/jpeg|jpg|png|webp/.test(ing.mime_type)) return json({ skipped: "unsupported_type" });
      if (!isPdf && ing.content.length < 30000) return json({ skipped: "too_small_probably_logo" });
      // Dédup par empreinte du contenu -> même PJ reçue deux fois = un seul doc
      const hashBuf = await crypto.subtle.digest("SHA-256", Uint8Array.from(atob(ing.content), (c) => c.charCodeAt(0)));
      const sha = Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
      const ext = isPdf ? "pdf" : ing.mime_type.includes("png") ? "png" : ing.mime_type.includes("webp") ? "webp" : "jpg";
      const path = `email/${sha}.${ext}`;
      const { data: existing } = await admin.from("purchase_docs").select("id,status").eq("storage_path", path).maybeSingle();
      if (existing) return json({ skipped: "already_ingested", doc_id: existing.id, status: existing.status });
      const bytes = Uint8Array.from(atob(ing.content), (c) => c.charCodeAt(0));
      const up = await admin.storage.from("purchase-docs").upload(path, bytes, { contentType: ing.mime_type, upsert: true });
      if (up.error) return json({ error: up.error.message }, 500);
      const { data: row, error: insErr } = await admin.from("purchase_docs")
        .insert({ storage_path: path, file_name: ing.filename, mime_type: ing.mime_type })
        .select("id").single();
      if (insErr) return json({ error: insErr.message }, 500);
      raw = { doc_id: row.id }; // pour le marquage d'erreur du catch
      return json(await extractAndMatch(row.id));
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user || !(await isAdminEmailDb(user.email))) return json({ error: "Forbidden" }, 403);

    if (parsed.data.link) {
      const { doc_id, tx_id } = parsed.data.link;
      const { data: doc } = await admin.from("purchase_docs").select("total_ttc,vat_breakdown").eq("id", doc_id).maybeSingle();
      if (!doc) return json({ error: "Doc not found" }, 404);
      const vatApplied = await applyVat(tx_id, { total_ttc: doc.total_ttc, vat_breakdown: doc.vat_breakdown });
      await admin.from("purchase_docs").update({ tx_id, status: "matched", updated_at: new Date().toISOString() }).eq("id", doc_id);
      return json({ linked: true, vat_applied: vatApplied });
    }
    if (parsed.data.unlink) {
      await admin.from("purchase_docs").update({ tx_id: null, status: "review", updated_at: new Date().toISOString() }).eq("id", parsed.data.unlink.doc_id);
      return json({ unlinked: true });
    }
    if (parsed.data.doc_id) return json(await extractAndMatch(parsed.data.doc_id));
    if (parsed.data.rematch) return json(await rematchRecent(parsed.data.days ?? 60));
    return json({ error: "doc_id, link, unlink or rematch required" }, 400);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    console.error("receipt-extract error:", msg);
    // marquer le doc en erreur si possible (best effort)
    if (typeof raw?.doc_id === "string") {
      await admin.from("purchase_docs").update({ status: "error", error: msg }).eq("id", raw.doc_id).then(() => {}, () => {});
    }
    return json({ error: msg }, 500);
  }
});
