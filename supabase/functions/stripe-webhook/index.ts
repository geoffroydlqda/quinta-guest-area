// Webhook Stripe — marque les échéances payées quand Stripe confirme.
// verify_jwt = false : Stripe ne peut pas envoyer de JWT Supabase. La sécurité
// vient de la signature Stripe (header stripe-signature, HMAC-SHA256 avec le
// signing secret whsec_… stocké dans app_settings key='internal'.stripe_webhook_secret).
// Événements traités :
//   checkout.session.completed          -> payé si payment_status = paid
//                                          (SEPA : payment_status = unpaid -> on pose
//                                          processing_since/method sur les échéances,
//                                          visibles admin + guest, 15 oct 2026)
//   checkout.session.async_payment_succeeded -> payé (confirmation SEPA, ~6 j ouvrés)
//   checkout.session.async_payment_failed    -> processing effacé + email admin
// Étape 4 (à venir) : après le marquage payé en mode LIVE, générer la
// fatura-recibo Moloni + email de confirmation. Volontairement absent tant
// qu'on est en mode test (pas de vrais documents fiscaux pour de faux paiements).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}

// Deux secrets possibles pendant la transition sandbox -> live :
// la signature est acceptée si elle correspond à l'un des deux.
async function webhookSecrets(): Promise<string[]> {
  const { data } = await admin.from("app_settings").select("value").eq("key", "internal").maybeSingle();
  const v = data?.value as Record<string, string> | null;
  const list = [v?.stripe_webhook_secret, v?.stripe_webhook_secret_live].filter(Boolean) as string[];
  if (!list.length) throw new Error("WEBHOOK_SECRET_MISSING");
  return list;
}

function hexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifySignature(payload: string, header: string | null): Promise<boolean> {
  if (!header) return false;
  // Pendant une rotation de secret, Stripe envoie PLUSIEURS signatures v1 —
  // il faut toutes les tester (avant, seule la derniere etait comparee et les
  // events valides pouvaient etre rejetes pendant la transition — 25 aout 2026).
  const pairs = header.split(",").map((p) => p.split("=", 2) as [string, string]);
  const t = pairs.find(([k]) => k.trim() === "t")?.[1];
  const v1s = pairs.filter(([k]) => k.trim() === "v1").map(([, v]) => v).filter(Boolean);
  if (!t || v1s.length === 0) return false;
  // Tolérance 10 min contre le rejeu
  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(age) || age > 600) return false;

  for (const secret of await webhookSecrets()) {
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`));
    const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
    if (v1s.some((v1) => hexEqual(hex, v1))) return true;
  }
  return false;
}

async function markPaid(installmentIds: string[], sessionId: string, fxRate: number | null): Promise<string[]> {
  const newlyPaid: string[] = [];
  for (const installmentId of installmentIds) {
    const { data: inst } = await admin.from("payment_installments")
      .select("id,status,amount_due")
      .eq("id", installmentId).maybeSingle();
    if (!inst) {
      console.error(`[stripe-webhook] installment ${installmentId} not found (session ${sessionId})`);
      continue;
    }
    if (inst.status === "paid") continue; // idempotent — Stripe renvoie parfois deux fois
    const { error } = await admin.from("payment_installments").update({
      status: "paid",
      paid_on: new Date().toISOString().slice(0, 10),
      stripe_session_id: sessionId,
      processing_since: null,
      processing_method: null,
      // Paiement présenté en USD : taux figé + montant dollars payé (trace compta)
      ...(fxRate ? {
        usd_rate: fxRate,
        paid_usd: Math.round(Number(inst.amount_due) * fxRate * 100) / 100,
      } : {}),
    }).eq("id", installmentId);
    if (error) throw error;
    newlyPaid.push(installmentId);
    console.log(`[stripe-webhook] installment ${installmentId} marked paid (session ${sessionId})${fxRate ? ` · USD @ ${fxRate}` : ""}`);
  }
  return newlyPaid;
}

// Paiement asynchrone initié (SEPA, virement, ACH) : le guest a terminé le
// checkout mais la banque n'a pas encore confirmé. On marque les échéances
// "processing" pour que l'admin (et le guest) sachent que le paiement est en
// route — évite les relances et les doubles paiements. La méthode réelle est
// lue sur le PaymentIntent (best-effort ; la session ne porte que la liste
// des méthodes proposées).
async function markProcessing(installmentIds: string[], session: Record<string, unknown>) {
  let method: string | null = null;
  try {
    const piId = typeof session?.payment_intent === "string" ? session.payment_intent : null;
    if (piId) {
      const { data } = await admin.from("app_settings").select("value").eq("key", "internal").maybeSingle();
      const key = (data?.value as Record<string, string> | null)?.stripe_secret_key;
      if (key) {
        const r = await fetch(`https://api.stripe.com/v1/payment_intents/${piId}?expand[]=payment_method`, {
          headers: { Authorization: `Bearer ${key}` },
        });
        const pi = await r.json().catch(() => ({}));
        method = pi?.payment_method?.type ?? (Array.isArray(pi?.payment_method_types) ? pi.payment_method_types[0] : null);
      }
    }
  } catch (e) {
    console.error("[processing] method lookup failed:", String((e as Error)?.message ?? e));
  }
  const { error } = await admin.from("payment_installments")
    .update({ processing_since: new Date().toISOString(), processing_method: method })
    .in("id", installmentIds)
    .neq("status", "paid");
  if (error) console.error("[processing] update failed:", error.message);
  else console.log(`[processing] installments ${installmentIds.join(",")} marked processing (${method ?? "unknown method"})`);
}

// Échec d'un paiement asynchrone (prélèvement refusé, microdépôts expirés…) :
// on efface l'état processing et on prévient l'admin — avant, l'échec était
// seulement loggé et personne ne le voyait (cas Shandra, oct 2026).
async function notifyAsyncFailure(installmentIds: string[], session: Record<string, unknown>) {
  const { error } = await admin.from("payment_installments")
    .update({ processing_since: null, processing_method: null })
    .in("id", installmentIds)
    .neq("status", "paid");
  if (error) console.error("[async-fail] clear processing failed:", error.message);
  if (String(session?.id ?? "").startsWith("cs_test")) {
    console.log("[async-fail] test session — no admin email");
    return;
  }
  try {
    const { data: insts } = await admin.from("payment_installments")
      .select("label,amount_due,booking_id").in("id", installmentIds);
    const bookingId = insts?.[0]?.booking_id;
    const { data: booking } = bookingId
      ? await admin.from("bookings").select("retreat_name,email").eq("id", bookingId).maybeSingle()
      : { data: null };
    const lines = (insts ?? []).map((i) => `• ${i.label} — €${Number(i.amount_due).toFixed(2)}`).join("\n");
    const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
    await resend.emails.send({
      from: "Quinta do Amor <hello@quintamor.com>",
      to: ["hello@quintamor.com"],
      subject: `⚠️ Payment failed — ${booking?.retreat_name ?? "unknown booking"}`,
      text: `A bank payment (SEPA / bank transfer / ACH) initiated by the guest has FAILED.\n\nBooking: ${booking?.retreat_name ?? "?"} (${booking?.email ?? "?"})\nInstallments back to pending:\n${lines}\n\nStripe session: ${String(session?.id ?? "?")}\nThe guest may believe they have paid — consider reaching out so they can retry (card is the most reliable fallback).`,
    });
    console.log("[async-fail] admin notified");
  } catch (e) {
    console.error("[async-fail] admin email failed:", String((e as Error)?.message ?? e));
  }
}

// Virement direct via le QR EPC (15 oct 2026) : le guest vire sur son IBAN
// virtuel SANS ouvrir de session Checkout — l'argent arrive sur son solde
// client Stripe et l'événement customer_cash_balance_transaction.created
// (type funded) est le seul signal. On rapproche le montant des échéances
// impayées du guest (mêmes règles que bank-payment-match : UNE échéance au
// montant exact, sinon la totalité des impayés d'UN booking), on encaisse le
// solde par un PaymentIntent customer_balance confirmé immédiatement, puis
// markPaid + fatura + email de confirmation (chaîne habituelle). Montant non
// rapproché -> email admin, l'argent reste en crédit sur le customer.
async function handleCashBalanceFunded(tx: Record<string, unknown>) {
  try {
    if (String(tx?.type) !== "funded" || String(tx?.currency ?? "").toLowerCase() !== "eur") return;
    const customerId = typeof tx?.customer === "string" ? tx.customer : null;
    const cents = Number((tx as { net_amount?: number }).net_amount ?? 0);
    const txId = String(tx?.id ?? "");
    if (!customerId || !(cents > 0) || !txId) return;
    const amount = Math.round(cents) / 100;

    const { data: settings } = await admin.from("app_settings").select("value").eq("key", "internal").maybeSingle();
    const key = (settings?.value as Record<string, string> | null)?.stripe_secret_key;
    if (!key) { console.error("[cash-balance] stripe key missing"); return; }
    const sHeaders = { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" };

    // Idempotence : Stripe rejoue les événements — un PI déjà taggé avec
    // cette transaction de solde signifie que tout est déjà traité.
    const srch = await fetch(
      `https://api.stripe.com/v1/payment_intents/search?query=${encodeURIComponent(`metadata['cash_balance_tx']:'${txId}'`)}`,
      { headers: { Authorization: `Bearer ${key}` } });
    const srchBody = await srch.json().catch(() => ({}));
    if (srch.ok && (srchBody?.data?.length ?? 0) > 0) {
      console.log(`[cash-balance] tx ${txId} already handled (${srchBody.data[0].id})`);
      return;
    }

    const cr = await fetch(`https://api.stripe.com/v1/customers/${customerId}`, { headers: { Authorization: `Bearer ${key}` } });
    const cust = await cr.json().catch(() => ({}));
    const email = String(cust?.email ?? "").toLowerCase().trim();
    if (!email) { console.error(`[cash-balance] customer ${customerId} has no email`); return; }

    const { data: bks } = await admin.from("bookings")
      .select("id,email,retreat_name,is_test,cancelled_at")
      .ilike("email", email);
    const bookings = (bks ?? []).filter((b) => !b.is_test && !b.cancelled_at);
    const bookingIds = bookings.map((b) => b.id);
    type I = { id: string; booking_id: string; label: string | null; amount_due: number; status: string; is_cash: boolean | null; category: string | null; processing_since: string | null };
    const { data: instsData } = bookingIds.length
      ? await admin.from("payment_installments")
        .select("id,booking_id,label,amount_due,status,is_cash,category,processing_since")
        .in("booking_id", bookingIds)
      : { data: [] as I[] };
    const open = ((instsData ?? []) as I[]).filter((i) =>
      i.status !== "paid" && !i.processing_since && !i.is_cash && i.category !== "discount" && Number(i.amount_due) > 0);

    // Règle A : UNE échéance au montant exact. Règle B : la totalité des
    // impayés d'UN booking. Ambigu (plusieurs candidats) -> on ne touche rien.
    const close = (a: number, b: number) => Math.abs(a - b) <= 0.02;
    const exact = open.filter((i) => close(Number(i.amount_due), amount));
    let matched: I[] | null = null;
    if (exact.length === 1) matched = [exact[0]];
    else if (exact.length === 0) {
      const byBooking = new Map<string, I[]>();
      for (const i of open) byBooking.set(i.booking_id, [...(byBooking.get(i.booking_id) ?? []), i]);
      const candidates = [...byBooking.values()].filter((g) => close(g.reduce((s, i) => s + Number(i.amount_due), 0), amount));
      if (candidates.length === 1) matched = candidates[0];
    }

    const notifyAdmin = async (subject: string, text: string) => {
      try {
        const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
        await resend.emails.send({ from: "Quinta do Amor <hello@quintamor.com>", to: ["hello@quintamor.com"], subject, text });
      } catch (e) { console.error("[cash-balance] admin email failed:", String((e as Error)?.message ?? e)); }
    };

    if (!matched) {
      console.error(`[cash-balance] €${amount.toFixed(2)} from ${email} NOT matched (${open.length} open installments)`);
      await notifyAdmin(
        `⚠️ Bank transfer received on Stripe — not matched (€${amount.toFixed(2)})`,
        `€${amount.toFixed(2)} arrived by direct bank transfer on the Stripe account of ${email}, but it doesn't match any single unpaid installment nor the full balance of one booking.\n\nThe money sits as customer credit in Stripe (Customers → ${customerId} → Cash balance). Apply it manually from the Stripe dashboard, then mark the installments paid in the admin.`);
      return;
    }

    const booking = bookings.find((b) => b.id === matched![0].booking_id);
    const ids = matched.map((i) => i.id);
    const params = new URLSearchParams();
    params.set("amount", String(Math.round(cents)));
    params.set("currency", "eur");
    params.set("customer", customerId);
    params.set("payment_method_types[0]", "customer_balance");
    params.set("payment_method_data[type]", "customer_balance");
    params.set("confirm", "true");
    params.set("metadata[installment_ids]", ids.join(","));
    params.set("metadata[booking_id]", matched[0].booking_id);
    params.set("metadata[cash_balance_tx]", txId);
    params.set("description", `${booking?.retreat_name ?? "Quinta do Amor"} — ${matched.map((i) => i.label).join(" + ")} (EPC QR transfer)`.slice(0, 250));
    const pr = await fetch("https://api.stripe.com/v1/payment_intents", { method: "POST", headers: sHeaders, body: params.toString() });
    const pi = await pr.json().catch(() => ({}));
    if (!pr.ok || pi?.status !== "succeeded") {
      // Solde insuffisant ou refus : on annule le PI éventuel et on alerte.
      if (pi?.id && pi?.status && pi.status !== "succeeded" && pi.status !== "canceled") {
        await fetch(`https://api.stripe.com/v1/payment_intents/${pi.id}/cancel`, { method: "POST", headers: sHeaders }).catch(() => null);
      }
      console.error(`[cash-balance] PI not succeeded for tx ${txId}: ${JSON.stringify(pi?.error ?? pi?.status).slice(0, 200)}`);
      await notifyAdmin(
        `⚠️ Bank transfer received on Stripe — matched but not collected (€${amount.toFixed(2)})`,
        `€${amount.toFixed(2)} from ${email} matched "${matched.map((i) => i.label).join(" + ")}" (${booking?.retreat_name ?? "?"}) but collecting the customer cash balance failed (${String(pi?.error?.message ?? pi?.status ?? "unknown")}).\n\nHandle it from the Stripe dashboard (Customers → ${customerId}).`);
      return;
    }
    console.log(`[cash-balance] €${amount.toFixed(2)} from ${email} matched ${ids.length} installment(s) — PI ${pi.id} succeeded`);
    const newlyPaid = await markPaid(ids, String(pi.id), null);
    await automate(newlyPaid, String(pi.id));
  } catch (e) {
    console.error("[cash-balance] error:", String((e as Error)?.message ?? e));
  }
}

// Étape 4 — automatisation post-paiement (LIVE uniquement, best-effort) :
// fatura-recibo Moloni générée puis email de confirmation avec le PDF joint.
// Auth interne des appels : x-cron-key (app_settings.internal.cron_key).
// En cas d'échec, tout reste faisable à la main (boutons Invoice et ✉️).
async function automate(newlyPaid: string[], sessionId: string) {
  if (!newlyPaid.length) return;
  if (sessionId.startsWith("cs_test")) {
    console.log("[automation] test session — no invoice/email");
    return;
  }
  try {
    const { data } = await admin.from("app_settings").select("value").eq("key", "internal").maybeSingle();
    const cronKey = (data?.value as Record<string, string> | null)?.cron_key;
    if (!cronKey) { console.error("[automation] cron_key missing"); return; }
    const base = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
      "x-cron-key": cronKey,
    };

    // 1. Facture (couvre tout le groupe de la session, une seule fatura-recibo)
    const inv = await fetch(`${base}/moloni-invoice`, {
      method: "POST", headers,
      body: JSON.stringify({ action: "generate", installment_id: newlyPaid[0] }),
    });
    const invBody = await inv.json().catch(() => ({}));
    if (!inv.ok || invBody?.error) {
      console.error(`[auto-invoice] failed (manual Invoice button still available): ${JSON.stringify(invBody).slice(0, 300)}`);
      return; // pas d'email de confirmation sans facture jointe
    }
    console.log(`[auto-invoice] ${invBody.number ?? invBody.document_id} created (${invBody.lines} line(s))`);

    // 1b. Si le PDF n'était pas prêt, on retente (Moloni met parfois >25 s)
    if (!invBody.pdf_attached) {
      console.log("[auto-invoice] PDF not ready — retrying");
      await new Promise((r) => setTimeout(r, 5000));
      const retry = await fetch(`${base}/moloni-invoice`, {
        method: "POST", headers,
        body: JSON.stringify({ action: "pdf", installment_id: newlyPaid[0] }),
      });
      const retryBody = await retry.json().catch(() => ({}));
      if (!retry.ok || retryBody?.error) {
        console.error(`[auto-invoice] PDF retry failed — no confirmation email (attach manually then use ✉️): ${JSON.stringify(retryBody).slice(0, 300)}`);
        return;
      }
    }

    // 2. Email de confirmation avec le PDF.
    // 2a. D'abord les regles personnalisees (email_rules, trigger
    //     payment_received : confirmation differente acompte / solde / etc.).
    //     Si une regle active matche et envoie (ou a deja envoye), on s'arrete la.
    let customSent = false;
    try {
      const er = await fetch(`${base}/email-rules-run`, {
        method: "POST", headers,
        body: JSON.stringify({ event: { type: "payment_received", installment_id: newlyPaid[0] } }),
      });
      const erBody = await er.json().catch(() => ({}));
      if (er.ok && (Number(erBody?.sent) > 0 || erBody?.deduped === true)) {
        customSent = true;
        console.log(`[auto-email] custom confirmation rule "${erBody.rule_name}" ${erBody.deduped ? "already sent" : "sent"}`);
      } else if (erBody?.matched > 0) {
        console.error(`[auto-email] custom rule matched but failed (falling back to default): ${JSON.stringify(erBody).slice(0, 200)}`);
      }
    } catch (e) {
      console.error("[auto-email] email-rules-run call failed (falling back to default):", e);
    }

    // 2b. Sinon, template de confirmation par defaut (payment-emails).
    if (!customSent) {
      const em = await fetch(`${base}/payment-emails`, {
        method: "POST", headers,
        body: JSON.stringify({ kind: "confirmation", installment_id: newlyPaid[0] }),
      });
      const emBody = await em.json().catch(() => ({}));
      if (!em.ok || emBody?.error) {
        console.error(`[auto-email] failed (manual ✉️ still available): ${JSON.stringify(emBody).slice(0, 300)}`);
      } else {
        console.log(`[auto-email] confirmation sent to ${emBody.to} (${emBody.attachment})`);
      }
    }
  } catch (e) {
    console.error("[automation] error:", e);
  }
}

function scheduleAutomation(newlyPaid: string[], sessionId: string) {
  const task = automate(newlyPaid, sessionId);
  // Répond vite à Stripe ; le travail continue après la réponse.
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(task);
  return task;
}

serve(async (req) => {
  try {
    const payload = await req.text();
    const ok = await verifySignature(payload, req.headers.get("stripe-signature"));
    if (!ok) return json({ error: "Invalid signature" }, 400);

    const event = JSON.parse(payload);
    const type: string = event?.type ?? "";
    const session = event?.data?.object ?? {};

    // Virement direct (QR EPC) arrivé sur le solde client — LIVE uniquement
    // (jamais de fatura/encaissement sur un événement de test). Traité après
    // la réponse à Stripe (plusieurs appels API).
    if (type === "customer_cash_balance_transaction.created") {
      if (event?.livemode) {
        const task = handleCashBalanceFunded(session);
        const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
        if (rt?.waitUntil) rt.waitUntil(task); else await task;
      } else {
        console.log("[cash-balance] test event — ignored");
      }
      return json({ received: true });
    }
    const idsRaw: string = session?.metadata?.installment_ids
      ?? session?.metadata?.installment_id
      ?? session?.client_reference_id
      ?? "";
    const installmentIds = idsRaw.split(",").map((s: string) => s.trim()).filter(Boolean);
    const fxRaw = Number(session?.metadata?.fx_rate);
    const fxRate = Number.isFinite(fxRaw) && fxRaw > 0 ? fxRaw : null;

    // Preuve d'acceptation des CGV (clickwrap) : Stripe pose la case obligatoire
    // et renvoie consent.terms_of_service = "accepted" sur la session. On
    // archive une trace horodatee, idempotente par session.
    if (type === "checkout.session.completed" && session?.consent?.terms_of_service === "accepted") {
      const { error: taErr } = await admin.from("terms_acceptances").upsert({
        stripe_session_id: session.id,
        booking_id: session?.metadata?.booking_id ?? null,
        installment_ids: idsRaw || null,
        email: session?.customer_details?.email ?? session?.customer_email ?? null,
        consent: session.consent,
        amount_total: session?.amount_total != null ? Number(session.amount_total) / 100 : null,
        currency: session?.currency ?? null,
        livemode: !!event?.livemode,
        accepted_at: session?.created ? new Date(Number(session.created) * 1000).toISOString() : new Date().toISOString(),
      }, { onConflict: "stripe_session_id" });
      if (taErr) console.error("[terms] terms_acceptances upsert failed:", taErr.message);
      else console.log(`[terms] ToS acceptance recorded for session ${session.id}`);
    }

    if (type === "checkout.session.completed") {
      if (session?.payment_status === "paid" && installmentIds.length) {
        const newlyPaid = await markPaid(installmentIds, session.id, fxRate);
        scheduleAutomation(newlyPaid, session.id);
      } else {
        // SEPA & co : le débit est en cours, async_payment_succeeded suivra.
        console.log(`[stripe-webhook] session ${session?.id} completed, payment ${session?.payment_status} — marking processing`);
        if (installmentIds.length) await markProcessing(installmentIds, session);
      }
    } else if (type === "checkout.session.async_payment_succeeded") {
      if (installmentIds.length) {
        const newlyPaid = await markPaid(installmentIds, session.id, fxRate);
        scheduleAutomation(newlyPaid, session.id);
      }
    } else if (type === "checkout.session.async_payment_failed") {
      console.error(`[stripe-webhook] async payment FAILED for installments ${idsRaw} (session ${session?.id})`);
      if (installmentIds.length) await notifyAsyncFailure(installmentIds, session);
    }

    return json({ received: true });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    console.error("stripe-webhook error:", msg);
    return json({ error: msg }, 500);
  }
});
