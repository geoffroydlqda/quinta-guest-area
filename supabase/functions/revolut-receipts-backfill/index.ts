// revolut-receipts-backfill (19 août 2026) — rapatrie les reçus attachés aux
// dépenses dans Revolut Business (API Expenses) vers purchase_docs :
//   1. liste les expenses de la fenêtre {from,to} qui ont des receipt_ids
//   2. télécharge chaque reçu (/expenses/{id}/receipts/{rid}/content)
//   3. upload dans le bucket purchase-docs (chemin revolut/{receipt_id}.ext
//      -> dédup naturelle, relançable sans doublons)
//   4. rattache à la fin_transaction : d'abord par dedup_key revapi|{tx_id}
//      (transactions synchronisées), sinon montant ±0,02 € + date ±3 j
//   5. TVA : si un taux a été saisi dans Revolut (splits.tax_rate), il est
//      enregistré sur le doc et appliqué à la transaction liée
// Auth : x-cron-key. Params : { from, to, dry_run?, limit? } (limit = nb de
// reçus téléchargés par appel, défaut 15 — rappeler jusqu'à has_more=false).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
const CLIENT_ID = "itkV0zmTxXrJU0pX83JOzIVZo9uaOqlT_RYAGzLQQjQ";
const ISS_DOMAIN = "fnlgeeuohvethmfpsxpf.supabase.co";
const API = "https://b2b.revolut.com";

async function internalValue(k: string): Promise<string | null> {
  const { data } = await admin.from("app_settings").select("value").eq("key", "internal").maybeSingle();
  return (data?.value as Record<string, string> | null)?.[k] ?? null;
}
async function setInternalValue(k: string, v: string) {
  const { data } = await admin.from("app_settings").select("value").eq("key", "internal").maybeSingle();
  const val = { ...((data?.value as Record<string, string> | null) ?? {}), [k]: v };
  await admin.from("app_settings").upsert({ key: "internal", value: val });
}
function b64url(data: Uint8Array): string {
  let s = "";
  for (const b of data) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function clientAssertion(): Promise<string> {
  const pem = Deno.env.get("REVOLUT_PRIVATE_KEY");
  if (!pem) throw new Error("REVOLUT_PRIVATE_KEY_MISSING");
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const enc = new TextEncoder();
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = b64url(enc.encode(JSON.stringify({ iss: ISS_DOMAIN, sub: CLIENT_ID, aud: "https://revolut.com", iat: now, exp: now + 3600 })));
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(`${header}.${payload}`)));
  return `${header}.${payload}.${b64url(sig)}`;
}
async function accessToken(): Promise<string> {
  const refresh = await internalValue("revolut_b2b_refresh_token");
  if (!refresh) throw new Error("NOT_CONNECTED");
  const body = new URLSearchParams({
    grant_type: "refresh_token", refresh_token: refresh, client_id: CLIENT_ID,
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: await clientAssertion(),
  });
  const r = await fetch(`${API}/api/1.0/auth/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`token ${r.status}: ${JSON.stringify(data).slice(0, 200)}`);
  if (data.refresh_token && data.refresh_token !== refresh) await setInternalValue("revolut_b2b_refresh_token", data.refresh_token);
  return data.access_token;
}

type RevExpense = {
  id: string; state: string; transaction_type: string; expense_date: string;
  splits?: { amount?: { amount?: number; currency?: string }; tax_rate?: { name?: string; percentage?: number } }[];
  receipt_ids?: string[]; spent_amount?: { amount?: number; currency?: string };
  description?: string; merchant?: string; payer?: string; transaction_id?: string;
};

const extFor = (ct: string) => ct.includes("pdf") ? "pdf" : ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";

serve(async (req) => {
  try {
    const cronKey = req.headers.get("x-cron-key");
    if (!cronKey || cronKey !== (await internalValue("cron_key"))) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }
    const body = await req.json().catch(() => ({} as Record<string, unknown>));

    // --- Purge : retire les docs importes de Revolut restes sans transaction
    // (depenses payees depuis Main ou vieux tickets — aucun ancrage dans le
    // tool, demande Geoffroy 19 aout 2026). Fichiers storage inclus.
    if (body.purge_no_match) {
      const { data: docs } = await admin.from("purchase_docs")
        .select("id,storage_path").eq("status", "no_match").like("storage_path", "revolut/%");
      const paths = (docs ?? []).map((d: { storage_path: string }) => d.storage_path);
      for (let i = 0; i < paths.length; i += 50) {
        await admin.storage.from("purchase-docs").remove(paths.slice(i, i + 50));
      }
      const { error } = await admin.from("purchase_docs").delete()
        .eq("status", "no_match").like("storage_path", "revolut/%");
      return new Response(JSON.stringify({ purged: paths.length, error: error?.message ?? null }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const from = String(body.from ?? "");
    const to = String(body.to ?? "");
    const dryRun = !!body.dry_run;
    const limit = Math.min(Number(body.limit ?? 15) || 15, 30);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return new Response(JSON.stringify({ error: "from/to required (YYYY-MM-DD)" }), { status: 400 });
    }

    const token = await accessToken();
    const er = await fetch(`${API}/api/1.0/expenses?from=${from}&to=${to}&count=500`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!er.ok) throw new Error(`expenses ${er.status}: ${(await er.text()).slice(0, 200)}`);
    const expenses = (await er.json()) as RevExpense[];
    const withReceipts = expenses.filter((e) => (e.receipt_ids?.length ?? 0) > 0);

    // Dédup : reçus déjà importés (chemin revolut/{receipt_id}.*)
    const { data: existing } = await admin.from("purchase_docs").select("storage_path").like("storage_path", "revolut/%");
    const done = new Set((existing ?? []).map((r: { storage_path: string }) => r.storage_path.split("/")[1].split(".")[0]));

    let imported = 0, linked = 0, review = 0, skipped = 0, vatApplied = 0, skippedNoTx = 0;
    const errors: string[] = [];
    let processed = 0, hasMore = false;

    for (const e of withReceipts) {
      for (const rid of e.receipt_ids ?? []) {
        if (done.has(rid)) { skipped++; continue; }
        if (processed >= limit) { hasMore = true; break; }
        processed++;
        try {
          // 1. Rattachement D'ABORD : revapi|{transaction_id}, sinon montant+date.
          // Aucune transaction Quinta correspondante (depense payee depuis Main,
          // vieux ticket...) -> on n'importe PAS (demande Geoffroy 19 aout 2026).
          const amount = Math.abs(Number(e.spent_amount?.amount ?? 0));
          const docDate = (e.expense_date ?? "").slice(0, 10) || null;
          let txId: string | null = null;
          let candidates: Record<string, unknown>[] = [];
          if (e.transaction_id) {
            const { data: byKey } = await admin.from("fin_transactions").select("id")
              .eq("dedup_key", `revapi|${e.transaction_id}`).maybeSingle();
            if (byKey) txId = byKey.id;
          }
          if (!txId && amount > 0 && docDate) {
            const d = new Date(`${docDate}T12:00:00`);
            const lo = new Date(d.getTime() - 3 * 86400000).toISOString().slice(0, 10);
            const hi = new Date(d.getTime() + 3 * 86400000).toISOString().slice(0, 10);
            const { data: cands } = await admin.from("fin_transactions")
              .select("id,date,description,amount,category")
              .eq("kind", "expense").lt("amount", 0).gte("date", lo).lte("date", hi);
            const hits = (cands ?? []).filter((t) => Math.abs(Math.abs(Number(t.amount)) - amount) <= 0.02);
            if (hits.length === 1) txId = hits[0].id;
            else candidates = hits.slice(0, 5).map((t) => ({ tx_id: t.id, date: t.date, description: t.description, amount: t.amount, category: t.category, score: 55 }));
          }
          if (!txId && !candidates.length) { skippedNoTx++; done.add(rid); continue; }
          if (dryRun) { imported++; continue; }

          // 2. Téléchargement du reçu
          const rr = await fetch(`${API}/api/1.0/expenses/${e.id}/receipts/${rid}/content`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!rr.ok) throw new Error(`receipt ${rr.status}`);
          const ct = rr.headers.get("content-type") ?? "image/jpeg";
          const bytes = new Uint8Array(await rr.arrayBuffer());
          const path = `revolut/${rid}.${extFor(ct)}`;
          const up = await admin.storage.from("purchase-docs").upload(path, bytes, { contentType: ct, upsert: true });
          if (up.error) throw new Error(up.error.message);

          // 3. Métadonnées depuis Revolut (pas besoin d'OCR)
          const taxPct = e.splits?.length === 1 ? e.splits[0].tax_rate?.percentage : undefined;
          const vatBreakdown = taxPct != null && amount > 0
            ? [{ rate: taxPct, base: Math.round((amount / (1 + taxPct / 100)) * 100) / 100, vat: Math.round((amount - amount / (1 + taxPct / 100)) * 100) / 100 }]
            : null;

          // 4. Doc + TVA sur la transaction liée
          await admin.from("purchase_docs").insert({
            storage_path: path, file_name: `${(e.merchant ?? e.description ?? "receipt").replace(/[^A-Za-z0-9 _-]/g, "")}.${extFor(ct)}`,
            mime_type: ct, status: txId ? "matched" : (candidates.length ? "review" : "no_match"),
            tx_id: txId, vendor: e.merchant ?? e.description ?? null, doc_date: docDate,
            total_ttc: amount || null, vat_breakdown: vatBreakdown, candidates: candidates.length ? candidates : null,
          });
          imported++;
          if (txId) {
            linked++;
            if (vatBreakdown && taxPct != null) {
              const net = vatBreakdown[0].base;
              await admin.from("fin_transactions").update({ amount_net: net, vat_rate: taxPct }).eq("id", txId);
              vatApplied++;
            }
          } else if (candidates.length) review++;
          done.add(rid);
        } catch (err) {
          errors.push(`${e.merchant ?? e.id} (${e.spent_amount?.amount ?? "?"}€): ${String((err as Error)?.message ?? err)}`);
        }
      }
      if (hasMore) break;
    }

    return new Response(JSON.stringify({
      from, to, dry_run: dryRun, expenses_in_window: expenses.length,
      with_receipts: withReceipts.length, imported, linked, review, skipped_already_imported: skipped,
      skipped_no_quinta_tx: skippedNoTx, vat_applied: vatApplied, has_more: hasMore, errors: errors.slice(0, 10),
    }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e) }), { status: 500 });
  }
});
