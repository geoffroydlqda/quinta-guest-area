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

const RoomSetupSchema = z.object({
  action: z.literal('submit'),
  fullName: z.string().min(1).max(200).trim(),
  firstName: z.string().max(100).optional().nullable(),
  email: z.string().email().max(254),
  remarks: z.string().max(2000).optional().nullable(),
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
  const { stats, fullName, firstName, email, remarks } = payload;
  const greetingName = firstName || fullName?.split(' ')[0] || 'Guest';
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Room Setup Confirmation</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: Georgia, 'Times New Roman', serif; line-height: 1.6; color: #000000; background-color: #f6efea;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f6efea; padding: 32px 16px;">
        <tr>
          <td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%;">
              
              <!-- Header -->
              <tr>
                <td style="background-color: #5e6d3f; padding: 32px; text-align: center; border-radius: 12px 12px 0 0;">
                  <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 400; letter-spacing: 1px;">Quinta do Amor</h1>
                  <p style="margin: 8px 0 0 0; color: rgba(255,255,255,0.85); font-size: 14px;">
                    ${isAdmin ? 'Housekeeping Setup — ' + fullName : 'Your Room Setup Confirmation'}
                  </p>
                </td>
              </tr>

              <!-- Body -->
              <tr>
                <td style="background-color: #ffffff; padding: 32px; border-left: 1px solid #e8ddd6; border-right: 1px solid #e8ddd6;">
                  
                  ${isAdmin ? `
                  <table width="100%" style="background-color: #f6efea; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
                    <tr><td>
                      <strong style="color: #000;">Guest:</strong> ${fullName}<br>
                      <strong style="color: #000;">Email:</strong> ${email}
                    </td></tr>
                  </table>
                  ` : `
                  <p style="margin: 0 0 16px 0; font-size: 16px;">Hi ${greetingName},</p>
                  <p style="margin: 0 0 24px 0; color: #333;">Thank you for submitting your room configuration. Here's a summary:</p>
                  `}

                  <!-- Room Setup -->
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                    <tr><td style="padding-bottom: 12px; border-bottom: 2px solid #5e6d3f;">
                      <h2 style="margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; color: #5e6d3f; font-weight: 600;">Room Configuration</h2>
                    </td></tr>
                    <tr><td style="padding: 12px 0;">
                      <table width="100%">
                        <tr><td style="padding: 8px 0; color: #333;">King (en-suite bathroom) — fixed</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${stats.kingsFixed}</td></tr>
                        <tr><td style="padding: 8px 0; color: #333;">Queen (shared bathroom)</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${stats.queenSharedCount}</td></tr>
                        <tr><td style="padding: 8px 0; color: #333;">Twins (shared bathroom)</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${stats.twinsSharedCount}</td></tr>
                        <tr><td style="padding: 8px 0; color: #333;">Queen (en-suite bathroom)</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${stats.queenEnsuiteCount}</td></tr>
                        <tr><td style="padding: 8px 0; color: #333;">Twins (en-suite bathroom)</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${stats.twinsEnsuiteCount}</td></tr>
                        <tr><td style="padding: 8px 0; color: #333;">Flexible (not set)</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${stats.notSetCount}</td></tr>
                      </table>
                    </td></tr>
                  </table>

                  ${remarks ? `
                  <table width="100%" style="background-color: #fef9e7; border-radius: 8px; border-left: 4px solid #d4a843; margin-bottom: 24px;">
                    <tr><td style="padding: 16px;">
                      <strong style="color: #000;">Remarks:</strong><br>
                      <span style="color: #333;">${remarks}</span>
                    </td></tr>
                  </table>
                  ` : ''}

                  ${!isAdmin ? `
                  <p style="margin-top: 24px; font-size: 14px; color: #333; background-color: #f6efea; padding: 16px; border-radius: 8px;">
                    You can log in to your account anytime to view or update your room setup.
                  </p>
                  ` : ''}
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="background-color: #f6efea; padding: 24px 32px; text-align: center; border-radius: 0 0 12px 12px; border-left: 1px solid #e8ddd6; border-right: 1px solid #e8ddd6; border-bottom: 1px solid #e8ddd6;">
                  <p style="margin: 0 0 4px 0; font-size: 12px; color: #333;">Submitted: ${new Date().toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' })}</p>
                  <p style="margin: 0 0 8px 0; font-size: 12px; color: #666;">Quinta do Amor © ${new Date().getFullYear()}</p>
                  <p style="margin: 0; font-size: 12px; color: #5e6d3f;">hello@quintamor.com</p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

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

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: authError } = await supabaseClient.auth.getClaims(token);

    if (authError || !claimsData?.claims) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    const userEmail = claimsData.claims.email as string;
    const rawPayload = await req.json();
    
    let payload: RoomSetupPayload;
    try {
      payload = RoomSetupSchema.parse(rawPayload);
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        return new Response(
          JSON.stringify({ error: 'Invalid input', details: validationError.errors.map(e => `${e.path.join('.')}: ${e.message}`) }),
          { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }
      throw validationError;
    }

    if (payload.action !== "submit") {
      return new Response(
        JSON.stringify({ error: "Only 'submit' action supported" }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    if (payload.email.toLowerCase() !== userEmail?.toLowerCase()) {
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    const emailPromises: Promise<any>[] = [];

    emailPromises.push(
      resend.emails.send({
        from: FROM_EMAIL,
        to: [payload.email],
        subject: "Your Room Setup Confirmation — Quinta do Amor",
        html: generateSubmitEmailHtml(payload, false),
      })
    );

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
    const successfulEmails = results.filter(r => r.status === 'fulfilled');

    if (failedEmails.length > 0) console.error("Some emails failed:", failedEmails);

    return new Response(
      JSON.stringify({ success: true, emailsSent: successfulEmails.length, emailsFailed: failedEmails.length }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
