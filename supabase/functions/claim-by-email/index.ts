// Rattachement automatique des bookings par email vérifié (3 août 2026).
// Cas Isabel Muir : un organisateur récurrent crée UN compte avec l'email de
// ses réservations ; à chaque chargement de la guest area, cette fonction
// attache à son compte tous les bookings au même email pas encore réclamés
// (user_id null). Les liens d'invitation restent le chemin des nouveaux
// guests — ils deviennent simplement optionnels pour les habitués.
// Sécurité : on n'attache que si l'email du compte est VÉRIFIÉ (confirmation
// Supabase ou OAuth Google) — personne ne peut réclamer les bookings d'un
// autre en tapant son email.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    if (!user?.email) return json({ error: "Unauthorized" }, 401);

    // Email vérifié uniquement (confirmation email ou provider OAuth)
    const verified = !!user.email_confirmed_at || !!(user as { confirmed_at?: string }).confirmed_at;
    if (!verified) return json({ claimed: 0, skipped: "email_not_verified" });

    const email = user.email.normalize("NFC").toLowerCase().trim();

    // Bookings au même email, jamais réclamés -> rattachés à ce compte.
    const { data: candidates, error: qErr } = await admin.from("bookings")
      .select("id,email,user_id")
      .is("user_id", null);
    if (qErr) return json({ error: qErr.message }, 500);

    const mine = (candidates ?? []).filter(
      (b) => (b.email ?? "").normalize("NFC").toLowerCase().trim() === email
    );
    if (!mine.length) return json({ claimed: 0 });

    const ids = mine.map((b) => b.id);
    const { error: uErr } = await admin.from("bookings")
      .update({ user_id: user.id, invitation_claimed: true })
      .in("id", ids);
    if (uErr) return json({ error: uErr.message }, 500);

    console.log(`[claim-by-email] ${ids.length} booking(s) attached to ${email}`);
    return json({ claimed: ids.length });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    console.error("claim-by-email error:", msg);
    return json({ error: msg }, 500);
  }
});
