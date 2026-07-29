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
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.split("=", 2) as [string, string])
  );
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;
  // Tolérance 10 min contre le rejeu
  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(age) || age > 600) return false;

  for (const secret of await webhookSecrets()) {
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`));
    const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
    if (hexEqual(hex, v1)) return true;
  }
  return false;
}

async function markPaid(installmentIds: string[], sessionId: string) {
  for (const installmentId of installmentIds) {
    const { data: inst } = await admin.from("payment_installments")
      .select("id,status")
      .eq("id", installmentId).maybeSingle();
    if (!inst) {
      console.error(`[stripe-webhook] installment ${installmentId} not found (session ${sessionId})`);
      continue;
    }
    if (inst.status === "paid") continue; // idempotent — Stripe renvoie parfois deux fois
    const { error } = await admin.from("payment_installments").update({
      status: "paid",
      stripe_session_id: sessionId,
    }).eq("id", installmentId);
    if (error) throw error;
    console.log(`[stripe-webhook] installment ${installmentId} marked paid (session ${sessionId})`);
  }
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

    if (type === "checkout.session.completed") {
      if (session?.payment_status === "paid" && installmentIds.length) {
        await markPaid(installmentIds, session.id);
      } else {
        // SEPA & co : le débit est en cours, async_payment_succeeded suivra.
        console.log(`[stripe-webhook] session ${session?.id} completed, payment ${session?.payment_status} — waiting`);
      }
    } else if (type === "checkout.session.async_payment_succeeded") {
      if (installmentIds.length) await markPaid(installmentIds, session.id);
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
