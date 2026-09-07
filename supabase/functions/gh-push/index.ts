// gh-push — relais de déploiement GitHub (7 sept 2026).
// Pourquoi : l'environnement des sessions Claude ne peut pas toujours pousser
// directement sur github.com (proxy git). Cette fonction crée un commit sur
// main via l'API GitHub (Git Data API) depuis Supabase, dont l'egress est
// libre. Le token vit dans app_settings.internal.github_pat (fine-grained PAT
// limité à ce repo, contents read/write) — jamais dans le code ni le repo.
//
// Auth : header x-cron-key = app_settings.internal.cron_key (appels internes).
// Entrées :
//   { ping: true }  -> vérifie token + renvoie le sha de main (test sans écrire)
//   { message, files: [{ path, content_b64 }] } -> UN commit sur main avec ces
//     fichiers (création ou remplacement ; ~40 fichiers max, gros binaires OK).
//   Variante : { path, blob_sha } référence un blob git DÉJÀ présent dans le
//   repo (sha calculable localement via `git hash-object`) — évite de
//   retéléverser un gros fichier qui existe ailleurs dans l'historique.
// Sortie : { sha, url } du commit créé.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

const REPO = "geoffroydlqda/quinta-guest-area";
const API = "https://api.github.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const BodySchema = z.object({
  ping: z.boolean().optional(),
  message: z.string().min(1).max(2000).optional(),
  branch: z.string().min(1).max(100).default("main"),
  files: z.array(z.object({
    path: z.string().min(1).max(500).refine((p) => !p.startsWith("/") && !p.includes(".."), "path must be repo-relative"),
    content_b64: z.string().min(1).max(30_000_000).optional(),
    blob_sha: z.string().regex(/^[0-9a-f]{40}$/).optional(),
  }).refine((f) => !!f.content_b64 !== !!f.blob_sha, "exactly one of content_b64 or blob_sha")).min(1).max(40).optional(),
});

async function internalSettings(): Promise<{ cronKey: string; token: string }> {
  const { data } = await admin.from("app_settings").select("value").eq("key", "internal").maybeSingle();
  const v = (data?.value ?? {}) as Record<string, string>;
  if (!v.cron_key) throw new Error("cron_key missing");
  if (!v.github_pat) throw new Error("github_pat missing in app_settings.internal");
  return { cronKey: v.cron_key, token: v.github_pat };
}

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "quinta-gh-push",
    "Content-Type": "application/json",
  };
}

async function gh(token: string, method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: ghHeaders(token),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`GitHub ${method} ${path} -> ${res.status}: ${JSON.stringify(out).slice(0, 300)}`);
  }
  return out as Record<string, unknown>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const settings = await internalSettings();
    if (req.headers.get("x-cron-key") !== settings.cronKey) {
      return json({ error: "Unauthorized" }, 401);
    }
    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
    const { token } = settings;
    const branch = parsed.data.branch;

    // Tête de branche actuelle
    const ref = await gh(token, "GET", `/repos/${REPO}/git/ref/heads/${branch}`);
    const headSha = (ref.object as { sha: string }).sha;

    if (parsed.data.ping) {
      return json({ ok: true, branch, head: headSha });
    }
    if (!parsed.data.message || !parsed.data.files?.length) {
      return json({ error: "message and files required" }, 400);
    }

    const headCommit = await gh(token, "GET", `/repos/${REPO}/git/commits/${headSha}`);
    const baseTree = (headCommit.tree as { sha: string }).sha;

    // 1 blob par fichier (base64 -> GitHub le stocke tel quel)
    const treeEntries: { path: string; mode: string; type: string; sha: string }[] = [];
    for (const f of parsed.data.files) {
      let sha = f.blob_sha ?? "";
      if (!sha) {
        const blob = await gh(token, "POST", `/repos/${REPO}/git/blobs`, {
          content: f.content_b64, encoding: "base64",
        });
        sha = blob.sha as string;
      }
      treeEntries.push({ path: f.path, mode: "100644", type: "blob", sha });
    }

    const tree = await gh(token, "POST", `/repos/${REPO}/git/trees`, {
      base_tree: baseTree, tree: treeEntries,
    });
    const commit = await gh(token, "POST", `/repos/${REPO}/git/commits`, {
      message: parsed.data.message, tree: tree.sha, parents: [headSha],
    });
    await gh(token, "PATCH", `/repos/${REPO}/git/refs/heads/${branch}`, {
      sha: commit.sha, force: false,
    });

    return json({ sha: commit.sha, url: `https://github.com/${REPO}/commit/${commit.sha}`, files: treeEntries.length });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    console.error("[gh-push]", msg);
    return json({ error: msg }, 500);
  }
});
