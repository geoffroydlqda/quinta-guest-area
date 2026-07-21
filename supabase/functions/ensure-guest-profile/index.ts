import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    // Create client with user's token to get their identity
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user: authUser }, error: authError } = await supabaseClient.auth.getUser();

    if (authError || !authUser) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    const userId = authUser.id;
    const userEmail = authUser.email ?? '';

    // Skip guest profile creation for admin users
    if (await isAdminEmailDb(userEmail)) {
      console.log('Skipping guest profile creation for admin:', userEmail);
      return new Response(
        JSON.stringify({ success: true, profile: null, created: false, isAdmin: true }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    // Get metadata from request body (optional)
    let metadata: Record<string, any> = {};
    try {
      const body = await req.json();
      metadata = body.metadata || {};
    } catch {
      // No body or invalid JSON
    }

    // Merge auth user metadata with request metadata
    const allMetadata = { ...authUser.user_metadata, ...metadata };

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Check if profile already exists
    const { data: existingProfile, error: selectError } = await supabaseAdmin
      .from('guest_profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (selectError) {
      console.error('Error checking profile:', selectError);
    }

    if (existingProfile) {
      return new Response(
        JSON.stringify({ success: true, profile: existingProfile, created: false }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    // Extract name from metadata - support both email/password signup and Google OAuth
    const firstName = allMetadata.first_name || allMetadata.given_name || '';
    const lastName = allMetadata.last_name || allMetadata.family_name || '';
    const fullName = allMetadata.full_name || allMetadata.name ||
      (firstName && lastName ? `${firstName} ${lastName}` : firstName || lastName || '');

    const { data: newProfile, error: insertError } = await supabaseAdmin
      .from('guest_profiles')
      .insert({
        user_id: userId,
        email: userEmail,
        full_name: fullName,
        first_name: firstName || null,
        last_name: lastName || null,
        guests_count: 1,
      })
      .select()
      .single();

    if (insertError) {
      // Handle race condition - profile was created between our check and insert
      if (insertError.code === '23505') {
        const { data: retryProfile } = await supabaseAdmin
          .from('guest_profiles')
          .select('*')
          .eq('user_id', userId)
          .single();

        if (retryProfile) {
          return new Response(
            JSON.stringify({ success: true, profile: retryProfile, created: false }),
            { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
          );
        }
      }

      console.error('Error creating profile:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to create profile', details: insertError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    console.log('Profile created for user:', userId);
    return new Response(
      JSON.stringify({ success: true, profile: newProfile, created: true }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );

  } catch (error: any) {
    console.error("Unhandled error:", error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }
};

serve(handler);
