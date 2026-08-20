import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

// Admin emails are centralized in the public.admin_users table (Phase 0).
const _adminAuthClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);
let _adminEmailsCache: string[] | null = null;
async function getAdminEmails(): Promise<string[]> {
  if (_adminEmailsCache) return _adminEmailsCache;
  const { data } = await _adminAuthClient.from("admin_users").select("email");
  _adminEmailsCache = (data ?? []).map((r: { email: string }) =>
    String(r.email).normalize("NFC").toLowerCase().trim()
  );
  return _adminEmailsCache;
}
async function isAdminEmailDb(email?: string | null): Promise<boolean> {
  if (!email) return false;
  return (await getAdminEmails()).includes(email.normalize("NFC").toLowerCase().trim());
}


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};


const BodySchema = z.object({
  retreat_name: z.string().trim().max(200).default(""),
  first_name: z.string().trim().max(100).optional().nullable(),
  last_name: z.string().trim().max(100).optional().nullable(),
  email: z.string().trim().email().max(255),
  guest_count: z.number().int().min(1).max(50).default(1),
  check_in_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  check_out_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  payment_status: z.enum(["pending", "deposit_paid", "paid_in_full", "overdue"]).default("pending"),
  deposit_amount: z.number().nonnegative().optional().nullable(),
  remaining_balance: z.number().nonnegative().optional().nullable(),
  internal_notes: z.string().max(2000).optional().nullable(),
  invitation_expires_at: z.string().datetime().optional().nullable(),
  origin: z.string().url().optional().nullable(),
});

function genToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

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
    const adminEmail = (user?.email || "").normalize("NFC").toLowerCase().trim();
    if (authErr || !user || !(await isAdminEmailDb(adminEmail))) {
      return json({ error: "Forbidden" }, 403);
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return json({ error: parsed.error.flatten().fieldErrors }, 400);
    }
    const body = parsed.data;

    if (body.check_in_date && body.check_out_date && body.check_out_date < body.check_in_date) {
      return json({ error: "check_out_date must be on or after check_in_date" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Règle (20 août 2026) : pas de création si un booking actif occupe déjà
    // ces dates. Chevauchement = in < other.out ET out > other.in (le
    // back-to-back check-out/check-in le même jour est autorisé). Les bookings
    // de test et annulés ne bloquent pas.
    if (body.check_in_date && body.check_out_date) {
      const { data: conflicts } = await admin
        .from("bookings")
        .select("id,retreat_name,first_name,last_name,email,check_in_date,check_out_date,is_test,cancelled_at")
        .not("check_in_date", "is", null)
        .not("check_out_date", "is", null)
        .lt("check_in_date", body.check_out_date)
        .gt("check_out_date", body.check_in_date);
      const active = (conflicts ?? []).filter((b: any) => !b.is_test && !b.cancelled_at);
      if (active.length > 0) {
        const c = active[0] as any;
        const label = c.retreat_name || `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || c.email;
        return json({
          error: `These dates overlap an existing booking: "${label}" (${c.check_in_date} → ${c.check_out_date}). Adjust the dates or that booking first.`,
          conflict: { id: c.id, label, check_in_date: c.check_in_date, check_out_date: c.check_out_date },
        }, 409);
      }
    }

    const token = genToken();

    const insertPayload = {
      retreat_name: body.retreat_name || "",
      first_name: body.first_name ?? null,
      last_name: body.last_name ?? null,
      email: body.email.toLowerCase(),
      guest_count: body.guest_count,
      check_in_date: body.check_in_date ?? null,
      check_out_date: body.check_out_date ?? null,
      payment_status: body.payment_status,
      deposit_amount: body.deposit_amount ?? null,
      remaining_balance: body.remaining_balance ?? null,
      internal_notes: body.internal_notes ?? null,
      invitation_token: token,
      invitation_claimed: false,
      invitation_expires_at: body.invitation_expires_at ?? null,
      created_by_admin: true,
    };
    console.log("[create-booking] insert payload", { ...insertPayload, invitation_token: "***" });

    const { data: booking, error: insErr } = await admin
      .from("bookings")
      .insert(insertPayload)
      .select()
      .single();

    if (insErr) {
      console.error("[create-booking] insert error", insErr);
      return json({ error: insErr.message, code: insErr.code, details: insErr.details }, 500);
    }
    if (!booking?.id) {
      console.error("[create-booking] insert returned no row");
      return json({ error: "Insert returned no row" }, 500);
    }
    console.log("[create-booking] inserted", { booking_id: booking.id });

    const origin = body.origin || "";
    const inviteUrl = origin ? `${origin.replace(/\/$/, "")}/invite/${token}` : `/invite/${token}`;

    return json({ ok: true, booking, invite_url: inviteUrl, invitation_token: token });
  } catch (e: any) {
    console.error("[create-booking] error", e);
    return json({ error: e.message ?? String(e) }, 500);
  }

  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
