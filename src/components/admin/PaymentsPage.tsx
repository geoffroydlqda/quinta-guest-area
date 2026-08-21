import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Mail, Link2, Upload, Download, Trash2, FileDown, ExternalLink, FilePlus2,
} from "lucide-react";
import { PaymentEmailDialog } from "@/components/admin/PaymentEmailDialog";

/**
 * Page Payments — échéancier global (remplace le Google Sheet de suivi).
 * Une ligne par échéance : montants TVAC/HT, statut, dernier rappel envoyé,
 * facture (upload en attendant Moloni), lien de paiement (Wise…), marquer payé,
 * envoi d'un rappel manuel (Edge Function payment-reminders, type payment_manual).
 */
export interface PayBooking {
  id: string;
  retreat_name: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  check_in_date: string | null;
  check_out_date?: string | null;
  total_rental_price?: number | null;
  is_test?: boolean | null;
}

export interface PayInstallment {
  id: string;
  booking_id: string;
  label?: string | null;
  amount_due: number;
  amount_excl_vat?: number | null;
  due_date: string | null;
  status: string;
  category?: string | null;
  invoice_file_url?: string | null;
  invoice_file_name?: string | null;
  payment_link?: string | null;
  is_cash?: boolean;
  moloni_document_id?: number | null;
  invoice_number?: string | null;
}

type Bucket = "paid" | "overdue" | "upcoming";

const fmt2 = (v: number) =>
  `${v < 0 ? "−" : ""}€${Math.abs(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt0 = (v: number) =>
  `${v < 0 ? "−" : ""}€${Math.abs(v).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const STATUS_BADGE: Record<Bucket, string> = {
  paid: "bg-green-100 text-green-800 border-green-300",
  overdue: "bg-red-100 text-red-800 border-red-300",
  upcoming: "bg-muted text-muted-foreground border-border",
};

export function PaymentsPage({
  bookings,
  installments,
  onReload,
  onOpen,
}: {
  bookings: PayBooking[];
  installments: PayInstallment[];
  onReload: () => void;
  onOpen: (bookingId: string) => void;
}) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | Bucket>("all");
  const [sortDesc, setSortDesc] = useState(false);
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [catFilter, setCatFilter] = useState<"all" | "rental" | "catering" | "extra" | "discount">("all");
  const [lastReminder, setLastReminder] = useState<Map<string, string>>(new Map());
  const [busyId, setBusyId] = useState<string | null>(null);
  const uploadTarget = useRef<PayInstallment | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Compose email de paiement (textes validés — demande ou confirmation)
  const [emailTarget, setEmailTarget] = useState<{ inst: PayInstallment; booking: PayBooking; kind: "request" | "confirmation" } | null>(null);

  // Position de l'échéance parmi les échéances payables du booking (pour
  // "second and final payment") + reste-t-il d'autres échéances impayées.
  const emailMeta = (inst: PayInstallment) => {
    const siblings = installments
      .filter((i) => i.booking_id === inst.booking_id && i.category !== "discount" && Number(i.amount_due) > 0)
      .sort((a, b) => (a.due_date ?? "0000").localeCompare(b.due_date ?? "0000"));
    const idx = siblings.findIndex((i) => i.id === inst.id);
    const ordinal = idx >= 0 ? idx + 1 : 1;
    const isLast = idx >= 0 && idx === siblings.length - 1;
    const allSettled = siblings.every((i) => i.id === inst.id || i.status === "paid");
    return { ordinal, isLast, allSettled };
  };

  const todayIso = useMemo(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  }, []);

  const loadReminders = async () => {
    const { data } = await supabase
      .from("reminder_log")
      .select("installment_id, created_at")
      .eq("status", "sent")
      .in("type", ["payment_upcoming", "payment_overdue", "payment_manual"])
      .order("created_at", { ascending: false })
      .limit(1000);
    const m = new Map<string, string>();
    for (const r of data || []) {
      if (r.installment_id && !m.has(r.installment_id)) m.set(r.installment_id, r.created_at);
    }
    setLastReminder(m);
  };
  useEffect(() => { loadReminders(); }, []);

  const bookingById = useMemo(() => new Map(bookings.map((b) => [b.id, b])), [bookings]);

  type Row = {
    inst: PayInstallment;
    booking: PayBooking;
    name: string;
    bucket: Bucket;
    year: string;
    isInternal: boolean;
  };

  const allRows: Row[] = useMemo(() => {
    const list: Row[] = [];
    for (const inst of installments) {
      const booking = bookingById.get(inst.booking_id);
      if (!booking) continue;
      const name = booking.retreat_name
        || `${booking.first_name ?? ""} ${booking.last_name ?? ""}`.trim()
        || booking.email;
      const bucket: Bucket = inst.status === "paid"
        ? "paid"
        : inst.due_date && inst.due_date < todayIso ? "overdue" : "upcoming";
      list.push({
        inst,
        booking,
        name,
        bucket,
        year: (booking.check_in_date || "").slice(0, 4) || "—",
        isInternal: /^internal\+/i.test(booking.email || ""),
      });
    }
    // Tri : échéances datées d'abord (croissant), puis sans date, groupé par check-in
    list.sort((a, b) =>
      (a.inst.due_date ?? "9999-99-99").localeCompare(b.inst.due_date ?? "9999-99-99") ||
      (a.booking.check_in_date ?? "").localeCompare(b.booking.check_in_date ?? "")
    );
    return list;
  }, [installments, bookingById, todayIso]);

  const years = useMemo(
    () => [...new Set(allRows.map((r) => r.year).filter((y) => y !== "—"))].sort(),
    [allRows]
  );

  const rows = useMemo(() => {
    const s = search.toLowerCase().trim();
    const filtered = allRows.filter((r) => {
      if (statusFilter !== "all" && r.bucket !== statusFilter) return false;
      if (yearFilter !== "all" && r.year !== yearFilter) return false;
      if (catFilter !== "all" && (r.inst.category ?? "rental") !== catFilter) return false;
      if (s && !r.name.toLowerCase().includes(s) && !r.booking.email.toLowerCase().includes(s)) return false;
      return true;
    });
    // Ordre par due date : croissant (défaut) ou plus récent d'abord
    return sortDesc ? [...filtered].reverse() : filtered;
  }, [allRows, search, statusFilter, yearFilter, catFilter, sortDesc]);

  const totals = useMemo(() => {
    let total = 0, totalHt = 0, paid = 0, paidCash = 0, paidBank = 0, overdue = 0;
    for (const r of rows) {
      if (r.booking.is_test) continue; // bookings de test : hors totaux
      const a = Number(r.inst.amount_due || 0);
      total += a;
      totalHt += Number(r.inst.amount_excl_vat ?? 0);
      if (r.bucket === "paid") {
        paid += a;
        if (r.inst.is_cash) paidCash += a; else paidBank += a;
      }
      if (r.bucket === "overdue") overdue += a;
    }
    return { total, totalHt, paid, paidCash, paidBank, outstanding: total - paid, overdue };
  }, [rows]);

  // ------------------------------------------------------------------ actions
  const togglePaid = async (r: Row, paid: boolean) => {
    const { error } = await supabase
      .from("payment_installments")
      .update({ status: paid ? "paid" : "pending", paid_on: paid ? new Date().toISOString().slice(0, 10) : null })
      .eq("id", r.inst.id);
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else onReload();
  };

  const editLink = async (r: Row) => {
    const current = r.inst.payment_link || "";
    const input = window.prompt(
      "Payment link for this installment (Wise, etc.).\nLeave empty to remove.",
      current
    );
    if (input === null) return;
    const value = input.trim();
    if (value && !/^https?:\/\//i.test(value)) {
      toast({ title: "Invalid link", description: "The link must start with http(s)://", variant: "destructive" });
      return;
    }
    const { error } = await supabase
      .from("payment_installments")
      .update({ payment_link: value || null })
      .eq("id", r.inst.id);
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else { toast({ title: value ? "Payment link saved" : "Payment link removed" }); onReload(); }
  };

  const sendReminder = async (r: Row) => {
    const ok = window.confirm(
      `Send a payment reminder email to ${r.booking.email} for "${r.inst.label || "Payment"}" (${fmt2(Number(r.inst.amount_due))})?` +
      (r.inst.payment_link ? "\n\nThe email will include the Pay now link." : "")
    );
    if (!ok) return;
    setBusyId(r.inst.id);
    const res = await supabase.functions.invoke("payment-reminders", {
      body: { send_installment: r.inst.id },
    });
    setBusyId(null);
    const err = res.error?.message || (res.data as any)?.error;
    if (err) toast({ title: "Reminder failed", description: String(err), variant: "destructive" });
    else {
      toast({ title: "Reminder sent", description: `Email sent to ${r.booking.email}.` });
      loadReminders();
    }
  };

  const pickInvoice = (r: Row) => {
    uploadTarget.current = r.inst;
    fileRef.current?.click();
  };

  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    e.target.value = "";
    const inst = uploadTarget.current;
    uploadTarget.current = null;
    if (!file || !inst) return;
    const allowed = ["application/pdf", "image/jpeg", "image/png"];
    if (!allowed.includes(file.type)) {
      toast({ title: "Unsupported file type", description: "PDF, JPG, or PNG only.", variant: "destructive" });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast({ title: "File too large", description: "Max 20MB.", variant: "destructive" });
      return;
    }
    setBusyId(inst.id);
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${inst.booking_id}/${inst.id}/${Date.now()}_${safeName}`;
    const up = await supabase.storage.from("invoices").upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) {
      setBusyId(null);
      toast({ title: "Upload failed", description: up.error.message, variant: "destructive" });
      return;
    }
    if (inst.invoice_file_url) {
      await supabase.storage.from("invoices").remove([inst.invoice_file_url]);
    }
    await supabase
      .from("payment_installments")
      .update({ invoice_file_url: path, invoice_file_name: file.name })
      .eq("id", inst.id);
    setBusyId(null);
    toast({ title: "Invoice uploaded" });
    onReload();
  };

  const downloadInvoice = async (r: Row) => {
    if (!r.inst.invoice_file_url) return;
    const { data, error } = await supabase.storage.from("invoices").createSignedUrl(r.inst.invoice_file_url, 3600);
    if (error || !data) toast({ title: "Download failed", description: error?.message, variant: "destructive" });
    else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const removeInvoice = async (r: Row) => {
    if (!r.inst.invoice_file_url) return;
    if (!window.confirm(`Remove invoice "${r.inst.invoice_file_name || "file"}"?`)) return;
    await supabase.storage.from("invoices").remove([r.inst.invoice_file_url]);
    await supabase
      .from("payment_installments")
      .update({ invoice_file_url: null, invoice_file_name: null })
      .eq("id", r.inst.id);
    toast({ title: "Invoice removed" });
    onReload();
  };

  // Step 1 facturation Moloni : crée la fatura-recibo (FR2026) et attache le PDF.
  const generateInvoice = async (r: Row) => {
    const guest = `${r.booking.first_name ?? ""} ${r.booking.last_name ?? ""}`.trim() || r.booking.retreat_name || r.booking.email;
    const ok = window.confirm(
      `Generate a Moloni invoice (fatura-recibo) for ${guest} — ${fmt2(Number(r.inst.amount_due))}?\n\n` +
      `This issues a REAL sequential document in the FR2026 series and reports it to the AT. It cannot be undone (only corrected with a credit note).`
    );
    if (!ok) return;
    setBusyId(r.inst.id);
    const res = await supabase.functions.invoke("moloni-invoice", {
      body: { action: "generate", installment_id: r.inst.id },
    });
    setBusyId(null);
    const err = (res.data as any)?.error || res.error?.message;
    if (err) {
      toast({ title: "Invoice failed", description: String(err), variant: "destructive" });
      return;
    }
    const d = res.data as { number?: string; pdf_attached?: boolean };
    toast({
      title: `Invoice ${d.number ?? "created"}`,
      description: d.pdf_attached ? "PDF attached to the payment." : "Created in Moloni — PDF not attached yet, retry download from Moloni.",
    });
    onReload();
  };

  const exportCsv = () => {
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      ["Event", "Payment", "Category", "Due date", "Amount incl. VAT", "Amount excl. VAT", "Status", "Last reminder", "Payment link"].join(","),
      ...rows.map((r) => [
        esc(r.name), esc(r.inst.label || "Payment"), esc(r.inst.category ?? "rental"),
        esc(r.inst.due_date || ""), esc(Number(r.inst.amount_due).toFixed(2)),
        esc(r.inst.amount_excl_vat != null ? Number(r.inst.amount_excl_vat).toFixed(2) : ""),
        esc(r.bucket), esc(lastReminder.get(r.inst.id)?.slice(0, 10) || ""),
        esc(r.inst.payment_link || ""),
      ].join(",")),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([lines], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url; a.download = "quinta-payments.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const Tile = ({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "danger" | "success" }) => (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold mt-0.5 ${tone === "danger" ? "text-destructive" : tone === "success" ? "text-[#35532A]" : ""}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Total (filtered)" value={fmt0(totals.total)} sub={`${fmt0(totals.totalHt)} excl. VAT`} />
        <Tile label="Collected" value={fmt0(totals.paid)} tone="success"
          sub={`${totals.total > 0 ? `${Math.round((totals.paid / totals.total) * 100)}% · ` : ""}${fmt0(totals.paidBank)} bank & card · ${fmt0(totals.paidCash)} cash`} />
        <Tile label="Outstanding" value={fmt0(totals.outstanding)} />
        <Tile label="Overdue" value={fmt0(totals.overdue)} tone={totals.overdue > 0 ? "danger" : undefined} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search event or email" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-[220px]" />
        <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} className="border border-border rounded-md px-2.5 py-2 text-sm bg-background">
          <option value="all">All years</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={catFilter} onChange={(e) => setCatFilter(e.target.value as any)} className="border border-border rounded-md px-2.5 py-2 text-sm bg-background">
          <option value="all">All categories</option>
          <option value="rental">Rental</option>
          <option value="catering">Catering</option>
          <option value="extra">Extras</option>
          <option value="discount">Discounts</option>
        </select>
        <div className="inline-flex rounded-md border border-input overflow-hidden">
          {(["all", "overdue", "upcoming", "paid"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 text-xs capitalize ${statusFilter === s ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
            >
              {s === "all" ? "All" : s}
            </button>
          ))}
        </div>
        <span className="text-sm text-muted-foreground">{rows.length} payment{rows.length === 1 ? "" : "s"}</span>
        <Button size="sm" variant="outline" className="ml-auto" onClick={exportCsv}>
          <FileDown className="w-4 h-4 mr-1" /> CSV
        </Button>
      </div>

      <div className="border border-border rounded-xl bg-card overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
              <th className="px-3 py-2.5 font-medium">Event</th>
              <th className="px-3 py-2.5 font-medium">Payment</th>
              <th className="px-3 py-2.5 font-medium">
                <button
                  type="button"
                  onClick={() => setSortDesc((v) => !v)}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  title={sortDesc ? "Most recent first — click for oldest first" : "Oldest first — click for most recent first"}
                >
                  Due date <span aria-hidden className="text-xs">{sortDesc ? "↓" : "↑"}</span>
                </button>
              </th>
              <th className="px-3 py-2.5 font-medium text-right">Incl. VAT</th>
              <th className="px-3 py-2.5 font-medium text-right">Excl. VAT</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-3 py-2.5 font-medium">Reminder</th>
              <th className="px-3 py-2.5 font-medium">Invoice</th>
              <th className="px-3 py-2.5 font-medium text-center">Paid</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const rem = lastReminder.get(r.inst.id);
              const busy = busyId === r.inst.id;
              return (
                <tr key={r.inst.id} className="hover:bg-muted/40">
                  <td className="px-3 py-2 font-medium max-w-[200px]">
                    <button type="button" className="hover:underline text-left truncate block w-full" onClick={() => onOpen(r.booking.id)}>
                      {r.name}
                      {r.booking.is_test && (
                        <span className="ml-1.5 text-[10px] uppercase px-1 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-800">Test</span>
                      )}
                    </button>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.inst.label || "Payment"}
                    {(r.inst.category ?? "rental") !== "rental" && (
                      <span className="ml-1.5 text-[10px] uppercase px-1 py-0.5 rounded border border-border bg-muted text-muted-foreground">{r.inst.category}</span>
                    )}
                    <button
                      type="button"
                      title={r.inst.payment_link ? `Payment link: ${r.inst.payment_link}` : "Set payment link (Wise…)"}
                      onClick={() => editLink(r)}
                      className={`ml-1.5 inline-flex align-middle ${r.inst.payment_link ? "text-primary" : "text-muted-foreground/50 hover:text-foreground"}`}
                    >
                      <Link2 className="w-3.5 h-3.5" />
                    </button>
                    {r.inst.payment_link && (
                      <a href={r.inst.payment_link} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex align-middle text-muted-foreground hover:text-foreground" title="Open payment link">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                    {r.inst.is_cash && (
                      <span className="ml-1.5 inline-flex align-middle rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground" title="Cash payment — no VAT, no invoice">
                        Cash
                      </span>
                    )}
                  </td>
                  <td className={`px-3 py-2 whitespace-nowrap ${r.bucket === "overdue" ? "text-destructive font-medium" : ""}`}>
                    {fmtDate(r.inst.due_date)}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{fmt2(Number(r.inst.amount_due))}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-muted-foreground">
                    {r.inst.amount_excl_vat != null ? fmt2(Number(r.inst.amount_excl_vat)) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${STATUS_BADGE[r.bucket]}`}>
                      {r.bucket === "upcoming" ? "Pending" : r.bucket}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      {rem && <span className="text-xs text-muted-foreground">{fmtDate(rem.slice(0, 10))}</span>}
                      {r.bucket !== "paid" ? (
                        <Button
                          size="sm" variant="outline" className="h-7 px-2"
                          disabled={busy || r.isInternal || !!r.inst.is_cash}
                          title={r.isInternal ? "Internal booking — no real client email" : `Send a payment request to ${r.booking.email}`}
                          onClick={() => setEmailTarget({ inst: r.inst, booking: r.booking, kind: "request" })}
                        >
                          <Mail className="w-3.5 h-3.5" />
                        </Button>
                      ) : (
                        !r.inst.is_cash && (
                          <Button
                            size="sm" variant="outline" className="h-7 px-2"
                            disabled={busy || r.isInternal}
                            title={r.isInternal ? "Internal booking — no real client email" : `Send the payment confirmation (invoice attached) to ${r.booking.email}`}
                            onClick={() => setEmailTarget({ inst: r.inst, booking: r.booking, kind: "confirmation" })}
                          >
                            <Mail className="w-3.5 h-3.5" />
                          </Button>
                        )
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      {r.inst.is_cash ? (
                        <span className="text-xs text-muted-foreground" title="Cash payment — no invoice">—</span>
                      ) : r.inst.invoice_file_url ? (
                        <>
                          {r.inst.invoice_number && (
                            <span className="text-xs text-muted-foreground mr-0.5" title="Moloni document">{r.inst.invoice_number}</span>
                          )}
                          <Button size="sm" variant="ghost" className="h-7 px-1.5" title={`Download ${r.inst.invoice_file_name || "invoice"}`} onClick={() => downloadInvoice(r)}>
                            <Download className="w-3.5 h-3.5" />
                          </Button>
                          {!r.inst.moloni_document_id && (
                            <Button size="sm" variant="ghost" className="h-7 px-1.5 text-destructive" title="Remove invoice" onClick={() => removeInvoice(r)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </>
                      ) : r.inst.moloni_document_id ? (
                        <span className="text-xs text-muted-foreground" title="Created in Moloni — PDF pending">{r.inst.invoice_number ?? "In Moloni"}</span>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" title="Generate a Moloni invoice (fatura-recibo FR2026)" disabled={busy} onClick={() => generateInvoice(r)}>
                            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><FilePlus2 className="w-3.5 h-3.5 mr-1" />Invoice</>}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 px-1.5 text-muted-foreground" title="Upload an existing invoice (PDF/JPG/PNG)" disabled={busy} onClick={() => pickInvoice(r)}>
                            <Upload className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center">
                    {r.inst.category === "discount" ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <Checkbox
                        checked={r.inst.status === "paid"}
                        onCheckedChange={(v) => togglePaid(r, v === true)}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground italic">No payments match the current filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        className="hidden"
        onChange={onFileSelected}
      />

      {emailTarget && (() => {
        const meta = emailMeta(emailTarget.inst);
        return (
          <PaymentEmailDialog
            open={!!emailTarget}
            onOpenChange={(v) => { if (!v) setEmailTarget(null); }}
            kind={emailTarget.kind}
            booking={emailTarget.booking}
            inst={emailTarget.inst}
            ordinal={meta.ordinal}
            isLast={meta.isLast}
            allSettled={meta.allSettled}
            onSent={() => { loadReminders(); }}
          />
        );
      })()}
    </div>
  );
}
