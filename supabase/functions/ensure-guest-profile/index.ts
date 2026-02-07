import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authentication: Extract and validate JWT from Authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized - missing auth header' }),
        { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    // Create Supabase client with user's JWT for auth validation
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    // Validate JWT and get authenticated user
    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: authError } = await supabaseClient.auth.getClaims(token);

    if (authError || !claimsData?.claims) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized - invalid token' }),
        { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    const userId = claimsData.claims.sub as string;
    const userEmail = claimsData.claims.email as string;

    // Get metadata from request body (optional)
    let metadata: { first_name?: string; last_name?: string; full_name?: string } = {};
    try {
      const body = await req.json();
      metadata = body.metadata || {};
    } catch {
      // No body or invalid JSON, that's fine
    }

    // Use service role client for upsert to bypass RLS
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
      console.error('Error checking existing profile:', selectError);
    }

    if (existingProfile) {
      // Profile exists, return it
      console.log('Profile already exists for user:', userId);
      return new Response(
        JSON.stringify({ success: true, profile: existingProfile, created: false }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    // Profile doesn't exist, create one
    const firstName = metadata.first_name || '';
    const lastName = metadata.last_name || '';
    const fullName = metadata.full_name || 
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
      // Check if it's a unique constraint violation (profile was created by another process)
      if (insertError.code === '23505') {
        // Fetch the existing profile
        const { data: retryProfile } = await supabaseAdmin
          .from('guest_profiles')
          .select('*')
          .eq('user_id', userId)
          .single();

        if (retryProfile) {
          console.log('Profile created by concurrent process for user:', userId);
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
    console.error("Error in ensure-guest-profile function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }
};

serve(handler);
