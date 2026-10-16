/**
 * Carte "Email digest" (16 oct 2026, demande Geoffroy) — résumé des échanges
 * email avec le guest + checklist d'actions, écrits chaque matin par la tâche
 * planifiée Claude (table booking_email_digests, lecture Gmail quotidienne).
 * L'admin coche les actions ici ; la tâche MERGE la checklist (jamais de
 * décochage, les items réglés restent cochés). Masquée tant qu'aucun digest
 * n'existe pour ce booking.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Mail } from "lucide-react";

type ChecklistItem = { id: string; text: string; done: boolean; done_at?: string | null };
type Digest = {
  booking_id: string;
  summary: string;
  checklist: ChecklistItem[];
  last_email_at: string | null;
  updated_at: string;
};

export function EmailDigestCard({ bookingId }: { bookingId: string | null }) {
  const { toast } = useToast();
  const [digest, setDigest] = useState<Digest | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!bookingId) {
      setDigest(null);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("booking_email_digests")
        .select("booking_id,summary,checklist,last_email_at,updated_at")
        .eq("booking_id", bookingId)
        .maybeSingle();
      if (!cancelled && data) {
        setDigest({
          ...(data as unknown as Digest),
          checklist: Array.isArray(data.checklist) ? (data.checklist as unknown as ChecklistItem[]) : [],
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  if (!bookingId || !digest) return null;

  const toggle = async (item: ChecklistItem) => {
    const next = digest.checklist.map((c) =>
      c.id === item.id ? { ...c, done: !c.done, done_at: !c.done ? new Date().toISOString() : null } : c
    );
    setSavingId(item.id);
    const { error } = await supabase
      .from("booking_email_digests")
      .update({ checklist: next as unknown as Digest["checklist"] })
      .eq("booking_id", digest.booking_id);
    setSavingId(null);
    if (error) {
      toast({ title: "Could not save", description: error.message, variant: "destructive" });
      return;
    }
    setDigest({ ...digest, checklist: next });
  };

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : null;
  const openCount = digest.checklist.filter((c) => !c.done).length;

  return (
    <section className="bg-card rounded-2xl border border-border p-6">
      <div className="flex items-start justify-between mb-3 gap-2 flex-wrap">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Mail className="w-4 h-4 text-[#35532A]" /> Email digest
          <span className="text-[10px] font-medium uppercase tracking-wide rounded-full bg-muted text-muted-foreground px-2 py-0.5">
            auto · daily
          </span>
        </h2>
        <span className="text-xs text-muted-foreground">
          Updated {fmt(digest.updated_at)}
          {digest.last_email_at ? <> · emails up to {fmt(digest.last_email_at)}</> : null}
        </span>
      </div>

      {digest.summary.trim() && (
        <p className="text-sm whitespace-pre-wrap leading-relaxed">{digest.summary}</p>
      )}

      {digest.checklist.length > 0 && (
        <div className="mt-4 pt-4 border-t border-border/70">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            To do {openCount > 0 ? `· ${openCount} open` : "· all done ✓"}
          </div>
          <ul className="space-y-2">
            {digest.checklist.map((item) => (
              <li key={item.id} className="flex items-start gap-2.5">
                <Checkbox
                  checked={item.done}
                  disabled={savingId === item.id}
                  onCheckedChange={() => toggle(item)}
                  className="mt-0.5"
                  aria-label={item.text}
                />
                <button
                  type="button"
                  onClick={() => toggle(item)}
                  className={`text-sm text-left ${item.done ? "line-through text-muted-foreground" : ""}`}
                >
                  {item.text}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
