// Stripe Checkout — bouton "Pay" de la guest area.
// { installment_id } -> crée une Checkout Session Stripe pour l'échéance
// (montant TVAC, EUR) et renvoie l'URL de paiement hébergée par Stripe.
// Accessible au guest propriétaire du booking (user_id ou email) et aux admins.
// Clé API : app_settings key='internal'.stripe_secret_key (service role only).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const BodySchema = z.object({ installment_id: z.string().uuid() });

const PROD_ORIGIN = "https://guest.quintamor.com";
const ALLOWED_ORIGINS = new Set([
  PROD_ORIGIN,
  "https://quinta-guest-area.vercel.app",
  "http://localhost:5173",
  "http://localhost:8080",
]);

async function stripeKey(): Promise<string> {
  const { data } = await admin.from("app_settings").select("value").eq("key", "internal").maybeSingle();
  const key = (data?.value as Record<string, string> | null)?.stripe_secret_key;
  if (!key) throw new Error("STRIPE_KEY_MISSING");
  return key;
}

async function isAdminEmailDb(email?: string | null): Promise<boolean> {
  if (!email) return false;
  const { data } = await admin.from("admin_users").select("email");
  const emails = (data ?? []).map((r: { email: string }) => String(r.email).toLowerCase().trim());
  return emails.includes(email.toLowerCase().trim());
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
    const { installment_id } = parsed.data;

    // Échéance + booking
    const { data: inst, error: instErr } = await admin.from("payment_installments")
      .select("id,booking_id,label,amount_due,category,status,is_cash")
      .eq("id", installment_id).maybeSingle();
    if (instErr) throw instErr;
    if (!inst) return json({ error: "Installment not found" }, 404);
    if (inst.status === "paid") return json({ error: "This payment is already settled" }, 400);
    if (inst.is_cash) return json({ error: "Cash payment — not payable online" }, 400);
    if (inst.category === "discount" || !(Number(inst.amount_due) > 0)) {
      return json({ error: "This line is not payable online" }, 400);
    }

    const { data: booking, error: bErr } = await admin.from("bookings")
      .select("id,user_id,email,retreat_name,first_name,check_in_date,check_out_date")
      .eq("id", inst.booking_id).maybeSingle();
    if (bErr) throw bErr;
    if (!booking) return json({ error: "Booking not found" }, 404);

    const userEmail = (user.email ?? "").toLowerCase().trim();
    const owns = booking.user_id === user.id
      || (!!booking.email && booking.email.toLowerCase().trim() === userEmail);
    if (!owns && !(await isAdminEmailDb(user.email))) return json({ error: "Forbidden" }, 403);

    // Origin de retour : celui de la requête s'il est connu, sinon prod.
    const reqOrigin = req.headers.get("Origin") ?? "";
    const origin = ALLOWED_ORIGINS.has(reqOrigin) ? reqOrigin : PROD_ORIGIN;

    const key = await stripeKey();
    const cents = Math.round(Number(inst.amount_due) * 100);
    const name = `${inst.label || "Payment"} — ${booking.retreat_name || "Quinta do Amor"}`;
    const stay = booking.check_in_date && booking.check_out_date
      ? `Stay ${booking.check_in_date} → ${booking.check_out_date}`
      : "Quinta do Amor";

    const params = new URLSearchParams();
    params.set("mode", "payment");
    // Moyens de paiement maîtrisés (frais minimaux) : carte (+ Apple/Google Pay
    // automatiques), prélèvement SEPA (~6 € plafonnés), Link (tarif carte).
    // Pas de Klarna/BNPL ni de méthodes locales non pertinentes.
    params.set("payment_method_types[0]", "card");
    params.set("payment_method_types[1]", "sepa_debit");
    params.set("payment_method_types[2]", "link");
    params.set("line_items[0][quantity]", "1");
    params.set("line_items[0][price_data][currency]", "eur");
    params.set("line_items[0][price_data][unit_amount]", String(cents));
    params.set("line_items[0][price_data][product_data][name]", name.slice(0, 250));
    params.set("line_items[0][price_data][product_data][description]", stay.slice(0, 250));
    params.set("client_reference_id", inst.id);
    params.set("metadata[installment_id]", inst.id);
    params.set("metadata[booking_id]", booking.id);
    params.set("payment_intent_data[metadata][installment_id]", inst.id);
    params.set("payment_intent_data[description]", name.slice(0, 250));
    if (booking.email) params.set("customer_email", booking.email);
    params.set("success_url", `${origin}/dashboard?payment=success&session_id={CHECKOUT_SESSION_ID}`);
    params.set("cancel_url", `${origin}/dashboard?payment=cancelled`);

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const session = await res.json();
    if (!res.ok) {
      console.error("Stripe error:", JSON.stringify(session).slice(0, 500));
      return json({ error: session?.error?.message ?? `Stripe HTTP ${res.status}` }, 502);
    }

    return json({ url: session.url, session_id: session.id, test_mode: key.startsWith("sk_test_") });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    console.error("stripe-checkout error:", msg);
    return json({ error: msg }, 500);
  }
});
