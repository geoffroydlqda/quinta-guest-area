/**
 * Page publique investisseurs (11 août 2026) — /investors/:token
 * Lecture seule : P&L mensuel (HT, accrual) + cash flow (TTC), servis par
 * l'edge function investor-report (auth par token secret, agrégats uniquement).
 * Le lien est inclus dans l'Investor update mensuel de l'onglet Finance.
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Landmark, TrendingUp, Wallet2 } from "lucide-react";

type Report = {
  year: string;
  years: string[];
  generated_at: string;
  pnl: {
    revenue: Record<string, number[]>;
    other_income: number[];
    total_revenue: number[];
    variable_costs: Record<string, number[]>;
    fixed_costs: Record<string, number[]>;
    total_variable: number[];
    total_fixed: number[];
    margin_after_variable: number[];
    ebitda: number[];
  };
  cash: {
    money_in: number[];
    money_out: number[];
    of_which_cash: number[];
    of_which_capital: number[];
  };
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt0 = (v: number) =>
  `${v < 0 ? "−" : ""}€${Math.abs(v).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

// Ordre d'affichage des lignes de revenus (miroir de FinancePage)
const REV_LINE_ORDER = [
  "Venue — retreats", "Venue — weddings", "Venue — day retreats", "Venue — other events",
  "Catering — retreats", "Catering — weddings", "Catering — day retreats", "Catering — other events",
  "Extras — retreats", "Extras — weddings", "Extras — day retreats", "Extras — other events",
  "Discounts", "Bar (merchant)",
];
const rank = (l: string) => { const i = REV_LINE_ORDER.indexOf(l); return i === -1 ? REV_LINE_ORDER.length : i; };

function Row({ label, arr, bold, indent, negative }: { label: string; arr: number[]; bold?: boolean; indent?: boolean; negative?: boolean }) {
  if (!bold && arr.every((v) => v === 0)) return null;
  return (
    <tr className="border-t border-border/40">
      <td className={`py-1.5 pr-2 sticky left-0 bg-card whitespace-nowrap ${bold ? "font-semibold" : "text-muted-foreground"} ${indent ? "pl-3" : ""}`}>{label}</td>
      {arr.map((v, i) => (
        <td key={i} className={`py-1.5 px-2 text-right tabular-nums ${bold ? "font-semibold" : ""}`}>
          {v ? `${negative ? "−" : ""}${fmt0(v)}` : "·"}
        </td>
      ))}
      <td className={`py-1.5 px-2 text-right tabular-nums ${bold ? "font-bold" : "font-semibold"}`}>{negative ? "−" : ""}{fmt0(sum(arr))}</td>
    </tr>
  );
}

function Head() {
  return (
    <thead>
      <tr className="text-left">
        <th className="py-1.5 pr-2 font-semibold text-muted-foreground sticky left-0 bg-card">&nbsp;</th>
        {MONTHS.map((m) => <th key={m} className="py-1.5 px-2 text-right font-semibold text-muted-foreground">{m}</th>)}
        <th className="py-1.5 px-2 text-right font-bold text-muted-foreground">Total</th>
      </tr>
    </thead>
  );
}

export default function InvestorReport() {
  const { token } = useParams<{ token: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [year, setYear] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    supabase.functions
      .invoke("investor-report", { body: { token, ...(year ? { year } : {}) } })
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err || data?.error) setError("This link is not valid or has been revoked.");
        else setReport(data as Report);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [token, year]);

  if (loading && !report) {
    return (
      <div className="admin-ui min-h-screen bg-[#F6F7F2] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[#35532A]" />
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="admin-ui min-h-screen bg-[#F6F7F2] flex items-center justify-center px-4">
        <div className="max-w-md text-center space-y-2">
          <h1 className="text-lg font-semibold">Quinta do Amor — Investor figures</h1>
          <p className="text-sm text-muted-foreground">{error ?? "Something went wrong."}</p>
        </div>
      </div>
    );
  }

  const { pnl, cash } = report;
  const net = MONTHS.map((_, m) => cash.money_in[m] - cash.money_out[m]);
  const bankIn = MONTHS.map((_, m) => cash.money_in[m] - cash.of_which_cash[m] - cash.of_which_capital[m]);

  return (
    <div className="admin-ui min-h-screen bg-[#F6F7F2] text-[#31352E]">
      <header className="border-b border-[#E7E8E1] bg-white/85 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold leading-tight">💐 Quinta do Amor — Investor figures</h1>
            <p className="text-[11px] text-muted-foreground">
              Read-only · P&L net of VAT (accrual) · cash at bank date · updated {new Date(report.generated_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
            </p>
          </div>
          <span className="flex gap-1.5">
            {report.years.map((y) => (
              <button key={y} type="button" onClick={() => setYear(y)}
                className={`rounded-full px-3 py-1 text-sm border ${y === report.year ? "bg-[#35532A] text-white border-[#35532A] font-medium" : "bg-white border-[#E7E8E1] hover:bg-[#EAF6DF]"}`}>
                {y}
              </button>
            ))}
          </span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* ================= P&L ================= */}
        <section id="pnl" className="overflow-auto rounded-2xl bg-card shadow-sm border border-border/60 p-4 scroll-mt-16">
          <div className="font-semibold text-sm mb-1 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[#35532A]" /> P&L {report.year}
            <span className="text-xs font-normal text-muted-foreground">· net of VAT · accrual (revenue at event month)</span>
          </div>
          <table className="w-full text-xs mt-3">
            <Head />
            <tbody>
              <tr><td colSpan={14} className="pb-1 pr-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground sticky left-0 bg-card">Revenue</td></tr>
              {Object.entries(pnl.revenue)
                .sort((a, b) => rank(a[0]) - rank(b[0]))
                .map(([label, arr]) => <Row key={label} label={label} arr={arr} indent />)}
              <Row label="Other income" arr={pnl.other_income} indent />
              <Row label="Total revenue" arr={pnl.total_revenue} bold />
              <tr><td colSpan={14} className="pt-3 pb-1 pr-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground sticky left-0 bg-card">Variable costs — per event</td></tr>
              {Object.entries(pnl.variable_costs).sort((a, b) => a[0].localeCompare(b[0]))
                .map(([label, arr]) => <Row key={label} label={label} arr={arr} indent negative />)}
              <Row label="Total variable costs" arr={pnl.total_variable} bold negative />
              <tr className="border-t border-border bg-[#F4F7EF]">
                <td className="py-1.5 pr-2 font-semibold sticky left-0 bg-[#F4F7EF] whitespace-nowrap">Margin after variable costs</td>
                {pnl.margin_after_variable.map((v, i) => (
                  <td key={i} className={`py-1.5 px-2 text-right tabular-nums font-semibold ${v < 0 ? "text-destructive" : ""}`}>{v ? fmt0(v) : "·"}</td>
                ))}
                <td className="py-1.5 px-2 text-right tabular-nums font-bold">{fmt0(sum(pnl.margin_after_variable))}</td>
              </tr>
              <tr><td colSpan={14} className="pt-3 pb-1 pr-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground sticky left-0 bg-card">Fixed & other costs</td></tr>
              {Object.entries(pnl.fixed_costs).sort((a, b) => a[0].localeCompare(b[0]))
                .map(([label, arr]) => <Row key={label} label={label} arr={arr} indent negative />)}
              <Row label="Total fixed & other" arr={pnl.total_fixed} bold negative />
              <tr className="border-t-2 border-border bg-secondary/60">
                <td className="py-2 pr-2 font-bold sticky left-0 bg-secondary/60">EBITDA</td>
                {pnl.ebitda.map((v, i) => (
                  <td key={i} className={`py-2 px-2 text-right tabular-nums font-bold ${v < 0 ? "text-destructive" : ""}`}>{v ? fmt0(v) : "·"}</td>
                ))}
                <td className="py-2 px-2 text-right tabular-nums font-extrabold">{fmt0(sum(pnl.ebitda))}</td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* ================= CASH FLOW ================= */}
        <section id="cash" className="overflow-auto rounded-2xl bg-card shadow-sm border border-border/60 p-4 scroll-mt-16">
          <div className="font-semibold text-sm mb-1 flex items-center gap-2">
            <Wallet2 className="w-4 h-4 text-[#35532A]" /> Cash flow {report.year}
            <span className="text-xs font-normal text-muted-foreground">· gross of VAT · at bank/payment date · internal transfers excluded</span>
          </div>
          <table className="w-full text-xs mt-3">
            <Head />
            <tbody>
              <Row label="Money in" arr={cash.money_in} bold />
              <Row label="of which bank (card & transfers)" arr={bankIn} indent />
              <Row label="of which cash (espèces)" arr={cash.of_which_cash} indent />
              <Row label="of which owner contributions" arr={cash.of_which_capital} indent />
              <Row label="Money out" arr={cash.money_out} bold negative />
              <tr className="border-t-2 border-border bg-secondary/60">
                <td className="py-2 pr-2 font-bold sticky left-0 bg-secondary/60">Net</td>
                {net.map((v, i) => (
                  <td key={i} className={`py-2 px-2 text-right tabular-nums font-bold ${v < 0 ? "text-destructive" : ""}`}>{v ? fmt0(v) : "·"}</td>
                ))}
                <td className="py-2 px-2 text-right tabular-nums font-extrabold">{fmt0(sum(net))}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <footer className="pb-8 text-center text-[11px] text-muted-foreground">
          Quinta do Amor · figures generated live from the operations tool · this link is private, please do not share
        </footer>
      </main>
    </div>
  );
}
