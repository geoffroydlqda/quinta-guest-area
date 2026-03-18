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

const GuestSummarySchema = z.object({
  fullName: z.string().min(1).max(200).trim(),
  firstName: z.string().max(100).optional().nullable(),
  email: z.string().email().max(254),
  checkInDate: z.string().nullable().refine(
    (val) => !val || /^\d{4}-\d{2}-\d{2}$/.test(val),
    "Invalid date format"
  ),
  checkOutDate: z.string().nullable().refine(
    (val) => !val || /^\d{4}-\d{2}-\d{2}$/.test(val),
    "Invalid date format"
  ),
  guestsCount: z.number().int().min(1).max(21),
  roomSetup: z.object({
    queenSharedCount: z.number().int().min(0).max(6),
    twinsSharedCount: z.number().int().min(0).max(6),
    queenEnsuiteCount: z.number().int().min(0).max(3),
    twinsEnsuiteCount: z.number().int().min(0).max(3),
  }).nullable(),
  transportation: z.object({
    tripCount: z.number().int().min(0).max(50),
    totalPrice: z.number().min(0).max(10000),
    customOfferCount: z.number().int().min(0).max(50),
  }).nullable(),
  food: z.object({
    fullBoardDays: z.number().int().min(0).max(365),
    breakfastOnlyDays: z.number().int().min(0).max(365),
    customDays: z.number().int().min(0).max(365),
    dietPreference: z.string().max(100).nullable().optional(),
    totalCost: z.number().min(0).max(100000).optional(),
  }).nullable(),
});

type GuestSummaryPayload = z.infer<typeof GuestSummarySchema>;

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Not set';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function generateSummaryHtml(payload: GuestSummaryPayload, isAdmin: boolean): string {
  const { fullName, firstName, email, checkInDate, checkOutDate, guestsCount, roomSetup, transportation, food } = payload;
  const greetingName = firstName || fullName?.split(' ')[0] || 'Guest';
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Guest Area Summary</title>
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
                    ${isAdmin ? 'Guest Area Summary — ' + fullName : 'Guest Area Summary'}
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
                  <p style="margin: 0 0 24px 0; color: #333;">Here's a summary of your Guest Area selections:</p>
                  `}

                  <!-- Stay Information -->
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                    <tr><td style="padding-bottom: 12px; border-bottom: 2px solid #5e6d3f;">
                      <h2 style="margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; color: #5e6d3f; font-weight: 600;">Stay Information</h2>
                    </td></tr>
                    <tr><td style="padding: 12px 0;">
                      <table width="100%">
                        <tr><td style="padding: 8px 0; color: #333;">Check-in</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${formatDate(checkInDate)}</td></tr>
                        <tr><td style="padding: 8px 0; color: #333;">Check-out</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${formatDate(checkOutDate)}</td></tr>
                        <tr><td style="padding: 8px 0; color: #333;">Number of guests</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${guestsCount || 1}</td></tr>
                      </table>
                    </td></tr>
                  </table>

                  <!-- Room Setup -->
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                    <tr><td style="padding-bottom: 12px; border-bottom: 2px solid #5e6d3f;">
                      <h2 style="margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; color: #5e6d3f; font-weight: 600;">Room Setup</h2>
                    </td></tr>
                    <tr><td style="padding: 12px 0;">
                      ${roomSetup ? `
                      <table width="100%">
                        <tr><td style="padding: 8px 0; color: #333;">King (en-suite bathroom) — fixed</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">2</td></tr>
                        <tr><td style="padding: 8px 0; color: #333;">Queen (shared bathroom)</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${roomSetup.queenSharedCount}</td></tr>
                        <tr><td style="padding: 8px 0; color: #333;">Twins (shared bathroom)</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${roomSetup.twinsSharedCount}</td></tr>
                        <tr><td style="padding: 8px 0; color: #333;">Queen (en-suite bathroom)</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${roomSetup.queenEnsuiteCount}</td></tr>
                        <tr><td style="padding: 8px 0; color: #333;">Twins (en-suite bathroom)</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${roomSetup.twinsEnsuiteCount}</td></tr>
                      </table>
                      ` : '<p style="color: #999; font-style: italic;">Not set</p>'}
                    </td></tr>
                  </table>

                  <!-- Transportation -->
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                    <tr><td style="padding-bottom: 12px; border-bottom: 2px solid #5e6d3f;">
                      <h2 style="margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; color: #5e6d3f; font-weight: 600;">Transportation</h2>
                    </td></tr>
                    <tr><td style="padding: 12px 0;">
                      ${transportation && transportation.tripCount > 0 ? `
                      <table width="100%">
                        <tr><td style="padding: 8px 0; color: #333;">Trips scheduled</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${transportation.tripCount}</td></tr>
                        ${transportation.totalPrice > 0 ? `<tr><td style="padding: 8px 0; color: #333;">Estimated total (fixed-price)</td><td style="padding: 8px 0; text-align: right; font-weight: 600; color: #5e6d3f;">€${transportation.totalPrice}</td></tr>` : ''}
                        ${transportation.customOfferCount > 0 ? `<tr><td style="padding: 8px 0; color: #333;">Custom offer trips</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${transportation.customOfferCount}</td></tr>` : ''}
                      </table>
                      ` : '<p style="color: #999; font-style: italic;">Not set</p>'}
                    </td></tr>
                  </table>

                  <!-- Food -->
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                    <tr><td style="padding-bottom: 12px; border-bottom: 2px solid #5e6d3f;">
                      <h2 style="margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; color: #5e6d3f; font-weight: 600;">Food</h2>
                    </td></tr>
                    <tr><td style="padding: 12px 0;">
                      ${food ? `
                      <table width="100%">
                        ${food.dietPreference ? `<tr><td style="padding: 8px 0; color: #333;">Diet preference</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${food.dietPreference}</td></tr>` : ''}
                        ${food.fullBoardDays > 0 ? `<tr><td style="padding: 8px 0; color: #333;">Full board</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${food.fullBoardDays} day${food.fullBoardDays !== 1 ? 's' : ''}</td></tr>` : ''}
                        ${food.breakfastOnlyDays > 0 ? `<tr><td style="padding: 8px 0; color: #333;">Breakfast only</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${food.breakfastOnlyDays} day${food.breakfastOnlyDays !== 1 ? 's' : ''}</td></tr>` : ''}
                        ${food.customDays > 0 ? `<tr><td style="padding: 8px 0; color: #333;">Custom selection</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${food.customDays} day${food.customDays !== 1 ? 's' : ''}</td></tr>` : ''}
                      </table>
                      ${food.totalCost !== undefined && food.totalCost > 0 ? `
                      <table width="100%" style="background-color: #f0f7e6; border-radius: 8px; margin-top: 12px;">
                        <tr><td style="padding: 12px; color: #333; font-weight: 600;">Estimated total food cost</td><td style="padding: 12px; text-align: right; font-weight: 700; color: #5e6d3f; font-size: 18px;">€${food.totalCost}</td></tr>
                      </table>
                      ` : ''}
                      ${!food.dietPreference && food.fullBoardDays === 0 && food.breakfastOnlyDays === 0 && food.customDays === 0 ? '<p style="color: #999; font-style: italic;">No selections made</p>' : ''}
                      ` : '<p style="color: #999; font-style: italic;">Not set</p>'}
                    </td></tr>
                  </table>

                  ${!isAdmin ? `
                  <p style="margin-top: 24px; font-size: 14px; color: #333; background-color: #f6efea; padding: 16px; border-radius: 8px;">
                    Your information can still be edited until 5 days before check-in date.
                    Log in to your account anytime to view or update your selections.
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
    
    let payload: GuestSummaryPayload;
    try {
      payload = GuestSummarySchema.parse(rawPayload);
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        return new Response(
          JSON.stringify({ error: 'Invalid input', details: validationError.errors.map(e => `${e.path.join('.')}: ${e.message}`) }),
          { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }
      throw validationError;
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
        subject: "Your Guest Area Summary — Quinta do Amor",
        html: generateSummaryHtml(payload, false),
      })
    );

    emailPromises.push(
      resend.emails.send({
        from: FROM_EMAIL,
        to: [ADMIN_EMAIL],
        subject: `Guest Area Summary — ${payload.fullName || 'Guest'}`,
        html: generateSummaryHtml(payload, true),
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
