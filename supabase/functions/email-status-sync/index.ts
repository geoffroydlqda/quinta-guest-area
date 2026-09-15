// Rafraichit le statut de livraison/ouverture des emails envoyes (15 sept 2026).
// Appele a la demande depuis l'onglet Emails -> Sent (JWT admin). Pour chaque
// ligne de reminder_log / email_rule_log qui porte un resend_id et dont le
// dernier statut connu n'est pas terminal, on interroge GET /emails/{id} de
// l'API Resend et on stocke last_event (+ opened_at au premier opened/clicked).
// ⚠️ Les ouvertures ne remontent que si l'open tracking est active dans le
// dashboard Resend pour le domaine quintamor.com ; sinon last_event s'arrete
// a "delivered". Les emails anterieurs au 15 sept 2026 n'ont pas de resend_id.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function isAdminEmailDb(email?: string | null): Promise<boolean> {
  if (!email) return false;
  const { data } = await admin.from("admin_users").select("email");
  return (data ?? []).map((r: { email: string }) => String(r.email).toLowerCase().trim())
    .includes(email.toLowerCase().trim());
}

const BodySchema = z.object({
  days: z.number().int().min(1).max(365).optional(),
});

// Statuts terminaux : plus rien a rafraichir apres ca.
const TERMINAL = new Set(["opened", "clicked", "bounced", "complained"]);

type Row = { id: string; resend_id: string; last_event: string | null };

async function refreshTable(table: "reminder_log" | "email_rule_log", sinceIso: string) {
  const { data, error } = await admin.from(table)
    .select("id, resend_id, last_event")
    .not("resend_id", "is", null)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(120);
  if (error) throw new Error(`${table}: ${error.message}`);

  let checked = 0, updated = 0;
  for (const row of (data ?? []) as Row[]) {
    if (row.last_event && TERMINAL.has(row.last_event)) continue;
    checked++;
    try {
      const res = await fetch(`https://api.resend.com/emails/${row.resend_id}`, {
        headers: { Authorization: `Bearer ${RESEND_KEY}` },
      });
      if (!res.ok) continue; // 404 = email trop ancien cote Resend, on ignore
      const info = await res.json() as { last_event?: string };
      const ev = info.last_event ?? null;
      if (ev && ev !== row.last_event) {
        const patch: Record<string, unknown> = { last_event: ev };
        if (ev === "opened" || ev === "clicked") patch.opened_at = new Date().toISOString();
        const { error: upErr } = await admin.from(table).update(patch).eq("id", row.id);
        if (!upErr) updated++;
      }
    } catch (e) {
      console.error(`[email-status-sync] ${table} ${row.resend_id}:`, String(e));
    }
  }
  return { checked, updated };
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

    if (!RESEND_KEY) return json({ error: "RESEND_API_KEY not configured" }, 500);

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
    const days = parsed.data.days ?? 60;
    const sinceIso = new Date(Date.now() - days * 86400_000).toISOString();

    const a = await refreshTable("reminder_log", sinceIso);
    const b = await refreshTable("email_rule_log", sinceIso);
    return json({ ok: true, reminder_log: a, email_rule_log: b });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    console.error("[email-status-sync] error:", msg);
    return json({ error: msg }, 500);
  }
});
