// Honesty bar — synchronisation Revolut Merchant (31 juil. 2026).
// Le QR à montant libre encaisse vin (22 €), coconut water (4 €) et
// bières/why not (3 €). Cette fonction :
//   1. récupère les paiements COMPLETED via l'API Merchant (depuis mai 2026),
//   2. classe chaque montant AUTOMATIQUEMENT par décomposition 22a + 4b + 3c
//      (règle du 1er sept 2026 : >= 22 € max vin puis max coconut ; < 22 €
//      max coconut ; non décomposable -> misc 23 % — voir classify()),
//   3. rattache la vente au booking dont le séjour couvre la date (hors tests),
//   4. agrège par booking en 2 échéances "bar" déjà payées :
//      TVA 23 % (vin — prudence AT — + bières/sodas) et TVA 6 % (coconut).
// Les échéances bar sont admin-only (exclues de la guest area) et serviront
// de base à la fatura simplificada "consumidor final" par événement.
// Auth : x-cron-key (cron quotidien 04:40 UTC) ou JWT admin (bouton Sync now).
// Clé API : app_settings key='internal'.revolut_merchant_key (jamais en repo).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Produits & prix (les taux : vin 23 % par prudence — verba restauração ;
// à repasser à 13 % si le comptable confirme la vente de biens).
const PRICE_WINE = 22;
const PRICE_COCONUT = 4;
const PRICE_SOFT = 3;
const SYNC_FROM = "2026-05-01T00:00:00Z"; // le QR tourne depuis mai 2026

type Qty = { wine: number; coconut: number; soft: number };

// Toutes les décompositions amount = 22a + 4b + 3c (montants en euros entiers).
function decompositions(amount: number): Qty[] {
  const out: Qty[] = [];
  if (!Number.isInteger(amount) || amount <= 0 || amount > 2000) return out;
  for (let a = 0; a * PRICE_WINE <= amount; a++) {
    for (let b = 0; a * PRICE_WINE + b * PRICE_COCONUT <= amount; b++) {
      const rest = amount - a * PRICE_WINE - b * PRICE_COCONUT;
      if (rest % PRICE_SOFT === 0) out.push({ wine: a, coconut: b, soft: rest / PRICE_SOFT });
    }
  }
  return out;
}

// Classement AUTOMATIQUE (règle validée par Geoffroy le 1er sept 2026 —
// plus de file "à classer") :
//   - >= 22 € : max de vins, puis max de coconut sur le reste (solde en
//     bières/why not). Paniers crédibles ; le coconut (6 %) est privilégié
//     partout où c'est défendable, sans produire de lignes absurdes du type
//     "1 vin + 43 coconuts" (variante coconut-max écartée : ~29 € de TVA
//     d'écart sur toute la file, pas la peine).
//   - < 22 € : max de coconut, solde en bières/why not.
//   - Montant non décomposable (0,01 € test de carte, 2,50 € pourboire,
//     centimes, > 2 000 €) : part "misc" facturée en divers 23 % sur la
//     fatura mensuelle (décision : exhaustivité plutôt qu'ignorer).
// Le résultat est toujours "classified" — déterministe et rejouable.
function classify(amount: number): { qty: Qty; misc: number } {
  const sols = decompositions(amount);
  if (sols.length === 0) return { qty: { wine: 0, coconut: 0, soft: 0 }, misc: amount };
  const pick = [...sols].sort((x, y) =>
    amount >= PRICE_WINE
      ? (y.wine - x.wine) || (y.coconut - x.coconut)
      : (y.coconut - x.coconut)
  )[0];
  return { qty: pick, misc: 0 };
}

async function internalValue(key: string): Promise<string | null> {
  const { data } = await admin.from("app_settings").select("value").eq("key", "internal").maybeSingle();
  return (data?.value as Record<string, string> | null)?.[key] ?? null;
}

async function isAdminEmailDb(email?: string | null): Promise<boolean> {
  if (!email) return false;
  const { data } = await admin.from("admin_users").select("email");
  return (data ?? []).map((r: { email: string }) => String(r.email).toLowerCase().trim())
    .includes(email.toLowerCase().trim());
}

// ---- Revolut Merchant API -------------------------------------------------
// GET /api/orders (Bearer secret key, en-tête de version) — pagination par
// created_before, on remonte jusqu'à SYNC_FROM.
type RevOrder = {
  id: string; state?: string; created_at?: string; completed_at?: string;
  order_amount?: { value?: number; currency?: string };
  amount?: number; currency?: string;
};

async function fetchCompletedOrders(apiKey: string): Promise<RevOrder[]> {
  const out: RevOrder[] = [];
  let createdBefore: string | null = null;
  for (let page = 0; page < 40; page++) {
    // 1er sept. 2026 : la version datee de l'API ("/api/orders" +
    // Revolut-Api-Version) enveloppe la reponse dans {orders:[...]} — la
    // fonction attendait un tableau nu et voyait 0 commande. L'endpoint
    // /api/1.0/orders renvoie le format historique (tableau, order_amount,
    // etats en MAJUSCULES) et supporte created_before : on s'y tient.
    const url = new URL("https://merchant.revolut.com/api/1.0/orders");
    url.searchParams.set("limit", "100");
    if (createdBefore) url.searchParams.set("created_before", createdBefore);
    const r = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`Revolut API ${r.status}: ${t.slice(0, 300)}`);
    }
    const raw = await r.json();
    const batch = (Array.isArray(raw) ? raw : (raw?.orders ?? [])) as RevOrder[];
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push(...batch);
    const oldest = batch[batch.length - 1]?.created_at;
    if (!oldest || oldest <= SYNC_FROM) break;
    createdBefore = oldest;
  }
  return out.filter((o) => (o.state ?? "").toLowerCase() === "completed"
    && (o.created_at ?? o.completed_at ?? "") >= SYNC_FROM);
}

// Date de vente côté Lisbonne (rattachement à l'événement)
function lisbonDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(new Date(iso));
}

// ---- Rollup : 2 échéances "bar" par booking -------------------------------
const LABEL_23 = "Honesty bar — drinks 23%";
const LABEL_6 = "Honesty bar — drinks 6%";

async function rollupBooking(bookingId: string) {
  const { data: sales } = await admin.from("bar_sales")
    .select("qty_wine,qty_coconut,qty_soft,misc_amount,state")
    .eq("booking_id", bookingId).eq("state", "classified");
  const wine = (sales ?? []).reduce((s, r) => s + (r.qty_wine ?? 0), 0);
  const coconut = (sales ?? []).reduce((s, r) => s + (r.qty_coconut ?? 0), 0);
  const soft = (sales ?? []).reduce((s, r) => s + (r.qty_soft ?? 0), 0);
  const misc = (sales ?? []).reduce((s, r) => s + Number(r.misc_amount ?? 0), 0);
  const eur23 = wine * PRICE_WINE + soft * PRICE_SOFT + misc;
  const eur6 = coconut * PRICE_COCONUT;

  const { data: booking } = await admin.from("bookings")
    .select("id,check_out_date").eq("id", bookingId).maybeSingle();
  const { data: existing } = await admin.from("payment_installments")
    .select("id,label,vat_rate").eq("booking_id", bookingId).eq("category", "bar");

  const upsertLine = async (rate: number, label: string, ttc: number, notes: string) => {
    const row = (existing ?? []).find((e) => Number(e.vat_rate) === rate);
    if (ttc <= 0) {
      if (row) await admin.from("payment_installments").delete().eq("id", row.id);
      return;
    }
    const payload = {
      booking_id: bookingId,
      label,
      amount_due: Math.round(ttc * 100) / 100,
      amount_excl_vat: Math.round((ttc / (1 + rate / 100)) * 100) / 100,
      due_date: booking?.check_out_date ?? null,
      status: "paid",
      category: "bar",
      vat_rate: rate,
      is_cash: false,
      notes,
    };
    if (row) await admin.from("payment_installments").update(payload).eq("id", row.id);
    else await admin.from("payment_installments").insert(payload);
  };

  await upsertLine(23, LABEL_23, eur23,
    `Honesty bar (Revolut) — ${wine} wine, ${soft} why not / beer${misc > 0 ? `, €${misc} misc` : ""}`);
  await upsertLine(6, LABEL_6, eur6,
    `Honesty bar (Revolut) — ${coconut} coconut water`);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    // Auth : cron interne ou admin connecté
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

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const action = String(body.action ?? "sync");

    // --- Classement manuel d'une vente ambiguë -----------------------------
    if (action === "classify") {
      const { sale_id, qty_wine, qty_coconut, qty_soft } = body as Record<string, unknown>;
      const { data: sale } = await admin.from("bar_sales")
        .select("id,amount,booking_id").eq("id", String(sale_id)).maybeSingle();
      if (!sale) return json({ error: "Sale not found" }, 404);
      const w = Number(qty_wine ?? 0), c = Number(qty_coconut ?? 0), s = Number(qty_soft ?? 0);
      const sum = w * PRICE_WINE + c * PRICE_COCONUT + s * PRICE_SOFT;
      if (Math.abs(sum - Number(sale.amount)) > 0.001) {
        return json({ error: `Quantities total €${sum}, sale is €${sale.amount}` }, 400);
      }
      await admin.from("bar_sales").update({
        qty_wine: w, qty_coconut: c, qty_soft: s, state: "classified",
      }).eq("id", sale.id);
      if (sale.booking_id) await rollupBooking(sale.booking_id);
      return json({ ok: true });
    }

    // --- Reclassement en masse (règle auto du 1er sept 2026) ---------------
    // Applique la règle max-vin/max-coconut à toutes les ventes encore
    // "ambiguous" (one-shot après le changement de règle ; rejouable sans
    // effet sur les ventes déjà classées ou facturées).
    if (action === "reclassify_all") {
      const { data: pending } = await admin.from("bar_sales")
        .select("id,amount,booking_id").neq("state", "classified");
      const touchedB = new Set<string>();
      let done = 0, misc = 0;
      for (const s of pending ?? []) {
        const { qty, misc: m } = classify(Number(s.amount));
        await admin.from("bar_sales").update({
          qty_wine: qty.wine, qty_coconut: qty.coconut, qty_soft: qty.soft,
          misc_amount: m, state: "classified",
        }).eq("id", s.id);
        done++;
        if (m > 0) misc++;
        if (s.booking_id) touchedB.add(String(s.booking_id));
      }
      for (const b of touchedB) await rollupBooking(b);
      return json({ ok: true, reclassified: done, misc_sales: misc, bookings_updated: touchedB.size });
    }

    // --- Rattachement manuel à un booking ----------------------------------
    if (action === "assign") {
      const { sale_id, booking_id } = body as Record<string, unknown>;
      const { data: sale } = await admin.from("bar_sales")
        .select("id,booking_id").eq("id", String(sale_id)).maybeSingle();
      if (!sale) return json({ error: "Sale not found" }, 404);
      const prev = sale.booking_id;
      await admin.from("bar_sales").update({ booking_id: booking_id ? String(booking_id) : null }).eq("id", sale.id);
      if (prev) await rollupBooking(String(prev));
      if (booking_id) await rollupBooking(String(booking_id));
      return json({ ok: true });
    }

    // --- Sync Revolut -------------------------------------------------------
    const apiKey = await internalValue("revolut_merchant_key");
    if (!apiKey) return json({ configured: false, error: "REVOLUT_KEY_MISSING — paste the Merchant secret key into app_settings.internal.revolut_merchant_key" }, viaCron ? 200 : 400);

    const orders = await fetchCompletedOrders(apiKey);
    const { data: known } = await admin.from("bar_sales").select("revolut_order_id");
    const knownIds = new Set((known ?? []).map((r) => r.revolut_order_id));

    // Bookings réels (hors tests) pour le rattachement par date
    const { data: bookings } = await admin.from("bookings")
      .select("id,check_in_date,check_out_date,is_test")
      .not("check_in_date", "is", null).not("check_out_date", "is", null);
    const realBookings = (bookings ?? []).filter((b) => !b.is_test);

    let inserted = 0, unassigned = 0;
    const touched = new Set<string>();

    for (const o of orders) {
      if (knownIds.has(o.id)) continue;
      const minor = o.order_amount?.value ?? o.amount;
      if (minor == null) continue;
      const amount = Math.round(Number(minor)) / 100;
      if (!(amount > 0)) continue;
      const paidAt = o.completed_at ?? o.created_at ?? new Date().toISOString();
      const saleDay = lisbonDate(paidAt);
      const matches = realBookings.filter((b) =>
        (b.check_in_date as string) <= saleDay && saleDay <= (b.check_out_date as string));
      const bookingId = matches.length === 1 ? matches[0].id : null;
      const { qty, misc } = classify(amount);

      const { error } = await admin.from("bar_sales").insert({
        revolut_order_id: o.id,
        paid_at: paidAt,
        amount,
        currency: o.order_amount?.currency ?? o.currency ?? "EUR",
        qty_wine: qty.wine,
        qty_coconut: qty.coconut,
        qty_soft: qty.soft,
        misc_amount: misc,
        state: "classified",
        booking_id: bookingId,
      });
      if (error) { console.error("[bar-sync] insert failed:", error.message); continue; }
      inserted++;
      if (!bookingId) unassigned++;
      if (bookingId) touched.add(bookingId);
    }

    for (const b of touched) await rollupBooking(b);

    console.log(`[bar-sync] ${inserted} new sale(s), ${unassigned} without event, ${touched.size} booking(s) updated`);
    return json({
      configured: true, fetched: orders.length, inserted,
      to_classify: 0, unassigned, bookings_updated: touched.size,
    });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    console.error("revolut-bar-sync error:", msg);
    return json({ error: msg }, 500);
  }
});
