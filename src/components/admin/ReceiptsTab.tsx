import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Loader2, Paperclip, Upload, ExternalLink, X, RefreshCw } from "lucide-react";

/**
 * Onglet Receipts (18 août 2026) — boîte de réception des justificatifs
 * d'achat. Dépôt en vrac (photos/PDF) -> extraction Claude (fournisseur,
 * date, TTC, ventilation TVA, NIF) via receipt-extract -> matching auto sur
 * les dépenses sans doc ; sinon file "à confirmer" avec candidats classés.
 * La TVA extraite corrige amount_net / vat_rate de la transaction liée.
 */
export type PurchaseDoc = {
  id: string; storage_path: string; file_name: string | null; mime_type: string | null;
  status: "inbox" | "extracting" | "review" | "matched" | "no_match" | "error";
  tx_id: string | null; vendor: string | null; doc_date: string | null;
  total_ttc: number | null; nif: string | null;
  vat_breakdown: { rate: number; base: number; vat: number }[] | null;
  candidates: { tx_id: string; date: string; description: string | null; amount: number; category: string | null; score: number }[] | null;
  error: string | null; created_at: string;
};

const fmtEUR = (n: number) => `€${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtD = (d: string | null) => d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";

const STATUS_BADGE: Record<PurchaseDoc["status"], { label: string; cls: string }> = {
  inbox: { label: "Queued", cls: "bg-muted text-muted-foreground" },
  extracting: { label: "Reading…", cls: "bg-[#E8F0FB] text-[#1C5CAB]" },
  review: { label: "Confirm match", cls: "bg-[#FDF1E0] text-[#B45309]" },
  matched: { label: "Linked", cls: "bg-[#E5F5EA] text-[#178A3F]" },
  no_match: { label: "No match", cls: "bg-[#FBE9E7] text-[#B3261E]" },
  error: { label: "Error", cls: "bg-[#FBE9E7] text-[#B3261E]" },
};

export function ReceiptsTab() {
  const { toast } = useToast();
  const [docs, setDocs] = useState<PurchaseDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(0); // nb de fichiers en cours
  const [busyDoc, setBusyDoc] = useState<string | null>(null);
  const [missingCount, setMissingCount] = useState<number | null>(null);

  const load = async () => {
    const [d, t] = await Promise.all([
      supabase.from("purchase_docs").select("*").order("created_at", { ascending: false }).limit(300),
      supabase.from("fin_transactions").select("id", { count: "exact", head: true })
        .eq("kind", "expense").gte("date", `${new Date().getFullYear()}-01-01`),
    ]);
    setDocs((d.data || []) as PurchaseDoc[]);
    const linked = new Set(((d.data || []) as PurchaseDoc[]).map((x) => x.tx_id).filter(Boolean));
    setMissingCount(t.count != null ? t.count - linked.size : null);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const extract = async (docId: string) => {
    const { data, error } = await supabase.functions.invoke("receipt-extract", { body: { doc_id: docId } });
    if (error || data?.error) throw new Error(data?.error || error?.message);
    return data;
  };

  const onFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const files = Array.from(list);
    setUploading(files.length);
    for (const f of files) {
      try {
        const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
        const path = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
        const up = await supabase.storage.from("purchase-docs").upload(path, f, { contentType: f.type || "image/jpeg" });
        if (up.error) throw new Error(up.error.message);
        const { data: row, error: insErr } = await supabase.from("purchase_docs")
          .insert({ storage_path: path, file_name: f.name, mime_type: f.type || "image/jpeg" })
          .select("id").single();
        if (insErr) throw new Error(insErr.message);
        await extract(row.id);
      } catch (e) {
        toast({ title: `${f.name} failed`, description: e instanceof Error ? e.message : String(e), variant: "destructive" });
      } finally {
        setUploading((n) => n - 1);
        load();
      }
    }
  };

  const linkTo = async (doc: PurchaseDoc, txId: string) => {
    setBusyDoc(doc.id);
    try {
      const { data, error } = await supabase.functions.invoke("receipt-extract", { body: { link: { doc_id: doc.id, tx_id: txId } } });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      toast({ title: "Linked", description: data?.vat_applied ? "VAT applied to the transaction." : undefined });
      load();
    } catch (e) {
      toast({ title: "Link failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally { setBusyDoc(null); }
  };

  const unlink = async (doc: PurchaseDoc) => {
    setBusyDoc(doc.id);
    await supabase.functions.invoke("receipt-extract", { body: { unlink: { doc_id: doc.id } } });
    setBusyDoc(null);
    load();
  };

  const retry = async (doc: PurchaseDoc) => {
    setBusyDoc(doc.id);
    try { await extract(doc.id); } catch (e) {
      toast({ title: "Extraction failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally { setBusyDoc(null); load(); }
  };

  const view = async (doc: PurchaseDoc) => {
    const { data } = await supabase.storage.from("purchase-docs").createSignedUrl(doc.storage_path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  const remove = async (doc: PurchaseDoc) => {
    if (!window.confirm("Delete this receipt? The linked transaction keeps its VAT values.")) return;
    await supabase.storage.from("purchase-docs").remove([doc.storage_path]);
    await supabase.from("purchase_docs").delete().eq("id", doc.id);
    load();
  };

  const needsAction = docs.filter((d) => ["review", "no_match", "error", "inbox"].includes(d.status));
  const done = docs.filter((d) => !["review", "no_match", "error", "inbox"].includes(d.status));

  return (
    <div className="space-y-4">
      {/* Zone de dépôt */}
      <label className="block rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 px-4 py-6 text-center cursor-pointer hover:bg-primary/10 transition-colors">
        <input type="file" multiple accept="image/*,application/pdf" className="hidden"
          onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
        <Upload className="w-5 h-5 inline mr-2 text-[#35532A]" />
        <span className="text-sm font-medium">Drop receipts here or tap to photograph / pick files</span>
        <span className="block text-xs text-muted-foreground mt-1">
          Photos or PDFs, in bulk — each one is read (vendor, date, VAT) and matched to an expense automatically.
        </span>
        {uploading > 0 && (
          <span className="block text-xs text-[#1C5CAB] mt-2"><Loader2 className="w-3.5 h-3.5 inline animate-spin mr-1" />Processing {uploading} file{uploading > 1 ? "s" : ""}…</span>
        )}
      </label>

      {missingCount != null && missingCount > 0 && (
        <p className="text-xs text-muted-foreground">
          <Paperclip className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
          {missingCount} expense{missingCount > 1 ? "s" : ""} this year still without a receipt — you can also attach one directly from the Transactions tab (📎 on each row).
        </p>
      )}

      {loading ? (
        <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline text-muted-foreground" /></div>
      ) : (
        <>
          {needsAction.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs uppercase font-semibold text-muted-foreground">Needs your attention</div>
              {needsAction.map((d) => <DocCard key={d.id} d={d} busy={busyDoc === d.id} onView={view} onLink={linkTo} onRetry={retry} onDelete={remove} onUnlink={unlink} />)}
            </div>
          )}
          {done.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs uppercase font-semibold text-muted-foreground">Processed</div>
              {done.map((d) => <DocCard key={d.id} d={d} busy={busyDoc === d.id} onView={view} onLink={linkTo} onRetry={retry} onDelete={remove} onUnlink={unlink} />)}
            </div>
          )}
          {docs.length === 0 && (
            <p className="text-sm text-muted-foreground italic text-center py-6">No receipts yet — drop your first batch above.</p>
          )}
        </>
      )}
    </div>
  );
}

function DocCard({ d, busy, onView, onLink, onRetry, onDelete, onUnlink }: {
  d: PurchaseDoc; busy: boolean;
  onView: (d: PurchaseDoc) => void; onLink: (d: PurchaseDoc, txId: string) => void;
  onRetry: (d: PurchaseDoc) => void; onDelete: (d: PurchaseDoc) => void; onUnlink: (d: PurchaseDoc) => void;
}) {
  const badge = STATUS_BADGE[d.status];
  return (
    <div className="rounded-xl border border-border bg-card p-3 text-sm space-y-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${badge.cls}`}>{busy ? "…" : badge.label}</span>
          <span className="font-medium truncate">{d.vendor || d.file_name || "Receipt"}</span>
          {d.total_ttc != null && <span className="whitespace-nowrap">{fmtEUR(d.total_ttc)}</span>}
          <span className="text-xs text-muted-foreground whitespace-nowrap">{fmtD(d.doc_date)}</span>
          {d.vat_breakdown?.length ? (
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              VAT {d.vat_breakdown.map((v) => `${v.rate}%: ${fmtEUR(Number(v.vat) || 0)}`).join(" · ")}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button size="icon" variant="ghost" className="h-7 w-7" title="View file" onClick={() => onView(d)}>
            <ExternalLink className="w-3.5 h-3.5" />
          </Button>
          {(d.status === "error" || d.status === "inbox" || d.status === "no_match") && (
            <Button size="icon" variant="ghost" className="h-7 w-7" title="Retry extraction" onClick={() => onRetry(d)} disabled={busy}>
              <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
            </Button>
          )}
          {d.status === "matched" && (
            <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => onUnlink(d)} disabled={busy}>Unlink</Button>
          )}
          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground/60 hover:text-destructive" title="Delete" onClick={() => onDelete(d)}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
      {d.status === "error" && d.error && <p className="text-xs text-[#B3261E]">{d.error}</p>}
      {(d.status === "review" || d.status === "no_match") && (d.candidates?.length ?? 0) > 0 && (
        <div className="space-y-1 pt-1 border-t border-border/60">
          {d.candidates!.map((c) => (
            <div key={c.tx_id} className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 truncate">
                {fmtD(c.date)} · {c.description || "—"} · {fmtEUR(Math.abs(Number(c.amount)))}
                {c.category ? <span className="text-muted-foreground"> · {c.category}</span> : null}
              </span>
              <Button size="sm" className="h-6 text-[11px] px-2 shrink-0" onClick={() => onLink(d, c.tx_id)} disabled={busy}>Link</Button>
            </div>
          ))}
        </div>
      )}
      {d.status === "no_match" && !(d.candidates?.length) && (
        <p className="text-xs text-muted-foreground">No expense matches this amount/date — link it later from the Transactions tab (📎), or the bank line may not have synced yet.</p>
      )}
    </div>
  );
}
