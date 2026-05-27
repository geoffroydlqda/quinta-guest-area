import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ADMIN_EMAILS = ["hello@quintamor.com", "loïs@quintamor.com", "lois@quintamor.com", "977luisferreira@gmail.com"].map((e) =>
  e.normalize("NFC").toLowerCase().trim()
);
const isAdmin = (email?: string | null) =>
  !!email && ADMIN_EMAILS.includes(email.normalize("NFC").toLowerCase().trim());

// Scoped delete: removes ONE booking and all of its child rows.
// Does NOT touch guest_profiles or the auth user — a guest may have
// other bookings that must stay intact.
const BodySchema = z.object({
  booking_id: z.string().uuid(),
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
    const adminEmail = (user?.email || "").normalize("NFC").toLowerCase().trim();
    if (authErr || !user || !isAdmin(adminEmail)) {
      return json({ error: "Forbidden" }, 403);
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return json({ error: parsed.error.flatten().fieldErrors }, 400);
    }
    const { booking_id } = parsed.data;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // a. Load the booking
    const { data: booking, error: loadErr } = await admin
      .from("bookings")
      .select("id, email")
      .eq("id", booking_id)
      .maybeSingle();
    if (loadErr) {
      console.error("Load booking failed:", loadErr);
      return json({ error: loadErr.message }, 500);
    }
    if (!booking) return json({ error: "Booking not found" }, 404);

    // b. Delete child rows scoped strictly by booking_id.
    // Legacy rows with NULL booking_id are intentionally NOT touched.
    const childTables = [
      "transportation_passengers",
      "transportation_trips",
      "transportation_requests",
      "food_plans",
      "room_setups",
      "docs_ack",
      "payment_installments",
    ] as const;

    for (const t of childTables) {
      const { error } = await admin.from(t).delete().eq("booking_id", booking_id);
      if (error) {
        console.error(`Delete failed on ${t}:`, error);
        return json({ error: `Failed to delete from ${t}: ${error.message}` }, 500);
      }
    }

    // c. Delete the booking itself
    const { error: bookingDelErr } = await admin
      .from("bookings")
      .delete()
      .eq("id", booking_id);
    if (bookingDelErr) {
      console.error("Booking delete failed:", bookingDelErr);
      return json({ error: bookingDelErr.message }, 500);
    }

    // e. Best-effort storage cleanup for invoices/{booking_id}/*
    try {
      const { data: files } = await admin.storage
        .from("invoices")
        .list(booking_id, { limit: 1000 });
      if (files && files.length > 0) {
        const paths = files.map((f) => `${booking_id}/${f.name}`);
        await admin.storage.from("invoices").remove(paths);
      }
    } catch (e) {
      console.warn("Invoice storage cleanup failed (non-fatal):", e);
    }

    // f. Audit log
    await admin.from("deleted_entries_log").insert({
      deleted_guest_id: booking_id,
      deleted_guest_email: booking.email ?? null,
      deleted_by_admin: adminEmail,
      also_deleted_auth_user: false,
    });

    // g. Sheets sync (fire-and-forget)
    admin.functions.invoke("sync-google-sheets").catch((e) =>
      console.warn("Sheets sync after delete failed:", e)
    );

    return json({ ok: true, booking_id });
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
