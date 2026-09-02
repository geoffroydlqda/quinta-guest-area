import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Paperclip, Upload, ExternalLink, X, RefreshCw, Link2, Eye, Pencil } from "lucide-react";

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
  // Visionneuse latérale : le justificatif s'ouvre à droite, sans recouvrir
  // la liste — on garde l'outil et la facture sous les yeux en même temps.
  const [preview, setPreview] = useState<{ doc: PurchaseDoc; url: string } | null>(null);

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

  // HEIC (photos iPhone) -> JPEG côté navigateur avant upload : l'extraction
  // (API Anthropic) n'accepte que jpeg/png/gif/webp, et Chrome ne sait de
  // toute façon pas afficher le HEIC. heic2any est chargé à la demande.
  const isHeic = (f: File) => /\.hei[cf]$/i.test(f.name) || /hei[cf]/i.test(f.type);
  const toJpegIfHeic = async (f: File): Promise<File> => {
    if (!isHeic(f)) return f;
    const { default: heic2any } = await import("heic2any");
    const out = await heic2any({ blob: f, toType: "image/jpeg", quality: 0.86 });
    const blob = Array.isArray(out) ? out[0] : out;
    return new File([blob], f.name.replace(/\.hei[cf]$/i, "") + ".jpg", { type: "image/jpeg" });
  };

  const onFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const files = Array.from(list);
    setUploading(files.length);
    for (const raw of files) {
      try {
        const f = await toJpegIfHeic(raw);
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
        toast({ title: `${raw.name} failed`, description: e instanceof Error ? e.message : String(e), variant: "destructive" });
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
    try {
      // Auto-réparation des HEIC déjà uploadés (avant la conversion à
      // l'upload) : on télécharge, convertit en JPEG, remplace le fichier
      // au même chemin logique (.jpg) puis on relance l'extraction.
      const heicStored = /\.hei[cf]$/i.test(doc.storage_path) || /hei[cf]/i.test(doc.mime_type ?? "");
      if (heicStored) {
        const dl = await supabase.storage.from("purchase-docs").download(doc.storage_path);
        if (dl.error || !dl.data) throw new Error(dl.error?.message ?? "Download failed");
        const jpg = await toJpegIfHeic(new File([dl.data], doc.file_name ?? "receipt.heic", { type: "image/heic" }));
        const newPath = doc.storage_path.replace(/\.[^.]+$/, "") + ".jpg";
        const up = await supabase.storage.from("purchase-docs").upload(newPath, jpg, { contentType: "image/jpeg", upsert: true });
        if (up.error) throw new Error(up.error.message);
        await supabase.from("purchase_docs").update({
          storage_path: newPath, mime_type: "image/jpeg",
          file_name: (doc.file_name ?? "receipt").replace(/\.hei[cf]$/i, ".jpg"),
        }).eq("id", doc.id);
        await supabase.storage.from("purchase-docs").remove([doc.storage_path]);
      }
      await extract(doc.id);
    } catch (e) {
      toast({ title: "Extraction failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally { setBusyDoc(null); load(); }
  };

  const view = async (doc: PurchaseDoc) => {
    if (preview?.doc.id === doc.id) { setPreview(null); return; }
    const { data } = await supabase.storage.from("purchase-docs").createSignedUrl(doc.storage_path, 3600);
    if (data?.signedUrl) setPreview({ doc, url: data.signedUrl });
  };

  // Correction manuelle des champs mal lus (montant, date, fournisseur) —
  // le tri "closest amounts" du lien manuel se base ensuite sur ces valeurs.
  const saveEdit = async (doc: PurchaseDoc, patch: { vendor: string | null; total_ttc: number | null; doc_date: string | null }) => {
    const { error } = await supabase.from("purchase_docs")
      .update({ ...patch, updated_at: new Date().toISOString() }).eq("id", doc.id);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Receipt updated" });
    load();
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
        <input type="file" multiple accept="image/*,.heic,.heif,application/pdf" className="hidden"
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
        <div className="lg:flex lg:items-start lg:gap-4">
          {/* Liste — se resserre quand la visionneuse est ouverte */}
          <div className={`space-y-4 min-w-0 ${preview ? "lg:w-[55%]" : "flex-1"}`}>
            {needsAction.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs uppercase font-semibold text-muted-foreground">Needs your attention</div>
                {needsAction.map((d) => <DocCard key={d.id} d={d} busy={busyDoc === d.id} viewing={preview?.doc.id === d.id} onView={view} onLink={linkTo} onRetry={retry} onDelete={remove} onUnlink={unlink} onEdit={saveEdit} />)}
              </div>
            )}
            {done.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs uppercase font-semibold text-muted-foreground">Processed</div>
                {done.map((d) => <DocCard key={d.id} d={d} busy={busyDoc === d.id} viewing={preview?.doc.id === d.id} onView={view} onLink={linkTo} onRetry={retry} onDelete={remove} onUnlink={unlink} onEdit={saveEdit} />)}
              </div>
            )}
            {docs.length === 0 && (
              <p className="text-sm text-muted-foreground italic text-center py-6">No receipts yet — drop your first batch above.</p>
            )}
          </div>

          {/* Visionneuse latérale (à droite sur desktop, plein écran sur mobile) */}
          {preview && (
            <aside className="fixed inset-0 z-40 bg-background p-3 overflow-auto lg:static lg:z-auto lg:flex-1 lg:min-w-0 lg:p-0 lg:overflow-visible lg:sticky lg:top-4">
              <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
                <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
                  <div className="min-w-0 text-sm font-medium truncate">
                    {preview.doc.vendor || preview.doc.file_name || "Receipt"}
                    {preview.doc.total_ttc != null && <span className="text-muted-foreground font-normal"> · {fmtEUR(Number(preview.doc.total_ttc))}</span>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <a href={preview.url} target="_blank" rel="noopener noreferrer"
                      className="p-1.5 rounded-md hover:bg-muted text-muted-foreground" title="Open in a new tab">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    <button type="button" className="p-1.5 rounded-md hover:bg-muted text-muted-foreground" title="Close"
                      onClick={() => setPreview(null)}>
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                {preview.doc.mime_type?.includes("pdf") ? (
                  <iframe src={preview.url} title="Receipt" className="w-full h-[78vh] bg-white" />
                ) : (
                  <div className="max-h-[78vh] overflow-auto bg-muted/30 flex justify-center">
                    <img src={preview.url} alt="Receipt" className="max-w-full h-auto object-contain" />
                  </div>
                )}
              </div>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

function DocCard({ d, busy, viewing, onView, onLink, onRetry, onDelete, onUnlink, onEdit }: {
  d: PurchaseDoc; busy: boolean; viewing: boolean;
  onView: (d: PurchaseDoc) => void; onLink: (d: PurchaseDoc, txId: string) => void;
  onRetry: (d: PurchaseDoc) => void; onDelete: (d: PurchaseDoc) => void; onUnlink: (d: PurchaseDoc) => void;
  onEdit: (d: PurchaseDoc, patch: { vendor: string | null; total_ttc: number | null; doc_date: string | null }) => void;
}) {
  const badge = STATUS_BADGE[d.status];
  // Édition manuelle des champs mal lus par l'OCR (montant, date, fournisseur)
  const [editing, setEditing] = useState(false);
  const [eVendor, setEVendor] = useState("");
  const [eAmount, setEAmount] = useState("");
  const [eDate, setEDate] = useState("");
  const startEdit = () => {
    setEVendor(d.vendor ?? "");
    setEAmount(d.total_ttc != null ? String(d.total_ttc) : "");
    setEDate(d.doc_date ?? "");
    setEditing(true);
  };
  const saveEdit = () => {
    onEdit(d, {
      vendor: eVendor.trim() || null,
      total_ttc: eAmount.trim() === "" ? null : Number(eAmount),
      doc_date: eDate || null,
    });
    setEditing(false);
  };
  return (
    <div className={`rounded-xl border bg-card p-3 text-sm space-y-1.5 ${viewing ? "border-[#1C5CAB]" : "border-border"}`}>
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
          <Button size="icon" variant="ghost"
            className={`h-7 w-7 ${viewing ? "bg-[#E8F0FB] text-[#1C5CAB]" : ""}`}
            title={viewing ? "Close the side viewer" : "View the receipt in the side panel"}
            onClick={() => onView(d)}>
            <Eye className="w-3.5 h-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" title="Fix vendor, amount or date (misread by OCR)"
            onClick={() => (editing ? setEditing(false) : startEdit())}>
            <Pencil className="w-3.5 h-3.5" />
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
      {editing && (
        <div className="flex flex-wrap items-end gap-2 pt-1 border-t border-border/60">
          <label className="space-y-0.5 flex-1 min-w-[140px]">
            <div className="text-[10px] text-muted-foreground">Vendor</div>
            <Input value={eVendor} onChange={(e) => setEVendor(e.target.value)} className="h-8 text-xs" />
          </label>
          <label className="space-y-0.5">
            <div className="text-[10px] text-muted-foreground">Amount (€ incl. VAT)</div>
            <Input type="number" min="0" step="0.01" value={eAmount} onChange={(e) => setEAmount(e.target.value)} className="h-8 w-28 text-right text-xs" />
          </label>
          <label className="space-y-0.5">
            <div className="text-[10px] text-muted-foreground">Date</div>
            <Input type="date" value={eDate} onChange={(e) => setEDate(e.target.value)} className="h-8 w-36 text-xs" />
          </label>
          <Button size="sm" className="h-8 text-xs" onClick={saveEdit}>Save</Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      )}
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
      {(d.status === "review" || d.status === "no_match") && (
        <TxPicker doc={d} busy={busy} onLink={onLink} />
      )}
    </div>
  );
}

/** Parcours manuel des dépenses pour lier un reçu sans match auto :
 *  recherche libre + tri par proximité de montant avec le reçu. */
function TxPicker({ doc, busy, onLink }: {
  doc: PurchaseDoc; busy: boolean; onLink: (d: PurchaseDoc, txId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [txs, setTxs] = useState<{ id: string; date: string; description: string | null; amount: number; category: string | null; is_cash: boolean | null }[] | null>(null);

  useEffect(() => {
    if (!open || txs !== null) return;
    supabase.from("fin_transactions")
      .select("id,date,description,amount,category,is_cash")
      .eq("kind", "expense").lt("amount", 0)
      .order("date", { ascending: false }).limit(600)
      .then(({ data }) => setTxs((data as typeof txs) ?? []));
  }, [open, txs]);

  const shown = useMemo(() => {
    if (!txs) return [];
    const needle = q.trim().toLowerCase();
    let list = txs;
    if (needle) {
      list = txs.filter((t) =>
        (t.description ?? "").toLowerCase().includes(needle)
        || (t.category ?? "").toLowerCase().includes(needle)
        || String(Math.abs(Number(t.amount))).includes(needle));
    } else if (doc.total_ttc != null) {
      // Sans recherche : les montants les plus proches du reçu d'abord
      list = [...txs].sort((a, b) =>
        Math.abs(Math.abs(Number(a.amount)) - Number(doc.total_ttc)) - Math.abs(Math.abs(Number(b.amount)) - Number(doc.total_ttc)));
    }
    return list.slice(0, 8);
  }, [txs, q, doc.total_ttc]);

  return (
    <div className="pt-1 border-t border-border/60">
      {!open ? (
        <button type="button" className="text-xs font-medium text-[#1C5CAB] hover:underline inline-flex items-center gap-1"
          onClick={() => setOpen(true)}>
          <Link2 className="w-3.5 h-3.5" /> Browse expenses & link manually
        </button>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} autoFocus
              placeholder="Search by description, category or amount…"
              className="h-8 text-xs placeholder:italic placeholder:text-muted-foreground/50" />
            <button type="button" className="text-xs text-muted-foreground hover:underline shrink-0" onClick={() => setOpen(false)}>Close</button>
          </div>
          {txs === null ? (
            <div className="py-2 text-center"><Loader2 className="w-4 h-4 animate-spin inline text-muted-foreground" /></div>
          ) : shown.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No expense matches this search.</p>
          ) : (
            <>
              {!q && doc.total_ttc != null && (
                <p className="text-[10px] text-muted-foreground">Closest amounts to this receipt ({fmtEUR(Number(doc.total_ttc))}) first:</p>
              )}
              {shown.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate">
                    {fmtD(t.date)} · {t.description || "—"} · <span className="font-medium">{fmtEUR(Math.abs(Number(t.amount)))}</span>
                    {t.is_cash ? <span className="text-[#B45309]"> · cash</span> : null}
                    {t.category ? <span className="text-muted-foreground"> · {t.category}</span> : null}
                  </span>
                  <Button size="sm" className="h-6 text-[11px] px-2 shrink-0" onClick={() => onLink(doc, t.id)} disabled={busy}>Link</Button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
