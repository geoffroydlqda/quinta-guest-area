// Upload de documents legaux versionnes (CGV) dans le bucket public 'legal'.
// Auth : x-ingest-key = app_settings.internal.ingest_key (meme cle que
// l'ingestion Gmail des receipts). Les fichiers sont IMMUABLES : un nom deja
// pris renvoie une erreur — une nouvelle version de CGV = un nouveau fichier.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ingest-key",
};

const BodySchema = z.object({
  filename: z.string().min(1).max(200).regex(/^[A-Za-z0-9._-]+\.pdf$/),
  content: z.string().min(1).max(15_000_000), // base64
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const keyHeader = req.headers.get("x-ingest-key");
    const { data } = await admin.from("app_settings").select("value").eq("key", "internal").maybeSingle();
    const expected = (data?.value as Record<string, string> | null)?.ingest_key;
    if (!expected || keyHeader !== expected) return json({ error: "Forbidden" }, 403);

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
    const { filename, content } = parsed.data;

    const bin = Uint8Array.from(atob(content), (c) => c.charCodeAt(0));
    // upsert: false -> immuable (une version de CGV ne s'ecrase jamais)
    const up = await admin.storage.from("legal").upload(filename, bin, {
      contentType: "application/pdf",
      upsert: false,
    });
    if (up.error) return json({ error: up.error.message }, 409);

    const publicUrl = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/legal/${filename}`;
    return json({ ok: true, path: up.data.path, public_url: publicUrl, bytes: bin.length });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
