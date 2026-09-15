// Onglet Emails -> Sent : historique GLOBAL de tous les emails partis vers les
// guests (manuels via reminder_log + regles automatiques via email_rule_log),
// avec visionneuse (body_html rendu en iframe sandboxee) et statut d'ouverture
// Resend (colonne resend_id / last_event / opened_at, migration 20260915100000).
// "Refresh statuses" appelle l'Edge Function email-status-sync qui interroge
// l'API Resend ; les ouvertures ne remontent que si l'open tracking est active
// dans le dashboard Resend (domaine quintamor.com). Les emails envoyes avant le
// 15 sept 2026 n'ont pas de resend_id -> pas de suivi possible pour eux.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Mail, RefreshCw, X } from "lucide-react";

type SentRow = {
  id: string;
  source: "manual" | "rule";
  type: string;
  booking_id: string | null;
  recipient: string | null;
  subject: string | null;
  status: string | null;
  error: string | null;
  created_at: string;
  body_html: string | null;
  resend_id: string | null;
  last_event: string | null;
  opened_at: string | null;
};

const TYPE_META: Record<string, { label: string; cls: string }> = {
  invitation: { label: "Invitation", cls: "bg-sky-100 text-sky-800 border-sky-200" },
  payment_request: { label: "Payment request", cls: "bg-amber-100 text-amber-800 border-amber-200" },
  payment_receipt: { label: "Payment confirmation", cls: "bg-green-100 text-green-800 border-green-200" },
  payment_upcoming: { label: "Auto reminder — upcoming", cls: "bg-muted text-foreground border-border" },
  payment_overdue: { label: "Auto reminder — overdue", cls: "bg-red-100 text-red-800 border-red-200" },
  payment_manual: { label: "Manual reminder", cls: "bg-muted text-foreground border-border" },
  auto_rule: { label: "Automated email", cls: "bg-[#EEF1E4] text-[#57624A] border-[#D7DFC3]" },
};

function fmtTs(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    + " · " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// Chip de statut d'ouverture : priorite opened_at > last_event > pas de tracking
function OpenChip({ r }: { r: SentRow }) {
  if (r.status === "error") return null;
  if (r.opened_at || r.last_event === "opened" || r.last_event === "clicked") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium bg-green-100 text-green-800 border-green-200"
        title={r.opened_at ? `Opened — first seen ${fmtTs(r.opened_at)}` : "Opened"}>
        Opened ✓
      </span>
    );
  }
  if (r.last_event === "bounced" || r.last_event === "complained") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium bg-red-100 text-red-800 border-red-200">
        {r.last_event === "bounced" ? "Bounced" : "Spam report"}
      </span>
    );
  }
  if (r.last_event === "delivered") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium bg-muted text-muted-foreground border-border"
        title="Delivered — not opened yet (or open tracking is off in Resend)">
        Delivered
      </span>
    );
  }
  if (!r.resend_id) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium bg-muted text-muted-foreground border-border opacity-60"
        title="Sent before 15 Sept 2026 — no tracking id stored, open status unavailable">
        No tracking
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium bg-muted text-muted-foreground border-border"
      title="Status unknown — hit Refresh statuses">
      Sent
    </span>
  );
}

export function SentEmailsCard() {
  const { toast } = useToast();
  const [rows, setRows] = useState<SentRow[]>([]);
  const [bookingNames, setBookingNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [opened, setOpened] = useState<SentRow | null>(null);

  const load = async () => {
    setLoading(true);
    const manualCols = "id,type,booking_id,recipient,subject,status,error,created_at,body_html,resend_id,last_event,opened_at";
    const ruleCols = "id,booking_id,recipient,subject,status,error,created_at,body_html,resend_id,last_event,opened_at";
    const [manual, rules, bookings] = await Promise.all([
      supabase.from("reminder_log").select(manualCols).order("created_at", { ascending: false }).limit(500),
      supabase.from("email_rule_log").select(ruleCols).order("created_at", { ascending: false }).limit(300),
      supabase.from("bookings").select("id,retreat_name"),
    ]);
    const names: Record<string, string> = {};
    for (const b of ((bookings.data ?? []) as unknown as { id: string; retreat_name: string | null }[])) {
      names[b.id] = b.retreat_name ?? "";
    }
    const manualRows = ((manual.data ?? []) as unknown as Omit<SentRow, "source">[])
      .map((r) => ({ ...r, source: "manual" as const }));
    const ruleRows = ((rules.data ?? []) as unknown as Omit<SentRow, "source" | "type">[])
      .map((r) => ({ ...r, source: "rule" as const, type: "auto_rule" }));
    // Un envoi groupe (plusieurs echeances) ecrit une ligne par echeance ->
    // une seule entree ici (meme dedup que le feed de la fiche booking)
    const merged = [...manualRows, ...ruleRows];
    const seen = new Set<string>();
    const deduped = merged.filter((r) => {
      const k = `${r.type}|${r.recipient}|${r.subject}|${r.created_at}|${r.status}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    setRows(deduped);
    setBookingNames(names);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const refreshStatuses = async () => {
    setRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke("email-status-sync", { body: { days: 60 } });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(String(data.error));
      const upd = (data?.reminder_log?.updated ?? 0) + (data?.email_rule_log?.updated ?? 0);
      toast({ title: "Statuses refreshed", description: upd > 0 ? `${upd} email${upd > 1 ? "s" : ""} updated.` : "No changes since last check." });
      await load();
    } catch (e) {
      toast({ title: "Refresh failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setRefreshing(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      if (!q) return true;
      const booking = r.booking_id ? (bookingNames[r.booking_id] ?? "") : "";
      return [r.recipient, r.subject, booking].some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [rows, search, typeFilter, bookingNames]);

  const typeOptions = useMemo(() => {
    const present = new Set(rows.map((r) => r.type));
    return Object.entries(TYPE_META).filter(([k]) => present.has(k));
  }, [rows]);

  return (
    <section className="bg-card rounded-2xl border border-border p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Mail className="w-4 h-4 text-[#35532A]" /> All sent emails
        </h2>
        <Button size="sm" variant="outline" onClick={() => void refreshStatuses()} disabled={refreshing}>
          {refreshing ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
          Refresh statuses
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <Input
          id="sent-emails-search"
          placeholder="Search recipient, subject or booking…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 max-w-xs text-sm"
        />
        <select
          id="sent-emails-type"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="h-8 rounded-md border border-border bg-card px-2 text-sm text-foreground"
        >
          <option value="all">All types</option>
          {typeOptions.map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No emails match.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => {
            const meta = TYPE_META[r.type] ?? { label: r.type, cls: "bg-muted text-foreground border-border" };
            const failed = r.status === "error";
            const booking = r.booking_id ? (bookingNames[r.booking_id] ?? null) : null;
            return (
              <button
                key={`${r.source}-${r.id}`}
                type="button"
                onClick={() => setOpened(r)}
                className="w-full text-left rounded-lg border border-border p-3 text-sm hover:bg-muted/50 transition-colors cursor-pointer"
                title="Open this email"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium ${meta.cls}`}>
                      {meta.label}
                    </span>
                    {failed && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium bg-red-100 text-red-800 border-red-200">
                        Failed
                      </span>
                    )}
                    <OpenChip r={r} />
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums">{fmtTs(r.created_at)}</span>
                </div>
                <div className="mt-1.5 text-muted-foreground text-xs">
                  To <span className="font-medium text-foreground">{r.recipient || "—"}</span>
                  {booking ? <> · <span className="text-foreground">{booking}</span></> : null}
                </div>
                {r.subject && <div className="mt-0.5 truncate" title={r.subject}>{r.subject}</div>}
                {failed && r.error && <div className="mt-1 text-xs text-red-700 break-words">{r.error}</div>}
              </button>
            );
          })}
        </div>
      )}

      {/* Visionneuse : HTML rendu dans une iframe sandboxee (meme pattern que la fiche booking) */}
      {opened && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setOpened(null)}>
          <div className="bg-card rounded-2xl border border-border shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-border flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold truncate">{opened.subject || "(no subject)"}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  To {opened.recipient || "—"} · {fmtTs(opened.created_at)}
                  {opened.opened_at ? <> · <span className="text-green-700 font-medium">opened {fmtTs(opened.opened_at)}</span></> : null}
                </div>
              </div>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0 shrink-0" onClick={() => setOpened(null)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-hidden min-h-[340px]">
              {opened.body_html ? (
                <iframe title="Email content" sandbox="" srcDoc={opened.body_html} className="w-full h-[60vh] bg-white" />
              ) : (
                <p className="text-sm text-muted-foreground p-6">
                  The content of this email wasn't stored — only emails sent from 25 August 2026
                  onwards keep a copy of their body. Subject and recipient above are all we have for this one.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
