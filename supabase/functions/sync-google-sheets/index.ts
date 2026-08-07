// RETIRÉE (Sprint 1, 7 août 2026) — cette fonction appelait la passerelle
// Lovable supprimée et affichait de faux succès, sans contrôle admin.
// Le bouton front et l'appel d'admin-delete-guest ont été retirés.
// Stub 410 conservé pour que tout appelant résiduel reçoive une erreur claire.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  return new Response(
    JSON.stringify({ error: "sync-google-sheets has been removed (Lovable gateway shut down). Data lives in the admin app." }),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
