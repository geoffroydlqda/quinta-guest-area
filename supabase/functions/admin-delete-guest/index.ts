import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ADMIN_EMAILS = ["hello@quintamor.com"];

const BodySchema = z.object({
  guest_id: z.string().uuid(),
  also_delete_auth_user: z.boolean().optional().default(false),
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    const adminEmail = (user?.email || "").toLowerCase();
    if (authErr || !user || !ADMIN_EMAILS.includes(adminEmail)) {
      return json({ error: "Forbidden" }, 403);
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return json({ error: parsed.error.flatten().fieldErrors }, 400);
    }
    const { guest_id, also_delete_auth_user } = parsed.data;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Look up guest email for log
    const { data: profile } = await admin
      .from("guest_profiles")
      .select("email")
      .eq("user_id", guest_id)
      .maybeSingle();

    // Cascade delete operational data. Service role bypasses RLS.
    const tables = [
      "transportation_passengers",
      "transportation_trips",
      "transportation_requests",
      "food_plans",
      "room_setups",
      "docs_ack",
      "guest_profiles",
    ] as const;

    for (const t of tables) {
      const { error } = await admin.from(t).delete().eq("user_id", guest_id);
      if (error) {
        console.error(`Delete failed on ${t}:`, error);
        return json({ error: `Failed to delete from ${t}: ${error.message}` }, 500);
      }
    }

    let authDeleted = false;
    if (also_delete_auth_user) {
      const { error: delErr } = await admin.auth.admin.deleteUser(guest_id);
      if (delErr) {
        console.error("Auth user delete failed:", delErr);
        // Operational data already gone — return partial success info.
        return json({
          error: `Operational data deleted, but failed to delete login account: ${delErr.message}`,
          partial: true,
        }, 500);
      }
      authDeleted = true;
    }

    await admin.from("deleted_entries_log").insert({
      deleted_guest_id: guest_id,
      deleted_guest_email: profile?.email ?? null,
      deleted_by_admin: adminEmail,
      also_deleted_auth_user: authDeleted,
    });

    // Refresh Google Sheets so deleted rows disappear from the mirror.
    admin.functions.invoke("sync-google-sheets").catch((e) =>
      console.warn("Sheets sync after delete failed:", e)
    );

    return json({ ok: true, auth_deleted: authDeleted });
  } catch (e: any) {
    console.error(e);
    return json({ error: e.message ?? String(e) }, 500);
  }

  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
