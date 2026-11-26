import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileText, Loader2, Plus, Trash2, TrendingUp, Users } from "lucide-react";

/**
 * Panel des événements IN-HOUSE (26 nov 2026, demande Geoffroy) — affiché sur
 * la fiche booking quand event_type = 'in_house' (Dia do Amor, Silêncio…).
 * Deux cartes :
 * - Event margin : revenus HT (échéances du booking) − coûts HT (transactions
 *   rattachées à l'event dans Accounting), ventilés par catégorie, marge € et
 *   %, coût et marge par participant.
 * - Participants : la liste des inscrits avec montant payé, date, source et
 *   la FACTURE INDIVIDUELLE de chacun (bucket invoices, fatura série TERRA
 *   stockée par moloni-bundle-pdf en mode store_each). Édition inline.
 */

type Participant = {
  id: string; name: string; email: string | null; amount_ttc: number | null;
  paid_on: string | null; source: string; moloni_document_id: number | null;
  invoice_path: string | null; notes: string | null;
};
type Inst = { id: string; category: string | null; status: string; amount_due: number; amount_excl_vat: number | null };
type Tx = { id: string; kind: string; category: string | null; amount: number; amount_net: number | null };

const fmt = (n: number) => `€${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDay = (iso: string | null) =>
  iso ? new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—";

export function InHouseEventPanel({ bookingId }: { bookingId: string }) {
  const { toast } = useToast();
  const [parts, setParts] = useState<Participant[]>([]);
  const [insts, setInsts] = useState<Inst[]>([]);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const empty = { name: "", email: "", amount_ttc: "", paid_on: "", source: "stripe", notes: "" };
  const [draft, setDraft] = useState(empty);
  const [opening, setOpening] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = async () => {
    const [p, i, t] = await Promise.all([
      supabase.from("event_participants").select("*").eq("booking_id", bookingId)
        .order("paid_on", { ascending: true, nullsFirst: false }).order("name"),
      supabase.from("payment_installments").select("id,category,status,amount_due,amount_excl_vat").eq("booking_id", bookingId),
      supabase.from("fin_transactions").select("id,kind,category,amount,amount_net").eq("booking_id", bookingId),
    ]);
    setParts((p.data as Participant[] | null) ?? []);
    setInsts((i.data as Inst[] | null) ?? []);
    setTxs((t.data as Tx[] | null) ?? []);
    setLoading(false);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [bookingId]);

  // Marge : revenus HT = toutes les échéances du booking (remises négatives
  // incluses, bar inclus) ; coûts HT = dépenses rattachées à l'event dans
  // Accounting (amount_net quand il existe, sinon TTC — à affiner en posant
  // la TVA sur chaque ligne).
  const margin = useMemo(() => {
    let revHt = 0;
    for (const i of insts) {
      revHt += i.amount_excl_vat != null
        ? Number(i.amount_excl_vat)
        : Number(i.amount_due || 0) / (i.category === "catering" ? 1.13 : 1.23);
    }
    const byCat = new Map<string, number>();
    let costHt = 0;
    for (const t of txs) {
      if (t.kind !== "expense") continue;
      const v = t.amount_net != null ? Number(t.amount_net) : Math.abs(Number(t.amount));
      costHt += v;
      const k = t.category ?? "Uncategorised";
      byCat.set(k, (byCat.get(k) ?? 0) + v);
    }
    const rows = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
    const m = revHt - costHt;
    return { revHt, costHt, rows, margin: m, pct: revHt > 0 ? (m / revHt) * 100 : null };
  }, [insts, txs]);

  const partsTotal = useMemo(() => parts.reduce((s, p) => s + Number(p.amount_ttc ?? 0), 0), [parts]);
  const instsTtc = useMemo(() => insts.filter((i) => i.category !== "discount").reduce((s, i) => s + Number(i.amount_due || 0), 0), [insts]);
  const uniquePeople = useMemo(() => new Set(parts.map((p) => (p.email ?? p.name).toLowerCase().trim())).size, [parts]);

  const addParticipant = async () => {
    if (!draft.name.trim()) { toast({ title: "Name required", variant: "destructive" }); return; }
    const { error } = await supabase.from("event_participants").insert({
      booking_id: bookingId, name: draft.name.trim(), email: draft.email.trim() || null,
      amount_ttc: draft.amount_ttc ? Number(draft.amount_ttc) : null,
      paid_on: draft.paid_on || null, source: draft.source, notes: draft.notes.trim() || null,
    });
    if (error) { toast({ title: "Add failed", description: error.message, variant: "destructive" }); return; }
    setDraft(empty); setShowAdd(false); load();
  };

  const patchParticipant = async (id: string, p: Partial<Participant>) => {
    setParts((arr) => arr.map((x) => (x.id === id ? { ...x, ...p } : x)));
    const { error } = await supabase.from("event_participants")
      .update({ ...p, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); load(); }
  };

  const deleteParticipant = async (p: Participant) => {
    if (!window.confirm(`Remove participant “${p.name}”?`)) return;
    const { error } = await supabase.from("event_participants").delete().eq("id", p.id);
    if (error) { toast({ title: "Delete failed", description: error.message, variant: "destructive" }); return; }
    load();
  };

  const openInvoice = async (p: Participant) => {
    if (!p.invoice_path) return;
    setOpening(p.id);
    const { data, error } = await supabase.storage.from("invoices").createSignedUrl(p.invoice_path, 3600);
    setOpening(null);
    if (error || !data?.signedUrl) { toast({ title: "Could not open", description: error?.message, variant: "destructive" }); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  if (loading) return <div className="py-6 text-center"><Loader2 className="w-5 h-5 animate-spin inline text-muted-foreground" /></div>;

  return (
    <>
      {/* ---- Event margin ---- */}
      <section className="bg-card rounded-2xl border border-border p-6 space-y-3">
        <h2 className="font-semibold flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-[#35532A]" /> Event margin
          <span className="text-xs font-normal text-muted-foreground">in-house · all amounts excl. VAT</span>
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-border px-4 py-3">
            <div className="text-xs text-muted-foreground">Revenue</div>
            <div className="text-xl font-bold tabular-nums">{fmt(margin.revHt)}</div>
          </div>
          <div className="rounded-xl border border-border px-4 py-3">
            <div className="text-xs text-muted-foreground">Costs attributed</div>
            <div className="text-xl font-bold tabular-nums">−{fmt(margin.costHt)}</div>
          </div>
          <div className={`rounded-xl border px-4 py-3 ${margin.margin >= 0 ? "border-[#79B84B]/50 bg-[#F2F8EC]" : "border-destructive/50 bg-destructive/5"}`}>
            <div className="text-xs text-muted-foreground">Margin</div>
            <div className={`text-xl font-bold tabular-nums ${margin.margin >= 0 ? "text-[#35532A]" : "text-destructive"}`}>
              {fmt(margin.margin)}{margin.pct != null && <span className="text-sm font-semibold ml-1.5">({margin.pct.toFixed(0)} %)</span>}
            </div>
            {uniquePeople > 0 && (
              <div className="text-xs text-muted-foreground mt-0.5">{fmt(margin.margin / uniquePeople)} / participant ({uniquePeople})</div>
            )}
          </div>
        </div>
        {margin.rows.length > 0 ? (
          <div className="space-y-1 pt-1">
            {margin.rows.map(([cat, v]) => (
              <div key={cat} className="flex items-baseline justify-between text-sm">
                <span className="text-muted-foreground">{cat}</span>
                <span className="tabular-nums">−{fmt(v)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No costs attributed yet — link expenses to this event in Accounting → Transactions (Event column) and they will appear here.
          </p>
        )}
      </section>

      {/* ---- Participants ---- */}
      <section className="bg-card rounded-2xl border border-border p-6 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="font-semibold flex items-center gap-2">
            <Users className="w-4 h-4 text-[#35532A]" /> Participants
            <span className="text-xs font-normal text-muted-foreground">{parts.length} payment{parts.length === 1 ? "" : "s"} · {uniquePeople} people · {fmt(partsTotal)} incl. VAT</span>
          </h2>
          <span className="flex-1" />
          <Button size="sm" onClick={() => setShowAdd((v) => !v)}><Plus className="w-4 h-4 mr-1" /> Add</Button>
        </div>
        {Math.abs(partsTotal - instsTtc) > 0.5 && instsTtc > 0 && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
            Participants total ({fmt(partsTotal)}) differs from the booking's payments ({fmt(instsTtc)}) — worth a check.
          </p>
        )}
        {showAdd && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6 rounded-xl border border-border p-3">
            <Input placeholder="Name *" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="lg:col-span-2" autoFocus />
            <Input placeholder="Email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} className="lg:col-span-2" />
            <Input placeholder="€ incl. VAT" type="number" value={draft.amount_ttc} onChange={(e) => setDraft({ ...draft, amount_ttc: e.target.value })} />
            <Input type="date" value={draft.paid_on} onChange={(e) => setDraft({ ...draft, paid_on: e.target.value })} />
            <select value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
              {["stripe", "cash", "transfer", "other"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <Input placeholder="Notes" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} className="lg:col-span-3" />
            <div className="flex gap-2 justify-end lg:col-span-2">
              <Button variant="outline" size="sm" onClick={() => { setShowAdd(false); setDraft(empty); }}>Cancel</Button>
              <Button size="sm" onClick={addParticipant}>Save</Button>
            </div>
          </div>
        )}
        {parts.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No participants yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">Participant</th>
                  <th className="py-2 pr-3">Paid on</th>
                  <th className="py-2 pr-3 text-right">Amount</th>
                  <th className="py-2 pr-3">Source</th>
                  <th className="py-2 pr-3">Invoice</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {parts.map((p) => (
                  <tr key={p.id} className="border-b border-border/50 last:border-0">
                    <td className="py-2 pr-3">
                      {editingId === p.id ? (
                        <span className="grid gap-1">
                          <Input defaultValue={p.name} className="h-7"
                            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== p.name) patchParticipant(p.id, { name: v }); }} />
                          <Input defaultValue={p.email ?? ""} placeholder="Email" className="h-7"
                            onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== p.email) patchParticipant(p.id, { email: v }); }} />
                        </span>
                      ) : (
                        <button type="button" className="text-left" onClick={() => setEditingId(p.id)} title="Click to edit">
                          <span className="font-medium">{p.name}</span>
                          {p.email && <span className="block text-xs text-muted-foreground">{p.email}</span>}
                          {p.notes && <span className="block text-xs text-muted-foreground/80">{p.notes}</span>}
                        </button>
                      )}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {editingId === p.id ? (
                        <Input type="date" defaultValue={p.paid_on ?? ""} className="h-7 w-[140px]"
                          onBlur={(e) => { const v = e.target.value || null; if (v !== p.paid_on) patchParticipant(p.id, { paid_on: v }); }} />
                      ) : fmtDay(p.paid_on)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                      {editingId === p.id ? (
                        <Input type="number" defaultValue={p.amount_ttc ?? ""} className="h-7 w-[110px] text-right"
                          onBlur={(e) => { const v = e.target.value ? Number(e.target.value) : null; if (v !== p.amount_ttc) patchParticipant(p.id, { amount_ttc: v }); setEditingId(null); }} />
                      ) : (p.amount_ttc != null ? fmt(Number(p.amount_ttc)) : "—")}
                    </td>
                    <td className="py-2 pr-3">
                      <span className="text-[11px] font-semibold rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{p.source}</span>
                    </td>
                    <td className="py-2 pr-3">
                      {p.invoice_path ? (
                        <button type="button" onClick={() => openInvoice(p)} disabled={opening === p.id}
                          className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs hover:bg-muted">
                          {opening === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />} Open
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      <button type="button" className="text-muted-foreground/60 hover:text-destructive" onClick={() => deleteParticipant(p)} title="Remove">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
