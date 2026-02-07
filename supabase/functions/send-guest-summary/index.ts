import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ADMIN_EMAIL = "hello@quintamor.com";
const FROM_EMAIL = "Quinta do Amor <noreply@quintamor.com>";

interface GuestSummaryPayload {
  fullName: string;
  email: string;
  checkInDate: string | null;
  checkOutDate: string | null;
  guestsCount: number;
  roomSetup: {
    queenSharedCount: number;
    twinsSharedCount: number;
    queenEnsuiteCount: number;
    twinsEnsuiteCount: number;
  } | null;
  transportation: {
    tripCount: number;
    totalPrice: number;
    customOfferCount: number;
  } | null;
  food: {
    fullBoardDays: number;
    breakfastOnlyDays: number;
    customDays: number;
    dietPreference?: string | null;
  } | null;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Not set';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function generateSummaryHtml(payload: GuestSummaryPayload, isAdmin: boolean): string {
  const { fullName, email, checkInDate, checkOutDate, guestsCount, roomSetup, transportation, food } = payload;
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Guest Area Summary</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #6d7855; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
        .section { background: white; border-radius: 8px; padding: 16px; margin: 12px 0; border: 1px solid #e5e7eb; }
        .section-title { font-weight: 600; color: #6d7855; margin-bottom: 12px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; }
        .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
        .row:last-child { border-bottom: none; }
        .label { color: #6b7280; }
        .value { font-weight: 500; }
        .not-set { color: #9ca3af; font-style: italic; }
        .footer { text-align: center; color: #6b7280; font-size: 12px; padding: 20px; }
        .guest-info { background: #f6efea; padding: 12px; border-radius: 6px; margin-bottom: 16px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1 style="margin: 0;">Quinta do Amor</h1>
        <p style="margin: 8px 0 0 0; opacity: 0.9;">${isAdmin ? 'Guest Area Summary — ' + fullName : 'Your Guest Area Summary'}</p>
      </div>
      <div class="content">
        ${isAdmin ? `
        <div class="guest-info">
          <strong>Guest:</strong> ${fullName}<br>
          <strong>Email:</strong> ${email}
        </div>
        ` : `<p>Hello ${fullName || 'Guest'},</p><p>Here's a summary of your Guest Area selections:</p>`}
        
        <!-- Stay Dates & Guests -->
        <div class="section">
          <div class="section-title">Stay Information</div>
          <div class="row">
            <span class="label">Check-in</span>
            <span class="value">${formatDate(checkInDate)}</span>
          </div>
          <div class="row">
            <span class="label">Check-out</span>
            <span class="value">${formatDate(checkOutDate)}</span>
          </div>
          <div class="row">
            <span class="label">Number of guests</span>
            <span class="value">${guestsCount || 1}</span>
          </div>
        </div>

        <!-- Room Setup -->
        <div class="section">
          <div class="section-title">Room Setup</div>
          ${roomSetup ? `
          <div class="row">
            <span class="label">King (en-suite) — fixed</span>
            <span class="value">2</span>
          </div>
          <div class="row">
            <span class="label">Queen (shared bathroom)</span>
            <span class="value">${roomSetup.queenSharedCount}</span>
          </div>
          <div class="row">
            <span class="label">Twins (shared bathroom)</span>
            <span class="value">${roomSetup.twinsSharedCount}</span>
          </div>
          <div class="row">
            <span class="label">Queen (en-suite)</span>
            <span class="value">${roomSetup.queenEnsuiteCount}</span>
          </div>
          <div class="row">
            <span class="label">Twins (en-suite)</span>
            <span class="value">${roomSetup.twinsEnsuiteCount}</span>
          </div>
          ` : '<p class="not-set">Not set</p>'}
        </div>

        <!-- Transportation -->
        <div class="section">
          <div class="section-title">Transportation</div>
          ${transportation && transportation.tripCount > 0 ? `
          <div class="row">
            <span class="label">Trips scheduled</span>
            <span class="value">${transportation.tripCount}</span>
          </div>
          ${transportation.totalPrice > 0 ? `
          <div class="row">
            <span class="label">Estimated total</span>
            <span class="value">€${transportation.totalPrice}</span>
          </div>
          ` : ''}
          ${transportation.customOfferCount > 0 ? `
          <div class="row">
            <span class="label">Custom pricing</span>
            <span class="value">${transportation.customOfferCount} trip${transportation.customOfferCount !== 1 ? 's' : ''}</span>
          </div>
          ` : ''}
          ` : '<p class="not-set">Not set</p>'}
        </div>

        <!-- Food -->
        <div class="section">
          <div class="section-title">Food</div>
          ${food ? `
          ${food.dietPreference ? `
          <div class="row">
            <span class="label">Diet preference</span>
            <span class="value">${food.dietPreference}</span>
          </div>
          ` : ''}
          ${food.fullBoardDays > 0 ? `
          <div class="row">
            <span class="label">Full board</span>
            <span class="value">${food.fullBoardDays} day${food.fullBoardDays !== 1 ? 's' : ''}</span>
          </div>
          ` : ''}
          ${food.breakfastOnlyDays > 0 ? `
          <div class="row">
            <span class="label">Breakfast only</span>
            <span class="value">${food.breakfastOnlyDays} day${food.breakfastOnlyDays !== 1 ? 's' : ''}</span>
          </div>
          ` : ''}
          ${food.customDays > 0 ? `
          <div class="row">
            <span class="label">Custom selection</span>
            <span class="value">${food.customDays} day${food.customDays !== 1 ? 's' : ''}</span>
          </div>
          ` : ''}
          ${!food.dietPreference && food.fullBoardDays === 0 && food.breakfastOnlyDays === 0 && food.customDays === 0 ? '<p class="not-set">No selections made</p>' : ''}
          ` : '<p class="not-set">Not set</p>'}
        </div>

        ${!isAdmin ? `
        <p style="margin-top: 20px; font-size: 14px; color: #6b7280;">
          Your information can still be edited until 5 days before check-in date.
          Log in to your account anytime to view or update your selections.
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
    const payload: GuestSummaryPayload = await req.json();

    // Validate required fields
    if (!payload.email) {
      throw new Error("Missing required field: email");
    }

    const emailPromises: Promise<any>[] = [];

    // Send to guest
    emailPromises.push(
      resend.emails.send({
        from: FROM_EMAIL,
        to: [payload.email],
        subject: "Your Guest Area Summary — Quinta do Amor",
        html: generateSummaryHtml(payload, false),
      })
    );

    // Send to admin
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
    console.error("Error in send-guest-summary function:", error);
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