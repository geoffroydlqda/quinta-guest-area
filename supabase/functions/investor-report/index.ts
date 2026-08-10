// Investor report — chiffres agrégés publics (11 août 2026).
// Sert la page /investors/:token : P&L mensuel (HT, accrual) + cash flow
// (TTC, date banque), calculés avec les MÊMES règles que l'onglet Finance.
// Auth : token secret stocké dans app_settings key='investor_share'
// (généré depuis l'admin). Lecture seule, agrégats uniquement — aucun nom
// de client, aucune transaction individuelle.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Coûts variables du P&L (miroir de FinancePage.PNL_VARIABLE_CATS)
const PNL_VARIABLE_CATS = new Set([
  "Retreat — catering / staff", "Retreat — catering / food",
  "Retreat — venue / cleaning & fixed", "Retreat - extras",
  "Wedding — catering / staff", "Wedding — catering / food",
  "Wedding — venue / cleaning & fixed", "Wedding - extras",
]);

const REV_EVENT_LABEL: Record<string, string> = {
  retreat: "retreats", wedding: "weddings", day_retreat: "day retreats", other: "other events",
};

function revenueLine(category: string, eventType: string): string {
  if (category === "bar") return "Bar (merchant)";
  if (category === "discount") return "Discounts";
  const ev = REV_EVENT_LABEL[eventType] ?? REV_EVENT_LABEL.retreat;
  if (category === "catering") return `Catering — ${ev}`;
  if (category === "extra") return `Extras — ${ev}`;
  return `Venue — ${ev}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const token = String((body as { token?: string }).token ?? "");
    const yearReq = String((body as { year?: string }).year ?? "");

    const { data: share } = await admin.from("app_settings").select("value").eq("key", "investor_share").maybeSingle();
    const expected = (share?.value as { token?: string } | null)?.token;
    if (!expected || !token || token !== expected) return json({ error: "Invalid link" }, 403);

    const [{ data: txs }, { data: insts }, { data: bookings }] = await Promise.all([
      admin.from("fin_transactions").select("date,amount,amount_net,kind,category,booking_id,pnl_month,notes,source"),
      admin.from("payment_installments").select("booking_id,amount_due,amount_excl_vat,category,status,is_cash,paid_on,due_date"),
      admin.from("bookings").select("id,check_in_date,event_type,is_test"),
    ]);
    const real = new Map((bookings ?? []).filter((b) => !b.is_test).map((b) => [b.id, b]));

    // Années disponibles
    const yearsSet = new Set<string>();
    for (const t of txs ?? []) yearsSet.add(String(t.date).slice(0, 4));
    for (const b of real.values()) if (b.check_in_date) yearsSet.add(String(b.check_in_date).slice(0, 4));
    const years = [...yearsSet].sort();
    // Défaut : l'année en cours (pas la dernière année ayant des données —
    // un booking 2027 ne doit pas ouvrir la page en vue 2027).
    const nowYear = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon", year: "numeric" }).format(new Date());
    const year = years.includes(yearReq) ? yearReq
      : years.includes(nowYear) ? nowYear
      : (years[years.length - 1] ?? nowYear);

    const Z = () => Array.from({ length: 12 }, () => 0);

    // ---- P&L (HT, accrual — mêmes règles que l'onglet Finance) ------------
    const revRows = new Map<string, number[]>();
    const addRev = (line: string, m: number, v: number) => {
      const a = revRows.get(line) ?? Z(); a[m] += v; revRows.set(line, a);
    };
    for (const i of insts ?? []) {
      const b = real.get(i.booking_id);
      if (!b?.check_in_date || !String(b.check_in_date).startsWith(year)) continue;
      const m = Number(String(b.check_in_date).slice(5, 7)) - 1;
      const net = i.amount_excl_vat != null
        ? Number(i.amount_excl_vat)
        : Number(i.amount_due || 0) / (i.category === "catering" ? 1.13 : 1.23);
      addRev(revenueLine(String(i.category ?? "rental"), String(b.event_type ?? "retreat")), m, net);
    }
    const byCat = new Map<string, number[]>();
    const otherIncome = Z();
    for (const t of txs ?? []) {
      if (t.kind === "bar_payout" && Number(t.amount) > 0) {
        const bm = (t.pnl_month as string | null) ?? String(t.date).slice(0, 7);
        if (bm.startsWith(year)) addRev("Bar (merchant)", Number(bm.slice(5, 7)) - 1, Number(t.amount_net ?? t.amount));
        continue;
      }
      if (t.kind === "other_income") {
        const om = (t.pnl_month as string | null) ?? String(t.date).slice(0, 7);
        if (om.startsWith(year)) otherIncome[Number(om.slice(5, 7)) - 1] += Number(t.amount_net ?? t.amount);
        continue;
      }
      if (t.kind !== "expense" || !t.category) continue;
      const b = t.booking_id ? real.get(t.booking_id) : null;
      const accrual = t.pnl_month ? `${t.pnl_month}-01` : (b?.check_in_date ?? t.date);
      if (!String(accrual).startsWith(year)) continue;
      const m = Number(String(accrual).slice(5, 7)) - 1;
      const a = byCat.get(t.category) ?? Z();
      a[m] += Number(t.amount_net ?? Math.abs(Number(t.amount)));
      byCat.set(t.category, a);
    }
    const sumRows = (rows: number[][]) => Z().map((_, m) => rows.reduce((s, a) => s + a[m], 0));
    const totalRev = Z().map((_, m) =>
      [...revRows.values()].reduce((s, a) => s + a[m], 0) + otherIncome[m]);
    const varCats = [...byCat.entries()].filter(([c]) => PNL_VARIABLE_CATS.has(c));
    const fixCats = [...byCat.entries()].filter(([c]) => !PNL_VARIABLE_CATS.has(c));
    const totalVar = sumRows(varCats.map(([, a]) => a));
    const totalFix = sumRows(fixCats.map(([, a]) => a));
    const margin = Z().map((_, m) => totalRev[m] - totalVar[m]);
    const ebitda = Z().map((_, m) => totalRev[m] - totalVar[m] - totalFix[m]);

    // ---- Cash flow (TTC, date banque — mêmes règles que l'onglet Finance) --
    const cin = Z(), cout = Z(), cashDrawer = Z(), capital = Z();
    for (const t of txs ?? []) {
      if (t.kind === "internal" || t.kind === "split" || !String(t.date).startsWith(year)) continue;
      const m = Number(String(t.date).slice(5, 7)) - 1;
      const amt = Number(t.amount);
      if (amt > 0) cin[m] += amt; else cout[m] += -amt;
      if (t.kind === "capital" && amt > 0) capital[m] += amt;
    }
    let cashUndated = 0;
    for (const i of insts ?? []) {
      if (!i.is_cash || i.status !== "paid" || !real.has(i.booking_id)) continue;
      const d = (i.paid_on as string | null) ?? (i.due_date as string | null);
      if (!d) { cashUndated += Number(i.amount_due || 0); continue; }
      if (!String(d).startsWith(year)) continue;
      const m = Number(String(d).slice(5, 7)) - 1;
      cin[m] += Number(i.amount_due || 0);
      cashDrawer[m] += Number(i.amount_due || 0);
    }

    const r2 = (a: number[]) => a.map((v) => Math.round(v * 100) / 100);
    return json({
      year, years,
      generated_at: new Date().toISOString(),
      pnl: {
        revenue: Object.fromEntries([...revRows.entries()].map(([k, a]) => [k, r2(a)])),
        other_income: r2(otherIncome),
        total_revenue: r2(totalRev),
        variable_costs: Object.fromEntries(varCats.map(([k, a]) => [k, r2(a)])),
        fixed_costs: Object.fromEntries(fixCats.map(([k, a]) => [k, r2(a)])),
        total_variable: r2(totalVar),
        total_fixed: r2(totalFix),
        margin_after_variable: r2(margin),
        ebitda: r2(ebitda),
      },
      cash: { money_in: r2(cin), money_out: r2(cout), of_which_cash: r2(cashDrawer), of_which_capital: r2(capital), cash_undated: Math.round(cashUndated * 100) / 100 },
    });
  } catch (e) {
    console.error("investor-report error:", String((e as Error)?.message ?? e));
    return json({ error: "Internal error" }, 500);
  }
});
