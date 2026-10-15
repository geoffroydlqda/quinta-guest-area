// QR EPC de virement SEPA (v2, 15 oct 2026 — choix Geoffroy : préremplir le
// virement dans l'app bancaire plutôt qu'ouvrir le checkout Stripe).
// GET ?installment=<uuid>&t=<HMAC>  ou  ?installments=<a,b,...>&t=<HMAC>
// (MÊME token signé que le bouton Pay — aucun nouveau secret).
// Rend un PNG au standard EPC069-12 (Girocode) : scanné depuis le SCANNER DE
// L'APP BANCAIRE (pas l'appareil photo), le virement arrive prérempli —
// bénéficiaire Grupo OHM, IBAN virtuel Stripe du customer (stable, obtenu via
// l'API Funding Instructions), montant = total restant dû des échéances du
// lien, libellé = événement + échéances. L'argent atterrit sur le solde
// client Stripe ; stripe-webhook (customer_cash_balance_transaction.created)
// le rapproche des échéances et déclenche fatura + confirmation.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import QRCode from "npm:qrcode@1.5.4";

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

async function internalVals(): Promise<Record<string, string>> {
  const { data } = await admin.from("app_settings").select("value").eq("key", "internal").maybeSingle();
  return (data?.value ?? {}) as Record<string, string>;
}

async function expectedToken(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`pay:${payload}`));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

function hexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Customer Stripe par email (même logique que stripe-checkout) puis IBAN
// virtuel via Funding Instructions (idempotent : IBAN stable par customer).
async function virtualIban(stripeKey: string, email: string): Promise<{ iban: string; bic: string; holder: string } | null> {
  try {
    let customerId: string | null = null;
    const q = await fetch(`https://api.stripe.com/v1/customers?email=${encodeURIComponent(email)}&limit=1`, {
      headers: { Authorization: `Bearer ${stripeKey}` },
    });
    const qb = await q.json();
    if (q.ok && qb.data?.[0]?.id) customerId = qb.data[0].id;
    if (!customerId) {
      const c = await fetch("https://api.stripe.com/v1/customers", {
        method: "POST",
        headers: { Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ email }).toString(),
      });
      const cb = await c.json();
      if (c.ok) customerId = cb.id ?? null;
    }
    if (!customerId) return null;
    const params = new URLSearchParams();
    params.set("funding_type", "bank_transfer");
    params.set("bank_transfer[type]", "eu_bank_transfer");
    params.set("bank_transfer[eu_bank_transfer][country]", "IE");
    params.set("currency", "eur");
    const r = await fetch(`https://api.stripe.com/v1/customers/${customerId}/funding_instructions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const data = await r.json();
    if (!r.ok) return null;
    const addr = (data?.bank_transfer?.financial_addresses ?? []).find((a: { type?: string }) => a?.type === "iban");
    const iban = addr?.iban?.iban as string | undefined;
    if (!iban) return null;
    return { iban, bic: String(addr.iban.bic ?? ""), holder: String(addr.iban.account_holder_name ?? "Grupo OHM") };
  } catch (_e) {
    return null;
  }
}

// Libellé de virement : latin basique, 140 caractères max (EPC remittance).
const cleanRemittance = (s: string) =>
  s.replace(/[—–]/g, "-").replace(/[’‘]/g, "'").replace(/[^\x20-\x7E\xC0-\xFF]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, 140);

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const one = url.searchParams.get("installment");
    const many = url.searchParams.get("installments");
    const t = url.searchParams.get("t") ?? "";
    const ids = (many ?? one ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!ids.length || !t) return new Response("Missing parameters", { status: 400 });

    const vals = await internalVals();
    if (!vals.cron_key || !vals.stripe_secret_key) return new Response("Config missing", { status: 500 });
    // Même convention de signature que stripe-checkout / payment-emails :
    // un id seul = l'id ; groupé = ids TRIÉS joints par virgule.
    const signPayload = many != null ? [...ids].sort().join(",") : ids[0];
    if (!hexEqual(t, await expectedToken(signPayload, vals.cron_key))) {
      return new Response("Invalid token", { status: 403 });
    }

    const { data: instsData } = await admin.from("payment_installments")
      .select("id,booking_id,label,amount_due,category,status,is_cash,processing_since")
      .in("id", ids);
    const insts = instsData ?? [];
    if (insts.length !== ids.length) return new Response("Not found", { status: 404 });
    if (new Set(insts.map((i) => i.booking_id)).size !== 1) return new Response("Not found", { status: 404 });
    // Montant = ce qui reste réellement dû sur ce lien (mêmes règles que le
    // bouton Pay) : payé / en cours (processing) / cash / discount exclus.
    const payable = insts.filter((i) =>
      i.status !== "paid" && !i.processing_since && !i.is_cash && i.category !== "discount" && Number(i.amount_due) > 0);
    if (!payable.length) return new Response("Nothing left to pay on this link", { status: 410 });
    const amount = Math.round(payable.reduce((s, i) => s + Number(i.amount_due || 0), 0) * 100) / 100;

    const { data: booking } = await admin.from("bookings")
      .select("id,email,retreat_name,is_test")
      .eq("id", payable[0].booking_id).maybeSingle();
    if (!booking?.email || booking.is_test) return new Response("Not found", { status: 404 });

    const acct = await virtualIban(vals.stripe_secret_key, booking.email);
    if (!acct) return new Response("Bank details unavailable", { status: 502 });

    const remittance = cleanRemittance(
      `Quinta do Amor - ${booking.retreat_name ?? ""} - ${payable.map((i) => i.label || "payment").join(" + ")}`
    );
    // EPC069-12 (Girocode), version 002 : BIC optionnel en EEE mais fourni.
    const payload = [
      "BCD", "002", "1", "SCT",
      acct.bic, acct.holder, acct.iban,
      `EUR${amount.toFixed(2)}`,
      "",            // purpose
      "",            // référence structurée (vide -> libellé libre)
      remittance,    // libellé libre
      "",            // information bénéficiaire
    ].join("\n");

    const png: Uint8Array = await QRCode.toBuffer(payload, {
      type: "png",
      errorCorrectionLevel: "M",
      margin: 2,
      width: 480,
      color: { dark: "#222222", light: "#FFFFFF" },
    });
    return new Response(png, {
      headers: {
        "Content-Type": "image/png",
        // Le montant restant peut évoluer (lien groupé payé en partie) :
        // cache court.
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (e) {
    console.error("payment-qr error:", String((e as Error)?.message ?? e));
    return new Response("Internal error", { status: 500 });
  }
});
