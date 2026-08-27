// Webhook Stripe — marque les échéances payées quand Stripe confirme.
// verify_jwt = false : Stripe ne peut pas envoyer de JWT Supabase. La sécurité
// vient de la signature Stripe (header stripe-signature, HMAC-SHA256 avec le
// signing secret whsec_… stocké dans app_settings key='internal'.stripe_webhook_secret).
// Événements traités :
//   checkout.session.completed          -> payé si payment_status = paid
//                                          (SEPA : payment_status = unpaid, on attend)
//   checkout.session.async_payment_succeeded -> payé (confirmation SEPA, quelques jours)
//   checkout.session.async_payment_failed    -> log (l'échéance reste pending)
// Étape 4 (à venir) : après le marquage payé en mode LIVE, générer la
// fatura-recibo Moloni + email de confirmation. Volontairement absent tant
// qu'on est en mode test (pas de vrais documents fiscaux pour de faux paiements).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
        console.log(`[stripe-webhook] session ${session?.id} completed, payment ${session?.payment_status} — waiting`);
      }
    } else if (type === "checkout.session.async_payment_succeeded") {
      if (installmentIds.length) {
        const newlyPaid = await markPaid(installmentIds, session.id, fxRate);
        scheduleAutomation(newlyPaid, session.id);
      }
    } else if (type === "checkout.session.async_payment_failed") {
      console.error(`[stripe-webhook] async payment FAILED for installments ${idsRaw} (session ${session?.id})`);
    }

    return json({ received: true });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    console.error("stripe-webhook error:", msg);
    return json({ error: msg }, 500);
  }
});
