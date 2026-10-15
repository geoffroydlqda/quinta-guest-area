// Sonde Stripe interne (lecture seule côté argent) — auth x-cron-key.
// { funding_instructions: { customer: "cus_..." } } -> POST
// /v1/customers/:id/funding_instructions (eu_bank_transfer IE, EUR) et
// renvoie l'IBAN virtuel + BIC + référence. Idempotent côté Stripe (le même
// IBAN est renvoyé à chaque appel). Aucun mouvement d'argent.
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

serve(async (req) => {
  try {
    const { data: settings } = await admin.from("app_settings").select("value").eq("key", "internal").maybeSingle();
    const vals = (settings?.value ?? {}) as Record<string, string>;
    const cronKey = vals.cron_key;
    if (!cronKey || req.headers.get("x-cron-key") !== cronKey) return json({ error: "Unauthorized" }, 401);
    const stripeKey = vals.stripe_secret_key;
    if (!stripeKey) return json({ error: "STRIPE_KEY_MISSING" }, 500);

    const body = await req.json().catch(() => ({}));
    const fi = (body as { funding_instructions?: { customer?: string } }).funding_instructions;
    if (fi?.customer) {
      const params = new URLSearchParams();
      params.set("funding_type", "bank_transfer");
      params.set("bank_transfer[type]", "eu_bank_transfer");
      params.set("bank_transfer[eu_bank_transfer][country]", "IE");
      params.set("currency", "eur");
      const r = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(fi.customer)}/funding_instructions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      const data = await r.json();
      if (!r.ok) return json({ error: data?.error?.message ?? "stripe error", status: r.status }, 502);
      // On ne renvoie que l'adresse financière (info visible guest), pas l'objet brut.
      const addrs = (data?.bank_transfer?.financial_addresses ?? []) as Array<Record<string, unknown>>;
      return json({ funding_type: data?.funding_type, currency: data?.currency, financial_addresses: addrs });
    }
    return json({ error: "No action" }, 400);
  } catch (e) {
    console.error("stripe-probe error:", String((e as Error)?.message ?? e));
    return json({ error: "Internal error" }, 500);
  }
});
