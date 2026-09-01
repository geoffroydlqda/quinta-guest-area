import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Landmark, Loader2, Plus, Upload, TrendingUp, Wallet2, ReceiptText, Mail, Copy, Banknote, Percent as PercentIcon } from "lucide-react";
import { EventMarginsTab } from "@/components/admin/EventMarginsTab";

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
    "Car maintenance", "Cleaning (out of season)", "Cleaning (in season)", "Equipment & furniture", "Furniture maintenance",
    "Gardening (contract)", "Gardening (seasonal)", "General maintenance",
    // Petits travaux d'amélioration du bâti par l'OpCo (étagères, aménagements
    // fixes...) : ni FF&E (pas emportable), ni maintenance (crée de la valeur).
    // Nature capex/benfeitorias — amortissable, clause d'indemnisation à
    // prévoir au bail avec Surreal. À distinguer de "Paid on behalf of Surreal".
    "Improvement works (leasehold)", "Pool maintenance",
    "Property operations & supplies",
  ]},
  { group: "Insurance & legal", items: ["Insurance — property", "Insurance — events"] },
  { group: "General & admin", items: ["Accounting", "Internet", "Software", "Team expenses", "Admin"] },
  { group: "Utilities", items: ["Electricity", "Water", "Gas", "Fuel"] },
  { group: "Marketing & sales", items: ["Advertising", "Commission", "Listing fee"] },
  { group: "Other fixed", items: ["Bank & payment fees", "Taxes & duties"] },
  // Dépenses immo payées par l'OpCo pour le compte de Surreal Estate (AssetCo) :
  // visibles comme un bloc à part dans le P&L — jamais fondues dans le reste.
  // En fin d'année : refacturation ou conta corrente, à trancher avec BDO.
  { group: "Intercompany — Surreal Estate (AssetCo)", items: ["Paid on behalf of Surreal (property)"] },
  { group: "Variable — retreat", items: [
    "Retreat — catering / staff", "Retreat — catering / food", "Retreat — venue / cleaning & fixed", "Retreat - extras",
  ]},
  { group: "Variable — wedding", items: [
    "Wedding — catering / staff", "Wedding — catering / food", "Wedding — venue / cleaning & fixed", "Wedding - extras",
  ]},
  // "Guest transport" : chauffeurs / taxis payés pour les guests (souvent en
  // cash), rattachés a l'événement — le revenu correspondant est facturé aux
  // guests en échéance "transport". Reste hors PNL_VARIABLE_CATS (modèle du
  // 6 août : seuls les 8 tags retreat/wedding comptent en variable).
  { group: "Variable — other", items: ["Bar — stock", "Guest transport", "Other variable"] },
];
const ALL_CATEGORIES = FIN_CATEGORIES.flatMap((g) => g.items);

const KIND_LABEL: Record<string, { label: string; cls: string }> = {
  expense: { label: "Expense", cls: "bg-[#FBE8DA] text-[#8A4A1B]" },
  guest_payment: { label: "Guest payment — already in P&L", cls: "bg-[#E5F5EA] text-[#178A3F]" },
  bar_payout: { label: "Bar payout — P&L revenue (bar)", cls: "bg-[#E5F5EA] text-[#178A3F]" },
  internal: { label: "Internal transfer — excluded", cls: "bg-muted text-muted-foreground" },
  capital: { label: "Owner contribution — cash only", cls: "bg-[#EDE9FE] text-[#5B21B6]" },
  vat_payment: { label: "VAT payment — cash only", cls: "bg-[#E8F0FB] text-[#1C5CAB]" },
  // Remboursement client : la sortie compte au cash flow, mais l'impact P&L
  // vit déjà dans l'échéance discount du booking — jamais de ligne P&L.
  refund: { label: "Guest refund — already in P&L", cls: "bg-[#E8F0FB] text-[#1C5CAB]" },
  other_income: { label: "Other income", cls: "bg-[#E5F5EA] text-[#178A3F]" },
  review: { label: "To review", cls: "bg-[#FDF1E0] text-[#B45309]" },
  split: { label: "Split across events", cls: "bg-[#F3EDFF] text-[#8a63d2]" },
};

type FinTx = {
  id: string; source: string; dedup_key: string | null; date: string;
  description: string | null; amount: number; currency: string; kind: string;
  category: string | null; vat_rate: number | null; amount_net: number | null;
  booking_id: string | null; notes: string | null; reviewed: boolean;
  parent_id?: string | null; payer?: string | null; pnl_month?: string | null;
  is_cash?: boolean;
  // "Pas de justificatif a attendre" (cash, pourboires...) — sort du filtre No receipt
  receipt_waived?: boolean;
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
  id?: string;
  booking_id: string; amount_due: number; amount_excl_vat?: number | null;
  category?: string | null; is_cash?: boolean; status?: string;
  due_date?: string | null; paid_on?: string | null; label?: string | null;
};

// ---- Ventilation des revenus du P&L (10 août 2026) -------------------------
// Chaque échéance est classée par flux : catégorie (rental/catering/extra/
// discount/bar) × type d'événement du booking (retreat/wedding/…).
const REV_EVENT_LABEL: Record<string, string> = {
  retreat: "retreats", wedding: "weddings", day_retreat: "day retreats", other: "other events",
};

function revenueLine(category: string, eventType: string): string {
  if (category === "bar") return "Bar (merchant)";
  if (category === "discount") return "Discounts";
  const ev = REV_EVENT_LABEL[eventType] ?? REV_EVENT_LABEL.retreat;
  if (category === "catering") return `Catering — ${ev}`;
  if (category === "extra") return `Extras — ${ev}`;
  return `Venue — ${ev}`; // rental = location du lieu, quel que soit l'événement
}

// Ordre d'affichage des lignes de revenus
const REV_LINE_ORDER = [
  "Venue — retreats", "Venue — weddings", "Venue — day retreats", "Venue — other events",
  "Catering — retreats", "Catering — weddings", "Catering — day retreats", "Catering — other events",
  "Extras — retreats", "Extras — weddings", "Extras — day retreats", "Extras — other events",
  "Discounts", "Bar (merchant)",
];
const revLineRank = (label: string) => {
  const i = REV_LINE_ORDER.indexOf(label);
  return i === -1 ? REV_LINE_ORDER.length : i;
};

const fmt0 = (v: number) =>
  `${v < 0 ? "−" : ""}€${Math.abs(v).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
const fmt2 = (v: number) =>
  `${v < 0 ? "−" : ""}€${Math.abs(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Dates en format européen (JJ-MM / JJ/MM/AAAA) — demande Geoffroy du 11/08/2026
const fmtDayEU = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}`;
const fmtFullEU = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

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

// Classification automatique anti-double comptage.
// Les DÉPENSES classées par une règle restent reviewed=false : la catégorie
// est probablement bonne mais l'événement doit être confirmé à la main
// (bouton Confirm). Les kinds mécaniques (payout, internal…) restent OK.
function autoKind(desc: string, amount: number, rules: FinRule[]): Partial<FinTx> {
  const d = desc.toLowerCase();
  for (const r of rules) {
    if (d.includes(r.pattern.toLowerCase())) {
      return {
        kind: r.kind, category: r.category, vat_rate: r.vat_rate,
        amount_net: r.kind === "expense" && r.vat_rate != null
          ? Math.round(Math.abs(amount) / (1 + Number(r.vat_rate) / 100) * 100) / 100
          : null,
        reviewed: r.kind !== "expense",
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

export function FinancePage({ bookings, installments, mode = "accounting" }: {
  bookings: FinBooking[];
  installments: FinInstallment[];
  mode?: "accounting" | "analytics";
}) {
  const { toast } = useToast();
  // Réorganisation 19 août 2026 (demande Geoffroy) : la page sert deux onglets
  // sidebar — "Accounting" (Transactions, Cash box, Event margins) et
  // "Analytics" (P&L, Cash flow, Investor update). Receipts = page à part.
  const [tab, setTab] = useState<"tx" | "pnl" | "cash" | "box" | "margins" | "report">(mode === "analytics" ? "pnl" : "tx");
  const [txs, setTxs] = useState<FinTx[]>([]);
  const [rules, setRules] = useState<FinRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState<"review" | "in" | "noreceipt" | "all">("all");
  const [showManual, setShowManual] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Ventilation multi-événements (facture staff couvrant 2-3 retraites)
  const [splitFor, setSplitFor] = useState<string | null>(null);
  const [deleteArm, setDeleteArm] = useState<string | null>(null);
  // Justificatifs d'achat : tx qui ont au moins un doc + rattachement "2 clics"
  // tx_id -> chemins storage des justificatifs liés (icône verte cliquable)
  const [docsByTx, setDocsByTx] = useState<Map<string, string[]>>(new Map());
  const buildDocsMap = (rows: { tx_id: string; storage_path: string }[] | null) => {
    const m = new Map<string, string[]>();
    for (const r of rows ?? []) m.set(r.tx_id, [...(m.get(r.tx_id) ?? []), r.storage_path]);
    return m;
  };
  const openReceipts = async (txId: string) => {
    for (const p of docsByTx.get(txId) ?? []) {
      const { data } = await supabase.storage.from("purchase-docs").createSignedUrl(p, 300);
      if (data?.signedUrl) window.open(data.signedUrl, "_blank");
    }
  };
  const [attachTxId, setAttachTxId] = useState<string | null>(null);
  const [attachBusy, setAttachBusy] = useState<string | null>(null);
  const attachRef = useRef<HTMLInputElement>(null);
  const [splitLines, setSplitLines] = useState<{ amount: string; category: string; booking_id: string; vat: string }[]>([]);

  const realBookings = useMemo(() => bookings.filter((b) => !b.is_test), [bookings]);
  const bookingById = useMemo(() => new Map(realBookings.map((b) => [b.id, b])), [realBookings]);

  // Date de signature de chaque echeance (pipeline de l'investor update)
  const [instCreated, setInstCreated] = useState<Map<string, string>>(new Map());
  const load = async () => {
    const [t, r, pd, ic] = await Promise.all([
      supabase.from("fin_transactions").select("*").order("date", { ascending: false }).limit(2000),
      supabase.from("fin_rules").select("*"),
      supabase.from("purchase_docs").select("tx_id,storage_path").not("tx_id", "is", null),
      supabase.from("payment_installments").select("id,created_at"),
    ]);
    setTxs((t.data as FinTx[] | null) ?? []);
    setRules((r.data as FinRule[] | null) ?? []);
    setDocsByTx(buildDocsMap(pd.data as { tx_id: string; storage_path: string }[] | null));
    setInstCreated(new Map(((ic.data ?? []) as { id: string; created_at: string }[])
      .map((x) => [x.id, x.created_at.slice(0, 10)])));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // Rafraîchit l'état des trombones au retour sur Transactions (un doc a pu
  // être lié depuis l'onglet Receipts entre-temps).
  useEffect(() => {
    if (tab !== "tx") return;
    supabase.from("purchase_docs").select("tx_id,storage_path").not("tx_id", "is", null)
      .then(({ data }) => setDocsByTx(buildDocsMap(data as { tx_id: string; storage_path: string }[] | null)));
  }, [tab]);

  // ---- Justificatif "2 clics" : photo/PDF -> doc lié à la transaction ->
  // extraction Claude (TVA appliquée sur amount_net/vat_rate) ---------------
  const attachReceipt = async (file: File, txId: string) => {
    setAttachBusy(txId);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage.from("purchase-docs").upload(path, file, { contentType: file.type || "image/jpeg" });
      if (up.error) throw new Error(up.error.message);
      const { data: row, error: insErr } = await supabase.from("purchase_docs")
        .insert({ storage_path: path, file_name: file.name, mime_type: file.type || "image/jpeg", tx_id: txId, status: "matched" })
        .select("id").single();
      if (insErr) throw new Error(insErr.message);
      setDocsByTx((m) => { const n = new Map(m); n.set(txId, [...(n.get(txId) ?? []), path]); return n; });
      const { data, error } = await supabase.functions.invoke("receipt-extract", { body: { doc_id: row.id } });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      toast({ title: "Receipt attached", description: data?.vat_applied ? "VAT read — net amount updated on the transaction." : "Attached (VAT breakdown not readable)." });
      load();
    } catch (e) {
      toast({ title: "Attach failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally { setAttachBusy(null); }
  };

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

  // ---- Tooltip du graphe cash flow ----------------------------------------
  const [cashTip, setCashTip] = useState<{ x: number; y: number; m: number } | null>(null);

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
        toast({ title: "Revolut synced", description: `${data?.inserted ?? 0} new transaction(s) imported${Array.isArray(data?.accounts) && data.accounts.length ? ` from ${data.accounts.join(", ")}` : ""}.` });
        await load();
      }
    } catch (e) {
      toast({ title: "Sync failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  // ---- Mois P&L forcé (facture d'un autre mois que le paiement) ------------
  const [pnlFor, setPnlFor] = useState<string | null>(null);

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
    // reviewed reste false : catégoriser ≠ valider — la ligne attend le clic
    // sur ✓ Confirm (demande Geoffroy, 10 août 2026 : vérifier TVA + événement
    // avant de sortir de "To review").
    await patch(t.id, { kind: "expense", category, vat_rate: vat, amount_net: net, reviewed: false, ...(autoEvent ? { booking_id: autoEvent.id } : {}) });
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
    // Revenus : échéances HT au mois du check-in (hors test), ventilées par
    // flux (accommodation/venue/catering/extras × retreat/wedding, discounts, bar)
    const revEvents = Array.from({ length: 12 }, () => 0);
    const revBar = Array.from({ length: 12 }, () => 0);
    const revRows = new Map<string, number[]>();
    for (const i of installments) {
      const b = bookingById.get(i.booking_id);
      if (!b?.check_in_date || !b.check_in_date.startsWith(year)) continue;
      const m = Number(b.check_in_date.slice(5, 7)) - 1;
      const net = i.amount_excl_vat != null
        ? Number(i.amount_excl_vat)
        : Number(i.amount_due || 0) / (i.category === "catering" ? 1.13 : 1.23);
      if (i.category === "bar") revBar[m] += net;
      else revEvents[m] += net;
      const line = revenueLine(i.category ?? "rental", b.event_type ?? "retreat");
      const arr = revRows.get(line) ?? Array.from({ length: 12 }, () => 0);
      arr[m] += net;
      revRows.set(line, arr);
    }
    // Bar (merchant) — 27 août 2026 : la source de revenu bar est passée aux
    // ÉCHÉANCES catégorie "bar" (rollup revolut-bar-sync : HT exact par taux
    // 23/6 %, rattachées à l'événement — comptées dans la boucle ci-dessus).
    // Les transactions kind bar_payout (virements Merchant -> compte, nets de
    // frais) ne comptent donc PLUS dans le P&L — uniquement dans le cash flow.
    // Filet anti-trou : tant qu'AUCUNE échéance bar n'existe sur l'année
    // (clé Merchant pas encore configurée), on garde l'ancien comptage payouts.
    const hasBarInstallments = installments.some((i) => {
      if (i.category !== "bar") return false;
      const b = bookingById.get(i.booking_id);
      return !!b?.check_in_date && b.check_in_date.startsWith(year);
    });
    if (!hasBarInstallments) {
      for (const t of txs) {
        if (t.kind !== "bar_payout" || t.amount <= 0) continue;
        const bm = t.pnl_month ?? t.date.slice(0, 7);
        if (!bm.startsWith(year)) continue;
        const m = Number(bm.slice(5, 7)) - 1;
        const v = t.amount_net ?? t.amount;
        revBar[m] += v;
        const arr = revRows.get("Bar (merchant)") ?? Array.from({ length: 12 }, () => 0);
        arr[m] += v;
        revRows.set("Bar (merchant)", arr);
      }
    }
    // Dépenses : booking lié -> mois du check-in ; sinon date de transaction
    const byCat = new Map<string, number[]>();
    let otherIncome = Array.from({ length: 12 }, () => 0);
    for (const t of txs) {
      if (t.kind === "other_income") {
        const oiMonth = t.pnl_month ?? t.date.slice(0, 7);
        if (oiMonth.startsWith(year)) otherIncome[Number(oiMonth.slice(5, 7)) - 1] += t.amount_net ?? t.amount;
        continue;
      }
      if (t.kind !== "expense" || !t.category) continue;
      // Priorité : mois P&L forcé (facture d'un autre mois) > check-in > date
      const b = t.booking_id ? bookingById.get(t.booking_id) : null;
      const accrual = t.pnl_month ? `${t.pnl_month}-01` : (b?.check_in_date ?? t.date);
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
    const totalRev = Array.from({ length: 12 }, (_, m) =>
      revEvents[m] + revBar[m] + otherIncome[m]);
    const grossMargin = Array.from({ length: 12 }, (_, m) =>
      revEvents[m] + revBar[m] + otherIncome[m] - totalVar[m]);
    const ebitda = Array.from({ length: 12 }, (_, m) =>
      revEvents[m] + revBar[m] + otherIncome[m] - totalExp[m]);
    return { revEvents, revBar, revRows, totalRev, otherIncome, byCat, totalExp, totalVar, totalFix, grossMargin, ebitda };
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

  const reviewCount = txs.filter((t) => !t.reviewed).length;
  const noReceiptCount = txs.filter((t) => (t.kind === "expense" || t.kind === "review") && t.amount < 0 && !docsByTx.has(t.id) && !t.receipt_waived).length;

  // ---- Cash box (caisse espèces) -------------------------------------------
  // Entrées : échéances is_cash payées (hors tests). Sorties/ajustements :
  // fin_transactions is_cash (dépenses cash, ajustements kind=internal —
  // ces derniers ne comptent QUE dans la caisse, jamais ailleurs).
  const box = useMemo(() => {
    type Move = { date: string; label: string; sub: string | null; amount: number; kind: "in" | "out" | "adj"; txId?: string; txKind?: string; bookingId?: string | null };
    const moves: Move[] = [];
    let undated = 0;
    for (const i of installments) {
      if (!i.is_cash || i.status !== "paid" || !bookingById.has(i.booking_id)) continue;
      const d = i.paid_on ?? i.due_date;
      if (!d) { undated += Number(i.amount_due || 0); continue; }
      moves.push({
        date: d,
        label: bookingById.get(i.booking_id)?.name ?? "Booking",
        sub: i.label ?? null,
        amount: Number(i.amount_due || 0),
        kind: "in",
      });
    }
    for (const t of txs) {
      if (!t.is_cash || t.kind === "split") continue;
      moves.push({
        date: t.date,
        label: t.description ?? "—",
        sub: t.kind === "internal" ? (t.notes ?? "Adjustment") : (t.category ?? null),
        amount: Number(t.amount),
        kind: t.kind === "internal" ? "adj" : t.amount < 0 ? "out" : "in",
        txId: t.id,
        txKind: t.kind,
        bookingId: t.booking_id,
      });
    }
    moves.sort((a, b) => a.date.localeCompare(b.date));
    let bal = 0;
    const withBal = moves.map((m) => ({ ...m, balance: (bal = Math.round((bal + m.amount) * 100) / 100) }));
    withBal.reverse();
    const cashIn = moves.filter((m) => m.kind === "in").reduce((s, m) => s + m.amount, 0);
    const cashOut = moves.filter((m) => m.kind === "out").reduce((s, m) => s + m.amount, 0);
    const adj = moves.filter((m) => m.kind === "adj").reduce((s, m) => s + m.amount, 0);
    return { moves: withBal, balance: bal, cashIn, cashOut, adj, undated };
  }, [txs, installments, bookingById]);

  // Ajustement caisse (dépôt en banque, correction d'inventaire…)
  const [adjAmount, setAdjAmount] = useState("");
  const [adjNote, setAdjNote] = useState("");
  const [adjDir, setAdjDir] = useState<"out" | "in">("out");
  // Édition / suppression d'un mouvement de caisse basé sur une transaction
  // (dépense cash, ajustement). Les encaissements guests s'éditent depuis la
  // fiche guest (échéance), pas ici.
  const [boxEdit, setBoxEdit] = useState<{ txId: string; txKind: string; date: string; label: string; amount: string; note: string; bookingId: string } | null>(null);
  const [boxDeleteArm, setBoxDeleteArm] = useState<string | null>(null);
  const saveBoxEdit = async () => {
    if (!boxEdit) return;
    const amt = Number(boxEdit.amount);
    if (!Number.isFinite(amt) || amt === 0) { toast({ title: "Enter a non-zero amount", variant: "destructive" }); return; }
    await patch(boxEdit.txId, {
      date: boxEdit.date,
      description: boxEdit.label.trim() || null,
      amount: amt,
      // Dépense cash : HT = montant (pas de TVA) ; ajustement : pas de HT
      ...(boxEdit.txKind === "expense" ? { amount_net: Math.abs(amt), booking_id: boxEdit.bookingId || null } : {}),
      ...(boxEdit.txKind === "internal" ? { notes: boxEdit.note.trim() || null } : {}),
    });
    setBoxEdit(null);
  };
  const deleteBoxMove = async (txId: string) => {
    setBoxDeleteArm(null);
    const { error } = await supabase.from("fin_transactions").delete().eq("id", txId);
    if (error) { toast({ title: "Delete failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Movement deleted" });
    load();
  };
  const addAdjustment = async () => {
    const amt = Number(adjAmount);
    if (!Number.isFinite(amt) || amt <= 0) { toast({ title: "Enter an amount", variant: "destructive" }); return; }
    const signed = adjDir === "out" ? -Math.abs(amt) : Math.abs(amt);
    const { error } = await supabase.from("fin_transactions").insert({
      source: "manual", date: new Date().toISOString().slice(0, 10),
      description: adjNote.trim() || (adjDir === "out" ? "Cash box — removed" : "Cash box — added"),
      amount: signed, kind: "internal", is_cash: true, reviewed: true,
      notes: "Ajustement caisse (compte uniquement dans la Cash box — ni cash flow bancaire, ni P&L)",
    } as never);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Cash box adjusted", description: `${signed > 0 ? "+" : ""}${fmt2(signed)}` });
    setAdjAmount(""); setAdjNote("");
    load();
  };

  // ---- Investor update (rapport mensuel copiable, ton CEO, en anglais) -----
  // Mêmes règles que les onglets P&L (HT, accrual) et Cash flow (TTC, date
  // banque). Brouillon à relire avant envoi — les chiffres sont vivants.
  const [reportMonth, setReportMonth] = useState(() => {
    const d = new Date();
    d.setDate(1); d.setMonth(d.getMonth() - 1); // par défaut : dernier mois complet
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  // Token du lien public investisseurs (/investors/:token) — page lecture seule
  // servie par l'edge function investor-report (agrégats uniquement).
  const [shareToken, setShareToken] = useState<string | null>(null);
  useEffect(() => {
    supabase.from("app_settings").select("value").eq("key", "investor_share").maybeSingle()
      .then(({ data }) => setShareToken((data?.value as { token?: string } | null)?.token ?? null));
  }, []);

  const reportText = useMemo(() => {
    const m = reportMonth;
    const yr = m.slice(0, 4);
    const mIdx = Number(m.slice(5, 7)) - 1;
    const monthLong = new Date(`${m}-01T12:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    const monthShort = new Date(`${m}-01T12:00:00`).toLocaleDateString("en-GB", { month: "long" });
    const f = (v: number) => `€${Math.round(Math.abs(v)).toLocaleString("en-GB")}`;

    // P&L accrual — revenus (échéances au mois du check-in, HT)
    const netOf = (i: FinInstallment) => i.amount_excl_vat != null
      ? Number(i.amount_excl_vat)
      : Number(i.amount_due || 0) / (i.category === "catering" ? 1.13 : 1.23);
    let revVenue = 0, revCatering = 0, revBarInst = 0, revYtd = 0;
    for (const i of installments) {
      const b = bookingById.get(i.booking_id);
      if (!b?.check_in_date || !b.check_in_date.startsWith(yr)) continue;
      const im = Number(b.check_in_date.slice(5, 7)) - 1;
      const net = netOf(i);
      if (im <= mIdx) revYtd += net;
      if (im !== mIdx) continue;
      if (i.category === "bar") revBarInst += net;
      else if (i.category === "catering") revCatering += net;
      else revVenue += net; // venue + extras − discounts
    }
    // Bar (merchant payouts) + other income, coûts HT (accrual).
    // 27 août 2026 : dès qu'il existe des échéances bar sur l'année (rollup
    // revolut-bar-sync), elles sont LA source du revenu bar (revBarInst
    // ci-dessus) — les payouts n'entrent plus (anti-double comptage).
    const yrHasBarInst = installments.some((i) => {
      if (i.category !== "bar") return false;
      const b = bookingById.get(i.booking_id);
      return !!b?.check_in_date && b.check_in_date.startsWith(yr);
    });
    let barMonth = 0, barYtd = 0, oiMonth = 0, oiYtd = 0;
    let costVar = 0, costFix = 0, costYtd = 0;
    for (const t of txs) {
      if (t.kind === "bar_payout" && t.amount > 0 && !yrHasBarInst) {
        const bm = t.pnl_month ?? t.date.slice(0, 7);
        if (!bm.startsWith(yr)) continue;
        const v = t.amount_net ?? t.amount;
        if (Number(bm.slice(5, 7)) - 1 <= mIdx) barYtd += v;
        if (bm === m) barMonth += v;
        continue;
      }
      if (t.kind === "other_income") {
        const om = t.pnl_month ?? t.date.slice(0, 7);
        if (!om.startsWith(yr)) continue;
        const v = t.amount_net ?? t.amount;
        if (Number(om.slice(5, 7)) - 1 <= mIdx) oiYtd += v;
        if (om === m) oiMonth += v;
        continue;
      }
      if (t.kind !== "expense" || !t.category) continue;
      const b = t.booking_id ? bookingById.get(t.booking_id) : null;
      const accrual = t.pnl_month ? `${t.pnl_month}-01` : (b?.check_in_date ?? t.date);
      if (!accrual.startsWith(yr)) continue;
      const am = Number(accrual.slice(5, 7)) - 1;
      const v = t.amount_net ?? Math.abs(t.amount);
      if (am <= mIdx) costYtd += v;
      if (am !== mIdx) continue;
      if (PNL_VARIABLE_CATS.has(t.category)) costVar += v; else costFix += v;
    }
    const revBar = revBarInst + barMonth;
    const revMonth = revVenue + revCatering + revBar + oiMonth;
    const costMonth = costVar + costFix;
    const ebitdaMonth = revMonth - costMonth;
    const revYtdTotal = revYtd + barYtd + oiYtd;
    const ebitdaYtd = revYtdTotal - costYtd;

    // Cash (TTC, date banque) : mouvements + espèces encaissées.
    // "Part espèces" : encaissements cash (échéances is_cash) et sorties hors
    // banque (dépenses manuelles / marquées hors compte Revolut Quinta).
    let cin = 0, cout = 0, cinYtd = 0, coutYtd = 0, cashIn = 0, cashOut = 0;
    for (const t of txs) {
      if (t.kind === "internal" || t.kind === "split" || !t.date.startsWith(yr)) continue;
      const tm = Number(t.date.slice(5, 7)) - 1;
      if (tm > mIdx) continue;
      const inMonth = t.date.startsWith(m);
      if (t.amount > 0) { cinYtd += t.amount; if (inMonth) cin += t.amount; }
      else {
        coutYtd += -t.amount;
        if (inMonth) {
          cout += -t.amount;
          if (t.source === "manual" || (t.notes ?? "").includes("Hors compte Revolut Quinta")) cashOut += -t.amount;
        }
      }
    }
    for (const i of installments) {
      if (!i.is_cash || i.status !== "paid" || !bookingById.has(i.booking_id)) continue;
      const d = i.paid_on ?? i.due_date;
      if (!d || !d.startsWith(yr)) continue;
      if (Number(d.slice(5, 7)) - 1 > mIdx) continue;
      cinYtd += Number(i.amount_due || 0);
      if (d.startsWith(m)) { cin += Number(i.amount_due || 0); cashIn += Number(i.amount_due || 0); }
    }
    const net = cin - cout;
    const netYtd = cinYtd - coutYtd;

    // Revenus sécurisés (TTC, contractés) pour l'année sélectionnée
    let secured = 0, collectedAmt = 0;
    const securedEvents = new Set<string>();
    for (const i of installments) {
      const b = bookingById.get(i.booking_id);
      if (!b?.check_in_date || !b.check_in_date.startsWith(yr) || i.category === "bar") continue;
      secured += Number(i.amount_due || 0);
      if (i.status === "paid") collectedAmt += Number(i.amount_due || 0);
      securedEvents.add(i.booking_id);
    }
    const pctCollected = secured > 0 ? Math.round((collectedAmt / secured) * 100) : 0;

    // Pipeline 90 jours + événements du mois
    const todayIso = new Date().toISOString().slice(0, 10);
    const in90 = new Date(); in90.setDate(in90.getDate() + 90);
    const in90Iso = in90.toISOString().slice(0, 10);
    const upcoming = realBookings.filter((b) => b.check_in_date && b.check_in_date > todayIso && b.check_in_date <= in90Iso);
    const upcomingIds = new Set(upcoming.map((b) => b.id));
    let upcomingValue = 0;
    for (const i of installments) {
      if (upcomingIds.has(i.booking_id) && i.category !== "bar") upcomingValue += Number(i.amount_due || 0);
    }
    const hosted = realBookings.filter((b) => b.check_in_date?.startsWith(m));

    // Bookings & pipeline (31 aout 2026) : ventes signees pendant le mois
    // (= echeances creees ce mois-ci, hors bar — nouvelles resas ET upsells,
    // toutes annees de sejour confondues) + carnet "on the books" des annees
    // futures. Montants TVAC, coherents avec la section Revenue secured.
    const realIds = new Set(realBookings.map((b) => b.id));
    let signedMonth = 0;
    const signedByYear = new Map<string, number>();
    for (const i of installments) {
      if (!i.id || i.category === "bar" || !realIds.has(i.booking_id)) continue;
      const createdDay = instCreated.get(i.id);
      if (!createdDay || !createdDay.startsWith(m)) continue;
      const v = Number(i.amount_due || 0);
      signedMonth += v;
      const stayYear = bookingById.get(i.booking_id)?.check_in_date?.slice(0, 4) ?? "TBD";
      signedByYear.set(stayYear, (signedByYear.get(stayYear) ?? 0) + v);
    }
    const signedDetail = [...signedByYear.entries()].sort()
      .map(([y2, v]) => `${y2} stays ${f(v)}`).join(" · ");
    const futureYears = new Map<string, { value: number; events: Set<string>; nights: number }>();
    for (const i of installments) {
      if (i.category === "bar" || !realIds.has(i.booking_id)) continue;
      const b = bookingById.get(i.booking_id);
      const y2 = b?.check_in_date?.slice(0, 4);
      if (!y2 || y2 <= yr) continue;
      const e = futureYears.get(y2) ?? { value: 0, events: new Set<string>(), nights: 0 };
      e.value += Number(i.amount_due || 0);
      if (!e.events.has(i.booking_id)) {
        e.events.add(i.booking_id);
        if (b?.check_in_date && b?.check_out_date) {
          e.nights += Math.max(0, (new Date(b.check_out_date).getTime() - new Date(b.check_in_date).getTime()) / 86400000);
        }
      }
      futureYears.set(y2, e);
    }
    const onTheBooks = [...futureYears.entries()].sort()
      .map(([y2, e]) => `${f(e.value)} already on the books for ${y2} (${e.events.size} event${e.events.size > 1 ? "s" : ""}, ${Math.round(e.nights)} nights)`)
      .join("; ");

    const lines = [
      `💐 QUINTA DO AMOR OPERATIONS`,
      `Investor update — ${monthLong}`,
      ``,
      `1. P&L (net of VAT, accrual) — Revenue recognised in ${monthShort}: ${f(revMonth)}`
        + (revMonth !== 0 ? ` (venue & extras ${f(revVenue)} · catering ${f(revCatering)} · bar ${f(revBar)})` : "")
        + `. Operating costs: ${f(costMonth)} (${f(costVar)} event-related, ${f(costFix)} fixed & structural), for an EBITDA of ${ebitdaMonth < 0 ? "−" : ""}${f(ebitdaMonth)}. Year to date: ${f(revYtdTotal)} revenue and ${ebitdaYtd < 0 ? "−" : ""}${f(ebitdaYtd)} EBITDA.`,
      ``,
      `2. Cash — ${f(cin)} collected (${f(cin - cashIn)} bank, ${f(cashIn)} cash) and ${f(cout)} paid out (${f(cout - cashOut)} bank, ${f(cashOut)} cash) in ${monthShort}, a net ${net < 0 ? "outflow" : "inflow"} of ${f(net)}. Net cash generated since 1 January: ${netYtd < 0 ? "−" : ""}${f(netYtd)}.`,
      ``,
      `3. Revenue secured — ${f(secured)} contracted for ${yr} across ${securedEvents.size} events, of which ${f(collectedAmt)} (${pctCollected}%) has already been collected; the balance falls due ahead of each event. ${upcoming.length > 0 ? `${upcoming.length} event${upcoming.length > 1 ? "s" : ""} in the next 90 days represent${upcoming.length > 1 ? "" : "s"} ${f(upcomingValue)} of contracted revenue.` : "No events are scheduled in the next 90 days."}`,
      ``,
      `4. Bookings & pipeline — ${signedMonth > 0
        ? `${f(signedMonth)} of new business signed in ${monthShort}${signedDetail ? ` (${signedDetail})` : ""}.`
        : `no new business signed in ${monthShort}.`}${onTheBooks ? ` ${onTheBooks[0].toUpperCase()}${onTheBooks.slice(1)}.` : ""}`,
      ``,
      `5. Activity — ${hosted.length > 0
        ? `${hosted.length} event${hosted.length > 1 ? "s" : ""} hosted in ${monthShort} (${hosted.map((b) => b.name).join(", ")}).`
        : `no events hosted in ${monthShort}.`}`,
    ];

    // Lien investisseurs : libellé court à l'écran, hyperlien cliquable dans
    // le presse-papier (HTML), URL complète en repli texte brut.
    const liveUrl = shareToken ? `https://guest.quintamor.com/investors/${shareToken}` : null;
    const linkLabel = "📈 Consult live P&L & cashflow";
    const display = lines.join("\n") + (liveUrl ? `\n\n${linkLabel}` : "");
    const plain = lines.join("\n") + (liveUrl ? `\n\n${linkLabel}: ${liveUrl}` : "");
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html = lines.map((l) => l === "" ? "<br>" : `<p style="margin:0 0 2px">${esc(l)}</p>`).join("")
      + (liveUrl ? `<br><p style="margin:0"><a href="${liveUrl}">${linkLabel}</a></p>` : "");
    return { display, plain, html };
  }, [reportMonth, txs, installments, bookingById, realBookings, shareToken, instCreated]);

  const copyReport = async () => {
    try {
      // HTML (liens cliquables dans Gmail & co) + repli texte brut avec URLs
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([reportText.html], { type: "text/html" }),
          "text/plain": new Blob([reportText.plain], { type: "text/plain" }),
        }),
      ]);
      toast({ title: "Copied", description: "Paste into your email — the P&L and Cashflow links arrive as clickable hyperlinks." });
    } catch {
      try {
        await navigator.clipboard.writeText(reportText.plain);
        toast({ title: "Copied (plain text)", description: "Links included as full URLs." });
      } catch {
        toast({ title: "Copy failed", description: "Select the text and copy it manually.", variant: "destructive" });
      }
    }
  };

  // ---- Filtres mois / événement / catégorie / recherche -------------------
  const [monthFilter, setMonthFilter] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [search, setSearch] = useState("");
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const monthsAvailable = useMemo(() => {
    const ms = new Set<string>();
    for (const t of txs) ms.add(t.date.slice(0, 7));
    return [...ms].sort().reverse();
  }, [txs]);
  const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

  const filtered = useMemo(() => {
    let arr = txs;
    if (filter === "review") arr = arr.filter((t) => !t.reviewed);
    if (filter === "in") arr = arr.filter((t) => t.amount > 0);
    // Dépenses sans justificatif lié (contrôle compta avant envoi au comptable)
    if (filter === "noreceipt") arr = arr.filter((t) => (t.kind === "expense" || t.kind === "review") && t.amount < 0 && !docsByTx.has(t.id) && !t.receipt_waived);
    if (monthFilter) arr = arr.filter((t) => t.date.startsWith(monthFilter));
    if (eventFilter) arr = arr.filter((t) => t.booking_id === eventFilter);
    if (catFilter === "__none__") arr = arr.filter((t) => !t.category && t.kind === "expense");
    else if (catFilter) arr = arr.filter((t) => t.category === catFilter);
    const q = norm(search.trim());
    if (q) {
      arr = arr.filter((t) =>
        norm(`${t.description ?? ""} ${t.notes ?? ""} ${t.payer ?? ""} ${t.category ?? ""} ${t.booking_id ? bookingById.get(t.booking_id)?.name ?? "" : ""}`).includes(q)
        || Math.abs(t.amount).toFixed(2).includes(q));
    }
    return arr;
  }, [txs, filter, monthFilter, eventFilter, catFilter, search, bookingById, docsByTx]);
  const visible = useMemo(() => filtered.slice(0, 300), [filtered]);

  // ---- Export CSV de la plage affichée (tous les filtres, sans la limite d'affichage)
  const exportCsv = () => {
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["date", "description", "note", "payer", "amount", "currency", "vat_rate", "amount_net", "kind", "category", "event", "pnl_month", "source"];
    const lines = [header.join(",")];
    for (const t of filtered) {
      lines.push([
        t.date, esc(t.description), esc(t.notes), esc(t.payer), t.amount, t.currency,
        t.vat_rate ?? "", t.amount_net ?? "", t.kind, esc(t.category),
        esc(t.booking_id ? bookingById.get(t.booking_id)?.name ?? "" : ""), t.pnl_month ?? "", t.source,
      ].join(","));
    }
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const parts = ["transactions", monthFilter || "all-months"];
    if (eventFilter) parts.push((bookingById.get(eventFilter)?.name ?? "event").toLowerCase().replace(/[^a-z0-9]+/g, "-"));
    if (catFilter) parts.push((catFilter === "__none__" ? "uncategorised" : catFilter).toLowerCase().replace(/[^a-z0-9]+/g, "-"));
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
  const [mCash, setMCash] = useState(true); // dépense manuelle = souvent payée en espèces
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
      booking_id: mBooking || null, reviewed: true, is_cash: mCash,
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
        {(mode === "analytics"
          ? ([["pnl", "P&L", TrendingUp], ["cash", "Cash flow", Wallet2], ["report", "Investor update", Mail]] as const)
          : ([["tx", "Transactions", ReceiptText], ["box", "Cash box", Banknote], ["margins", "Event margins", PercentIcon]] as const)
        ).map(([k, label, Icon]) => (
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
              {(["review", "in", "noreceipt", "all"] as const).map((f) => (
                <button key={f} type="button" onClick={() => setFilter(f)}
                  title={f === "noreceipt" ? "Expenses without a linked receipt — clear this list before sending the month to the accountant" : undefined}
                  className={`rounded-full px-3.5 py-1 text-xs font-semibold ${filter === f ? "bg-foreground text-background" : "text-muted-foreground"}`}>
                  {f === "review" ? `To review (${reviewCount})` : f === "in" ? "Money in" : f === "noreceipt" ? `📎 No receipt (${noReceiptCount})` : "All"}
                </button>
              ))}
            </div>
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search description, note, payer, amount…"
              className="h-7 w-[230px] rounded-full border border-border bg-card px-3 text-xs placeholder:text-muted-foreground/60" />
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
            <select className="h-7 rounded-full border border-border bg-card px-2.5 text-xs max-w-[210px]"
              value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
              <option value="">All categories</option>
              <option value="__none__">Uncategorised expenses</option>
              {FIN_CATEGORIES.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.items.map((c) => <option key={c} value={c}>{c}</option>)}
                </optgroup>
              ))}
            </select>
            {(monthFilter || eventFilter || catFilter || search) && (
              <button type="button" className="text-xs text-muted-foreground hover:underline"
                onClick={() => { setMonthFilter(""); setEventFilter(""); setCatFilter(""); setSearch(""); }}>
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
              <input ref={attachRef} type="file" accept="image/*,application/pdf" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f && attachTxId) attachReceipt(f, attachTxId); }} />
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
              <label className="flex items-center gap-2 text-sm pb-2" title="Paid in cash: also deducted from the Cash box tab. Untick if paid another way (personal card…).">
                <input type="checkbox" checked={mCash} onChange={(e) => setMCash(e.target.checked)} className="h-4 w-4 accent-[#35532A]" />
                Paid in cash
              </label>
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
                    {monthFilter || eventFilter || catFilter || search ? "No transactions match these filters." : filter === "review" ? "Nothing to review — inbox zero 🎉" : "No transactions yet — connect Revolut or import a CSV to start."}
                  </td></tr>
                ) : visible.map((t) => {
                  const k = KIND_LABEL[t.kind] ?? KIND_LABEL.review;
                  const editable = t.kind === "expense" || t.kind === "review";
                  return (
                  <Fragment key={t.id}>
                    <tr className="group border-t border-border/60">
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums text-xs">
                        {fmtDayEU(t.date)}
                        {(t.kind === "expense" || t.kind === "other_income") && (
                          pnlFor === t.id ? (
                            <input type="month" autoFocus
                              className="mt-0.5 block h-6 rounded border border-input bg-background px-1 text-[10px]"
                              defaultValue={t.pnl_month ?? t.date.slice(0, 7)}
                              onBlur={(e) => {
                                setPnlFor(null);
                                const v = e.target.value;
                                patch(t.id, { pnl_month: v && v !== t.date.slice(0, 7) ? v : null });
                              }}
                              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setPnlFor(null); }} />
                          ) : t.pnl_month ? (
                            <button type="button"
                              className="mt-0.5 block rounded-full bg-[#E8F0FB] px-1.5 py-px text-[9px] font-semibold text-[#1C5CAB] hover:brightness-95"
                              title={`Recognised in the ${MONTHS[Number(t.pnl_month.slice(5, 7)) - 1]} ${t.pnl_month.slice(0, 4)} P&L (bank date stays ${fmtFullEU(t.date)}) — click to change`}
                              onClick={() => setPnlFor(t.id)}>
                              P&L {MONTHS[Number(t.pnl_month.slice(5, 7)) - 1]}
                            </button>
                          ) : (
                            <button type="button"
                              className="mt-0.5 block text-left text-[9px] text-muted-foreground/0 group-hover:text-muted-foreground/60 hover:!text-muted-foreground hover:underline"
                              title="Recognise this expense in another month's P&L (e.g. March payment for a January invoice)"
                              onClick={() => setPnlFor(t.id)}>
                              P&L month
                            </button>
                          )
                        )}
                      </td>
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
                        {t.amount > 0 && t.kind !== "split" ? (
                          // Toujours modifiable, même auto-classée (Merchant payout,
                          // Stripe…) : le menu remplace le badge figé.
                          <select className="h-7 rounded-md border border-input bg-background px-1 text-xs"
                            value={t.kind === "review" ? "" : t.kind}
                            onChange={(e) => e.target.value && patch(t.id, { kind: e.target.value, category: null, vat_rate: null, amount_net: null, reviewed: true })}>
                            <option value="">Money in — classify…</option>
                            <option value="guest_payment">Guest payment (already in P&L)</option>
                            <option value="bar_payout">Bar payout — P&L revenue (bar)</option>
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
                                {" · "}
                                <button type="button" className="font-medium text-muted-foreground hover:text-foreground hover:underline"
                                  title="Refund to a guest — cash flow only; the P&L impact already lives in the booking's discount installment (never double-counted)"
                                  onClick={() => patch(t.id, { kind: "refund", category: null, vat_rate: null, amount_net: null, reviewed: true })}>
                                  refund
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
                      <td className="px-3 py-2 whitespace-nowrap">
                        {t.reviewed ? (
                          <span className="inline-flex rounded-full bg-[#E5F5EA] px-2 py-0.5 text-[10px] font-semibold text-[#178A3F]">OK</span>
                        ) : t.kind === "expense" && t.category ? (
                          <button type="button"
                            className="inline-flex rounded-full bg-[#35532A] px-2.5 py-0.5 text-[10px] font-semibold text-white hover:bg-[#2A4221]"
                            title="Auto-classified from your rules — check category, VAT and event, then confirm"
                            onClick={() => patch(t.id, { reviewed: true })}>
                            ✓ Confirm
                          </button>
                        ) : (
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${KIND_LABEL.review.cls}`}>To review</span>
                        )}
                        {t.reviewed && t.kind !== "review" && (
                          <button type="button" className="ml-1.5 text-[10px] text-muted-foreground hover:underline"
                            onClick={() => patch(t.id, { kind: "review", reviewed: false })}>edit</button>
                        )}
                        {(t.kind === "expense" || t.kind === "review") && t.amount < 0 && (
                          docsByTx.has(t.id) ? (
                            <>
                              {/* Justificatif lié : icône verte -> ouvre le fichier */}
                              <button type="button"
                                className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-[#E5F5EA] px-1.5 py-0.5 text-[10px] font-semibold text-[#178A3F] hover:bg-[#D3EDDC] align-middle"
                                title={`${docsByTx.get(t.id)!.length > 1 ? `${docsByTx.get(t.id)!.length} receipts` : "Receipt"} attached — click to open`}
                                onClick={() => openReceipts(t.id)}>
                                <ReceiptText className="w-3 h-3" />
                                {docsByTx.get(t.id)!.length > 1 ? docsByTx.get(t.id)!.length : ""}
                              </button>
                              <button type="button"
                                className="ml-1 text-[11px] text-muted-foreground/50 hover:text-foreground"
                                title="Attach another receipt"
                                onClick={() => { setAttachTxId(t.id); attachRef.current?.click(); }}>
                                {attachBusy === t.id ? "…" : "📎"}
                              </button>
                            </>
                          ) : t.receipt_waived ? (
                            <button type="button"
                              className="ml-1.5 inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground align-middle"
                              title="No receipt to expect for this line — click to undo"
                              onClick={() => patch(t.id, { receipt_waived: false })}>
                              ∅ no receipt
                            </button>
                          ) : (
                            <>
                              <button type="button"
                                className="ml-1.5 text-[11px] text-muted-foreground/60 hover:text-foreground"
                                title="Attach the receipt (photo or PDF) — vendor, date and VAT are read automatically"
                                onClick={() => { setAttachTxId(t.id); attachRef.current?.click(); }}>
                                {attachBusy === t.id ? "…" : "📎"}
                              </button>
                              <button type="button"
                                className="ml-1 text-[11px] text-muted-foreground/40 hover:text-foreground"
                                title="No receipt to expect (cash, tip, no-ticket purchase) — removes this line from the No receipt filter"
                                onClick={() => patch(t.id, { receipt_waived: true })}>
                                ∅
                              </button>
                            </>
                          )
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
                        Totals — {rows.length} row{rows.length > 1 ? "s" : ""}{monthFilter || eventFilter || catFilter || filter !== "all" ? " (filtered)" : ""}
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
            Anti-double counting: guest payments, guest refunds and internal transfers never create P&L lines — event revenue (and discounts/refunds) lives in the installments. Bar payouts (Merchant) are the P&L's "Bar (merchant)" revenue line. VAT payments and refunds count in cash flow only. Totals above are the raw sum of the listed lines (split parents excluded).
          </p>
        </>
      )}

      {/* ================= P&L ================= */}
      {tab === "pnl" && (
        <div className="overflow-auto rounded-2xl bg-card shadow-sm border border-border/60 p-4">
          <div className="font-semibold text-sm mb-1 flex items-center gap-2"><Landmark className="w-4 h-4 text-[#35532A]" /> P&L {year} <span className="text-xs font-normal text-muted-foreground">· net of VAT · accrual (P&L month override → event check-in month → bank date)</span></div>
          <table className="w-full text-xs mt-3">
            <thead>
              <tr className="text-left">
                <th className="py-1.5 pr-2 font-semibold text-muted-foreground sticky left-0 bg-card">&nbsp;</th>
                {MONTHS.map((m) => <th key={m} className="py-1.5 px-2 text-right font-semibold text-muted-foreground">{m}</th>)}
                <th className="py-1.5 px-2 text-right font-bold text-muted-foreground">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={14} className="pb-1 pr-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground sticky left-0 bg-card">Revenue</td>
              </tr>
              {[...pnl.revRows.entries()]
                .filter(([, arr]) => arr.some((v) => v !== 0))
                .sort((a, b) => revLineRank(a[0]) - revLineRank(b[0]))
                .map(([label, arr]) => (
                  <tr key={label} className="border-t border-border/40">
                    <td className="py-1.5 pr-2 pl-3 text-muted-foreground sticky left-0 bg-card whitespace-nowrap">{label}</td>
                    {arr.map((v, i) => <td key={i} className="py-1.5 px-2 text-right tabular-nums">{v ? fmt0(v) : "·"}</td>)}
                    <td className="py-1.5 px-2 text-right tabular-nums font-semibold">{fmt0(arr.reduce((s, v) => s + v, 0))}</td>
                  </tr>
                ))}
              {pnl.otherIncome.some((v) => v !== 0) && (
                <tr className="border-t border-border/40">
                  <td className="py-1.5 pr-2 pl-3 text-muted-foreground sticky left-0 bg-card whitespace-nowrap">Other income</td>
                  {pnl.otherIncome.map((v, i) => <td key={i} className="py-1.5 px-2 text-right tabular-nums">{v ? fmt0(v) : "·"}</td>)}
                  <td className="py-1.5 px-2 text-right tabular-nums font-semibold">{fmt0(pnl.otherIncome.reduce((s, v) => s + v, 0))}</td>
                </tr>
              )}
              <tr className="border-t border-border/60">
                <td className="py-1.5 pr-2 font-semibold sticky left-0 bg-card whitespace-nowrap">Total revenue</td>
                {pnl.totalRev.map((v, i) => <td key={i} className="py-1.5 px-2 text-right tabular-nums font-semibold">{v ? fmt0(v) : "·"}</td>)}
                <td className="py-1.5 px-2 text-right tabular-nums font-bold">{fmt0(pnl.totalRev.reduce((s, v) => s + v, 0))}</td>
              </tr>
              <tr>
                <td colSpan={14} className="pt-3 sticky left-0 bg-card" />
              </tr>
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
        <div className="rounded-2xl bg-card shadow-sm border border-border/60 p-4 relative">
          <div className="font-semibold text-sm mb-1 flex items-center gap-2"><Wallet2 className="w-4 h-4 text-[#35532A]" /> Cash flow {year} <span className="text-xs font-normal text-muted-foreground">· bank movements, internal transfers excluded</span></div>
          {(() => {
            const max = Math.max(...cash.cin, ...cash.cout, 1);
            return (
              <>
                <div className="flex items-end gap-2 h-44 mt-4 border-b border-border px-1">
                  {MONTHS.map((m, i) => (
                    <div key={m} className="flex-1 flex items-end justify-center gap-[3px] h-full"
                      onMouseMove={(e) => setCashTip({ x: e.clientX, y: e.clientY, m: i })}
                      onMouseLeave={() => setCashTip(null)}>
                      <div className="w-[46%] max-w-[26px] flex flex-col justify-end" style={{ height: `${(cash.cin[i] / max) * 100}%` }}>
                        {cash.capital[i] > 0 && (
                          <div className="w-full rounded-t bg-[#B08CF8]" style={{ height: `${(cash.capital[i] / Math.max(cash.cin[i], 0.01)) * 100}%` }} />
                        )}
                        <div className={`w-full flex-1 bg-[#8FC46A] ${cash.capital[i] > 0 ? "" : "rounded-t"}`} />
                        {cash.cashDrawer[i] > 0 && (
                          <div className="w-full bg-[#D9A93F]" style={{ height: `${(cash.cashDrawer[i] / Math.max(cash.cin[i], 0.01)) * 100}%` }} />
                        )}
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
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px] bg-[#8FC46A] inline-block" /> In — bank</span>
                  {cash.cashDrawer.some((v) => v > 0) && (
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px] bg-[#D9A93F] inline-block" /> In — espèces</span>
                  )}
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
                {cashTip && (() => {
                  const i = cashTip.m;
                  const bank = cash.cin[i] - cash.cashDrawer[i] - cash.capital[i];
                  const net = cash.cin[i] - cash.cout[i];
                  if (cash.cin[i] === 0 && cash.cout[i] === 0) return null;
                  const Row = ({ color, label, value }: { color: string; label: string; value: number }) => (
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: color }} />
                      <span className="flex-1 pr-3 text-white/75">{label}</span>
                      <b className="tabular-nums">{fmt2(value)}</b>
                    </div>
                  );
                  return (
                    <div className="pointer-events-none fixed z-50 rounded-lg bg-[#1F241C] px-3 py-2.5 text-[11.5px] leading-relaxed text-white shadow-lg"
                      style={{ left: Math.min(cashTip.x + 14, window.innerWidth - 240), top: cashTip.y + 14 }}>
                      <div className="mb-1 font-bold">{MONTHS[i]} {year}</div>
                      <Row color="#8FC46A" label="In — bank (card & transfers)" value={bank} />
                      {cash.cashDrawer[i] > 0 && <Row color="#D9A93F" label="In — cash (espèces)" value={cash.cashDrawer[i]} />}
                      {cash.capital[i] > 0 && <Row color="#B08CF8" label="Owner contribution" value={cash.capital[i]} />}
                      <Row color="#EF9455" label="Cash out" value={-cash.cout[i]} />
                      <div className="mt-1 border-t border-white/20 pt-1 flex items-center justify-between gap-4">
                        <span className="text-white/75">Net</span>
                        <b className={`tabular-nums ${net < 0 ? "text-[#FFB4A8]" : "text-[#C8E6A0]"}`}>{fmt2(net)}</b>
                      </div>
                    </div>
                  );
                })()}
              </>
            );
          })()}
        </div>
      )}

      {/* ================= CASH BOX (caisse espèces) ================= */}
      {tab === "box" && (
        <div className="space-y-4">
          <div className="grid sm:grid-cols-4 gap-3">
            <div className="rounded-2xl bg-[#35532A] text-white shadow-sm p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-white/70">Cash on hand</div>
              <div className="mt-1 text-3xl font-bold tabular-nums">{fmt2(box.balance)}</div>
            </div>
            <div className="rounded-2xl bg-card border border-border/60 shadow-sm p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Cash collected</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-[#178A3F]">{fmt2(box.cashIn)}</div>
              <div className="text-[11px] text-muted-foreground">guest payments in cash</div>
            </div>
            <div className="rounded-2xl bg-card border border-border/60 shadow-sm p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Cash spent</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-[#C0392B]">{fmt2(box.cashOut)}</div>
              <div className="text-[11px] text-muted-foreground">expenses paid in cash</div>
            </div>
            <div className="rounded-2xl bg-card border border-border/60 shadow-sm p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Adjustments</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{fmt2(box.adj)}</div>
              <div className="text-[11px] text-muted-foreground">bank deposits, corrections…</div>
            </div>
          </div>

          {box.undated > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              ⚠ {fmt2(box.undated)} of paid cash installments have no payment date (Payments tab) — they are not counted in the box yet. Set their "paid on" date to include them.
            </p>
          )}

          {/* Ajustement : dépôt en banque, correction après comptage… */}
          <div className="rounded-2xl bg-card border border-border/60 shadow-sm p-4 flex flex-wrap items-end gap-2">
            <label className="space-y-0.5">
              <div className="text-[11px] text-muted-foreground">Adjustment</div>
              <select className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                value={adjDir} onChange={(e) => setAdjDir(e.target.value as "out" | "in")}>
                <option value="out">Remove from box (deposit to bank…)</option>
                <option value="in">Add to box</option>
              </select>
            </label>
            <label className="space-y-0.5">
              <div className="text-[11px] text-muted-foreground">Amount (€)</div>
              <Input type="number" min="0" step="0.01" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} className="h-8 w-28" />
            </label>
            <label className="space-y-0.5 flex-1 min-w-[180px]">
              <div className="text-[11px] text-muted-foreground">Note</div>
              <Input value={adjNote} onChange={(e) => setAdjNote(e.target.value)} placeholder="Deposited at Millennium…" className="h-8 placeholder:italic placeholder:text-muted-foreground/50" />
            </label>
            <Button size="sm" className="h-8" onClick={addAdjustment}>Save</Button>
            <p className="w-full text-[11px] text-muted-foreground">
              Adjustments only move the Cash box — they never touch the bank cash flow or the P&L. Cash guest payments (Payments tab) add to the box automatically; cash expenses (Manual expense, Catering staff paid in cash) deduct automatically.
            </p>
          </div>

          {/* Mouvements */}
          <div className="overflow-auto rounded-2xl bg-card shadow-sm border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-muted/80">
                <tr className="text-left">
                  {["Date", "Movement", "Amount", "Balance", ""].map((h, hi) => (
                    <th key={hi} className="px-3 py-2.5 text-[11px] uppercase tracking-wider font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {box.moves.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground italic">
                    No cash movements yet — cash guest payments and cash expenses will appear here.
                  </td></tr>
                ) : box.moves.map((m, i) => (
                  m.txId && boxEdit?.txId === m.txId ? (
                    <tr key={i} className="border-t border-border/60 bg-primary/5">
                      <td className="px-3 py-2">
                        <Input type="date" value={boxEdit.date} onChange={(e) => setBoxEdit((v) => v && { ...v, date: e.target.value })} className="h-8 w-36 text-xs" />
                      </td>
                      <td className="px-3 py-2">
                        <Input value={boxEdit.label} onChange={(e) => setBoxEdit((v) => v && { ...v, label: e.target.value })} className="h-8 text-xs" />
                        {boxEdit.txKind === "expense" && (
                          <select className="h-8 mt-1 w-full rounded-md border border-input bg-background px-1.5 text-xs"
                            title="Attach this cash expense to an event — it will show in the event's margins and hit the P&L on the event's month"
                            value={boxEdit.bookingId}
                            onChange={(e) => setBoxEdit((v) => v && { ...v, bookingId: e.target.value })}>
                            <option value="">No event</option>
                            {realBookings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                          </select>
                        )}
                        {boxEdit.txKind === "internal" && (
                          <Input value={boxEdit.note} placeholder="Note"
                            onChange={(e) => setBoxEdit((v) => v && { ...v, note: e.target.value })}
                            className="h-8 text-xs mt-1 placeholder:italic placeholder:text-muted-foreground/50" />
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Input type="number" step="0.01" value={boxEdit.amount}
                          onChange={(e) => setBoxEdit((v) => v && { ...v, amount: e.target.value })}
                          className="h-8 w-28 text-right text-xs inline-block" />
                        <span className="block text-[10px] text-muted-foreground mt-0.5">negative = out of the box</span>
                      </td>
                      <td className="px-3 py-2 text-right" colSpan={2}>
                        <Button size="sm" className="h-7 text-xs" onClick={saveBoxEdit}>Save</Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs ml-1" onClick={() => setBoxEdit(null)}>Cancel</Button>
                      </td>
                    </tr>
                  ) : (
                  <tr key={i} className="border-t border-border/60">
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums text-xs">{fmtDayEU(m.date)} {m.date.slice(0, 4)}</td>
                    <td className="px-3 py-2">
                      <span className="font-medium">{m.label}</span>
                      {m.kind !== "in" && m.bookingId && bookingById.has(m.bookingId) && (
                        <span className="ml-1.5 inline-block rounded-full bg-[#EFF3EC] text-[#35532A] px-1.5 py-0.5 text-[10px] font-medium align-middle">
                          {bookingById.get(m.bookingId)!.name}
                        </span>
                      )}
                      {m.sub && <span className="block text-[11px] text-muted-foreground truncate max-w-[380px]">{m.sub}</span>}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums font-semibold whitespace-nowrap ${m.amount > 0 ? "text-[#178A3F]" : "text-[#C0392B]"}`}>
                      {m.amount > 0 ? "+" : ""}{fmt2(m.amount)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground whitespace-nowrap">{fmt2(m.balance)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {m.txId ? (
                        <>
                          <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                            title="Edit this movement (date, description, amount)"
                            onClick={() => setBoxEdit({ txId: m.txId!, txKind: m.txKind!, date: m.date, label: m.label, amount: String(m.amount), note: m.txKind === "internal" ? (m.sub ?? "") : "", bookingId: m.bookingId ?? "" })}>
                            edit
                          </button>
                          {boxDeleteArm === m.txId ? (
                            <button type="button" className="ml-1.5 text-[11px] font-semibold text-destructive hover:underline"
                              onClick={() => deleteBoxMove(m.txId!)}>sure?</button>
                          ) : (
                            <button type="button" className="ml-1.5 text-[11px] text-muted-foreground/60 hover:text-destructive"
                              title={m.txKind === "expense" ? "Delete — also removes this cash expense from the P&L and cash flow" : "Delete this adjustment"}
                              onClick={() => { setBoxDeleteArm(m.txId!); setTimeout(() => setBoxDeleteArm((v) => (v === m.txId ? null : v)), 3000); }}>✕</button>
                          )}
                        </>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/60" title="Cash guest payment — edit it from the guest's file (Payments section)">guest file</span>
                      )}
                    </td>
                  </tr>
                  )
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ================= INVESTOR UPDATE ================= */}
      {/* ================= EVENT MARGINS ================= */}
      {tab === "margins" && <EventMarginsTab year={year} />}


      {tab === "report" && (
        <div className="rounded-2xl bg-card shadow-sm border border-border/60 p-4 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="font-semibold text-sm flex items-center gap-2">
              <Mail className="w-4 h-4 text-[#35532A]" /> Investor update
            </div>
            <select className="h-8 rounded-full border border-border bg-card px-3 text-xs"
              value={reportMonth} onChange={(e) => setReportMonth(e.target.value)}>
              {monthsAvailable.map((mo) => <option key={mo} value={mo}>{monthLabel(mo)}</option>)}
              {!monthsAvailable.includes(reportMonth) && <option value={reportMonth}>{monthLabel(reportMonth)}</option>}
            </select>
            <Button size="sm" onClick={copyReport}>
              <Copy className="w-4 h-4 mr-1" /> Copy for email
            </Button>
            <span className="text-xs text-muted-foreground">
              Draft generated from live data (P&L net of VAT, cash at bank date) — reread, adjust the narrative, then paste into your email.
            </span>
          </div>
          <textarea
            readOnly
            value={reportText.display}
            rows={14}
            className="w-full resize-y rounded-xl border border-border bg-background p-4 text-[13px] leading-relaxed"
          />
          <p className="text-[11px] text-muted-foreground">
            Tip: the numbers update as you confirm transactions in the To review queue — generate the update once the month's lines are confirmed. Add your own qualitative points (works progress, unexpected items, outlook) on top: investors read the story, the numbers back it up.
          </p>
        </div>
      )}
    </div>
  );
}
