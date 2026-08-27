// bank-payment-match (27 aout 2026) — chaine auto pour les paiements par
// VIREMENT bancaire (Wise, SEPA...), parite avec la chaine Stripe.
//
// Les guests qui paient par virement (souvent les Americains via Wise)
// arrivent sur Revolut sans passer par Stripe : personne ne marque
// l'echeance payee, pas de fatura Moloni, pas d'email de confirmation.
// Cette fonction rapproche chaque virement entrant (fin_transactions,
// kind guest_payment/review, montant > 0, hors payouts Stripe) des
// echeances impayees :
//   Regle A — le montant = exactement UNE echeance impayee
//   Regle B — le montant = la somme de TOUTES les echeances impayees
//             d'un booking (paiement du solde en une fois)
// Ambiguite (plusieurs candidats) : on tente de departager par le nom du
// payeur / la description du virement vs nom, email, retreat du booking.
// Toujours ambigu -> on ne touche RIEN (marquage manuel comme avant).
//
// Sur un match : echeances marquees payees (paid_on = date du virement,
// paid_bank_tx_id = id de la transaction -> groupe la fatura), transaction
// rattachee au booking, puis MEME automatisation que stripe-webhook :
// fatura-recibo Moloni (une seule pour tout le virement) + email de
// confirmation (email-rules-run payment_received, fallback payment-emails).
//
// Exclusions : bookings test/annules, emails internal+, echeances cash ou
// discount. Idempotent : une transaction deja referencee par un
// paid_bank_tx_id n'est jamais retraitee.
// Auth : x-cron-key (cron horaire, apres revolut-sync) ou JWT admin.
// Body : { days?, dry_run? }.
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

const eq = (a: number, b: number) => Math.abs(a - b) < 0.005;

type Inst = {
  id: string; booking_id: string; label: string | null; amount_due: number;
  status: string; is_cash: boolean | null; category: string | null;
};
type Booking = {
  id: string; retreat_name: string | null; first_name: string | null;
  last_name: string | null; email: string; is_test: boolean | null; cancelled_at: string | null;
};
type Candidate = { bookingId: string; insts: Inst[] };

// Tokens significatifs (>= 4 lettres) d'un booking, pour departager les
// candidats par le nom du payeur ou la description du virement.
function bookingTokens(b: Booking): string[] {
  const parts = [b.first_name, b.last_name, b.retreat_name, (b.email || "").split("@")[0]];
  return [...new Set(
    parts.filter(Boolean).join(" ").toLowerCase().split(/[^a-zà-ÿ]+/i).filter((t) => t.length >= 4)
  )];
}

// Meme automatisation que stripe-webhook (fatura + confirmation), best-effort.
async function automate(representativeId: string) {
  const cronKey = await internalValue("cron_key");
  if (!cronKey) { console.error("[bank-match] cron_key missing — no invoice/email"); return { invoice: false, email: false }; }
  const base = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
    "x-cron-key": cronKey,
  };

  // 1. Fatura-recibo (groupe tout le virement via paid_bank_tx_id)
  const inv = await fetch(`${base}/moloni-invoice`, {
    method: "POST", headers,
    body: JSON.stringify({ action: "generate", installment_id: representativeId }),
  });
  const invBody = await inv.json().catch(() => ({}));
  if (!inv.ok || invBody?.error) {
    console.error(`[bank-match invoice] failed (manual Invoice button still available): ${JSON.stringify(invBody).slice(0, 300)}`);
    return { invoice: false, email: false };
  }
  console.log(`[bank-match invoice] ${invBody.number ?? invBody.document_id} created (${invBody.lines} line(s))`);
  if (!invBody.pdf_attached) {
    await new Promise((r) => setTimeout(r, 5000));
    const retry = await fetch(`${base}/moloni-invoice`, {
      method: "POST", headers,
      body: JSON.stringify({ action: "pdf", installment_id: representativeId }),
    });
    const retryBody = await retry.json().catch(() => ({}));
    if (!retry.ok || retryBody?.error) {
      console.error(`[bank-match invoice] PDF retry failed — no confirmation email: ${JSON.stringify(retryBody).slice(0, 300)}`);
      return { invoice: true, email: false };
    }
  }

  // 2. Confirmation : regles personnalisees d'abord, template par defaut sinon.
  let customSent = false;
  try {
    const er = await fetch(`${base}/email-rules-run`, {
      method: "POST", headers,
      body: JSON.stringify({ event: { type: "payment_received", installment_id: representativeId } }),
    });
    const erBody = await er.json().catch(() => ({}));
    if (er.ok && (Number(erBody?.sent) > 0 || erBody?.deduped === true)) {
      customSent = true;
      console.log(`[bank-match email] custom rule "${erBody.rule_name}" ${erBody.deduped ? "already sent" : "sent"}`);
    }
  } catch (e) { console.error("[bank-match email] email-rules-run failed:", e); }
  if (!customSent) {
    const em = await fetch(`${base}/payment-emails`, {
      method: "POST", headers,
      body: JSON.stringify({ kind: "confirmation", installment_id: representativeId }),
    });
    const emBody = await em.json().catch(() => ({}));
    if (!em.ok || emBody?.error) {
      console.error(`[bank-match email] failed (manual ✉️ still available): ${JSON.stringify(emBody).slice(0, 300)}`);
      return { invoice: true, email: false };
    }
    console.log(`[bank-match email] confirmation sent to ${emBody.to}`);
  }
  return { invoice: true, email: true };
}

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
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

    // ---- virements entrants candidats (hors payouts Stripe, deja geres)
    const { data: txsRaw } = await admin.from("fin_transactions")
      .select("id,date,amount,description,payer,booking_id,notes,kind")
      .gt("amount", 0)
      .in("kind", ["guest_payment", "review"])
      .gte("date", since)
      .order("date", { ascending: true });
    const txs = (txsRaw ?? []).filter((t) => !/^payment from stripe/i.test(t.description ?? ""));

    // Transactions deja utilisees pour payer des echeances : jamais retraitees.
    const { data: used } = await admin.from("payment_installments")
      .select("paid_bank_tx_id").not("paid_bank_tx_id", "is", null);
    const usedTx = new Set((used ?? []).map((r: { paid_bank_tx_id: string }) => r.paid_bank_tx_id));
    const candidates = txs.filter((t) => !usedTx.has(t.id));
    if (!candidates.length) return json({ checked: 0, matched: 0, results: [] });

    // ---- pool d'echeances impayees rapprochables
    const { data: instsRaw } = await admin.from("payment_installments")
      .select("id,booking_id,label,amount_due,status,is_cash,category")
      .neq("status", "paid");
    const { data: bookingsRaw } = await admin.from("bookings")
      .select("id,retreat_name,first_name,last_name,email,is_test,cancelled_at");
    const bookingById = new Map((bookingsRaw ?? []).map((b: Booking) => [b.id, b]));
    const pool: Inst[] = ((instsRaw ?? []) as Inst[]).filter((i) => {
      if (i.is_cash || i.category === "discount" || !(Number(i.amount_due) > 0)) return false;
      const b = bookingById.get(i.booking_id) as Booking | undefined;
      if (!b || b.is_test || b.cancelled_at) return false;
      if (/^internal\+/i.test(b.email || "")) return false;
      return true;
    });

    let matched = 0;
    const results: unknown[] = [];

    for (const tx of candidates) {
      const amount = Number(tx.amount);

      // Regle A : une echeance seule au bon montant
      const singles: Candidate[] = pool
        .filter((i) => eq(Number(i.amount_due), amount))
        .map((i) => ({ bookingId: i.booking_id, insts: [i] }));
      // Regle B : la somme des echeances impayees d'un booking
      const byBooking = new Map<string, Inst[]>();
      for (const i of pool) {
        byBooking.set(i.booking_id, [...(byBooking.get(i.booking_id) ?? []), i]);
      }
      const sums: Candidate[] = [...byBooking.entries()]
        .filter(([, is]) => is.length > 1 && eq(is.reduce((s, i) => s + Number(i.amount_due), 0), amount))
        .map(([bookingId, insts]) => ({ bookingId, insts }));

      // Dedoublonne les candidats par ensemble d'echeances
      const seen = new Set<string>();
      let cands: Candidate[] = [];
      for (const c of [...singles, ...sums]) {
        const key = c.insts.map((i) => i.id).sort().join("|");
        if (!seen.has(key)) { seen.add(key); cands.push(c); }
      }
      if (!cands.length) { results.push({ tx: tx.id, amount, matched: false, reason: "no amount match" }); continue; }

      // Ambigu -> departage par nom payeur / description du virement
      if (cands.length > 1) {
        const hay = `${tx.payer ?? ""} ${tx.description ?? ""}`.toLowerCase();
        const byName = cands.filter((c) => {
          const b = bookingById.get(c.bookingId) as Booking | undefined;
          return b ? bookingTokens(b).some((t) => hay.includes(t)) : false;
        });
        if (byName.length === 1) cands = byName;
        else {
          results.push({ tx: tx.id, amount, matched: false, reason: `ambiguous (${cands.length} candidates)` });
          continue;
        }
      }

      const c = cands[0];
      const booking = bookingById.get(c.bookingId) as Booking;
      const bookingName = booking.retreat_name
        || `${booking.first_name ?? ""} ${booking.last_name ?? ""}`.trim() || booking.email;
      const labels = c.insts.map((i) => i.label || "Payment").join(" + ");

      if (!dryRun) {
        // 1. Echeances -> payees (idempotent : seulement si toujours impayees)
        for (const i of c.insts) {
          const { error } = await admin.from("payment_installments").update({
            status: "paid", paid_on: tx.date, paid_bank_tx_id: tx.id,
          }).eq("id", i.id).neq("status", "paid");
          if (error) throw error;
        }
        // 2. Transaction -> rattachee au booking
        const note = `Matched to: ${labels} — ${bookingName} (bank transfer)`;
        await admin.from("fin_transactions").update({
          kind: "guest_payment", reviewed: true,
          ...(tx.booking_id ? {} : { booking_id: c.bookingId }),
          notes: tx.notes ? `${tx.notes}\n${note}` : note,
        }).eq("id", tx.id);
        // 3. Fatura + email de confirmation (representant = la plus grosse ligne)
        const rep = [...c.insts].sort((a, b) => Number(b.amount_due) - Number(a.amount_due))[0];
        const auto = await automate(rep.id);
        results.push({ tx: tx.id, amount, matched: true, booking: bookingName, installments: labels, ...auto });
      } else {
        results.push({ tx: tx.id, amount, matched: true, dry_run: true, booking: bookingName, installments: labels });
      }

      // Retire les echeances consommees du pool pour les virements suivants
      const usedIds = new Set(c.insts.map((i) => i.id));
      pool.splice(0, pool.length, ...pool.filter((i) => !usedIds.has(i.id)));
      matched++;
    }

    console.log(`[bank-match] ${candidates.length} transfers checked, ${matched} matched${dryRun ? " (dry run)" : ""}`);
    return json({ checked: candidates.length, matched, dry_run: dryRun, results });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    console.error("[bank-match] error:", msg);
    return json({ error: msg }, 500);
  }
});
