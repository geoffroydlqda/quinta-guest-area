// Barre IA de l'onglet Tasks (26 nov 2026, demande Geoffroy) : transforme un
// texte libre — tapé ou dicté (la reconnaissance vocale se fait côté
// navigateur, Web Speech API) — en liste de tâches structurées via Claude.
// Auth : JWT admin (admin_users). Ne CRÉE rien en base — renvoie les tâches
// parsées, le front les montre en aperçu et les insère après confirmation.
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

const BodySchema = z.object({
  text: z.string().min(3).max(4000),
  context: z.object({
    areas: z.array(z.string().max(80)).max(50).default([]),
    categories: z.array(z.string().max(80)).max(50).default([]),
    assignees: z.array(z.string().max(40)).max(10).default([]),
    today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    property: z.string().max(20).default("quinta"),
  }),
});

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

// Extraction robuste du premier objet JSON de la réponse du modèle
function firstJson(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) throw new Error(`No JSON in model output: ${text.slice(0, 200)}`);
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") { depth--; if (depth === 0) return JSON.parse(text.slice(start, i + 1)); }
  }
  throw new Error(`Unbalanced JSON in model output: ${text.slice(0, 200)}`);
}

const PRIORITIES = new Set(["low", "medium", "high"]);
const REPEATS = new Set(["none", "weekly", "monthly", "quarterly", "yearly"]);

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
    const { text, context } = parsed.data;

    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "ANTHROPIC_API_KEY secret is not set" }, 500);

    const prompt = `You turn a free-form note (typed or dictated, in French or English) into a structured task list for the admin tool of a retreat venue.

Today is ${context.today}. Current property: ${context.property}.
Existing areas (physical places): ${context.areas.join(", ") || "(none yet)"}
Existing categories (task types): ${context.categories.join(", ") || "(none yet)"}
People who can be assigned: ${context.assignees.join(", ") || "(none)"}

Rules:
- Split the note into individual actionable tasks. Title: concise, imperative, in the language of the note (dictation artifacts cleaned up).
- area: one of the existing areas when clearly implied; a NEW short name only if the note names a physical place not in the list; else null.
- category: one of the existing categories ONLY if clearly implied; else null.
- priority: "high" | "medium" | "low" — default "medium"; urgent/important/asap → "high"; someday/low → "low".
- due_date: "YYYY-MM-DD" if the note gives a date or relative date (resolve against today, weeks start Monday); else null.
- repeats: "none" | "weekly" | "monthly" | "quarterly" | "yearly" — default "none"; "every week/month/..." → the matching value.
- assignee: EXACTLY one of the listed people if the note says who does it (match loosely: "Loïs"/"Lois", "Geo"/"Geoffroy", "Luis"); else null.
- notes: extra details that do not fit the title; else null.

Note to convert:
"""
${text}
"""

Return ONLY a JSON object, nothing else:
{"tasks":[{"title":"...","area":null,"category":null,"priority":"medium","due_date":null,"repeats":"none","assignee":null,"notes":null}]}`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-haiku-4-5", max_tokens: 3000, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await r.json();
    if (!r.ok) return json({ error: `Anthropic ${r.status}: ${JSON.stringify(data).slice(0, 200)}` }, 502);
    const textOut = (data?.content ?? []).map((c: { text?: string }) => c.text ?? "").join("");
    const out = firstJson(textOut) as { tasks?: unknown };
    const rawTasks = Array.isArray(out?.tasks) ? out.tasks : [];

    const tasks = rawTasks.slice(0, 30).flatMap((t) => {
      const o = t as Record<string, unknown>;
      const title = String(o.title ?? "").trim().slice(0, 200);
      if (!title) return [];
      const clean = (v: unknown, max = 80) => {
        const s = v == null ? "" : String(v).trim();
        return s ? s.slice(0, max) : null;
      };
      const due = clean(o.due_date, 10);
      return [{
        title,
        area: clean(o.area),
        category: clean(o.category),
        priority: PRIORITIES.has(String(o.priority)) ? String(o.priority) : "medium",
        due_date: due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
        repeats: REPEATS.has(String(o.repeats)) ? String(o.repeats) : "none",
        assignee: clean(o.assignee, 40),
        notes: clean(o.notes, 500),
      }];
    });

    return json({ tasks });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    console.error("tasks-ai error:", msg);
    return json({ error: msg }, 500);
  }
});
