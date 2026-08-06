import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Landmark, Loader2, Plus, Upload, TrendingUp, Wallet2, ReceiptText } from "lucide-react";

/**
 * Onglet Finance (4 août 2026) — phase 1, alimentée par import CSV Revolut
 * (la sync API Business se branchera par-dessus, mêmes tables).
 *
 * Règle d'or validée avec Geoffroy :
 * - Trésorerie = mouvements bancaires au mois où ils ont lieu (kind != internal)
 * - P&L (HT, accrual) = échéances des événements au MOIS DU CHECK-IN
 *   + dépenses (booking lié -> mois du check-in ; sinon date de transaction)
 * - Anti-double comptage par "kind" : guest_payment / bar_payout / internal /
 *   vat_payment ne créent JAMAIS de ligne P&L.
 */

// ---- Catégories : nomenclature du QdA Financial Model + 3 ajouts ----------
export const FIN_CATEGORIES: { group: string; items: string[] }[] = [
  { group: "Core team — fixed payroll", items: ["Management - Geo", "Management - Loïs", "Logistics - Luis"] },
  { group: "Property operations & maintenance", items: [
    "Cleaning (out of season)", "Cleaning (in season)", "Equipment & furniture", "Furniture maintenance",
    "Gardening (contract)", "Gardening (seasonal)", "General maintenance", "Pool maintenance",
    "Property operations & supplies",
  ]},
  { group: "Insurance & legal", items: ["Insurance — property", "Insurance — events"] },
  { group: "General & admin", items: ["Accounting", "Internet", "Software", "Team expenses", "Admin"] },
  { group: "Utilities", items: ["Electricity", "Water", "Gas", "Fuel"] },
  { group: "Marketing & sales", items: ["Advertising", "Commission", "Listing fee"] },
  { group: "Other fixed", items: ["Bank & payment fees", "Taxes & duties"] },
  { group: "Variable — retreat", items: [
    "Retreat — catering / staff", "Retreat — catering / food", "Retreat — venue / cleaning & fixed", "Retreat - extras",
  ]},
  { group: "Variable — wedding", items: [
    "Wedding — catering / staff", "Wedding — catering / food", "Wedding — venue / cleaning & fixed", "Wedding - extras",
  ]},
  { group: "Variable — other", items: ["Bar — stock", "Other variable"] },
];
const ALL_CATEGORIES = FIN_CATEGORIES.flatMap((g) => g.items);

const KIND_LABEL: Record<string, { label: string; cls: string }> = {
  expense: { label: "Expense", cls: "bg-[#FBE8DA] text-[#8A4A1B]" },
  guest_payment: { label: "Guest payment — already in P&L", cls: "bg-[#E5F5EA] text-[#178A3F]" },
  bar_payout: { label: "Bar payout — already in P&L", cls: "bg-[#E5F5EA] text-[#178A3F]" },
  internal: { label: "Internal transfer — excluded", cls: "bg-muted text-muted-foreground" },
  capital: { label: "Owner contribution — cash only", cls: "bg-[#EDE9FE] text-[#5B21B6]" },
  vat_payment: { label: "VAT payment — cash only", cls: "bg-[#E8F0FB] text-[#1C5CAB]" },
  other_income: { label: "Other income", cls: "bg-[#E5F5EA] text-[#178A3F]" },
  review: { label: "To review", cls: "bg-[#FDF1E0] text-[#B45309]" },
  split: { label: "Split across events", cls: "bg-[#F3EDFF] text-[#8a63d2]" },
};

type FinTx = {
  id: string; source: string; dedup_key: string | null; date: string;
  description: string | null; amount: number; currency: string; kind: string;
  category: string | null; vat_rate: number | null; amount_net: number | null;
  booking_id: string | null; notes: string | null; reviewed: boolean;
  parent_id?: string | null; payer?: string | null;
};

type FinRule = { id: string; pattern: string; kind: string; category: string | null; vat_rate: number | null };

export type FinBooking = {
  id: string; name: string; check_in_date: string | null; check_out_date?: string | null;
  event_type: string | null; is_test: boolean;
};

// Catégories variables : les seules qu'on rattache automatiquement à un séjour
const VARIABLE_CATS = new Set(
  FIN_CATEGORIES.filter((g) => g.group.startsWith("Variable")).flatMap((g) => g.items)
);

// P&L : coûts VARIABLES au sens du modèle financier (validé avec Geoffroy,
// 6 août 2026) — uniquement les 8 tags retreat/wedding. "Bar — stock" et
// "Other variable" restent dans le bloc fixe & autres.
const PNL_VARIABLE_CATS = new Set([
  "Retreat — catering / staff", "Retreat — catering / food",
  "Retreat — venue / cleaning & fixed", "Retreat - extras",
  "Wedding — catering / staff", "Wedding — catering / food",
  "Wedding — venue / cleaning & fixed", "Wedding - extras",
]);

export type FinInstallment = {
  booking_id: string; amount_due: number; amount_excl_vat?: number | null;
  category?: string | null; is_cash?: boolean; status?: string;
  due_date?: string | null; paid_on?: string | null;
};

const fmt0 = (v: number) =>
  `${v < 0 ? "−" : ""}€${Math.abs(v).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
const fmt2 = (v: number) =>
  `${v < 0 ? "−" : ""}€${Math.abs(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ---- Parsing CSV Revolut ---------------------------------------------------
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

// ---- Suggestions de catégorie (nom du business, contexte) -----------------
// Marchands portugais / SaaS connus -> catégorie la plus probable + TVA usuelle.
// Le clic "Accept" passe par categorize(), donc crée aussi une règle apprenante.
const SUGGESTIONS: { re: RegExp; category: string; vat: number }[] = [
  { re: /intermarche|continente|pingo doce|lidl|aldi|auchan|minipre|mercadona|aux fins gourmets|talho|padaria|frutaria|makro|recheio|celeiro|pr[oó]vida/, category: "Retreat — catering / food", vat: 6 },
  { re: /vinho|garrafeira|adega|wine/, category: "Bar — stock", vat: 13 },
  { re: /\bedp\b|su eletricidade|endesa|iberdrola/, category: "Electricity", vat: 23 },
  { re: /aguas|águas|simarsul/, category: "Water", vat: 6 },
  { re: /galp gas|r[uú]brica g[aá]s|butano|propano/, category: "Gas", vat: 23 },
  { re: /nos comunicacoes|\bmeo\b|vodafone|starlink/, category: "Internet", vat: 23 },
  { re: /repsol|posto bp|\bgalp\b|prio |cepsa|combust/, category: "Fuel", vat: 23 },
  { re: /leroy merlin|maxmat|bricomarche|\baki\b|brico|ferragens|zimbrafogo/, category: "General maintenance", vat: 23 },
  { re: /amazon|decathlon|ikea|conforama|casa\b.*decor/, category: "Equipment & furniture", vat: 23 },
  { re: /notion|sqsp|squarespace|intuit|quickbooks|google|adobe|canva|openai|anthropic|claude|supabase|vercel|resend|moloni|stripe.*fee/, category: "Software", vat: 23 },
  { re: /municipio|financas|freguesia|\bimi\b|\bimt\b|selo/, category: "Taxes & duties", vat: 0 },
  { re: /piscina|pool/, category: "Pool maintenance", vat: 23 },
  { re: /jardim|jardinagem|garden/, category: "Gardening (seasonal)", vat: 23 },
  { re: /seguro|fidelidade|tranquilidade|allianz|ageas|generali/, category: "Insurance — property", vat: 0 },
  { re: /contabil|accounting/, category: "Accounting", vat: 23 },
  { re: /farmacia|wells|clinica/, category: "Property operations & supplies", vat: 23 },
];
function suggestFor(t: { description: string | null; notes: string | null; amount: number }): { category: string; vat: number } | null {
  if (t.amount > 0) return null;
  const d = `${t.description ?? ""} ${t.notes ?? ""}`.toLowerCase();
  for (const s of SUGGESTIONS) if (s.re.test(d)) return s;
  return null;
}

// Classification automatique anti-double comptage
function autoKind(desc: string, amount: number, rules: FinRule[]): Partial<FinTx> {
  const d = desc.toLowerCase();
  for (const r of rules) {
    if (d.includes(r.pattern.toLowerCase())) {
      return {
        kind: r.kind, category: r.category, vat_rate: r.vat_rate,
        amount_net: r.kind === "expense" && r.vat_rate != null
          ? Math.round(Math.abs(amount) / (1 + Number(r.vat_rate) / 100) * 100) / 100
          : null,
        reviewed: true,
      };
    }
  }
  if (/stripe/.test(d) && amount > 0) return { kind: "guest_payment", reviewed: true };
  if (/(payout|settlement).*(merchant)|merchant.*(payout|settlement)/.test(d) && amount > 0)
    return { kind: "bar_payout", reviewed: true };
  if (/^to (eur|usd|gbp|savings|pocket)|^exchanged|between own accounts|vault|cash deposit|dep[oó]sito.*numer[aá]rio/.test(d))
    return { kind: "internal", reviewed: true };
  if (/autoridade tribut|(^|\s)at($|\s)|imposto|\biva\b/.test(d) && amount < 0)
    return { kind: "vat_payment", reviewed: true };
  if (/revolut.*fee|fee.*revolut|service charge/.test(d) && amount < 0)
    return { kind: "expense", category: "Bank & payment fees", vat_rate: 0, amount_net: Math.abs(amount), reviewed: true };
  return { kind: "review", reviewed: false };
}

export function FinancePage({ bookings, installments }: {
  bookings: FinBooking[];
  installments: FinInstallment[];
}) {
  const { toast } = useToast();
  const [tab, setTab] = useState<"tx" | "pnl" | "cash">("tx");
  const [txs, setTxs] = useState<FinTx[]>([]);
  const [rules, setRules] = useState<FinRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState<"review" | "in" | "all">("review");
  const [showManual, setShowManual] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Ventilation multi-événements (facture staff couvrant 2-3 retraites)
  const [splitFor, setSplitFor] = useState<string | null>(null);
  const [deleteArm, setDeleteArm] = useState<string | null>(null);
  const [splitLines, setSplitLines] = useState<{ amount: string; category: string; booking_id: string; vat: string }[]>([]);

  const realBookings = useMemo(() => bookings.filter((b) => !b.is_test), [bookings]);
  const bookingById = useMemo(() => new Map(realBookings.map((b) => [b.id, b])), [realBookings]);

  const load = async () => {
    const [t, r] = await Promise.all([
      supabase.from("fin_transactions").select("*").order("date", { ascending: false }).limit(2000),
      supabase.from("fin_rules").select("*"),
    ]);
    setTxs((t.data as FinTx[] | null) ?? []);
    setRules((r.data as FinRule[] | null) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // ---- Import CSV Revolut --------------------------------------------------
  const importCsv = async (file: File) => {
    setImporting(true);
    try {
      const rows = parseCsv(await file.text());
      if (rows.length < 2) throw new Error("Empty file");
      const header = rows[0].map((h) => h.trim().toLowerCase());
      const idx = (pred: (h: string) => boolean) => header.findIndex(pred);
      const iDate = idx((h) => h.includes("completed")) !== -1 ? idx((h) => h.includes("completed")) : idx((h) => h.includes("date"));
      const iDesc = idx((h) => h === "description" || h.includes("description"));
      const iAmount = idx((h) => h === "amount");
      const iFee = idx((h) => h === "fee");
      const iState = idx((h) => h === "state");
      const iCur = idx((h) => h === "currency");
      const iBal = idx((h) => h === "balance");
      if (iDate === -1 || iAmount === -1) throw new Error("Not a Revolut export — missing Date/Amount columns");

      const payloads = [];
      for (const r of rows.slice(1)) {
        const state = iState >= 0 ? (r[iState] ?? "").toUpperCase() : "COMPLETED";
        if (state && state !== "COMPLETED") continue;
        const rawDate = (r[iDate] ?? "").trim();
        const date = rawDate.slice(0, 10).replace(/(\d{2})\/(\d{2})\/(\d{4})/, "$3-$2-$1");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        const amount = Number(r[iAmount]) + (iFee >= 0 ? -Math.abs(Number(r[iFee]) || 0) : 0);
        if (!Number.isFinite(amount) || amount === 0) continue;
        const desc = (r[iDesc] ?? "").trim();
        const dedup = `${date}|${desc}|${amount}|${iBal >= 0 ? r[iBal] : ""}`;
        payloads.push({
          source: "revolut", dedup_key: dedup, date, description: desc,
          amount, currency: iCur >= 0 ? (r[iCur] || "EUR") : "EUR",
          ...autoKind(desc, amount, rules),
        });
      }
      if (!payloads.length) throw new Error("No completed transactions found in the file");
      const { error } = await supabase.from("fin_transactions")
        .upsert(payloads, { onConflict: "dedup_key", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
      toast({ title: "Import done", description: `${payloads.length} transaction(s) processed — duplicates skipped automatically.` });
      await load();
    } catch (e) {
      toast({ title: "Import failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // ---- Catégorisation ------------------------------------------------------
  const patch = async (id: string, p: Partial<FinTx>) => {
    setTxs((arr) => arr.map((t) => (t.id === id ? { ...t, ...p } : t)));
    const { error } = await supabase.from("fin_transactions").update(p).eq("id", id);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); load(); }
  };

  // ---- Sync Revolut à la demande (l'horaire tourne via cron) ---------------
  const syncRevolut = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("revolut-sync", { body: {} });
      if (error) throw new Error(error.message);
      if (data?.connected === false) {
        toast({
          title: "Revolut not connected",
          description: "Open Revolut Business → Settings → API and click 'Enable API access' to (re)authorise the sync.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Revolut synced", description: `${data?.inserted ?? 0} new transaction(s) imported.` });
        await load();
      }
    } catch (e) {
      toast({ title: "Sync failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  // ---- Note libre par ligne ------------------------------------------------
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const saveNote = async (t: FinTx) => {
    setNoteFor(null);
    const v = noteDraft.trim();
    if ((t.notes ?? "") === v) return;
    await patch(t.id, { notes: v || null });
  };

  const categorize = async (t: FinTx, category: string, vatOverride?: number) => {
    if (t.amount > 0) {
      toast({ title: "Incoming money is never an expense", description: "Classify it as guest payment, bar payout, internal or other income instead.", variant: "destructive" });
      return;
    }
    const vat = vatOverride ?? t.vat_rate ?? 23;
    const net = Math.round(Math.abs(t.amount) / (1 + vat / 100) * 100) / 100;
    // Dépense variable sans événement -> rattachement auto si un seul séjour colle avec la date
    const autoEvent = !t.booking_id && VARIABLE_CATS.has(category) ? eventForDate(t.date) : null;
    await patch(t.id, { kind: "expense", category, vat_rate: vat, amount_net: net, reviewed: true, ...(autoEvent ? { booking_id: autoEvent.id } : {}) });
    // Règle apprenante : la contrepartie retiendra cette catégorie
    const pattern = (t.description ?? "").trim().slice(0, 24);
    if (pattern.length >= 4 && !rules.some((r) => r.pattern.toLowerCase() === pattern.toLowerCase())) {
      const { data } = await supabase.from("fin_rules")
        .insert({ pattern, kind: "expense", category, vat_rate: vat }).select("*").single();
      if (data) setRules((rs) => [...rs, data as FinRule]);
    }
  };

  const openSplit = (t: FinTx) => {
    setSplitFor(t.id);
    const half = Math.abs(t.amount) / 2;
    setSplitLines([
      { amount: half.toFixed(2), category: t.category ?? "", booking_id: "", vat: String(t.vat_rate ?? 23) },
      { amount: (Math.abs(t.amount) - half).toFixed(2), category: t.category ?? "", booking_id: "", vat: String(t.vat_rate ?? 23) },
    ]);
  };

  const saveSplit = async (t: FinTx) => {
    const lines = splitLines.filter((l) => Number(l.amount) > 0);
    if (lines.length < 2) { toast({ title: "At least 2 parts", variant: "destructive" }); return; }
    if (lines.some((l) => !l.category)) { toast({ title: "Each part needs a category", variant: "destructive" }); return; }
    const sum = lines.reduce((s, l) => s + Number(l.amount), 0);
    if (Math.abs(sum - Math.abs(t.amount)) > 0.01) {
      toast({ title: "Parts must add up", description: `Parts total €${sum.toFixed(2)} — transaction is €${Math.abs(t.amount).toFixed(2)}.`, variant: "destructive" });
      return;
    }
    const children = lines.map((l) => {
      const vat = Number(l.vat);
      return {
        source: "split", date: t.date,
        description: `${t.description ?? "Split"} (part)`,
        amount: -Math.abs(Number(l.amount)),
        kind: "expense", category: l.category, vat_rate: vat,
        amount_net: Math.round(Math.abs(Number(l.amount)) / (1 + vat / 100) * 100) / 100,
        booking_id: l.booking_id || null, parent_id: t.id, reviewed: true,
      };
    });
    const { error } = await supabase.from("fin_transactions").insert(children);
    if (error) { toast({ title: "Split failed", description: error.message, variant: "destructive" }); return; }
    await supabase.from("fin_transactions").update({ kind: "split", reviewed: true, category: null, amount_net: null }).eq("id", t.id);
    toast({ title: "Transaction split", description: `${children.length} parts created — treasury unchanged, P&L per event.` });
    setSplitFor(null);
    load();
  };

  const unsplit = async (t: FinTx) => {
    await supabase.from("fin_transactions").delete().eq("parent_id", t.id);
    await supabase.from("fin_transactions").update({ kind: "review", reviewed: false }).eq("id", t.id);
    load();
  };

  // ---- Rattachement auto dépense <-> séjour --------------------------------
  // La date tombe dans la fenêtre [check-in - 6 jours (courses de préparation),
  // check-out + 1 jour] d'UN SEUL événement -> on peut lier sans ambiguïté.
  const eventForDate = (date: string): FinBooking | null => {
    const ts = new Date(`${date}T12:00:00`).getTime();
    const D = 86400000;
    // 1) La date tombe PENDANT un séjour -> ce séjour gagne (priorité en saison back-to-back)
    const during = realBookings.filter((b) => {
      if (!b.check_in_date) return false;
      const from = new Date(`${b.check_in_date}T12:00:00`).getTime();
      const to = new Date(`${b.check_out_date ?? b.check_in_date}T12:00:00`).getTime();
      return ts >= from && ts <= to;
    });
    if (during.length === 1) return during[0];
    if (during.length > 1) return null;
    // 2) Sinon, fenêtre de préparation : jusqu'à 6 jours avant le check-in d'UN SEUL séjour
    const pre = realBookings.filter((b) => {
      if (!b.check_in_date) return false;
      const from = new Date(`${b.check_in_date}T12:00:00`).getTime();
      return ts >= from - 6 * D && ts < from;
    });
    return pre.length === 1 ? pre[0] : null;
  };

  const setVat = async (t: FinTx, vat: number) => {
    const net = Math.round(Math.abs(t.amount) / (1 + vat / 100) * 100) / 100;
    await patch(t.id, { vat_rate: vat, amount_net: t.kind === "expense" ? net : t.amount_net });
  };

  // ---- Agrégats P&L / Cash -------------------------------------------------
  const years = useMemo(() => {
    const ys = new Set<string>();
    for (const t of txs) ys.add(t.date.slice(0, 4));
    for (const b of realBookings) if (b.check_in_date) ys.add(b.check_in_date.slice(0, 4));
    const arr = [...ys].sort();
    return arr.length ? arr : [String(new Date().getFullYear())];
  }, [txs, realBookings]);
  const [year, setYear] = useState(String(new Date().getFullYear()));

  const pnl = useMemo(() => {
    // Revenus : échéances HT au mois du check-in (hors test, hors discount négatif déjà net)
    const revEvents = Array.from({ length: 12 }, () => 0);
    const revBar = Array.from({ length: 12 }, () => 0);
    for (const i of installments) {
      const b = bookingById.get(i.booking_id);
      if (!b?.check_in_date || !b.check_in_date.startsWith(year)) continue;
      const m = Number(b.check_in_date.slice(5, 7)) - 1;
      const net = i.amount_excl_vat != null
        ? Number(i.amount_excl_vat)
        : Number(i.amount_due || 0) / (i.category === "catering" ? 1.13 : 1.23);
      if (i.category === "bar") revBar[m] += net;
      else revEvents[m] += net;
    }
    // Dépenses : booking lié -> mois du check-in ; sinon date de transaction
    const byCat = new Map<string, number[]>();
    let otherIncome = Array.from({ length: 12 }, () => 0);
    for (const t of txs) {
      if (t.kind === "other_income") {
        if (t.date.startsWith(year)) otherIncome[Number(t.date.slice(5, 7)) - 1] += t.amount_net ?? t.amount;
        continue;
      }
      if (t.kind !== "expense" || !t.category) continue;
      const b = t.booking_id ? bookingById.get(t.booking_id) : null;
      const accrual = b?.check_in_date ?? t.date;
      if (!accrual.startsWith(year)) continue;
      const m = Number(accrual.slice(5, 7)) - 1;
      const arr = byCat.get(t.category) ?? Array.from({ length: 12 }, () => 0);
      arr[m] += t.amount_net ?? Math.abs(t.amount);
      byCat.set(t.category, arr);
    }
    const totalExp = Array.from({ length: 12 }, (_, m) =>
      [...byCat.values()].reduce((s, a) => s + a[m], 0));
    // Variable (8 tags retreat/wedding) vs fixe & autres
    const totalVar = Array.from({ length: 12 }, (_, m) =>
      [...byCat.entries()].filter(([c]) => PNL_VARIABLE_CATS.has(c)).reduce((s, [, a]) => s + a[m], 0));
    const totalFix = Array.from({ length: 12 }, (_, m) => totalExp[m] - totalVar[m]);
    const grossMargin = Array.from({ length: 12 }, (_, m) =>
      revEvents[m] + revBar[m] + otherIncome[m] - totalVar[m]);
    const ebitda = Array.from({ length: 12 }, (_, m) =>
      revEvents[m] + revBar[m] + otherIncome[m] - totalExp[m]);
    return { revEvents, revBar, otherIncome, byCat, totalExp, totalVar, totalFix, grossMargin, ebitda };
  }, [txs, installments, bookingById, year]);

  const cash = useMemo(() => {
    const cin = Array.from({ length: 12 }, () => 0);
    const cout = Array.from({ length: 12 }, () => 0);
    const cashDrawer = Array.from({ length: 12 }, () => 0);
    const capital = Array.from({ length: 12 }, () => 0);
    for (const t of txs) {
      if (t.kind === "internal" || t.kind === "split" || !t.date.startsWith(year)) continue;
      const m = Number(t.date.slice(5, 7)) - 1;
      if (t.amount > 0) cin[m] += t.amount; else cout[m] += -t.amount;
      if (t.kind === "capital" && t.amount > 0) capital[m] += t.amount;
    }
    // Encaissements CASH : lus directement dans Payments (échéances is_cash
    // payées, hors bookings test) — jamais ressaisis, jamais dans Revolut.
    // Date = paid_on (réelle) avec repli sur l'échéance.
    let cashUndated = 0; // is_cash payées SANS date -> invisibles dans les mois
    for (const i of installments) {
      if (!i.is_cash || i.status !== "paid") continue;
      if (!bookingById.has(i.booking_id)) continue; // exclut les tests
      const d = i.paid_on ?? i.due_date;
      if (!d) { cashUndated += Number(i.amount_due || 0); continue; }
      if (!d.startsWith(year)) continue;
      const m = Number(d.slice(5, 7)) - 1;
      cin[m] += Number(i.amount_due || 0);
      cashDrawer[m] += Number(i.amount_due || 0);
    }
    return { cin, cout, cashDrawer, capital, cashUndated };
  }, [txs, installments, bookingById, year]);

  const reviewCount = txs.filter((t) => t.kind === "review").length;

  // ---- Filtres mois / événement -------------------------------------------
  const [monthFilter, setMonthFilter] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const monthsAvailable = useMemo(() => {
    const ms = new Set<string>();
    for (const t of txs) ms.add(t.date.slice(0, 7));
    return [...ms].sort().reverse();
  }, [txs]);
  const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

  const filtered = useMemo(() => {
    let arr = txs;
    if (filter === "review") arr = arr.filter((t) => t.kind === "review");
    if (filter === "in") arr = arr.filter((t) => t.amount > 0);
    if (monthFilter) arr = arr.filter((t) => t.date.startsWith(monthFilter));
    if (eventFilter) arr = arr.filter((t) => t.booking_id === eventFilter);
    return arr;
  }, [txs, filter, monthFilter, eventFilter]);
  const visible = useMemo(() => filtered.slice(0, 300), [filtered]);

  // ---- Export CSV de la plage affichée (tous les filtres, sans la limite d'affichage)
  const exportCsv = () => {
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["date", "description", "note", "payer", "amount", "currency", "vat_rate", "amount_net", "kind", "category", "event", "source"];
    const lines = [header.join(",")];
    for (const t of filtered) {
      lines.push([
        t.date, esc(t.description), esc(t.notes), esc(t.payer), t.amount, t.currency,
        t.vat_rate ?? "", t.amount_net ?? "", t.kind, esc(t.category),
        esc(t.booking_id ? bookingById.get(t.booking_id)?.name ?? "" : ""), t.source,
      ].join(","));
    }
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const parts = ["transactions", monthFilter || "all-months"];
    if (eventFilter) parts.push((bookingById.get(eventFilter)?.name ?? "event").toLowerCase().replace(/[^a-z0-9]+/g, "-"));
    a.href = url; a.download = `${parts.join("_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---- Dépense manuelle ----------------------------------------------------
  const [mDate, setMDate] = useState(new Date().toISOString().slice(0, 10));
  const [mDesc, setMDesc] = useState("");
  const [mAmount, setMAmount] = useState("");
  const [mCat, setMCat] = useState("");
  const [mVat, setMVat] = useState("23");
  const [mBooking, setMBooking] = useState("");
  const addManual = async () => {
    const amt = Number(mAmount);
    if (!mDesc.trim() || !Number.isFinite(amt) || amt <= 0 || !mCat) {
      toast({ title: "Fill description, amount and category", variant: "destructive" }); return;
    }
    const vat = Number(mVat);
    const { error } = await supabase.from("fin_transactions").insert({
      source: "manual", date: mDate, description: mDesc.trim(), amount: -Math.abs(amt),
      kind: "expense", category: mCat, vat_rate: vat,
      amount_net: Math.round(Math.abs(amt) / (1 + vat / 100) * 100) / 100,
      booking_id: mBooking || null, reviewed: true,
    });
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Expense added" });
    setMDesc(""); setMAmount(""); setMCat(""); setMBooking(""); setShowManual(false);
    load();
  };

  const CategorySelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select className="h-7 rounded-md border border-input bg-background px-1.5 text-xs max-w-[230px]"
      value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Category…</option>
      {FIN_CATEGORIES.map((g) => (
        <optgroup key={g.group} label={g.group}>
          {g.items.map((c) => <option key={c} value={c}>{c}</option>)}
        </optgroup>
      ))}
    </select>
  );

  return (
    <div className="space-y-4">
      {/* Sous-onglets + année */}
      <div className="flex items-center gap-2 flex-wrap">
        {([["tx", "Transactions", ReceiptText], ["pnl", "P&L", TrendingUp], ["cash", "Cash flow", Wallet2]] as const).map(([k, label, Icon]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm border transition-colors ${
              tab === k ? "bg-primary text-primary-foreground border-primary font-semibold" : "bg-card border-border hover:bg-muted"}`}>
            <Icon className="w-3.5 h-3.5" />
            {label}
            {k === "tx" && reviewCount > 0 && (
              <span className="ml-0.5 rounded-full bg-[#FDF1E0] text-[#B45309] px-1.5 text-[10px] font-bold">{reviewCount}</span>
            )}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1.5">
          {years.map((y) => (
            <button key={y} type="button" onClick={() => setYear(y)}
              className={`rounded-full px-3 py-1 text-sm border ${y === year ? "bg-primary text-primary-foreground border-primary font-medium" : "bg-card border-border hover:bg-muted"}`}>
              {y}
            </button>
          ))}
        </span>
      </div>

      {/* ================= TRANSACTIONS ================= */}
      {tab === "tx" && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex bg-card border border-border rounded-full p-0.5">
              {(["review", "in", "all"] as const).map((f) => (
                <button key={f} type="button" onClick={() => setFilter(f)}
                  className={`rounded-full px-3.5 py-1 text-xs font-semibold ${filter === f ? "bg-foreground text-background" : "text-muted-foreground"}`}>
                  {f === "review" ? `To review (${reviewCount})` : f === "in" ? "Money in" : "All"}
                </button>
              ))}
            </div>
            <select className="h-7 rounded-full border border-border bg-card px-2.5 text-xs"
              value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
              <option value="">All months</option>
              {monthsAvailable.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
            <select className="h-7 rounded-full border border-border bg-card px-2.5 text-xs max-w-[190px]"
              value={eventFilter} onChange={(e) => setEventFilter(e.target.value)}>
              <option value="">All events</option>
              {realBookings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            {(monthFilter || eventFilter) && (
              <button type="button" className="text-xs text-muted-foreground hover:underline"
                onClick={() => { setMonthFilter(""); setEventFilter(""); }}>
                ✕ Clear
              </button>
            )}
            <span className="ml-auto flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={exportCsv}
                title="Download the currently filtered transactions (all rows, not just the first 300) as a CSV file">
                ⬇ Export CSV
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowManual((v) => !v)}>
                <Plus className="w-4 h-4 mr-1" /> Manual expense
              </Button>
              <input ref={fileRef} type="file" accept=".csv" className="hidden"
                onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
              <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={importing}
                title="Manual fallback — the Revolut sync normally makes this unnecessary">
                {importing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />}
                Import CSV
              </Button>
              <Button size="sm" onClick={syncRevolut} disabled={syncing}
                title="Pull the latest transactions from Revolut Business right now (they also sync automatically every hour)">
                {syncing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Landmark className="w-4 h-4 mr-1" />}
                Sync Revolut
              </Button>
            </span>
          </div>

          {showManual && (
            <div className="rounded-2xl border border-primary/50 bg-primary/5 p-3 grid sm:grid-cols-6 gap-2 items-end text-sm">
              <label className="space-y-1"><div className="text-xs text-muted-foreground">Date</div>
                <Input type="date" value={mDate} onChange={(e) => setMDate(e.target.value)} className="h-9" /></label>
              <label className="space-y-1 sm:col-span-2"><div className="text-xs text-muted-foreground">Description</div>
                <Input value={mDesc} onChange={(e) => setMDesc(e.target.value)} placeholder="Cash — firewood market" className="h-9 placeholder:italic placeholder:text-muted-foreground/50" /></label>
              <label className="space-y-1"><div className="text-xs text-muted-foreground">Amount (€, incl. VAT)</div>
                <Input type="number" min="0" step="0.01" value={mAmount} onChange={(e) => setMAmount(e.target.value)} className="h-9" /></label>
              <label className="space-y-1"><div className="text-xs text-muted-foreground">VAT</div>
                <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={mVat} onChange={(e) => setMVat(e.target.value)}>
                  {[23, 13, 6, 0].map((v) => <option key={v} value={v}>{v}%</option>)}
                </select></label>
              <div className="flex items-end gap-2">
                <label className="space-y-1 flex-1"><div className="text-xs text-muted-foreground">Category</div>
                  <CategorySelect value={mCat} onChange={setMCat} /></label>
              </div>
              <label className="space-y-1 sm:col-span-2"><div className="text-xs text-muted-foreground">Event (optional)</div>
                <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={mBooking} onChange={(e) => setMBooking(e.target.value)}>
                  <option value="">—</option>
                  {realBookings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select></label>
              <div className="sm:col-span-4 flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setShowManual(false)}>Cancel</Button>
                <Button size="sm" onClick={addManual}>Save expense</Button>
              </div>
            </div>
          )}

          <div className="overflow-auto rounded-2xl bg-card shadow-sm border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-muted/80">
                <tr className="text-left">
                  {["Date", "Description", "Payer", "Amount", "VAT", "Category", "Event", "Status"].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-[11px] uppercase tracking-wider font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline" /></td></tr>
                ) : visible.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-sm text-muted-foreground italic">
                    {filter === "review" ? "Nothing to review — inbox zero 🎉" : monthFilter || eventFilter ? "No transactions match these filters." : "No transactions yet — import a Revolut CSV to start."}
                  </td></tr>
                ) : visible.map((t) => {
                  const k = KIND_LABEL[t.kind] ?? KIND_LABEL.review;
                  const editable = t.kind === "expense" || t.kind === "review";
                  return (
                  <Fragment key={t.id}>
                    <tr className="group border-t border-border/60">
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums text-xs">{t.date.slice(5)}</td>
                      <td className="px-3 py-2 max-w-[240px]"><span className="block truncate font-medium" title={t.description ?? ""}>{t.description}</span>
                        {noteFor === t.id ? (
                          <input autoFocus value={noteDraft} placeholder="Add a note…"
                            className="mt-0.5 h-6 w-full rounded border border-input bg-background px-1.5 text-[10px] italic"
                            onChange={(e) => setNoteDraft(e.target.value)}
                            onBlur={() => saveNote(t)}
                            onKeyDown={(e) => { if (e.key === "Enter") saveNote(t); if (e.key === "Escape") setNoteFor(null); }} />
                        ) : t.notes ? (
                          <button type="button" className="block max-w-full truncate text-left text-[10px] italic text-[#1C5CAB] hover:underline"
                            title={`${t.notes} — click to edit`}
                            onClick={() => { setNoteFor(t.id); setNoteDraft(t.notes ?? ""); }}>{t.notes}</button>
                        ) : (
                          <button type="button" className="block text-left text-[10px] italic text-muted-foreground/0 hover:text-muted-foreground group-hover:text-muted-foreground/60"
                            onClick={() => { setNoteFor(t.id); setNoteDraft(""); }}>+ note</button>
                        )}
                        {t.source === "manual" && <span className="text-[10px] text-muted-foreground">manual</span>}
                        {t.source === "split" && <span className="text-[10px] font-medium text-[#7C3AED]">↳ part</span>}</td>
                      <td className="px-3 py-2 max-w-[110px]">
                        {t.payer ? <span className="block truncate text-[11px] text-muted-foreground" title={t.payer}>{t.payer}</span> : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums font-semibold whitespace-nowrap ${t.amount > 0 ? "text-[#178A3F]" : ""}`}>{fmt2(t.amount)}</td>
                      <td className="px-3 py-2">
                        {editable ? (
                          <select className="h-7 rounded-md border border-input bg-background px-1 text-xs"
                            value={String(t.vat_rate ?? 23)} onChange={(e) => setVat(t, Number(e.target.value))}>
                            {[23, 13, 6, 0].map((v) => <option key={v} value={v}>{v}%</option>)}
                          </select>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {editable && t.amount > 0 ? (
                          <select className="h-7 rounded-md border border-input bg-background px-1 text-xs"
                            value={t.kind === "review" ? "" : t.kind}
                            onChange={(e) => e.target.value && patch(t.id, { kind: e.target.value, category: null, vat_rate: null, amount_net: null, reviewed: true })}>
                            <option value="">Money in — classify…</option>
                            <option value="guest_payment">Guest payment (real revenue)</option>
                            <option value="bar_payout">Bar payout</option>
                            <option value="capital">Owner contribution (apport)</option>
                            <option value="internal">Internal transfer</option>
                            <option value="other_income">Other income</option>
                          </select>
                        ) : editable ? (
                          <>
                            <CategorySelect value={t.category ?? ""} onChange={(c) => categorize(t, c)} />
                            {!t.category && (() => {
                              const s = suggestFor(t);
                              return s ? (
                                <button type="button" className="mt-1 block max-w-[200px] truncate text-left text-[10px] font-medium text-[#1C5CAB] hover:underline"
                                  title={`Apply "${s.category}" at ${s.vat}% VAT (based on the merchant name)`}
                                  onClick={() => categorize(t, s.category, s.vat)}>
                                  ✨ {s.category} · {s.vat}% — accept
                                </button>
                              ) : null;
                            })()}
                            {t.kind === "review" && (
                              <span className="mt-1 block whitespace-nowrap text-[10px] text-muted-foreground/70">
                                not an expense?{" "}
                                <button type="button" className="font-medium text-muted-foreground hover:text-foreground hover:underline"
                                  title="Transfer between own accounts — excluded from P&L and cash flow"
                                  onClick={() => patch(t.id, { kind: "internal", category: null, vat_rate: null, amount_net: null, reviewed: true })}>
                                  internal
                                </button>
                                {" · "}
                                <button type="button" className="font-medium text-muted-foreground hover:text-foreground hover:underline"
                                  title="VAT payment to the tax authority — cash flow only, never a P&L cost"
                                  onClick={() => patch(t.id, { kind: "vat_payment", category: null, vat_rate: null, amount_net: null, reviewed: true })}>
                                  VAT
                                </button>
                              </span>
                            )}
                          </>
                        ) : (
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${k.cls}`}>{k.label}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {t.kind === "split" ? (
                          <button type="button" className="text-[11px] font-medium text-[#7C3AED] hover:underline"
                            onClick={() => unsplit(t)}>Undo split</button>
                        ) : editable || t.kind === "guest_payment" ? (
                          <>
                            <span className="inline-flex items-center gap-1.5">
                              <select className="h-7 rounded-md border border-input bg-background px-1 text-xs max-w-[180px]"
                                value={t.booking_id ?? ""} onChange={(e) => patch(t.id, { booking_id: e.target.value || null })}>
                                <option value="">—</option>
                                {realBookings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                              </select>
                              {editable && !t.parent_id && (
                                <button type="button" className="text-[10px] font-medium text-[#7C3AED] hover:underline whitespace-nowrap"
                                  onClick={() => (splitFor === t.id ? setSplitFor(null) : openSplit(t))}>
                                  {splitFor === t.id ? "Close" : "Split"}
                                </button>
                              )}
                            </span>
                            {!t.booking_id && t.amount < 0 && (() => {
                              const b = eventForDate(t.date);
                              return b ? (
                                <button type="button" className="mt-1 block max-w-[200px] truncate text-left text-[10px] font-medium text-[#1C5CAB] hover:underline"
                                  title={`The date falls inside this event's window (check-in −6 days → check-out)`}
                                  onClick={() => patch(t.id, { booking_id: b.id })}>
                                  ✨ {b.name} — accept
                                </button>
                              ) : null;
                            })()}
                          </>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${t.kind === "review" ? KIND_LABEL.review.cls : "bg-[#E5F5EA] text-[#178A3F]"}`}>
                          {t.kind === "review" ? "To review" : "OK"}
                        </span>
                        {t.kind !== "review" && (
                          <button type="button" className="ml-1.5 text-[10px] text-muted-foreground hover:underline"
                            onClick={() => patch(t.id, { kind: "review", reviewed: false })}>edit</button>
                        )}
                        {t.kind !== "split" && (deleteArm === t.id ? (
                          <button type="button" className="ml-1.5 text-[10px] font-semibold text-destructive hover:underline"
                            onClick={async () => {
                              setDeleteArm(null);
                              const { error } = await supabase.from("fin_transactions").delete().eq("id", t.id);
                              if (error) toast({ title: "Delete failed", description: error.message, variant: "destructive" });
                              else toast({ title: "Transaction deleted", description: "Use this only for duplicates — deleting real transactions skews the treasury." });
                              load();
                            }}>sure?</button>
                        ) : (
                          <button type="button" className="ml-1.5 text-[10px] text-muted-foreground/60 hover:text-destructive hover:underline"
                            title="Delete this transaction (duplicates only)"
                            onClick={() => { setDeleteArm(t.id); setTimeout(() => setDeleteArm((v) => (v === t.id ? null : v)), 3000); }}>✕</button>
                        ))}
                      </td>
                    </tr>
                    {splitFor === t.id && (() => {
                      const target = Math.abs(t.amount);
                      const partsSum = splitLines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
                      const ok = Math.abs(partsSum - target) <= 0.01;
                      return (
                        <tr className="border-t border-border/40 bg-[#F7F3FD]">
                          <td colSpan={8} className="px-4 py-3">
                            <div className="text-[11px] font-semibold text-[#5B21B6] mb-2">
                              Split €{target.toFixed(2)} across events — parts must add up exactly. Treasury keeps the single original payment; the P&L gets one line per event.
                            </div>
                            <div className="space-y-2">
                              {splitLines.map((l, i) => (
                                <div key={i} className="flex flex-wrap items-center gap-2">
                                  <input type="number" step="0.01" min="0" className="h-7 w-24 rounded-md border border-input bg-background px-2 text-xs text-right"
                                    value={l.amount}
                                    onChange={(e) => setSplitLines(splitLines.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                                  <CategorySelect value={l.category}
                                    onChange={(c) => setSplitLines(splitLines.map((x, j) => (j === i ? { ...x, category: c } : x)))} />
                                  <select className="h-7 rounded-md border border-input bg-background px-1 text-xs"
                                    value={l.vat}
                                    onChange={(e) => setSplitLines(splitLines.map((x, j) => (j === i ? { ...x, vat: e.target.value } : x)))}>
                                    {[23, 13, 6, 0].map((v) => <option key={v} value={v}>{v}%</option>)}
                                  </select>
                                  <select className="h-7 rounded-md border border-input bg-background px-1 text-xs max-w-[180px]"
                                    value={l.booking_id}
                                    onChange={(e) => setSplitLines(splitLines.map((x, j) => (j === i ? { ...x, booking_id: e.target.value } : x)))}>
                                    <option value="">No event</option>
                                    {realBookings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                                  </select>
                                  {splitLines.length > 2 && (
                                    <button type="button" className="text-xs text-muted-foreground hover:text-destructive"
                                      onClick={() => setSplitLines(splitLines.filter((_, j) => j !== i))}>✕</button>
                                  )}
                                </div>
                              ))}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-3">
                              <button type="button" className="text-[11px] font-medium text-[#5B21B6] hover:underline"
                                onClick={() => setSplitLines([...splitLines, { amount: "", category: t.category ?? "", booking_id: "", vat: String(t.vat_rate ?? 23) }])}>
                                + Add part
                              </button>
                              <span className={`text-[11px] tabular-nums font-medium ${ok ? "text-[#178A3F]" : "text-destructive"}`}>
                                Parts: €{partsSum.toFixed(2)} / €{target.toFixed(2)}
                              </span>
                              <span className="flex-1" />
                              <button type="button" className="h-7 rounded-md px-3 text-xs font-medium text-muted-foreground hover:bg-muted"
                                onClick={() => setSplitFor(null)}>Cancel</button>
                              <button type="button" disabled={!ok}
                                className="h-7 rounded-md bg-[#7C3AED] px-3 text-xs font-semibold text-white disabled:opacity-40"
                                onClick={() => saveSplit(t)}>Save split</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })()}
                  </Fragment>
                  );
                })}
              </tbody>
              {!loading && filtered.length > 0 && (() => {
                const rows = filtered.filter((t) => t.kind !== "split");
                const tin = rows.reduce((s, t) => s + (t.amount > 0 ? t.amount : 0), 0);
                const tout = rows.reduce((s, t) => s + (t.amount < 0 ? -t.amount : 0), 0);
                return (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/60">
                      <td colSpan={3} className="px-3 py-2 text-xs font-semibold">
                        Totals — {rows.length} row{rows.length > 1 ? "s" : ""}{monthFilter || eventFilter || filter !== "all" ? " (filtered)" : ""}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums text-xs font-bold whitespace-nowrap ${tin - tout < 0 ? "text-destructive" : ""}`}>{fmt2(tin - tout)}</td>
                      <td colSpan={4} className="px-3 py-2 text-[11px] text-muted-foreground whitespace-nowrap">
                        In <b className="text-[#178A3F] tabular-nums">{fmt2(tin)}</b> · Out <b className="tabular-nums">−{fmt2(tout)}</b>
                      </td>
                    </tr>
                  </tfoot>
                );
              })()}
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Anti-double counting: guest payments, bar payouts and internal transfers never create P&L lines — revenue lives in the event installments. VAT payments count in cash flow only. Totals above are the raw sum of the listed lines (split parents excluded).
          </p>
        </>
      )}

      {/* ================= P&L ================= */}
      {tab === "pnl" && (
        <div className="overflow-auto rounded-2xl bg-card shadow-sm border border-border/60 p-4">
          <div className="font-semibold text-sm mb-1 flex items-center gap-2"><Landmark className="w-4 h-4 text-[#35532A]" /> P&L {year} <span className="text-xs font-normal text-muted-foreground">· net of VAT · accrual (event month = check-in month)</span></div>
          <table className="w-full text-xs mt-3">
            <thead>
              <tr className="text-left">
                <th className="py-1.5 pr-2 font-semibold text-muted-foreground sticky left-0 bg-card">&nbsp;</th>
                {MONTHS.map((m) => <th key={m} className="py-1.5 px-2 text-right font-semibold text-muted-foreground">{m}</th>)}
                <th className="py-1.5 px-2 text-right font-bold text-muted-foreground">Total</th>
              </tr>
            </thead>
            <tbody>
              {([
                ["Revenue — events", pnl.revEvents, false],
                ["Revenue — bar", pnl.revBar, false],
                ["Other income", pnl.otherIncome, false],
              ] as const).filter(([, arr]) => arr.some((v) => v !== 0)).map(([label, arr]) => (
                <tr key={label as string} className="border-t border-border/50">
                  <td className="py-1.5 pr-2 font-semibold sticky left-0 bg-card whitespace-nowrap">{label}</td>
                  {arr.map((v, i) => <td key={i} className="py-1.5 px-2 text-right tabular-nums">{v ? fmt0(v) : "·"}</td>)}
                  <td className="py-1.5 px-2 text-right tabular-nums font-bold">{fmt0(arr.reduce((s, v) => s + v, 0))}</td>
                </tr>
              ))}
              {([
                ["Variable costs — per event", (c: string) => PNL_VARIABLE_CATS.has(c), pnl.totalVar, "Total variable costs"],
                ["Fixed & other costs", (c: string) => !PNL_VARIABLE_CATS.has(c), pnl.totalFix, "Total fixed & other"],
              ] as const).map(([groupLabel, belongs, totals, totalLabel]) => {
                const rows = [...pnl.byCat.entries()].filter(([c]) => belongs(c))
                  .sort((a, b) => ALL_CATEGORIES.indexOf(a[0]) - ALL_CATEGORIES.indexOf(b[0]));
                if (rows.length === 0) return null;
                return (
                  <Fragment key={groupLabel}>
                    <tr className="border-t border-border/60">
                      <td colSpan={14} className="pt-3 pb-1 pr-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground sticky left-0 bg-card">{groupLabel}</td>
                    </tr>
                    {rows.map(([cat, arr]) => (
                      <tr key={cat} className="border-t border-border/40">
                        <td className="py-1.5 pr-2 pl-3 text-muted-foreground sticky left-0 bg-card whitespace-nowrap">{cat}</td>
                        {arr.map((v, i) => <td key={i} className="py-1.5 px-2 text-right tabular-nums">{v ? `−${fmt0(v).slice(v < 0 ? 1 : 0)}` : "·"}</td>)}
                        <td className="py-1.5 px-2 text-right tabular-nums font-semibold">−{fmt0(arr.reduce((s, v) => s + v, 0))}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-border/60">
                      <td className="py-1.5 pr-2 font-semibold sticky left-0 bg-card whitespace-nowrap">{totalLabel}</td>
                      {totals.map((v, i) => <td key={i} className="py-1.5 px-2 text-right tabular-nums font-semibold">{v ? `−${fmt0(v).slice(v < 0 ? 1 : 0)}` : "·"}</td>)}
                      <td className="py-1.5 px-2 text-right tabular-nums font-bold">−{fmt0(totals.reduce((s, v) => s + v, 0))}</td>
                    </tr>
                    {groupLabel === "Variable costs — per event" && (
                      <tr className="border-t border-border bg-[#F4F7EF]">
                        <td className="py-1.5 pr-2 font-semibold sticky left-0 bg-[#F4F7EF] whitespace-nowrap">Margin after variable costs</td>
                        {pnl.grossMargin.map((v, i) => (
                          <td key={i} className={`py-1.5 px-2 text-right tabular-nums font-semibold ${v < 0 ? "text-destructive" : ""}`}>{v ? fmt0(v) : "·"}</td>
                        ))}
                        <td className="py-1.5 px-2 text-right tabular-nums font-bold">{fmt0(pnl.grossMargin.reduce((s, v) => s + v, 0))}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              <tr className="border-t-2 border-border bg-secondary/60">
                <td className="py-2 pr-2 font-bold sticky left-0 bg-secondary/60">EBITDA</td>
                {pnl.ebitda.map((v, i) => (
                  <td key={i} className={`py-2 px-2 text-right tabular-nums font-bold ${v < 0 ? "text-destructive" : ""}`}>{v ? fmt0(v) : "·"}</td>
                ))}
                <td className="py-2 px-2 text-right tabular-nums font-extrabold">{fmt0(pnl.ebitda.reduce((s, v) => s + v, 0))}</td>
              </tr>
            </tbody>
          </table>
          {pnl.byCat.size === 0 && (
            <p className="text-sm text-muted-foreground italic mt-4">No categorised expenses yet — import your Revolut CSV in the Transactions tab.</p>
          )}
        </div>
      )}

      {/* ================= CASH FLOW ================= */}
      {tab === "cash" && (
        <div className="rounded-2xl bg-card shadow-sm border border-border/60 p-4">
          <div className="font-semibold text-sm mb-1 flex items-center gap-2"><Wallet2 className="w-4 h-4 text-[#35532A]" /> Cash flow {year} <span className="text-xs font-normal text-muted-foreground">· bank movements, internal transfers excluded</span></div>
          {(() => {
            const max = Math.max(...cash.cin, ...cash.cout, 1);
            return (
              <>
                <div className="flex items-end gap-2 h-44 mt-4 border-b border-border px-1">
                  {MONTHS.map((m, i) => (
                    <div key={m} className="flex-1 flex items-end justify-center gap-[3px] h-full"
                      title={`${m}: in ${fmt0(cash.cin[i])}${cash.capital[i] > 0 ? ` (incl. owner contribution ${fmt0(cash.capital[i])})` : ""} · out ${fmt0(cash.cout[i])}`}>
                      <div className="w-[46%] max-w-[26px] flex flex-col justify-end" style={{ height: `${(cash.cin[i] / max) * 100}%` }}>
                        {cash.capital[i] > 0 && (
                          <div className="w-full rounded-t bg-[#B08CF8]" style={{ height: `${(cash.capital[i] / Math.max(cash.cin[i], 0.01)) * 100}%` }} />
                        )}
                        <div className={`w-full flex-1 bg-[#8FC46A] ${cash.capital[i] > 0 ? "" : "rounded-t"}`} />
                      </div>
                      <div className="w-[46%] max-w-[26px] rounded-t bg-[#EF9455]" style={{ height: `${(cash.cout[i] / max) * 100}%` }} />
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 px-1 mt-1">
                  {MONTHS.map((m, i) => {
                    const net = cash.cin[i] - cash.cout[i];
                    const active = cash.cin[i] !== 0 || cash.cout[i] !== 0;
                    return (
                      <div key={m} className="flex-1 text-center text-[10px] text-muted-foreground leading-tight">
                        {m}<br />
                        {active ? (
                          <>
                            <span className="tabular-nums text-[#4E8A2E]">{fmt0(cash.cin[i])}</span><br />
                            <span className="tabular-nums text-[#B25C1F]">−{fmt0(cash.cout[i])}</span><br />
                            <b className={`tabular-nums ${net < 0 ? "text-destructive" : "text-foreground"}`}>{fmt0(net)}</b>
                          </>
                        ) : "·"}
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px] bg-[#8FC46A] inline-block" /> Cash in</span>
                  {cash.capital.some((v) => v > 0) && (
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px] bg-[#B08CF8] inline-block" /> Owner contribution</span>
                  )}
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px] bg-[#EF9455] inline-block" /> Cash out</span>
                  <span className="ml-auto">In {fmt0(cash.cin.reduce((s, v) => s + v, 0))} <span className="text-[10px]">(incl. cash {fmt0(cash.cashDrawer.reduce((s, v) => s + v, 0))} from Payments{cash.capital.some((v) => v > 0) ? ` · owner contributions ${fmt0(cash.capital.reduce((s, v) => s + v, 0))}` : ""})</span> · Out {fmt0(cash.cout.reduce((s, v) => s + v, 0))} · Net <b className="text-foreground">{fmt0(cash.cin.reduce((s, v) => s + v, 0) - cash.cout.reduce((s, v) => s + v, 0))}</b></span>
                </div>
                {cash.cashUndated > 0 && (
                  <p className="mt-2 text-[11px] text-[#B45309]">
                    ⚠ {fmt0(cash.cashUndated)} of paid cash installments have no payment date in Payments — they are not shown in any month above. Set their "paid on" date to include them.
                  </p>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
