import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ADMIN_EMAIL = "hello@quintamor.com";
const FROM_EMAIL = "Quinta do Amor <noreply@quintamor.com>";

// Input validation schema
const RoomSetupSchema = z.object({
  action: z.literal('submit'),
  fullName: z.string().min(1, "Name required").max(200, "Name too long").trim(),
  email: z.string().email("Invalid email").max(254, "Email too long"),
  remarks: z.string().max(2000, "Remarks too long").optional().nullable(),
  stats: z.object({
    kingsFixed: z.number().int().min(0).max(10),
    queenSharedCount: z.number().int().min(0).max(10),
    twinsSharedCount: z.number().int().min(0).max(10),
    queenEnsuiteCount: z.number().int().min(0).max(10),
    twinsEnsuiteCount: z.number().int().min(0).max(10),
    notSetCount: z.number().int().min(0).max(10),
  }),
});

type RoomSetupPayload = z.infer<typeof RoomSetupSchema>;

function generateSubmitEmailHtml(payload: RoomSetupPayload, isAdmin: boolean): string {
  const { stats, fullName, email, remarks } = payload;
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Housekeeping Setup</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #1a1a2e; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
        .stats-table { width: 100%; border-collapse: collapse; margin: 16px 0; }
        .stats-table th, .stats-table td { padding: 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
        .stats-table th { background: #f3f4f6; font-weight: 600; }
        .stats-table tr:last-child td { border-bottom: none; }
        .count { font-weight: 600; color: #3b82f6; }
        .remarks { background: #fef3c7; padding: 12px; border-radius: 6px; margin: 16px 0; border-left: 4px solid #f59e0b; }
        .footer { text-align: center; color: #6b7280; font-size: 12px; padding: 20px; }
        .guest-info { background: #dbeafe; padding: 12px; border-radius: 6px; margin-bottom: 16px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Quinta do Amor</h1>
        <p>${isAdmin ? 'Housekeeping Setup — ' + fullName : 'Your Room Setup Confirmation'}</p>
      </div>
      <div class="content">
        ${isAdmin ? `
        <div class="guest-info">
          <strong>Guest:</strong> ${fullName}<br>
          <strong>Email:</strong> ${email}
        </div>
        ` : `<p>Hello ${fullName},</p><p>Thank you for submitting your room configuration. Here's a summary:</p>`}
        
        <table class="stats-table">
          <tr>
            <th>Room Type</th>
            <th>Count</th>
          </tr>
          <tr>
            <td>King (en-suite) — fixed</td>
            <td class="count">${stats.kingsFixed}</td>
          </tr>
          <tr>
            <td>Queen (shared bathroom)</td>
            <td class="count">${stats.queenSharedCount}</td>
          </tr>
          <tr>
            <td>Twins (shared bathroom)</td>
            <td class="count">${stats.twinsSharedCount}</td>
          </tr>
          <tr>
            <td>Queen (en-suite)</td>
            <td class="count">${stats.queenEnsuiteCount}</td>
          </tr>
          <tr>
            <td>Twins (en-suite)</td>
            <td class="count">${stats.twinsEnsuiteCount}</td>
          </tr>
          <tr>
            <td>Flexible (not set)</td>
            <td class="count">${stats.notSetCount}</td>
          </tr>
        </table>

        ${remarks ? `
        <div class="remarks">
          <strong>Remarks:</strong><br>
          ${remarks}
        </div>
        ` : ''}

        ${!isAdmin ? `
        <p style="margin-top: 20px; font-size: 14px; color: #6b7280;">
          You can log in to your account anytime to view or update your room setup.
        </p>
        ` : ''}
      </div>
      <div class="footer">
        <p>Submitted: ${new Date().toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' })}</p>
        <p>Quinta do Amor © ${new Date().getFullYear()}</p>
      </div>
    </body>
    </html>
  `;
}

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

    // Create Supabase client with user's JWT
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

    const userEmail = claimsData.claims.email as string;

    // Parse and validate input
    const rawPayload = await req.json();
    
    let payload: RoomSetupPayload;
    try {
      payload = RoomSetupSchema.parse(rawPayload);
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        return new Response(
          JSON.stringify({
            error: 'Invalid input',
            details: validationError.errors.map(e => `${e.path.join('.')}: ${e.message}`)
          }),
          { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }
      throw validationError;
    }

    // Only handle submit action
    if (payload.action !== "submit") {
      return new Response(
        JSON.stringify({ error: "Only 'submit' action is supported" }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    // Verify the email in payload belongs to the authenticated user
    if (payload.email.toLowerCase() !== userEmail?.toLowerCase()) {
      return new Response(
        JSON.stringify({ error: 'Forbidden - email mismatch' }),
        { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    const emailPromises: Promise<any>[] = [];

    // Send confirmation to user
    emailPromises.push(
      resend.emails.send({
        from: FROM_EMAIL,
        to: [payload.email],
        subject: "Your Room Setup Confirmation",
        html: generateSubmitEmailHtml(payload, false),
      })
    );

    // Send housekeeping summary to admin
    emailPromises.push(
      resend.emails.send({
        from: FROM_EMAIL,
        to: [ADMIN_EMAIL],
        subject: `Housekeeping Setup — ${payload.fullName}`,
        html: generateSubmitEmailHtml(payload, true),
      })
    );

    const results = await Promise.allSettled(emailPromises);
    
    const failedEmails = results.filter(r => r.status === 'rejected');
    if (failedEmails.length > 0) {
      console.error("Some emails failed to send:", failedEmails);
    }

    const successfulEmails = results.filter(r => r.status === 'fulfilled');
    console.log(`Successfully sent ${successfulEmails.length}/${results.length} emails`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        emailsSent: successfulEmails.length,
        emailsFailed: failedEmails.length 
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Error in send-room-setup-emails function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
