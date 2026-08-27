// stripe-payout-enrich (27 aout 2026) — met un nom sur les virements
// "Payment from Stripe" de l'onglet Accounting.
//
// Un payout Stripe regroupe une ou plusieurs sessions de paiement, net des
// frais. Pour chaque fin_transaction "Payment from Stripe" pas encore enrichie
// (payer null), on remonte la chaine via l'API Stripe :
//   payout (montant + date) -> balance_transactions (charges + frais)
//   -> charge -> checkout session -> payment_installments (stripe_session_id)
//   -> booking (evenement + nom du guest)
// puis on ecrit : payer, description "Payment from Stripe — <evenements>",
// note detaillee (lignes payees + frais Stripe), et booking_id si le payout
// ne concerne qu'un seul booking (colonne Event de l'onglet Accounting).
//
// Idempotent : payer non-null = deja enrichi, jamais retouche (les saisies
// manuelles sont preservees ; revolut-sync n'ecrase jamais une ligne existante).
// Auth : x-cron-key (cron quotidien) ou JWT admin. Body : { days?, dry_run? }.
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
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const BodySchema = z.object({
  days: z.number().int().min(1).max(365).optional(),
  dry_run: z.boolean().optional(),
});

async function internalValue(k: string): Promise<string | null> {
  const { data } = await admin.from("app_settings").select("value").eq("key", "internal").maybeSingle();
  return (data?.value as Record<string, string> | null)?.[k] ?? null;
}

async function isAdminEmailDb(email?: string | null): Promise<boolean> {
  if (!email) return false;
  const { data } = await admin.from("admin_users").select("email");
  return (data ?? []).map((r: { email: string }) => String(r.email).toLowerCase().trim())
    .includes(email.toLowerCase().trim());
}

async function stripeGet(key: string, path: string, params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`https://api.stripe.com/v1/${path}${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`Stripe ${path} ${r.status}: ${JSON.stringify(body?.error ?? body).slice(0, 300)}`);
  return body;
}

const fmtEur = (cents: number) => `€${(cents / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    // ---- auth : x-cron-key OU admin JWT
    let internalCall = false;
    const cronHeader = req.headers.get("x-cron-key");
    if (cronHeader) internalCall = cronHeader === (await internalValue("cron_key"));
    if (!internalCall) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user } } = await userClient.auth.getUser();
      if (!user || !(await isAdminEmailDb(user.email))) return json({ error: "Forbidden" }, 403);
    }

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
    const days = parsed.data.days ?? 30;
    const dryRun = parsed.data.dry_run === true;

    const stripeKey = await internalValue("stripe_secret_key");
    if (!stripeKey) return json({ error: "stripe_secret_key missing" }, 500);

    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

    // ---- transactions candidates (payer null = pas encore enrichies)
    const { data: txs } = await admin.from("fin_transactions")
      .select("id,date,amount,description,payer,booking_id,notes")
      .ilike("description", "Payment from Stripe%")
      .is("payer", null)
      .gte("date", since)
      .order("date", { ascending: true });
    if (!txs?.length) return json({ checked: 0, enriched: 0, results: [] });

    // ---- payouts Stripe de la fenetre (marge de 7 j en amont pour le lag bancaire)
    const gte = Math.floor((Date.now() - (days + 7) * 86400000) / 1000);
    const payouts: Array<{ id: string; amount: number; arrival_date: number; status: string }> = [];
    let startingAfter: string | undefined;
    for (let page = 0; page < 5; page++) {
      const res = await stripeGet(stripeKey, "payouts", {
        limit: "100", "arrival_date[gte]": String(gte),
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      payouts.push(...(res.data ?? []));
      if (!res.has_more) break;
      startingAfter = res.data[res.data.length - 1]?.id;
    }

    let enriched = 0;
    const results: unknown[] = [];

    for (const tx of txs) {
      const cents = Math.round(Number(tx.amount) * 100);
      const txTime = new Date(`${tx.date}T12:00:00Z`).getTime() / 1000;
      // payout du meme montant, arrive dans les 4 jours avant la date bancaire
      const candidates = payouts
        .filter((p) => p.amount === cents && Math.abs(p.arrival_date - txTime) <= 4 * 86400)
        .sort((a, b) => Math.abs(a.arrival_date - txTime) - Math.abs(b.arrival_date - txTime));
      const po = candidates[0];
      if (!po) { results.push({ tx: tx.id, amount: tx.amount, matched: false }); continue; }

      // charges incluses dans le payout (+ frais)
      const bts = await stripeGet(stripeKey, "balance_transactions", {
        payout: po.id, limit: "100", "expand[]": "data.source",
      });
      type LineInfo = { label: string; gross: number; payerName: string | null; bookingId: string | null; event: string | null };
      const lines: LineInfo[] = [];
      let totalFees = 0;
      for (const bt of (bts.data ?? [])) {
        if (bt.type === "payout") continue;
        totalFees += Number(bt.fee || 0);
        const charge = bt.source && typeof bt.source === "object" ? bt.source : null;
        const billingName = charge?.billing_details?.name ?? charge?.billing_details?.email ?? null;
        let event: string | null = null, bookingId: string | null = null, label = "";
        const pi = typeof charge?.payment_intent === "string" ? charge.payment_intent : charge?.payment_intent?.id;
        if (pi) {
          try {
            const sess = await stripeGet(stripeKey, "checkout/sessions", { payment_intent: pi, limit: "1" });
            const sessionId = sess.data?.[0]?.id;
            if (sessionId) {
              const { data: insts } = await admin.from("payment_installments")
                .select("label,booking_id").eq("stripe_session_id", sessionId);
              if (insts?.length) {
                bookingId = insts[0].booking_id;
                label = insts.map((i: { label: string | null }) => i.label).filter(Boolean).join(" + ");
                const { data: bk } = await admin.from("bookings")
                  .select("retreat_name,first_name,last_name,email").eq("id", bookingId).maybeSingle();
                event = bk?.retreat_name || [bk?.first_name, bk?.last_name].filter(Boolean).join(" ") || bk?.email || null;
              }
            }
          } catch (e) { console.error("session lookup failed:", e); }
        }
        lines.push({ label, gross: Number(bt.amount || 0), payerName: billingName, bookingId, event });
      }
      if (!lines.length) { results.push({ tx: tx.id, matched: true, payout: po.id, lines: 0 }); continue; }

      const events = [...new Set(lines.map((l) => l.event).filter(Boolean))] as string[];
      const payers = [...new Set(lines.map((l) => l.payerName).filter(Boolean))] as string[];
      const bookingIds = [...new Set(lines.map((l) => l.bookingId).filter(Boolean))] as string[];

      const description = `Payment from Stripe — ${events.length ? events.join(" + ") : (payers.join(" + ") || "unidentified")}`;
      const noteLines = lines.map((l) =>
        `${l.event ?? "?"}${l.label ? ` · ${l.label}` : ""} — ${fmtEur(l.gross)}${l.payerName ? ` (paid by ${l.payerName})` : ""}`
      );
      const notes = `Stripe payout ${po.id}\n${noteLines.join("\n")}\nStripe fees: ${fmtEur(totalFees)}`;

      if (!dryRun) {
        await admin.from("fin_transactions").update({
          description,
          payer: payers.join(" + ") || events.join(" + ") || null,
          notes: tx.notes ? `${tx.notes}\n${notes}` : notes,
          // Rattachement a l'evenement uniquement si le payout ne couvre qu'UN booking
          ...(bookingIds.length === 1 && !tx.booking_id ? { booking_id: bookingIds[0] } : {}),
        }).eq("id", tx.id).is("payer", null);
      }
      enriched++;
      results.push({
        tx: tx.id, amount: tx.amount, matched: true, payout: po.id,
        description, bookings: bookingIds.length, fees_eur: totalFees / 100,
      });
    }

    console.log(`[payout-enrich] ${txs.length} candidates, ${enriched} enriched${dryRun ? " (dry run)" : ""}`);
    return json({ checked: txs.length, enriched, dry_run: dryRun, results });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    console.error("[payout-enrich] error:", msg);
    return json({ error: msg }, 500);
  }
});
