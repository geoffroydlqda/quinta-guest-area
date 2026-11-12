// Rappels d'inventaire (12 nov 2026) — logique "comptage la veille de l'event".
// Cron quotidien (inventory-reminder-daily, 07:35 UTC, x-cron-key) :
// - J-1 avant le prochain check-in (jour tampon sans client) et aucun comptage
//   termine ce jour-la -> email de rappel a Luis (staff_profiles, role Logistics),
//   avec la shopping list du moment.
// - Jour J et toujours aucun comptage depuis la veille -> escalade a Geoffroy
//   (hello@), Luis en copie.
// Dedoublonnage via reminder_log (type inventory_count_due / inventory_count_overdue,
// un envoi par booking et par type). {preview:true} (JWT admin ou x-cron-key) =
// dry-run sans envoi.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);
const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const OWNER_EMAIL = "hello@quintamor.com";
const FROM_EMAIL = "Quinta do Amor <hello@quintamor.com>";
const INVENTORY_URL = "https://guest.quintamor.com/admin/inventory";

const esc = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const lisbonDay = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(d); // YYYY-MM-DD

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function cronKeyOk(req: Request): Promise<boolean> {
  const given = req.headers.get("x-cron-key");
  if (!given) return false;
  const { data } = await admin.from("app_settings").select("value").eq("key", "internal").maybeSingle();
  return !!data?.value?.cron_key && given === data.value.cron_key;
}

async function isAdminJwt(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data: { user } } = await userClient.auth.getUser();
  if (!user?.email) return false;
  const { data } = await admin.from("admin_users").select("email").eq("email", user.email.toLowerCase()).maybeSingle();
  return !!data;
}

serve(async (req) => {
  try {
    if (req.method !== "POST") return json({ error: "POST only" }, 405);
    const authed = (await cronKeyOk(req)) || (await isAdminJwt(req));
    if (!authed) return json({ error: "Unauthorized" }, 401);
    const body = await req.json().catch(() => ({})) as { preview?: boolean };
    const preview = !!body.preview;

    const today = lisbonDay();

    // Prochain evenement reel.
    const { data: bookings } = await admin.from("bookings")
      .select("id,retreat_name,check_in_date")
      .gte("check_in_date", today).eq("is_test", false).is("cancelled_at", null)
      .order("check_in_date", { ascending: true }).limit(1);
    const next = bookings?.[0];
    if (!next?.check_in_date) return json({ ok: true, action: "none", reason: "no upcoming booking" });

    const dueDay = addDays(next.check_in_date, -1);
    if (today < dueDay) return json({ ok: true, action: "none", reason: "count not due yet", dueDay });

    // Comptage deja fait depuis le jour tampon ?
    const { data: counts } = await admin.from("inventory_counts")
      .select("id,completed_at").not("completed_at", "is", null)
      .gte("completed_at", `${dueDay}T00:00:00Z`)
      .order("completed_at", { ascending: false }).limit(1);
    if (counts?.length) return json({ ok: true, action: "none", reason: "count already done", dueDay });

    const kind = today === dueDay ? "inventory_count_due" : "inventory_count_overdue";

    // Dedup : un envoi par booking et par type.
    const { data: already } = await admin.from("reminder_log")
      .select("id").eq("type", kind).eq("booking_id", next.id).eq("status", "sent").limit(1);
    if (already?.length) return json({ ok: true, action: "none", reason: "already sent", kind });

    // Destinataires : Luis (Logistics), escalade avec Geoffroy en plus.
    const { data: staff } = await admin.from("staff_profiles")
      .select("name,email,role").eq("active", true).ilike("role", "%logistic%").not("email", "is", null).limit(1);
    const luis = staff?.[0];
    const to = kind === "inventory_count_due" ? [luis?.email ?? OWNER_EMAIL] : [OWNER_EMAIL];
    const cc = kind === "inventory_count_overdue" && luis?.email ? [luis.email] : undefined;

    // Shopping list du moment (pour rendre l'email actionnable).
    const { data: items } = await admin.from("inventory_items")
      .select("name,reference,supplier,unit,par,reorder_point,current_qty")
      .eq("active", true);
    const toBuy = (items ?? []).filter((i) =>
      i.current_qty !== null && Number(i.current_qty) <= Number(i.reorder_point));
    const listHtml = toBuy.length
      ? `<p><b>Current shopping list:</b></p><ul>` + toBuy.map((i) => {
          const qty = Math.max(1, Math.ceil(Number(i.par) - Number(i.current_qty ?? 0)));
          return `<li>${esc(i.name)} — buy ${qty} ${esc(i.unit ?? "")}${i.reference ? ` · <i>${esc(i.reference)}</i>` : ""}${i.supplier ? ` (${esc(i.supplier)})` : ""}</li>`;
        }).join("") + `</ul>`
      : `<p>The shopping list will appear once the count is done.</p>`;

    const arrival = new Date(`${next.check_in_date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    const subject = kind === "inventory_count_due"
      ? `Inventory count today — ${next.retreat_name} arrives tomorrow`
      : `⚠️ Inventory count NOT done — ${next.retreat_name} arrives today`;
    const intro = kind === "inventory_count_due"
      ? `<p>Hi Luis,</p><p>Today is the buffer day before <b>${esc(next.retreat_name)}</b> (arrival ${esc(arrival)}). Please count the housekeeping stock and buy what's missing.</p>`
      : `<p>The pre-event inventory count was <b>not done</b> on the buffer day. <b>${esc(next.retreat_name)}</b> arrives today (${esc(arrival)}).</p>`;
    const html = `${intro}${listHtml}<p><a href="${INVENTORY_URL}" style="display:inline-block;background:#CAE8BD;color:#35532A;font-weight:600;border-radius:10px;padding:10px 18px;text-decoration:none">Open Inventory</a></p>`;

    if (preview) return json({ ok: true, preview: true, kind, to, cc, subject, to_buy: toBuy.length });

    const sent = await resend.emails.send({ from: FROM_EMAIL, to, cc, subject, html });
    await admin.from("reminder_log").insert({
      type: kind, booking_id: next.id, recipient: to.join(", "), subject,
      status: sent.error ? "error" : "sent", error: sent.error ? String(sent.error.message ?? sent.error) : null,
      body_html: html, resend_id: sent.data?.id ?? null,
    });
    if (sent.error) return json({ ok: false, error: String(sent.error.message ?? sent.error) }, 500);
    return json({ ok: true, action: "sent", kind, to, cc });
  } catch (e) {
    console.error("inventory-reminder error:", e);
    return json({ error: String(e).slice(0, 300) }, 500);
  }
});
