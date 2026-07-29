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
const FROM_EMAIL = "Quinta do Amor <hello@quintamor.com>";
const GUEST_AREA_URL = "https://guest.quintamor.com/dashboard";

const FoodSelectionSchema = z.object({
  date: z.string(),
  fullBoard: z.boolean(),
  breakfast: z.boolean(),
  lunch: z.boolean(),
  dinner: z.boolean(),
  guests_count_day: z.number().int().min(0).max(1000).optional(),
});

const TripSchema = z.object({
  trip_direction: z.string(),
  pickup_location: z.string(),
  dropoff_location: z.string(),
  trip_date: z.string(),
  trip_time: z.string(),
  passengers_count: z.number(),
  taxi_size: z.string(),
  price_estimate: z.string(),
}).passthrough();

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
  guestsCount: z.number().int().min(1).max(22),
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
    trips: z.array(TripSchema).optional(),
  }).nullable(),
  food: z.object({
    fullBoardDays: z.number().int().min(0).max(365),
    breakfastOnlyDays: z.number().int().min(0).max(365),
    customDays: z.number().int().min(0).max(365),
    dietPreference: z.string().max(100).nullable().optional(),
    totalCost: z.number().min(0).max(1000000).optional(),
    selections: z.array(FoodSelectionSchema).optional(),
    dietBreakdown: z.array(z.object({
      type: z.string(),
      label: z.string(),
      guests: z.number().int().min(0).max(100),
      total: z.number().min(0).max(1000000).optional(),
    })).optional(),
    dietTotal: z.number().int().min(0).max(100).optional(),
    mealTimes: z.object({
      breakfast_time: z.string().max(10).nullable(),
      lunch_time: z.string().max(10).nullable(),
      dinner_time: z.string().max(10).nullable(),
    }).optional().nullable(),
  }).nullable(),
});

type GuestSummaryPayload = z.infer<typeof GuestSummarySchema>;

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Not set';
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function getOrdinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function formatDateLong(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const weekday = date.toLocaleDateString('en-GB', { weekday: 'long' });
  const monthName = date.toLocaleDateString('en-GB', { month: 'long' });
  return `${weekday} ${getOrdinal(day)} of ${monthName}`;
}

function generateFoodBreakdownHtml(selections: z.infer<typeof FoodSelectionSchema>[]): string {
  if (!selections || selections.length === 0) return '';

  const sorted = [...selections].sort((a, b) => a.date.localeCompare(b.date));
  const activeDays = sorted.filter(s => s.fullBoard || s.breakfast || s.lunch || s.dinner);
  if (activeDays.length === 0) return '';

  let html = '';
  for (const sel of activeDays) {
    const meals: string[] = [];
    if (sel.fullBoard) {
      meals.push('Full board');
    } else {
      if (sel.breakfast) meals.push('Breakfast');
      if (sel.lunch) meals.push('Lunch');
      if (sel.dinner) meals.push('Dinner (+ dessert)');
    }
    if (meals.length === 0) continue;

    const dateLabel = formatDateLong(sel.date);
    const mealsLabel = meals.join(' + ');
    const guestsLabel = typeof sel.guests_count_day === 'number'
      ? ` — ${sel.guests_count_day} guest${sel.guests_count_day !== 1 ? 's' : ''}`
      : '';
    html += `<tr><td style="padding: 6px 0; color: #333;"><strong style="color: #000;">${dateLabel}${guestsLabel}</strong> : ${mealsLabel}</td></tr>`;
  }
  return html;
}

function generateTransportationTripsHtml(trips: z.infer<typeof TripSchema>[]): string {
  if (!trips || trips.length === 0) return '';

  const sorted = [...trips].sort((a, b) => {
    const dateCompare = a.trip_date.localeCompare(b.trip_date);
    return dateCompare !== 0 ? dateCompare : a.trip_time.localeCompare(b.trip_time);
  });

  return sorted.map((trip, i) => {
    const taxiLabel = trip.taxi_size === '4 seats' ? '4-seat taxi' : trip.taxi_size === '6 seats' ? '6-seat taxi' : trip.taxi_size === '8 seats' ? '8-seat taxi' : trip.taxi_size;
    const cp = (trip as any).custom_price;
    const hasCustomPrice = cp !== null && cp !== undefined && !Number.isNaN(Number(cp));
    const priceLabel = hasCustomPrice ? `${Number(cp)}€` : trip.price_estimate;
    return `
    <tr><td style="padding: 8px 0;">
      <table width="100%" style="background-color: #f6efea; border-radius: 8px;">
        <tr><td style="padding: 10px 14px 4px; color: #000; font-weight: 700; font-size: 14px;">Trip ${i + 1}</td></tr>
        <tr><td style="padding: 2px 14px; color: #333; font-size: 13px;">Pickup: ${trip.pickup_location}</td></tr>
        <tr><td style="padding: 2px 14px; color: #333; font-size: 13px;">Drop-off: ${trip.dropoff_location}</td></tr>
        <tr><td style="padding: 2px 14px; color: #333; font-size: 13px;">Date: ${formatDateLong(trip.trip_date)}</td></tr>
        <tr><td style="padding: 2px 14px; color: #333; font-size: 13px;">Time: ${trip.trip_time}</td></tr>
        <tr><td style="padding: 2px 14px; color: #333; font-size: 13px;">Vehicle: ${taxiLabel}</td></tr>
        <tr><td style="padding: 2px 14px 10px; color: #333; font-size: 13px;">Price: ${priceLabel}</td></tr>
      </table>
    </td></tr>
    `;
  }).join('');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function generateSummaryHtml(payload: GuestSummaryPayload, isAdmin: boolean): string {
  const { fullName, firstName, email, checkInDate, checkOutDate, guestsCount, roomSetup, transportation, food } = payload;
  const safeFullName = escapeHtml(fullName);
  const safeEmail = escapeHtml(email);
  const greetingName = escapeHtml(firstName || fullName?.split(' ')[0] || 'Guest');
  const safeDietPreference = food?.dietPreference ? escapeHtml(food.dietPreference) : null;
  
  const foodTotal = food?.totalCost || 0;
  const transportTotal = transportation?.totalPrice || 0;
  const grandTotal = foodTotal + transportTotal;
  const hasCustomOffers = (transportation?.customOfferCount || 0) > 0;

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
                    ${isAdmin ? 'Guest Area Summary — ' + safeFullName : 'Guest Area Summary'}
                  </p>
                </td>
              </tr>

              <!-- Body -->
              <tr>
                <td style="background-color: #ffffff; padding: 32px; border-left: 1px solid #e8ddd6; border-right: 1px solid #e8ddd6;">
                  
                   <!-- CTA Button -->
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                    <tr><td style="padding: 0 0 8px 0; font-size: 14px; color: #333; text-align: center;">You can edit your information anytime in your Guest Area.</td></tr>
                    <tr><td align="center">
                      <a href="${GUEST_AREA_URL}" style="display: inline-block; background-color: #5e6d3f; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 600; letter-spacing: 0.5px;">Go to Guest Area</a>
                    </td></tr>
                    <tr><td style="padding: 8px 0 0 0; font-size: 12px; color: #999; text-align: center;"><a href="${GUEST_AREA_URL}" style="color: #5e6d3f; text-decoration: underline;">${GUEST_AREA_URL}</a></td></tr>
                  </table>

                  ${isAdmin ? `
                  <table width="100%" style="background-color: #f6efea; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
                    <tr><td>
                      <strong style="color: #000;">Guest:</strong> ${safeFullName}<br>
                      <strong style="color: #000;">Email:</strong> ${safeEmail}
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
                        <tr><td style="padding: 8px 0; color: #333;">King size bed (shared bathroom)</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${roomSetup.queenSharedCount}</td></tr>
                        <tr><td style="padding: 8px 0; color: #333;">Twins (shared bathroom)</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${roomSetup.twinsSharedCount}</td></tr>
                        <tr><td style="padding: 8px 0; color: #333;">King size bed (en-suite bathroom)</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${roomSetup.queenEnsuiteCount}</td></tr>
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
                        ${transportation.trips ? generateTransportationTripsHtml(transportation.trips) : `
                        <tr><td style="padding: 8px 0; color: #333;">Trips scheduled</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${transportation.tripCount}</td></tr>
                        `}
                      </table>
                      <!-- Transportation Subtotal -->
                      <table width="100%" style="margin-top: 12px; border-top: 1px solid #e8ddd6;">
                         ${transportation.totalPrice > 0 ? `<tr><td style="padding: 12px 0; color: #000; font-weight: 700;">Transportation subtotal</td><td style="padding: 12px 0; text-align: right; font-weight: 700; color: #5e6d3f; font-size: 16px;">${transportation.totalPrice}€</td></tr>` : ''}
                         ${hasCustomOffers ? `<tr><td colspan="2" style="padding: 4px 0; color: #666; font-size: 13px; font-style: italic;">Custom transportation offers will be quoted separately.</td></tr>` : ''}
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
                      ${food.mealTimes && (food.mealTimes.breakfast_time || food.mealTimes.lunch_time || food.mealTimes.dinner_time) ? `
                        <p style="margin: 0 0 8px 0; color: #333; font-weight: 600;">Meal times:</p>
                        <table width="100%" style="margin-bottom: 12px;">
                          ${food.mealTimes.breakfast_time ? `<tr><td style="padding: 4px 0; color: #333;">Breakfast</td><td style="padding: 4px 0; text-align: right; font-weight: 600;">${escapeHtml(food.mealTimes.breakfast_time)}</td></tr>` : ''}
                          ${food.mealTimes.lunch_time ? `<tr><td style="padding: 4px 0; color: #333;">Lunch</td><td style="padding: 4px 0; text-align: right; font-weight: 600;">${escapeHtml(food.mealTimes.lunch_time)}</td></tr>` : ''}
                          ${food.mealTimes.dinner_time ? `<tr><td style="padding: 4px 0; color: #333;">Dinner</td><td style="padding: 4px 0; text-align: right; font-weight: 600;">${escapeHtml(food.mealTimes.dinner_time)}</td></tr>` : ''}
                        </table>
                      ` : ''}
                      ${food.dietBreakdown && food.dietBreakdown.filter((d:any)=>d.guests>0).length > 0 ? `
                        <p style="margin: 0 0 8px 0; color: #333; font-weight: 600;">Food preferences:</p>
                        <table width="100%" style="margin-bottom: 12px;">
                          ${food.dietBreakdown.filter((d:any)=>d.guests>0).map((d:any)=>`
                            <tr>
                              <td style="padding: 6px 0; color: #333;">${escapeHtml(d.label)}</td>
                              <td style="padding: 6px 0; text-align: right; font-weight: 600;">${d.guests} guest${d.guests!==1?'s':''}</td>
                            </tr>
                          `).join('')}
                        </table>
                      ` : (safeDietPreference ? `<p style="margin: 0 0 12px 0; color: #333;"><strong>Diet preference:</strong> ${safeDietPreference}</p>` : '')}
                      <!-- Daily Breakdown -->
                      ${food.selections && food.selections.length > 0 ? `
                      <p style="margin: 0 0 8px 0; color: #333; font-weight: 600;">Food plan:</p>
                      <table width="100%">
                        ${generateFoodBreakdownHtml(food.selections)}
                      </table>
                      ` : `
                      <table width="100%">
                        ${food.fullBoardDays > 0 ? `<tr><td style="padding: 8px 0; color: #333;">Full board</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${food.fullBoardDays} day${food.fullBoardDays !== 1 ? 's' : ''}</td></tr>` : ''}
                        ${food.breakfastOnlyDays > 0 ? `<tr><td style="padding: 8px 0; color: #333;">Breakfast only</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${food.breakfastOnlyDays} day${food.breakfastOnlyDays !== 1 ? 's' : ''}</td></tr>` : ''}
                        ${food.customDays > 0 ? `<tr><td style="padding: 8px 0; color: #333;">Custom selection</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${food.customDays} day${food.customDays !== 1 ? 's' : ''}</td></tr>` : ''}
                      </table>
                      `}

                      <!-- Food Subtotal -->
                      ${food.totalCost !== undefined && food.totalCost > 0 ? `
                      <table width="100%" style="margin-top: 12px; border-top: 1px solid #e8ddd6;">
                        <tr><td style="padding: 12px 0; color: #000; font-weight: 700;">Food subtotal</td><td style="padding: 12px 0; text-align: right; font-weight: 700; color: #5e6d3f; font-size: 16px;">${food.totalCost}€</td></tr>
                      </table>
                      ` : ''}
                      ${!food.dietPreference && food.fullBoardDays === 0 && food.breakfastOnlyDays === 0 && food.customDays === 0 && (!food.selections || food.selections.length === 0) ? '<p style="color: #999; font-style: italic;">No selections made</p>' : ''}
                      ` : '<p style="color: #999; font-style: italic;">Not set</p>'}
                    </td></tr>
                  </table>

                  <!-- Grand Total -->
                  ${grandTotal > 0 ? `
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 8px; margin-bottom: 24px; background-color: #f0f7e6; border-radius: 8px;">
                    <tr>
                      <td style="padding: 16px; font-weight: 700; font-size: 16px; color: #000;">Estimated total (Food + Transportation)</td>
                      <td style="padding: 16px; text-align: right; font-weight: 700; color: #5e6d3f; font-size: 20px;">${grandTotal}€</td>
                    </tr>
                    ${hasCustomOffers ? `<tr><td colspan="2" style="padding: 0 16px 12px; color: #666; font-size: 13px; font-style: italic;">* Excludes custom offer trips, which will be quoted separately.</td></tr>` : ''}
                  </table>
                  ` : ''}

                  ${!isAdmin ? (() => {
                    // Compute late-update (14 days) and final lock (3 days) windows
                    let html = '';
                    if (!checkInDate) return '';
                    const [y, m, d] = checkInDate.split('-').map(Number);
                    const today = new Date(); today.setHours(0,0,0,0);
                    const lateStart = new Date(y, m - 1, d); lateStart.setDate(lateStart.getDate() - 14);
                    const finalLock = new Date(y, m - 1, d); finalLock.setDate(finalLock.getDate() - 3);
                    const pastFinalLock = finalLock.getTime() <= today.getTime();
                    const inLateWindow = lateStart.getTime() <= today.getTime() && !pastFinalLock;

                    if (pastFinalLock) {
                      html = `<p style="margin-top: 24px; font-size: 14px; color: #ffffff; background-color: #b91c1c; padding: 16px; border-radius: 8px; font-weight: 600;">Your information is now finalized. Please contact hello@quintamor.com for any changes.</p>`;
                    } else if (inLateWindow) {
                      html = `<p style="margin-top: 24px; font-size: 14px; color: #78350f; background-color: #fde68a; border: 1px solid #f59e0b; padding: 16px; border-radius: 8px;"><strong>Your stay is approaching.</strong> Please finalize your information as soon as possible. Modifications will no longer be possible 3 days before your arrival.</p>`;
                    } else {
                      html = `<p style="margin-top: 24px; font-size: 14px; color: #333; background-color: #f6efea; padding: 16px; border-radius: 8px;">You may edit your information until 3 days before your arrival. Log in to your Guest Area anytime to view or update your selections.</p>`;
                    }
                    return html;
                  })() : ''}
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
    console.error("Unhandled error:", error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
