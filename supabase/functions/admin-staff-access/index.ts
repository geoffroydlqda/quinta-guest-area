// Gestion des accès admin depuis l'onglet Staff (7 août 2026).
// admin_users est verrouillée (RLS sans policy) : ce endpoint est le seul
// chemin d'écriture. Actions (JWT admin requis) :
//   {action:"list"}                  -> { admins: [emails] }
//   {action:"grant",  email}         -> ajoute l'email à admin_users
//   {action:"revoke", email}         -> retire l'email (jamais le owner, jamais soi-même)
// Depuis le Sprint 1, AdminGuard interroge aussi la base (check_is_admin_email) :
// un grant prend effet sans modifier src/lib/admin.ts (liste cosmétique).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

const OWNER_EMAIL = "hello@quintamor.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const norm = (e: string) => e.normalize("NFC").toLowerCase().trim();

const BodySchema = z.object({
  action: z.enum(["list", "grant", "revoke"]),
  email: z.string().email().max(255).optional(),
});

async function adminEmails(): Promise<string[]> {
  const { data } = await admin.from("admin_users").select("email");
  return (data ?? []).map((r: { email: string }) => norm(r.email));
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
    const callerEmail = norm(user?.email ?? "");
    const admins = await adminEmails();
    if (!user || !admins.includes(callerEmail)) return json({ error: "Forbidden" }, 403);

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
    const { action } = parsed.data;

    if (action === "list") return json({ admins });

    const email = norm(parsed.data.email ?? "");
    if (!email) return json({ error: "email required" }, 400);

    if (action === "grant") {
      if (admins.includes(email)) return json({ ok: true, admins });
      const { error } = await admin.from("admin_users").insert({ email });
      if (error) return json({ error: error.message }, 500);
      console.log(`[staff-access] ${callerEmail} granted admin to ${email}`);
      return json({ ok: true, admins: [...admins, email] });
    }

    // revoke — garde-fous : jamais le owner, jamais soi-même
    if (email === OWNER_EMAIL) return json({ error: "The owner account cannot be revoked." }, 400);
    if (email === callerEmail) return json({ error: "You cannot revoke your own admin access." }, 400);
    const { error } = await admin.from("admin_users").delete().eq("email", email);
    if (error) return json({ error: error.message }, 500);
    console.log(`[staff-access] ${callerEmail} revoked admin from ${email}`);
    return json({ ok: true, admins: admins.filter((a) => a !== email) });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    console.error("admin-staff-access error:", msg);
    return json({ error: msg }, 500);
  }
});
