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

interface RoomSetupPayload {
  action: "save" | "submit";
  fullName: string;
  email: string;
  editUrl: string;
  remarks?: string;
  stats: {
    kingsFixed: number;
    queenSharedCount: number;
    twinsSharedCount: number;
    queenEnsuiteCount: number;
    twinsEnsuiteCount: number;
    notSetCount: number;
  };
}

function generateSaveEmailHtml(payload: RoomSetupPayload): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Your Room Setup Edit Link</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #1a1a2e; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
        .button { display: inline-block; background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0; }
        .footer { text-align: center; color: #6b7280; font-size: 12px; padding: 20px; }
        .url-box { background: #e5e7eb; padding: 10px; border-radius: 4px; word-break: break-all; font-family: monospace; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Quinta do Amor</h1>
        <p>Room Setup Saved</p>
      </div>
      <div class="content">
        <p>Hello ${payload.fullName},</p>
        <p>Your room configuration has been saved. You can return anytime to complete or modify your setup using the link below:</p>
        <p style="text-align: center;">
          <a href="${payload.editUrl}" class="button">Continue Your Setup</a>
        </p>
        <p style="font-size: 14px; color: #6b7280;">Or copy this link:</p>
        <div class="url-box">${payload.editUrl}</div>
        <p style="margin-top: 20px; font-size: 14px; color: #6b7280;">
          <strong>Note:</strong> Keep this link safe – anyone with it can view and edit your room configuration.
        </p>
      </div>
      <div class="footer">
        <p>Quinta do Amor © ${new Date().getFullYear()}</p>
      </div>
    </body>
    </html>
  `;
}

function generateAdminSaveEmailHtml(payload: RoomSetupPayload): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Room Setup Saved</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #1a1a2e; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
        .info-row { display: flex; padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
        .label { font-weight: 600; min-width: 120px; }
        .url-box { background: #e5e7eb; padding: 10px; border-radius: 4px; word-break: break-all; font-family: monospace; font-size: 12px; margin-top: 10px; }
        .footer { text-align: center; color: #6b7280; font-size: 12px; padding: 20px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Room Setup Saved</h1>
        <p>A guest has saved their room configuration</p>
      </div>
      <div class="content">
        <div class="info-row"><span class="label">Guest:</span> ${payload.fullName}</div>
        <div class="info-row"><span class="label">Email:</span> ${payload.email}</div>
        <div class="info-row"><span class="label">Status:</span> Draft (not yet submitted)</div>
        <p style="margin-top: 16px;"><strong>Edit URL:</strong></p>
        <div class="url-box">${payload.editUrl}</div>
      </div>
      <div class="footer">
        <p>Quinta do Amor © ${new Date().getFullYear()}</p>
      </div>
    </body>
    </html>
  `;
}

function generateSubmitEmailHtml(payload: RoomSetupPayload, isAdmin: boolean): string {
  const { stats, fullName, email, editUrl, remarks } = payload;
  
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
        .url-box { background: #e5e7eb; padding: 10px; border-radius: 4px; word-break: break-all; font-family: monospace; font-size: 12px; margin-top: 10px; }
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

        <p style="margin-top: 16px;"><strong>Edit URL:</strong></p>
        <div class="url-box">${editUrl}</div>
        <p style="font-size: 14px; color: #6b7280; margin-top: 10px;">
          You can use this link to view or modify the configuration if needed.
        </p>
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
    const payload: RoomSetupPayload = await req.json();

    // Validate required fields
    if (!payload.action || !payload.fullName || !payload.email || !payload.editUrl) {
      throw new Error("Missing required fields: action, fullName, email, editUrl");
    }

    const emailPromises: Promise<any>[] = [];

    if (payload.action === "save") {
      // Send edit link to user
      emailPromises.push(
        resend.emails.send({
          from: FROM_EMAIL,
          to: [payload.email],
          subject: "Your Room Setup Edit Link",
          html: generateSaveEmailHtml(payload),
        })
      );

      // Send admin notification
      emailPromises.push(
        resend.emails.send({
          from: FROM_EMAIL,
          to: [ADMIN_EMAIL],
          subject: `Room Setup Saved — ${payload.fullName}`,
          html: generateAdminSaveEmailHtml(payload),
        })
      );
    } else if (payload.action === "submit") {
      // Validate stats for submit
      if (!payload.stats) {
        throw new Error("Missing stats for submit action");
      }

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
    }

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
