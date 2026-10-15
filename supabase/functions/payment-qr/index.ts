// QR code du lien de paiement (15 oct 2026) — image PNG servie aux emails
// de demande de paiement : le guest scanne avec l'appareil photo de son
// téléphone, le lien ouvre le checkout Stripe (mêmes params signés que le
// bouton Pay — session fraîche à chaque scan, comme au clic).
// GET ?installment=<uuid>&t=<HMAC>  ou  ?installments=<a,b,...>&t=<HMAC>
// Le token est le MÊME que celui du bouton Pay (HMAC cron_key, préfixe pay:,
// groupé = ids triés joints par virgule) — aucun nouveau secret, aucune
// donnée exposée : l'image ne contient que l'URL déjà présente dans l'email.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import QRCode from "npm:qrcode@1.5.4";

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);
const FUNCTIONS_BASE = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;

async function expectedToken(payload: string): Promise<string> {
  const { data } = await admin.from("app_settings").select("value").eq("key", "internal").maybeSingle();
  const secret = (data?.value as Record<string, string> | null)?.cron_key;
  if (!secret) throw new Error("CRON_KEY_MISSING");
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

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const one = url.searchParams.get("installment");
    const many = url.searchParams.get("installments");
    const t = url.searchParams.get("t") ?? "";
    const ids = (many ?? one ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!ids.length || !t) return new Response("Missing parameters", { status: 400 });
    // Même convention de signature que stripe-checkout / payment-emails :
    // un id seul = l'id ; groupé = ids TRIÉS joints par virgule.
    const signPayload = many != null ? [...ids].sort().join(",") : ids[0];
    const exp = await expectedToken(signPayload);
    if (!hexEqual(t, exp)) return new Response("Invalid token", { status: 403 });

    const target = many != null
      ? `${FUNCTIONS_BASE}/stripe-checkout?installments=${ids.join(",")}&t=${t}`
      : `${FUNCTIONS_BASE}/stripe-checkout?installment=${ids[0]}&t=${t}`;

    const png: Uint8Array = await QRCode.toBuffer(target, {
      type: "png",
      errorCorrectionLevel: "M",
      margin: 2,
      width: 480,
      color: { dark: "#222222", light: "#FFFFFF" },
    });
    return new Response(png, {
      headers: {
        "Content-Type": "image/png",
        // Le token ne change pas pour une échéance donnée : cacheable.
        "Cache-Control": "public, max-age=604800",
      },
    });
  } catch (e) {
    console.error("payment-qr error:", String((e as Error)?.message ?? e));
    return new Response("Internal error", { status: 500 });
  }
});
