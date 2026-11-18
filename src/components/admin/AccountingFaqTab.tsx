import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus, Search, Pencil, ExternalLink } from "lucide-react";

/**
 * Onglet Accounting > FAQ (18 nov 2026, demande Geoffroy) : chaque question
 * posée au bureau comptable (Joongle, BDO…) et sa réponse, pour que l'info ne
 * se perde pas dans les emails. Table `accounting_faq` (RLS admin).
 * Statuts : to_ask (à poser) -> asked (posée, en attente) -> answered.
 */

type Faq = {
  id: string;
  question: string;
  answer: string | null;
  topic: string | null;
  status: "to_ask" | "asked" | "answered";
  asked_to: string | null;
  asked_on: string | null;
  answered_on: string | null;
  source: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

const TOPICS = ["VAT", "IRS / retention", "Invoicing", "Expenses", "Assets", "Intercompany", "Payroll", "Other"];
const STATUS: Record<Faq["status"], { label: string; cls: string }> = {
  to_ask: { label: "To ask", cls: "bg-[#FDF1E0] text-[#B45309]" },
  asked: { label: "Waiting for answer", cls: "bg-[#E8EEF7] text-[#2F4E7A]" },
  answered: { label: "Answered", cls: "bg-[#E7EFDF] text-[#35532A]" },
};
const ORDER: Faq["status"][] = ["to_ask", "asked", "answered"];

const today = () => new Date().toISOString().slice(0, 10);
const fmtD = (d: string | null) => d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "";

type Draft = Omit<Faq, "id" | "created_at" | "updated_at" | "created_by">;
const EMPTY: Draft = { question: "", answer: "", topic: null, status: "to_ask", asked_to: "Joongle", asked_on: null, answered_on: null, source: null };

export function AccountingFaqTab() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Faq[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState<Faq["status"] | "all">("all");
  const [topicF, setTopicF] = useState<string>("");
  const [editId, setEditId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deleteArm, setDeleteArm] = useState<string | null>(null);

  const load = async () => {
    const { data, error } = await supabase.from("accounting_faq").select("*").order("created_at", { ascending: false });
    if (error) toast({ title: "Could not load the FAQ", description: error.message, variant: "destructive" });
    setRows((data ?? []) as Faq[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length, to_ask: 0, asked: 0, answered: 0 };
    rows.forEach((r) => { c[r.status]++; });
    return c;
  }, [rows]);

  const topics = useMemo(() => [...new Set([...TOPICS, ...rows.map((r) => r.topic).filter(Boolean) as string[]])], [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => statusF === "all" || r.status === statusF)
      .filter((r) => !topicF || r.topic === topicF)
      .filter((r) => !needle || `${r.question} ${r.answer ?? ""} ${r.topic ?? ""} ${r.asked_to ?? ""}`.toLowerCase().includes(needle))
      .sort((a, b) => {
        const s = ORDER.indexOf(a.status) - ORDER.indexOf(b.status);
        if (s) return s;
        const da = a.answered_on ?? a.asked_on ?? a.created_at;
        const db = b.answered_on ?? b.asked_on ?? b.created_at;
        return db.localeCompare(da);
      });
  }, [rows, q, statusF, topicF]);

  const startNew = () => { setDraft({ ...EMPTY }); setEditId("new"); setDeleteArm(null); };
  const startEdit = (r: Faq) => {
    setDraft({ question: r.question, answer: r.answer ?? "", topic: r.topic, status: r.status, asked_to: r.asked_to, asked_on: r.asked_on, answered_on: r.answered_on, source: r.source });
    setEditId(r.id); setDeleteArm(null);
  };

  const save = async () => {
    if (!draft.question.trim()) { toast({ title: "The question is empty", variant: "destructive" }); return; }
    setSaving(true);
    const answer = (draft.answer ?? "").trim() || null;
    let status = draft.status;
    // Une réponse saisie = question répondue (sauf si on choisit autre chose).
    if (answer && status !== "answered" && !(editId !== "new" && rows.find((r) => r.id === editId)?.answer)) status = "answered";
    if (!answer && status === "answered") status = draft.asked_on ? "asked" : "to_ask";
    const payload = {
      question: draft.question.trim(),
      answer,
      topic: draft.topic || null,
      status,
      asked_to: (draft.asked_to ?? "").trim() || null,
      asked_on: draft.asked_on || (status !== "to_ask" ? today() : null),
      answered_on: status === "answered" ? (draft.answered_on || today()) : null,
      source: (draft.source ?? "").trim() || null,
      updated_at: new Date().toISOString(),
    };
    let error;
    if (editId === "new") {
      const { data: u } = await supabase.auth.getUser();
      ({ error } = await supabase.from("accounting_faq").insert({ ...payload, created_by: u.user?.email ?? null }));
    } else {
      ({ error } = await supabase.from("accounting_faq").update(payload).eq("id", editId as string));
    }
    setSaving(false);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); return; }
    setEditId(null);
    load();
  };

  const remove = async (id: string) => {
    if (deleteArm !== id) { setDeleteArm(id); return; }
    const { error } = await supabase.from("accounting_faq").delete().eq("id", id);
    if (error) { toast({ title: "Delete failed", description: error.message, variant: "destructive" }); return; }
    setDeleteArm(null); setEditId(null);
    setRows((rs) => rs.filter((r) => r.id !== id));
  };

  const markAsked = async (r: Faq) => {
    const p = { status: "asked" as const, asked_on: r.asked_on ?? today(), updated_at: new Date().toISOString() };
    setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, ...p } : x)));
    const { error } = await supabase.from("accounting_faq").update(p).eq("id", r.id);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); load(); }
  };

  const form = (
    <div className="rounded-xl border border-primary/40 bg-card p-4 space-y-3">
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Question</label>
        <Textarea rows={2} value={draft.question} autoFocus
          onChange={(e) => setDraft({ ...draft, question: e.target.value })}
          placeholder="What do we need to know?" />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Answer</label>
        <Textarea rows={4} value={draft.answer ?? ""}
          onChange={(e) => setDraft({ ...draft, answer: e.target.value })}
          placeholder="Paste the accountant's answer here (leave empty while waiting)" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <label className="space-y-1 text-xs font-medium text-muted-foreground">
          Topic
          <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
            value={draft.topic ?? ""} onChange={(e) => setDraft({ ...draft, topic: e.target.value || null })}>
            <option value="">—</option>
            {topics.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium text-muted-foreground">
          Status
          <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
            value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as Faq["status"] })}>
            {ORDER.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium text-muted-foreground">
          Asked to
          <Input className="h-9" value={draft.asked_to ?? ""} onChange={(e) => setDraft({ ...draft, asked_to: e.target.value })} placeholder="Joongle" />
        </label>
        <label className="space-y-1 text-xs font-medium text-muted-foreground">
          Asked on
          <Input type="date" className="h-9" value={draft.asked_on ?? ""} onChange={(e) => setDraft({ ...draft, asked_on: e.target.value || null })} />
        </label>
        <label className="space-y-1 text-xs font-medium text-muted-foreground">
          Answered on
          <Input type="date" className="h-9" value={draft.answered_on ?? ""} onChange={(e) => setDraft({ ...draft, answered_on: e.target.value || null })} />
        </label>
        <label className="space-y-1 text-xs font-medium text-muted-foreground">
          Link (email, doc)
          <Input className="h-9" value={draft.source ?? ""} onChange={(e) => setDraft({ ...draft, source: e.target.value })} placeholder="https://…" />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Cancel</Button>
        {editId !== "new" && editId && (
          <button type="button" onClick={() => remove(editId)}
            className={`ml-auto text-xs rounded-md px-2 py-1 ${deleteArm === editId ? "bg-[#C0392B] text-white" : "text-[#C0392B] hover:bg-[#FBEAEA]"}`}>
            {deleteArm === editId ? "Click again to delete" : "Delete"}
          </button>
        )}
      </div>
    </div>
  );

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Every question we ask the accountant, with the answer once we have it, so nothing gets lost in emails.
        Add the question before sending it, then paste the answer here when it comes back.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input className="h-9 pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search questions and answers" />
        </div>
        {(["all", ...ORDER] as const).map((s) => (
          <button key={s} type="button" onClick={() => setStatusF(s)}
            className={`rounded-full px-3 py-1 text-xs border ${statusF === s ? "bg-primary text-primary-foreground border-primary font-semibold" : "bg-card border-border hover:bg-muted"}`}>
            {s === "all" ? "All" : STATUS[s].label} <span className="opacity-70">{counts[s]}</span>
          </button>
        ))}
        <select className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          value={topicF} onChange={(e) => setTopicF(e.target.value)}>
          <option value="">All topics</option>
          {topics.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <Button size="sm" className="ml-auto" onClick={startNew} disabled={editId === "new"}>
          <Plus className="w-3.5 h-3.5 mr-1" />New question
        </Button>
      </div>

      {editId === "new" && form}

      {shown.length === 0 && editId !== "new" && (
        <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          {rows.length ? "No question matches these filters." : "No question yet. Add the first one with “New question”."}
        </div>
      )}

      <div className="space-y-2">
        {shown.map((r) => editId === r.id ? <div key={r.id}>{form}</div> : (
          <div key={r.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0 space-y-2">
                <div className="font-semibold text-sm whitespace-pre-wrap">{r.question}</div>
                {r.answer ? (
                  <div className="text-sm whitespace-pre-wrap rounded-lg bg-muted/50 px-3 py-2">{r.answer}</div>
                ) : (
                  <div className="text-xs italic text-muted-foreground">No answer yet.</div>
                )}
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
                  {r.topic && <span className="rounded-full border border-border px-2 py-0.5">{r.topic}</span>}
                  {r.asked_to && <span>· {r.asked_to}</span>}
                  {r.asked_on && <span>· asked {fmtD(r.asked_on)}</span>}
                  {r.answered_on && <span>· answered {fmtD(r.answered_on)}</span>}
                  {r.source && /^https?:\/\//.test(r.source) && (
                    <a href={r.source} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline underline-offset-2">
                      · source <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  {r.source && !/^https?:\/\//.test(r.source) && <span>· {r.source}</span>}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <button type="button" onClick={() => startEdit(r)}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-muted">
                  <Pencil className="w-3 h-3" />{r.answer ? "Edit" : "Add answer"}
                </button>
                {r.status === "to_ask" && (
                  <button type="button" onClick={() => markAsked(r)}
                    className="rounded-md px-2 py-1 text-xs text-[#2F4E7A] hover:bg-[#E8EEF7]">
                    Mark as asked
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
