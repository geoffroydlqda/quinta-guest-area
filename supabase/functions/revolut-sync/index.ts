// Sync Revolut Business — transactions bancaires en direct (6 août 2026).
// Remplace les imports CSV mensuels de l'onglet Finance :
//   1. OAuth Business API : GET ?code=... = callback de consentement (échange
//      du code contre les jetons, refresh_token stocké dans app_settings).
//   2. Sync : récupère les transactions COMPLETED depuis SYNC_FROM (l'historique
//      jan→juil est déjà en base via CSV + Google Sheet — on ne remonte jamais
//      avant, aucun doublon possible), dédoublonnées par id Revolut.
//   3. Classification à l'arrivée : fin_rules (règles apprenantes de l'admin)
//      + heuristiques anti-double comptage (guest payment / bar payout /
//      internal / TVA), et rattachement auto des dépenses variables à
//      l'événement dont les dates collent (fenêtre check-in −6 j → check-out).
// Auth : x-cron-key (cron horaire) ou JWT admin (bouton Sync now).
// Secrets : REVOLUT_PRIVATE_KEY (secret Edge Function, dashboard Supabase) ;
// refresh_token dans app_settings key='internal' (jamais en repo).
// ⚠ Le refresh token expire ~90 jours après le consentement : la réponse du
// sync inclut connected=false le cas échéant -> recliquer "Enable API access"
// dans Revolut (Paramètres → API).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const FROM_EMAIL = "Quinta do Amor <hello@quintamor.com>";
const ADMIN_EMAIL = "hello@quintamor.com";

const CLIENT_ID = "itkV0zmTxXrJU0pX83JOzIVZo9uaOqlT_RYAGzLQQjQ";
const ISS_DOMAIN = "fnlgeeuohvethmfpsxpf.supabase.co";
const TOKEN_URL = "https://b2b.revolut.com/api/1.0/auth/token";
const TX_URL = "https://b2b.revolut.com/api/1.0/transactions";
// L'historique ≤ 31 juil. 2026 vient des imports CSV/Sheet — jamais re-synchronisé.
const SYNC_FROM = "2026-08-01";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function internalValue(key: string): Promise<string | null> {
  const { data } = await admin.from("app_settings").select("value").eq("key", "internal").maybeSingle();
  return (data?.value as Record<string, string> | null)?.[key] ?? null;
}

async function setInternalValue(key: string, value: string) {
  const { data } = await admin.from("app_settings").select("value").eq("key", "internal").maybeSingle();
  const v = { ...((data?.value as Record<string, unknown>) ?? {}), [key]: value };
  await admin.from("app_settings").update({ value: v }).eq("key", "internal");
}

async function isAdminEmailDb(email?: string | null): Promise<boolean> {
  if (!email) return false;
  const { data } = await admin.from("admin_users").select("email");
  return (data ?? []).map((r: { email: string }) => String(r.email).toLowerCase().trim())
    .includes(email.toLowerCase().trim());
}

// ---- JWT client assertion (RS256, WebCrypto — zéro dépendance) ------------
function b64url(data: Uint8Array): string {
  let s = "";
  for (const b of data) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function clientAssertion(): Promise<string> {
  const pem = Deno.env.get("REVOLUT_PRIVATE_KEY");
  if (!pem) throw new Error("REVOLUT_PRIVATE_KEY_MISSING — add the private key as an Edge Function secret in the Supabase dashboard");
  const der = Uint8Array.from(
    atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")),
    (c) => c.charCodeAt(0)
  );
  const key = await crypto.subtle.importKey(
    "pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
  );
  const enc = new TextEncoder();
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = b64url(enc.encode(JSON.stringify({
    iss: ISS_DOMAIN, sub: CLIENT_ID, aud: "https://revolut.com", iat: now, exp: now + 3600,
  })));
  const sig = new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", key, enc.encode(`${header}.${payload}`)
  ));
  return `${header}.${payload}.${b64url(sig)}`;
}

async function tokenRequest(params: Record<string, string>) {
  const body = new URLSearchParams({
    ...params,
    client_id: CLIENT_ID,
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: await clientAssertion(),
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Revolut token ${r.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data as { access_token?: string; refresh_token?: string };
}

async function accessToken(): Promise<string | null> {
  const refresh = await internalValue("revolut_b2b_refresh_token");
  if (!refresh) return null;
  const data = await tokenRequest({ grant_type: "refresh_token", refresh_token: refresh });
  if (data.refresh_token && data.refresh_token !== refresh) {
    await setInternalValue("revolut_b2b_refresh_token", data.refresh_token);
  }
  return data.access_token ?? null;
}

// ---- Comptes synchronisés --------------------------------------------------
// Le business a plusieurs comptes Revolut ; on ne synchronise QUE ceux de la
// Quinta do Amor. Sélection : app_settings.internal.revolut_b2b_account_ids
// (ids séparés par des virgules) ; sinon auto-détection par nom /quinta/i
// (persistée). Aucun match -> tous les comptes + warning dans les logs.
type RevAccount = { id: string; name?: string; currency?: string; state?: string };

async function allowedAccounts(token: string): Promise<{ ids: Set<string> | null; allIds: Set<string>; names: string[] }> {
  const r = await fetch("https://b2b.revolut.com/api/1.0/accounts", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Revolut accounts ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const accounts = (await r.json()) as RevAccount[];
  const allIds = new Set(accounts.map((a) => a.id));
  const configured = await internalValue("revolut_b2b_account_ids");
  let picked: RevAccount[];
  if (configured) {
    const set = new Set(configured.split(",").map((s) => s.trim()).filter(Boolean));
    picked = accounts.filter((a) => set.has(a.id));
  } else {
    picked = accounts.filter((a) => /quinta/i.test(a.name ?? ""));
    if (picked.length) await setInternalValue("revolut_b2b_account_ids", picked.map((a) => a.id).join(","));
  }
  if (!picked.length) {
    console.warn("[revolut-sync] no Quinta account matched — syncing ALL accounts:", accounts.map((a) => `${a.name} (${a.currency})`).join(", "));
    return { ids: null, allIds, names: accounts.map((a) => a.name ?? a.id) };
  }
  console.log("[revolut-sync] syncing accounts:", picked.map((a) => `${a.name} (${a.currency})`).join(", "));
  return { ids: new Set(picked.map((a) => a.id)), allIds, names: picked.map((a) => a.name ?? a.id) };
}

// ---- Classification (miroir de FinancePage.autoKind, côté serveur) --------
type Rule = { pattern: string; kind: string; category: string | null; vat_rate: number | null };
type Booking = { id: string; check_in_date: string | null; check_out_date: string | null; is_test: boolean | null };

const VARIABLE_CATS = new Set([
  "Retreat — catering / staff", "Retreat — catering / food", "Retreat — venue / cleaning & fixed", "Retreat - extras",
  "Wedding — catering / staff", "Wedding — catering / food", "Wedding — venue / cleaning & fixed", "Wedding - extras",
  "Bar — stock", "Other variable",
]);

function eventForDate(date: string, bookings: Booking[]): string | null {
  const ts = new Date(`${date}T12:00:00`).getTime();
  const D = 86400000;
  const real = bookings.filter((b) => !b.is_test && b.check_in_date);
  const during = real.filter((b) => {
    const from = new Date(`${b.check_in_date}T12:00:00`).getTime();
    const to = new Date(`${b.check_out_date ?? b.check_in_date}T12:00:00`).getTime();
    return ts >= from && ts <= to;
  });
  if (during.length === 1) return during[0].id;
  if (during.length > 1) return null;
  const pre = real.filter((b) => {
    const from = new Date(`${b.check_in_date}T12:00:00`).getTime();
    return ts >= from - 6 * D && ts < from;
  });
  return pre.length === 1 ? pre[0].id : null;
}

function autoKind(desc: string, amount: number, rules: Rule[]) {
  const d = desc.toLowerCase();
  for (const r of rules) {
    if (r.pattern && d.includes(r.pattern.toLowerCase())) {
      return {
        kind: r.kind, category: r.category, vat_rate: r.vat_rate,
        amount_net: r.kind === "expense" && r.vat_rate != null
          ? Math.round(Math.abs(amount) / (1 + Number(r.vat_rate) / 100) * 100) / 100
          : null,
        reviewed: true,
      };
    }
  }
  if (/stripe/.test(d) && amount > 0) return { kind: "guest_payment", reviewed: true };
  if (/^(recharge par|recharge |from |payment from )/.test(d) && amount > 0 && !/^from (eur|usd|gbp) /.test(d)) return { kind: "guest_payment", reviewed: true };
  if (/(payout|settlement).*(merchant)|merchant.*(payout|settlement)/.test(d) && amount > 0)
    return { kind: "bar_payout", reviewed: true };
  if (/^to (eur|usd|gbp|savings|pocket)|^exchanged|between own accounts|vault|cash deposit|dep[oó]sito.*numer[aá]rio/.test(d))
    return { kind: "internal", reviewed: true };
  if (/autoridade tribut|(^|\s)at($|\s)|imposto|\biva\b/.test(d) && amount < 0)
    return { kind: "vat_payment", reviewed: true };
  if (/revolut.*fee|fee.*revolut|service charge/.test(d) && amount < 0)
    return { kind: "expense", category: "Bank & payment fees", vat_rate: 0, amount_net: Math.abs(amount), reviewed: true };
  return { kind: "review", reviewed: false };
}

// ---- Sync ------------------------------------------------------------------
type RevLeg = {
  leg_id?: string; account_id?: string; amount?: number; fee?: number; currency?: string;
  description?: string; counterparty?: { account_type?: string };
};
type RevTx = {
  id: string; type?: string; state?: string;
  created_at?: string; completed_at?: string; legs?: RevLeg[];
};

function lisbonDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(new Date(iso));
}

async function syncTransactions(token: string) {
  const acc = await allowedAccounts(token);
  const from = (await internalValue("revolut_b2b_last_sync")) ?? SYNC_FROM;
  // Fenêtre de sécurité : on repart 7 jours en arrière (transactions SEPA
  // qui passent de pending à completed) — le dedup par id absorbe le reste.
  const fromDate = new Date(Math.max(
    new Date(SYNC_FROM).getTime(),
    new Date(from).getTime() - 7 * 86400000
  )).toISOString().slice(0, 10);

  const url = new URL(TX_URL);
  url.searchParams.set("from", fromDate);
  url.searchParams.set("count", "1000");
  const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Revolut transactions ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const txs = (await r.json()) as RevTx[];

  const [{ data: rules }, { data: bookings }] = await Promise.all([
    admin.from("fin_rules").select("pattern,kind,category,vat_rate"),
    admin.from("bookings").select("id,check_in_date,check_out_date,is_test"),
  ]);

  const payloads = [];
  for (const t of txs) {
    if ((t.state ?? "").toLowerCase() !== "completed") continue;
    const legsAll = t.legs ?? [];
    // Seuls les mouvements des comptes Quinta sont retenus
    const legs = acc.ids ? legsAll.filter((l) => l.account_id && acc.ids!.has(l.account_id)) : legsAll;
    if (!legs.length) continue;
    // Transfert/change entre comptes DU PÉRIMÈTRE Quinta -> internal (exclu
    // P&L + cash). Un mouvement Quinta <-> autre compte du business (ex. EUR
    // Main) reste à classer (apport, revenu…) : du point de vue Quinta, c'est
    // de l'argent qui entre/sort. Un payout Merchant a l'allure d'un
    // "transfer" mais sa source n'est aucun compte listé.
    const scope = acc.ids ?? acc.allIds;
    const isInternalMove = legsAll.length > 1 && legsAll.every((l) => !l.account_id || scope.has(l.account_id));
    const leg = legs.find((l) => (l.currency ?? "EUR") === "EUR") ?? legs[0];
    if (!leg || leg.amount == null) continue;
    const amount = Math.round((Number(leg.amount) - Math.abs(Number(leg.fee ?? 0))) * 100) / 100;
    if (!Number.isFinite(amount) || amount === 0) continue;
    const when = t.completed_at ?? t.created_at ?? new Date().toISOString();
    const date = lisbonDate(when);
    if (date < SYNC_FROM) continue; // l'historique vient des imports, pas de l'API
    let desc = (leg.description ?? t.type ?? "Revolut transaction").trim();
    let cls;
    if (isInternalMove) {
      cls = { kind: "internal", reviewed: true };
    } else if (!leg.description && (t.type ?? "").toLowerCase() === "transfer" && amount > 0) {
      // Payout quotidien Revolut Merchant (honesty bar) : entrée "transfer"
      // sans description — les ventes vivent dans bar_sales, cash flow only.
      desc = "Merchant payout";
      cls = { kind: "bar_payout", reviewed: true };
    } else {
      cls = autoKind(desc, amount, (rules ?? []) as Rule[]);
    }
    const booking = "category" in cls && cls.category && VARIABLE_CATS.has(cls.category) && amount < 0
      ? eventForDate(date, (bookings ?? []) as Booking[])
      : null;
    payloads.push({
      source: "revolut", dedup_key: `revapi|${t.id}`,
      date, description: desc, amount, currency: leg.currency ?? "EUR",
      ...cls, ...(booking ? { booking_id: booking } : {}),
    });
  }

  let inserted = 0;
  if (payloads.length) {
    const { error, count } = await admin.from("fin_transactions")
      .upsert(payloads, { onConflict: "dedup_key", ignoreDuplicates: true, count: "exact" });
    if (error) throw new Error(`insert failed: ${error.message}`);
    inserted = count ?? payloads.length;
  }
  await setInternalValue("revolut_b2b_last_sync", new Date().toISOString().slice(0, 10));
  console.log(`[revolut-sync] window from ${fromDate}: ${txs.length} fetched, ${payloads.length} eligible, ${inserted} upserted`);
  return { fetched: txs.length, eligible: payloads.length, inserted, accounts: acc.names };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = new URL(req.url);

    // --- Callback OAuth (clic "Enable API access" dans Revolut) -------------
    const code = url.searchParams.get("code");
    if (req.method === "GET" && code) {
      const data = await tokenRequest({ grant_type: "authorization_code", code });
      if (!data.refresh_token) throw new Error("No refresh_token in Revolut response");
      await setInternalValue("revolut_b2b_refresh_token", data.refresh_token);
      let firstSync: { fetched: number; eligible: number; inserted: number; accounts?: string[] } = { fetched: 0, eligible: 0, inserted: 0 };
      if (data.access_token) firstSync = await syncTransactions(data.access_token);
      return new Response(
        `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center">
        <h2>✅ Revolut Business connecté</h2>
        <p>${firstSync.inserted} transaction(s) synchronisée(s)${firstSync.accounts?.length ? ` — compte(s) : ${firstSync.accounts.join(", ")}` : ""}. La synchro tourne désormais toutes les heures.</p>
        <p><a href="https://guest.quintamor.com/admin/finance">Retour à l'onglet Finance</a></p>
        </body></html>`,
        { status: 200, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    // --- Statut (GET sans code) --------------------------------------------
    if (req.method === "GET") {
      const connected = !!(await internalValue("revolut_b2b_refresh_token"));
      return json({ connected, last_sync: await internalValue("revolut_b2b_last_sync") });
    }

    // --- Sync (cron ou admin) ----------------------------------------------
    const cronKey = await internalValue("cron_key");
    const viaCron = !!cronKey && req.headers.get("x-cron-key") === cronKey;
    if (!viaCron) {
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

    const token = await accessToken().catch((e) => {
      // Refresh token expiré / révoqué -> il faut recliquer "Enable API access"
      console.error("[revolut-sync] token refresh failed:", String(e));
      return null;
    });
    if (!token) {
      // Alerte email à Geoffroy (max 1 tous les 3 jours) avec la manip exacte.
      const wasConnected = !!(await internalValue("revolut_b2b_refresh_token"));
      const lastAlert = await internalValue("revolut_reauth_alerted");
      const threeDays = 3 * 86400000;
      if (viaCron && wasConnected && (!lastAlert || Date.now() - new Date(lastAlert).getTime() > threeDays)) {
        try {
          await resend.emails.send({
            from: FROM_EMAIL, to: [ADMIN_EMAIL],
            subject: "⚠ Revolut sync — réautorisation nécessaire",
            html: `<div style="font-family:sans-serif;line-height:1.6">
              <p>La synchronisation Revolut de l'onglet Finance ne peut plus se connecter :
              l'autorisation a expiré ou a été révoquée.</p>
              <p><b>La manip (2 minutes)&nbsp;:</b></p>
              <ol>
                <li>Ouvre <a href="https://business.revolut.com/settings/apis?tab=business-api">Revolut Business → Paramètres → API</a></li>
                <li>Sur le certificat existant, clique <b>«&nbsp;Activer l'accès API&nbsp;»</b> (Enable API access)</li>
                <li>Confirme le consentement — tu seras redirigé vers une page «&nbsp;✅ Revolut Business connecté&nbsp;»</li>
              </ol>
              <p>Rien d'autre à faire : la synchro horaire reprend toute seule et rattrape les transactions manquées.</p>
            </div>`,
          });
          await setInternalValue("revolut_reauth_alerted", new Date().toISOString());
          console.log("[revolut-sync] re-auth alert email sent");
        } catch (e) {
          console.error("[revolut-sync] alert email failed:", String(e));
        }
      }
      return json({
        connected: false,
        error: "NOT_CONNECTED — open Revolut Business → Settings → API and click 'Enable API access' to (re)authorise.",
      }, viaCron ? 200 : 400);
    }
    await setInternalValue("revolut_reauth_alerted", ""); // reconnecté -> réarme l'alerte
    const result = await syncTransactions(token);
    return json({ connected: true, ...result });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    console.error("revolut-sync error:", msg);
    return json({ error: msg }, 500);
  }
});
