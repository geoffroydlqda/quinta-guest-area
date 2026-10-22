import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Folder, FolderOpen, Loader2, ExternalLink, FileText, Paperclip } from "lucide-react";

/**
 * Onglet "Purchase invoices" (22 oct 2026, demande Geoffroy) — classeur des
 * justificatifs d'achat LIÉS à une transaction, en dossiers Année (2026→2030)
 * / Mois. Le classement est AUTOMATIQUE : chaque reçu est rangé d'après la
 * date de la transaction liée (repli : date lue sur le document, puis date
 * d'upload). Rien n'est déplacé dans le Storage — c'est une vue : tout
 * nouveau reçu rapproché (Receipts, trombone Transactions, Gmail, Revolut)
 * apparaît ici tout seul dans le bon mois.
 */

type LinkedDoc = {
  id: string;
  storage_path: string;
  file_name: string | null;
  mime_type: string | null;
  vendor: string | null;
  doc_date: string | null;
  total_ttc: number | null;
  tx_id: string;
  created_at: string;
};

type TxLite = { id: string; date: string; description: string | null; amount: number; payer: string | null };

const YEARS_FIXED = [2026, 2027, 2028, 2029, 2030];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const fmtEUR = (n: number) => `€${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtD = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });

export function PurchaseInvoicesTab() {
  const [docs, setDocs] = useState<LinkedDoc[]>([]);
  const [txById, setTxById] = useState<Map<string, TxLite>>(new Map());
  const [loading, setLoading] = useState(true);
  const now = new Date();
  const [openYear, setOpenYear] = useState<number>(now.getFullYear());
  const [openMonth, setOpenMonth] = useState<number | null>(now.getMonth()); // 0-11
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const d = await supabase.from("purchase_docs")
        .select("id,storage_path,file_name,mime_type,vendor,doc_date,total_ttc,tx_id,created_at")
        .not("tx_id", "is", null).neq("status", "discarded");
      const rows = (d.data ?? []) as LinkedDoc[];
      setDocs(rows);
      // Transactions liées, par paquets (certaines années comptent des
      // centaines de reçus — .in() a une limite de taille d'URL).
      const ids = [...new Set(rows.map((r) => r.tx_id))];
      const map = new Map<string, TxLite>();
      for (let i = 0; i < ids.length; i += 150) {
        const { data } = await supabase.from("fin_transactions")
          .select("id,date,description,amount,payer").in("id", ids.slice(i, i + 150));
        for (const t of (data ?? []) as TxLite[]) map.set(t.id, t);
      }
      setTxById(map);
      setLoading(false);
    })();
  }, []);

  // Rangement : date de la transaction liée > date du document > upload.
  const filed = useMemo(() => {
    const byYM = new Map<string, (LinkedDoc & { tx: TxLite | null; filedDate: string })[]>();
    for (const doc of docs) {
      const tx = txById.get(doc.tx_id) ?? null;
      const filedDate = (tx?.date ?? doc.doc_date ?? doc.created_at).slice(0, 10);
      const key = filedDate.slice(0, 7); // YYYY-MM
      const list = byYM.get(key) ?? [];
      list.push({ ...doc, tx, filedDate });
      byYM.set(key, list);
    }
    for (const list of byYM.values()) list.sort((a, b) => (a.filedDate < b.filedDate ? 1 : -1));
    return byYM;
  }, [docs, txById]);

  const years = useMemo(() => {
    const set = new Set<number>(YEARS_FIXED);
    for (const key of filed.keys()) set.add(Number(key.slice(0, 4)));
    return [...set].sort((a, b) => a - b);
  }, [filed]);

  const countYear = (y: number) => {
    let n = 0;
    for (const [key, list] of filed) if (Number(key.slice(0, 4)) === y) n += list.length;
    return n;
  };
  const monthKey = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, "0")}`;
  const monthDocs = openMonth == null ? [] : (filed.get(monthKey(openYear, openMonth)) ?? []);

  const openDoc = async (doc: LinkedDoc) => {
    setOpening(doc.id);
    const { data } = await supabase.storage.from("purchase-docs").createSignedUrl(doc.storage_path, 3600);
    setOpening(null);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading invoices…</div>;
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        <Paperclip className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
        Every receipt linked to a transaction is filed here automatically, in the month of that transaction.
        Link receipts from the Receipts page or the 📎 on each row in Transactions.
      </p>

      {/* Dossiers Année */}
      <div className="flex items-center gap-2 flex-wrap">
        {years.map((y) => {
          const n = countYear(y);
          const active = y === openYear;
          return (
            <button key={y} type="button"
              onClick={() => { setOpenYear(y); setOpenMonth(y === now.getFullYear() ? now.getMonth() : null); }}
              className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm transition-colors ${
                active ? "bg-primary text-primary-foreground border-primary font-semibold" : "bg-card border-border hover:bg-muted"}`}>
              {active ? <FolderOpen className="w-4 h-4" /> : <Folder className="w-4 h-4 text-[#35532A]" />}
              {y}
              <span className={`rounded-full px-1.5 text-[10px] font-bold ${active ? "bg-primary-foreground/20" : n > 0 ? "bg-[#E5F5EA] text-[#178A3F]" : "bg-muted text-muted-foreground"}`}>{n}</span>
            </button>
          );
        })}
      </div>

      {/* Dossiers Mois de l'année ouverte */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {MONTHS.map((label, m) => {
          const n = (filed.get(monthKey(openYear, m)) ?? []).length;
          const active = openMonth === m;
          return (
            <button key={m} type="button" onClick={() => setOpenMonth(active ? null : m)}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${
                active ? "bg-primary text-primary-foreground border-primary font-semibold"
                  : n > 0 ? "bg-card border-border hover:bg-muted" : "bg-card border-border hover:bg-muted opacity-50"}`}>
              {active ? <FolderOpen className="w-4 h-4 shrink-0" /> : <Folder className="w-4 h-4 shrink-0 text-[#35532A]" />}
              <span className="truncate">{label}</span>
              <span className={`ml-auto rounded-full px-1.5 text-[10px] font-bold ${active ? "bg-primary-foreground/20" : n > 0 ? "bg-[#E5F5EA] text-[#178A3F]" : "bg-muted text-muted-foreground"}`}>{n}</span>
            </button>
          );
        })}
      </div>

      {/* Contenu du mois ouvert */}
      {openMonth != null && (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border text-sm font-semibold flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-[#35532A]" />
            {MONTHS[openMonth]} {openYear}
            <span className="text-xs font-normal text-muted-foreground">· {monthDocs.length} invoice{monthDocs.length === 1 ? "" : "s"}</span>
          </div>
          {monthDocs.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">No receipts filed in this month yet.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {monthDocs.map((d) => (
                  <tr key={d.id} className="border-t border-border/60 first:border-t-0 hover:bg-muted/40">
                    <td className="px-4 py-2 whitespace-nowrap tabular-nums text-xs text-muted-foreground">{fmtD(d.filedDate)}</td>
                    <td className="px-3 py-2 font-medium max-w-[220px] truncate" title={d.vendor ?? d.file_name ?? undefined}>
                      {d.vendor ?? d.file_name ?? "Receipt"}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground max-w-[340px] truncate" title={d.tx?.description ?? undefined}>
                      {d.tx?.description ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                      {d.tx ? fmtEUR(d.tx.amount) : d.total_ttc != null ? fmtEUR(d.total_ttc) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button type="button" onClick={() => openDoc(d)} disabled={opening === d.id}
                        className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs hover:bg-muted"
                        title="Open the receipt in a new tab">
                        {opening === d.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                        Open <ExternalLink className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
