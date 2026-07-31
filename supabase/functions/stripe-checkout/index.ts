// Stripe Checkout — bouton "Pay" de la guest area.
// { installment_ids: [uuid, ...] } (ou installment_id unique, rétro-compatible)
// -> crée UNE Checkout Session Stripe couvrant les échéances (une ligne par
// échéance, montants TVAC, EUR) et renvoie l'URL de paiement.
// Toutes les échéances doivent appartenir au même booking. Le webhook marque
// ensuite toutes les échéances payées et stocke le stripe_session_id commun
// (-> une seule fatura-recibo à plusieurs lignes).
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

const BodySchema = z.object({
  installment_id: z.string().uuid().optional(),
  installment_ids: z.array(z.string().uuid()).min(1).max(10).optional(),
});

const PROD_ORIGIN = "https://guest.quintamor.com";
const ALLOWED_ORIGINS = new Set([
  PROD_ORIGIN,
  "https://quinta-guest-area.vercel.app",
  "http://localhost:5173",
  "http://localhost:8080",
]);
const CHECKOUT_IMAGE = `${PROD_ORIGIN}/checkout-quinta.jpg`;

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

// Lien de paiement des emails : GET ?installment=<uuid>&t=<HMAC tronqué>.
// Signé avec cron_key (app_settings.internal) par payment-emails. À chaque clic,
// une session Stripe FRAÎCHE est créée (les sessions expirent en 24 h, le lien
// email doit rester valable des semaines) puis redirection vers Stripe.
async function expectedToken(installmentId: string): Promise<string> {
  const { data } = await admin.from("app_settings").select("value").eq("key", "internal").maybeSingle();
  const secret = (data?.value as Record<string, string> | null)?.cron_key;
  if (!secret) throw new Error("CRON_KEY_MISSING");
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`pay:${installmentId}`));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

function redirect(url: string) {
  return new Response(null, { status: 302, headers: { Location: url } });
}

// Le virement bancaire (customer_balance) exige un Customer Stripe :
// on le retrouve par email, sinon on le crée.
async function getOrCreateCustomer(key: string, email: string): Promise<string | null> {
  try {
    const q = await fetch(`https://api.stripe.com/v1/customers?email=${encodeURIComponent(email)}&limit=1`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const qb = await q.json();
    if (q.ok && qb.data?.[0]?.id) return qb.data[0].id;
    const c = await fetch("https://api.stripe.com/v1/customers", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email }).toString(),
    });
    const cb = await c.json();
    return c.ok ? (cb.id ?? null) : null;
  } catch (_e) {
    return null;
  }
}

async function createSession(
  insts: { id: string; label: string | null; amount_due: number }[],
  booking: { id: string; email: string | null; retreat_name: string | null; check_in_date: string | null; check_out_date: string | null },
  successUrl: string,
  cancelUrl: string,
) {
  const key = await stripeKey();
  const stay = booking.check_in_date && booking.check_out_date
    ? `Stay ${booking.check_in_date} → ${booking.check_out_date} · ${booking.retreat_name || "Quinta do Amor"}`
    : (booking.retreat_name || "Quinta do Amor");

  const params = new URLSearchParams();
  params.set("mode", "payment");

  // Ordre voulu : rails les moins chers d'abord, carte en dernier recours.
  // SEPA (~6 € plafonnés) · Virement bancaire (~5 € plafonnés, IBAN virtuel,
  // réconciliation auto) · Bancontact (clientèle belge, < carte) · Carte · Link.
  // Le virement (customer_balance) exige un Customer Stripe — si sa création
  // échoue, on retire juste ce rail de la session.
  const customerId = booking.email ? await getOrCreateCustomer(key, booking.email) : null;
  const types = customerId
    ? ["sepa_debit", "customer_balance", "bancontact", "card", "link"]
    : ["sepa_debit", "bancontact", "card", "link"];
  types.forEach((t, i) => params.set(`payment_method_types[${i}]`, t));
  if (customerId) {
    params.set("customer", customerId);
    params.set("payment_method_options[customer_balance][funding_type]", "bank_transfer");
    params.set("payment_method_options[customer_balance][bank_transfer][type]", "eu_bank_transfer");
    params.set("payment_method_options[customer_balance][bank_transfer][eu_bank_transfer][country]", "FR");
  }
  insts.forEach((inst, idx) => {
    const cents = Math.round(Number(inst.amount_due) * 100);
    const name = `${inst.label || "Payment"} — ${booking.retreat_name || "Quinta do Amor"}`;
    params.set(`line_items[${idx}][quantity]`, "1");
    params.set(`line_items[${idx}][price_data][currency]`, "eur");
    params.set(`line_items[${idx}][price_data][unit_amount]`, String(cents));
    params.set(`line_items[${idx}][price_data][product_data][name]`, name.slice(0, 250));
    params.set(`line_items[${idx}][price_data][product_data][description]`, stay.slice(0, 250));
    params.set(`line_items[${idx}][price_data][product_data][images][0]`, CHECKOUT_IMAGE);
  });
  const idsCsv = insts.map((i) => i.id).join(",");
  params.set("client_reference_id", insts[0].id);
  params.set("metadata[installment_ids]", idsCsv);
  params.set("metadata[booking_id]", booking.id);
  params.set("payment_intent_data[metadata][installment_ids]", idsCsv);
  params.set("payment_intent_data[description]",
    `${booking.retreat_name || "Quinta do Amor"} — ${insts.map((i) => i.label).join(" + ")}`.slice(0, 250));
  // customer et customer_email sont mutuellement exclusifs chez Stripe
  if (!customerId && booking.email) params.set("customer_email", booking.email);
  params.set("success_url", successUrl);
  params.set("cancel_url", cancelUrl);

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const session = await res.json();
  if (!res.ok) {
    console.error("Stripe error:", JSON.stringify(session).slice(0, 500));
    throw new Error(session?.error?.message ?? `Stripe HTTP ${res.status}`);
  }
  return { session, test_mode: key.startsWith("sk_test_") };
}

async function handlePayLink(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const installmentId = url.searchParams.get("installment") ?? "";
  const token = url.searchParams.get("t") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(installmentId) || !token) {
    return redirect(`${PROD_ORIGIN}/payment-success?payment=invalid`);
  }
  const expected = await expectedToken(installmentId);
  if (token !== expected) return redirect(`${PROD_ORIGIN}/payment-success?payment=invalid`);

  const { data: inst } = await admin.from("payment_installments")
    .select("id,booking_id,label,amount_due,category,status,is_cash")
    .eq("id", installmentId).maybeSingle();
  if (!inst) return redirect(`${PROD_ORIGIN}/payment-success?payment=invalid`);
  if (inst.status === "paid") return redirect(`${PROD_ORIGIN}/payment-success?payment=already`);
  if (inst.is_cash || inst.category === "discount" || !(Number(inst.amount_due) > 0)) {
    return redirect(`${PROD_ORIGIN}/payment-success?payment=invalid`);
  }
  const { data: booking } = await admin.from("bookings")
    .select("id,email,retreat_name,check_in_date,check_out_date")
    .eq("id", inst.booking_id).maybeSingle();
  if (!booking) return redirect(`${PROD_ORIGIN}/payment-success?payment=invalid`);

  const { session } = await createSession(
    [inst], booking,
    `${PROD_ORIGIN}/payment-success?payment=success`,
    `${PROD_ORIGIN}/payment-success?payment=cancelled`,
  );
  return redirect(session.url);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    // Lien de paiement signé (clic depuis un email) — pas de JWT.
    if (req.method === "GET") return await handlePayLink(req);

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
    const ids = parsed.data.installment_ids ?? (parsed.data.installment_id ? [parsed.data.installment_id] : []);
    if (ids.length === 0) return json({ error: "installment_ids required" }, 400);

    // Échéances (dédupliquées) + validations
    const uniqueIds = [...new Set(ids)];
    const { data: insts, error: instErr } = await admin.from("payment_installments")
      .select("id,booking_id,label,amount_due,category,status,is_cash")
      .in("id", uniqueIds);
    if (instErr) throw instErr;
    if (!insts || insts.length !== uniqueIds.length) return json({ error: "Installment not found" }, 404);

    const bookingIds = new Set(insts.map((i) => i.booking_id));
    if (bookingIds.size !== 1) return json({ error: "All payments must belong to the same booking" }, 400);
    for (const inst of insts) {
      if (inst.status === "paid") return json({ error: `"${inst.label}" is already settled` }, 400);
      if (inst.is_cash) return json({ error: `"${inst.label}" is a cash payment — not payable online` }, 400);
      if (inst.category === "discount" || !(Number(inst.amount_due) > 0)) {
        return json({ error: `"${inst.label}" is not payable online` }, 400);
      }
    }

    const { data: booking, error: bErr } = await admin.from("bookings")
      .select("id,user_id,email,retreat_name,first_name,check_in_date,check_out_date")
      .eq("id", insts[0].booking_id).maybeSingle();
    if (bErr) throw bErr;
    if (!booking) return json({ error: "Booking not found" }, 404);

    const userEmail = (user.email ?? "").toLowerCase().trim();
    const owns = booking.user_id === user.id
      || (!!booking.email && booking.email.toLowerCase().trim() === userEmail);
    if (!owns && !(await isAdminEmailDb(user.email))) return json({ error: "Forbidden" }, 403);

    // Origin de retour : celui de la requête s'il est connu, sinon prod.
    const reqOrigin = req.headers.get("Origin") ?? "";
    const origin = ALLOWED_ORIGINS.has(reqOrigin) ? reqOrigin : PROD_ORIGIN;

    const { session, test_mode } = await createSession(
      insts, booking,
      `${origin}/dashboard?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      `${origin}/dashboard?payment=cancelled`,
    );
    return json({ url: session.url, session_id: session.id, test_mode });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    console.error("stripe-checkout error:", msg);
    return json({ error: msg }, 500);
  }
});
