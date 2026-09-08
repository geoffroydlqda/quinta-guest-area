// translate-text — traduction utilitaire (8 sept 2026).
// Usage actuel : le PDF du plan de chambres côté Housekeeping traduit les room
// setup remarks (texte libre du guest, souvent en anglais) en portugais pour
// l'équipe de ménage. Auth : JWT admin. Best-effort côté client : en cas
// d'erreur, l'appelant garde le texte original.
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
  text: z.string().min(1).max(4000),
  target: z.enum(["pt", "en", "fr"]).default("pt"),
});

const TARGET_NAME: Record<string, string> = { pt: "European Portuguese", en: "English", fr: "French" };

async function isAdminEmailDb(email?: string | null): Promise<boolean> {
  if (!email) return false;
  const { data } = await admin.from("admin_users").select("email").eq("email", email.toLowerCase().trim()).maybeSingle();
  return !!data;
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
    if (!user || !(await isAdminEmailDb(user.email))) return json({ error: "Forbidden" }, 403);

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);

    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "ANTHROPIC_API_KEY secret is not set" }, 500);

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 1500,
        messages: [{
          role: "user",
          content: `Translate the following text to ${TARGET_NAME[parsed.data.target]}. Keep line breaks, names, room numbers and quantities exactly as they are. Reply with ONLY the translation, no preamble.\n\n${parsed.data.text}`,
        }],
      }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: `Anthropic API ${r.status}: ${JSON.stringify(body).slice(0, 200)}` }, 502);
    const out = (body?.content ?? []).map((c: { text?: string }) => c.text ?? "").join("").trim();
    if (!out) return json({ error: "Empty translation" }, 502);
    return json({ text: out });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
