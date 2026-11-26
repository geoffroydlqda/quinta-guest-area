import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { todayLisbon } from "@/lib/dates";
import { getProperty, usePropertyFilter, PROPERTY_SHORT } from "@/lib/property";
import { notifyAdmins } from "@/lib/notifications";
import { normalizeEmail } from "@/lib/admin";
import { CheckSquare, CornerDownRight, Loader2, Mic, Plus, Repeat, Sparkles, Trash2, UserRound, X } from "lucide-react";

/**
 * Onglet Operations > Tasks (25 nov 2026, demande Geoffroy) — centralise le
 * « Quinta task tracker » créé par Loïs. V2 le même jour : sous-tâches
 * (parent_id, cascade), filtre Overdue, filtres déroulants Area et Person
 * (v3 : des filtres, pas des vues — groupement par date conservé),
 * assignés restreints à Geo / Loïs / Luis, dropdown d'area à la création,
 * récurrence annuelle, priorité en 3 boutons, ligne resserrée (chips collées
 * au titre). Récurrence façon Todoist : compléter une tâche récurrente recrée
 * la prochaine occurrence, sous-tâches recopiées non cochées.
 */

type Task = {
  id: string; title: string; notes: string | null; area: string | null;
  category: string | null;
  property: string; priority: string; status: string; due_date: string | null;
  repeats: string; assignee_id: string | null; created_by: string | null;
  created_at: string; completed_at: string | null; parent_id: string | null;
};
type Staff = { id: string; name: string; email: string | null; active: boolean };

const PRIORITIES = [
  { v: "high", label: "High", cls: "bg-[#FFEAE7] text-[#C84B3F]" },
  { v: "medium", label: "Medium", cls: "bg-[#FFF4DC] text-[#9A7B1E]" },
  { v: "low", label: "Low", cls: "bg-secondary text-secondary-foreground" },
] as const;
const STATUSES = [
  { v: "todo", label: "To do" },
  { v: "in_progress", label: "In progress" },
  { v: "done", label: "Done" },
] as const;
const REPEATS = [
  { v: "none", label: "Does not repeat" },
  { v: "weekly", label: "Every week" },
  { v: "monthly", label: "Every month" },
  { v: "quarterly", label: "Every 3 months" },
  { v: "yearly", label: "Every year" },
] as const;

// Assignés possibles (25 nov 2026, choix Geoffroy) : seulement Geo, Loïs et
// Luis — identifiés par email dans staff_profiles, libellé court imposé.
const ASSIGNEES = [
  { email: "hello@quintamor.com", label: "Geo" },
  { email: "lois@quintamor.com", label: "Loïs" },
  { email: "977luisferreira@gmail.com", label: "Luis" },
] as const;

export function nextOccurrence(due: string | null, repeats: string, today: string): string | null {
  // Prochaine échéance : à partir de l'échéance prévue (ou d'aujourd'hui si
  // aucune), décalée d'un pas de récurrence.
  const base = new Date(`${due ?? today}T12:00:00`);
  if (repeats === "weekly") base.setDate(base.getDate() + 7);
  else if (repeats === "monthly") base.setMonth(base.getMonth() + 1);
  else if (repeats === "quarterly") base.setMonth(base.getMonth() + 3);
  else if (repeats === "yearly") base.setFullYear(base.getFullYear() + 1);
  else return null;
  return base.toISOString().slice(0, 10);
}

const fmtDay = (iso: string | null) =>
  iso ? new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : null;

function PriorityButtons({ value, onChange, compact }: { value: string; onChange: (v: string) => void; compact?: boolean }) {
  return (
    <div className={`flex gap-1 ${compact ? "" : "items-center"}`}>
      {PRIORITIES.map((p) => (
        <button key={p.v} type="button" onClick={() => onChange(p.v)}
          className={`rounded-full px-3 ${compact ? "py-1" : "py-1.5"} text-xs font-semibold border transition-colors ${
            value === p.v ? `${p.cls} border-transparent ring-1 ring-foreground/20` : "border-border bg-card text-muted-foreground hover:bg-secondary"
          }`}>
          {p.label}
        </button>
      ))}
    </div>
  );
}

export function TasksPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const myEmail = normalizeEmail(user?.email) ?? "";
  const today = todayLisbon();
  const [propertyFilter] = usePropertyFilter();

  const [tasksAll, setTasksAll] = useState<Task[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"open" | "overdue" | "due7" | "done" | "all">("open");
  const [mineOnly, setMineOnly] = useState(false);
  const [areaFilter, setAreaFilter] = useState(""); // espace physique
  const [categoryFilter, setCategoryFilter] = useState(""); // catégorie (Pedro follow-ups, Admin & finance…)
  const [personFilter, setPersonFilter] = useState(""); // "" = everyone, "unassigned", ou staff id
  const [priorityFilter, setPriorityFilter] = useState(""); // "" = toutes
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const emptyDraft = { title: "", area: "", category: "", priority: "medium", due_date: "", repeats: "none", assignee_id: "", notes: "" };
  const [draft, setDraft] = useState(emptyDraft);
  const [newArea, setNewArea] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingSubId, setEditingSubId] = useState<string | null>(null); // sous-tâche en cours de renommage

  // Barre IA (26 nov 2026, demande Geoffroy) : taper OU dicter une liste de
  // tâches en vrac — la dictée passe par la Web Speech API du navigateur
  // (aucun audio envoyé à nos serveurs), le texte part à l'Edge Function
  // tasks-ai (Claude) qui renvoie des tâches structurées, montrées en aperçu
  // avant création.
  type AiTask = { title: string; area: string | null; category: string | null; priority: string; due_date: string | null; repeats: string; assignee: string | null; notes: string | null; checked: boolean };
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiPreview, setAiPreview] = useState<AiTask[] | null>(null);
  const [listening, setListening] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);
  const aiBaseRef = useRef("");
  const speechSupported = typeof window !== "undefined"
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  useEffect(() => () => { recRef.current?.stop?.(); }, []);

  const load = async () => {
    const [tasksRes, staffRes] = await Promise.all([
      supabase.from("admin_tasks").select("*").order("due_date", { ascending: true, nullsFirst: false }).order("created_at"),
      supabase.from("staff_profiles").select("id,name,email,active").order("name"),
    ]);
    if (tasksRes.error) toast({ title: "Failed to load tasks", description: tasksRes.error.message, variant: "destructive" });
    setTasksAll((tasksRes.data as Task[] | null) ?? []);
    setStaff(((staffRes.data as Staff[] | null) ?? []).filter((s) => s.active));
    setLoading(false);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);
  // Options d'assignation : Geo / Loïs / Luis, dans cet ordre.
  const assignable = useMemo(() =>
    ASSIGNEES.flatMap((a) => {
      const s = staff.find((x) => normalizeEmail(x.email) === a.email);
      return s ? [{ id: s.id, label: a.label }] : [];
    }), [staff]);
  const assigneeLabel = (id: string | null) => {
    if (!id) return null;
    const s = staffById.get(id);
    if (!s) return "?";
    const short = ASSIGNEES.find((a) => a.email === normalizeEmail(s.email));
    return short ? short.label : s.name;
  };
  const myStaffIds = useMemo(
    () => new Set(staff.filter((s) => normalizeEmail(s.email) === myEmail).map((s) => s.id)),
    [staff, myEmail]
  );

  const subsByParent = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasksAll) if (t.parent_id) m.set(t.parent_id, [...(m.get(t.parent_id) ?? []), t]);
    return m;
  }, [tasksAll]);

  const isOverdue = (t: Task) => t.status !== "done" && !!t.due_date && t.due_date < today;

  const tasks = useMemo(() => {
    let list = tasksAll.filter((t) => !t.parent_id);
    if (propertyFilter !== "all") list = list.filter((t) => t.property === propertyFilter);
    if (mineOnly) list = list.filter((t) => (t.assignee_id && myStaffIds.has(t.assignee_id)) || normalizeEmail(t.created_by) === myEmail);
    if (areaFilter) list = list.filter((t) => (t.area ?? "").trim() === areaFilter);
    if (categoryFilter) list = list.filter((t) => (t.category ?? "").trim() === categoryFilter);
    if (personFilter === "unassigned") list = list.filter((t) => !t.assignee_id);
    else if (personFilter) list = list.filter((t) => t.assignee_id === personFilter);
    if (priorityFilter) list = list.filter((t) => t.priority === priorityFilter);
    if (filter === "open") list = list.filter((t) => t.status !== "done");
    if (filter === "overdue") list = list.filter(isOverdue);
    if (filter === "due7") {
      const in7 = new Date(`${today}T12:00:00`); in7.setDate(in7.getDate() + 7);
      const in7Iso = in7.toISOString().slice(0, 10);
      list = list.filter((t) => t.status !== "done" && t.due_date && t.due_date >= today && t.due_date <= in7Iso);
    }
    if (filter === "done") list = list.filter((t) => t.status === "done");
    return list;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasksAll, propertyFilter, mineOnly, areaFilter, categoryFilter, personFilter, priorityFilter, filter, myStaffIds, myEmail, today]);

  const stats = useMemo(() => {
    let scoped = tasksAll.filter((t) => !t.parent_id);
    if (propertyFilter !== "all") scoped = scoped.filter((t) => t.property === propertyFilter);
    const open = scoped.filter((t) => t.status !== "done");
    const in7 = new Date(`${today}T12:00:00`); in7.setDate(in7.getDate() + 7);
    const in7Iso = in7.toISOString().slice(0, 10);
    return {
      overdue: open.filter((t) => t.due_date && t.due_date < today).length,
      due7: open.filter((t) => t.due_date && t.due_date >= today && t.due_date <= in7Iso).length,
      open: open.length,
      done: scoped.length - open.length,
    };
  }, [tasksAll, propertyFilter, today]);

  // Deux champs distincts (25 nov 2026, demande Geoffroy) : Area = espace
  // physique (Barn, Oasis, Garden…), Category = type de tâche (Pedro
  // follow-ups, Admin & finance, Yearly…). Les listes viennent des valeurs
  // existantes.
  const areas = useMemo(
    () => [...new Set(tasksAll.map((t) => (t.area ?? "").trim()).filter(Boolean))].sort(),
    [tasksAll]
  );
  const categories = useMemo(
    () => [...new Set(tasksAll.map((t) => (t.category ?? "").trim()).filter(Boolean))].sort(),
    [tasksAll]
  );

  const toggleMic = () => {
    if (listening) { recRef.current?.stop(); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { toast({ title: "Voice input not supported in this browser", variant: "destructive" }); return; }
    const rec = new SR();
    rec.lang = navigator.language || "fr-FR";
    rec.continuous = true;
    rec.interimResults = true;
    aiBaseRef.current = aiText ? aiText.trim() + " " : "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let final = "", interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) final += res[0].transcript;
        else interim += res[0].transcript;
      }
      setAiText((aiBaseRef.current + final + interim).trimStart());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  };

  const aiGenerate = async () => {
    const text = aiText.trim();
    if (text.length < 3) return;
    if (listening) recRef.current?.stop();
    setAiBusy(true);
    const { data, error } = await supabase.functions.invoke("tasks-ai", {
      body: {
        text,
        context: {
          areas, categories,
          assignees: assignable.map((a) => a.label),
          today,
          property: propertyFilter !== "all" ? propertyFilter : getProperty(),
        },
      },
    });
    setAiBusy(false);
    if (error || data?.error) { toast({ title: "AI parsing failed", description: String(data?.error ?? error?.message ?? ""), variant: "destructive" }); return; }
    const tasks = ((data?.tasks ?? []) as Omit<AiTask, "checked">[]).map((t) => ({ ...t, checked: true }));
    if (!tasks.length) { toast({ title: "No tasks found in the note" }); return; }
    setAiPreview(tasks);
  };

  const aiCreate = async () => {
    const picked = (aiPreview ?? []).filter((t) => t.checked);
    if (!picked.length) return;
    setAiSaving(true);
    const property = propertyFilter !== "all" ? propertyFilter : getProperty();
    const labelToId = new Map(assignable.map((a) => [a.label.toLowerCase(), a.id]));
    const payloads = picked.map((t) => ({
      title: t.title, area: t.area, category: t.category, property,
      priority: t.priority, due_date: t.due_date, repeats: t.repeats,
      assignee_id: t.assignee ? (labelToId.get(t.assignee.toLowerCase()) ?? null) : null,
      notes: t.notes, created_by: myEmail || null,
    }));
    const { error } = await supabase.from("admin_tasks").insert(payloads);
    setAiSaving(false);
    if (error) { toast({ title: "Create failed", description: error.message, variant: "destructive" }); return; }
    const who = user?.email?.split("@")[0] ?? "Someone";
    // Une notification par assigné, puis un broadcast aux autres (sans doublon)
    const byAssignee = new Map<string, number>();
    for (const p of payloads) {
      if (!p.assignee_id) continue;
      const em = normalizeEmail(staffById.get(p.assignee_id)?.email);
      if (em && em !== myEmail) byAssignee.set(em, (byAssignee.get(em) ?? 0) + 1);
    }
    for (const [em, n] of byAssignee) {
      notifyAdmins({ message: `${who} assigned you ${n} task${n > 1 ? "s" : ""}`, only: [em], createdBy: myEmail });
    }
    notifyAdmins({ message: `${who} created ${payloads.length} task${payloads.length > 1 ? "s" : ""} via the AI bar`, exclude: [myEmail, ...byAssignee.keys()], createdBy: myEmail });
    setAiPreview(null); setAiText("");
    toast({ title: `${payloads.length} task${payloads.length > 1 ? "s" : ""} created` });
    load();
  };

  const addTask = async () => {
    const title = draft.title.trim();
    if (!title) { toast({ title: "Task title required", variant: "destructive" }); return; }
    setSaving(true);
    const property = propertyFilter !== "all" ? propertyFilter : getProperty();
    const area = draft.area === "__new__" ? (newArea.trim() || null) : (draft.area.trim() || null);
    const category = draft.category === "__new__" ? (newCategory.trim() || null) : (draft.category.trim() || null);
    const payload = {
      title, area, category, property,
      priority: draft.priority, due_date: draft.due_date || null,
      repeats: draft.repeats, assignee_id: draft.assignee_id || null,
      notes: draft.notes.trim() || null, created_by: myEmail || null,
    };
    const { data, error } = await supabase.from("admin_tasks").insert(payload).select("id").single();
    setSaving(false);
    if (error) { toast({ title: "Add failed", description: error.message, variant: "destructive" }); return; }
    const assignee = draft.assignee_id ? staffById.get(draft.assignee_id) : null;
    const who = user?.email?.split("@")[0] ?? "Someone";
    const bits = [assignee ? `for ${assigneeLabel(assignee.id)}` : null, draft.due_date ? `due ${fmtDay(draft.due_date)}` : null].filter(Boolean).join(", ");
    // Notification : l'assigné d'abord (message dédié), puis les autres admins.
    const assigneeEmail = normalizeEmail(assignee?.email);
    if (assigneeEmail && assigneeEmail !== myEmail) {
      notifyAdmins({ message: `${who} assigned you a task: “${title}”${draft.due_date ? ` (due ${fmtDay(draft.due_date)})` : ""}`, taskId: data.id, only: [assigneeEmail], createdBy: myEmail });
    }
    notifyAdmins({ message: `${who} created a task: “${title}”${bits ? ` (${bits})` : ""}`, taskId: data.id, exclude: [myEmail, assigneeEmail], createdBy: myEmail });
    setDraft(emptyDraft); setNewArea(""); setNewCategory(""); setShowAdd(false);
    toast({ title: "Task created" });
    load();
  };

  const patchTask = async (id: string, p: Partial<Task>) => {
    setTasksAll((arr) => arr.map((t) => (t.id === id ? { ...t, ...p } : t)));
    const { error } = await supabase.from("admin_tasks")
      .update({ ...p, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); load(); }
  };

  const toggleDone = async (t: Task) => {
    const done = t.status !== "done";
    await patchTask(t.id, {
      status: done ? "done" : "todo",
      completed_at: done ? new Date().toISOString() : null,
    } as Partial<Task>);
    if (!done || t.parent_id) return; // les sous-tâches : coche simple, rien d'autre
    const who = user?.email?.split("@")[0] ?? "Someone";
    const creator = normalizeEmail(t.created_by);
    if (creator && creator !== myEmail) {
      notifyAdmins({ message: `${who} completed “${t.title}”`, taskId: t.id, only: [creator], createdBy: myEmail });
    }
    // Récurrence : recrée la prochaine occurrence, sous-tâches recopiées.
    const next = nextOccurrence(t.due_date, t.repeats, today);
    if (next) {
      const { data: np, error } = await supabase.from("admin_tasks").insert({
        title: t.title, area: t.area, category: t.category, property: t.property, priority: t.priority,
        due_date: next, repeats: t.repeats, assignee_id: t.assignee_id,
        notes: t.notes, created_by: t.created_by,
      }).select("id").single();
      if (!error && np) {
        const subs = tasksAll.filter((s) => s.parent_id === t.id);
        if (subs.length) {
          await supabase.from("admin_tasks").insert(subs.map((s) => ({
            title: s.title, parent_id: np.id, property: s.property, priority: s.priority,
            status: "todo", repeats: "none", notes: s.notes, created_by: s.created_by,
          })));
        }
        toast({ title: `Recurring task — next occurrence created (due ${fmtDay(next)})` });
      }
      load();
    }
  };

  const addSubtask = async (parent: Task, title: string) => {
    const v = title.trim();
    if (!v) return;
    const { error } = await supabase.from("admin_tasks").insert({
      title: v, parent_id: parent.id, property: parent.property, priority: "medium",
      status: "todo", repeats: "none", created_by: myEmail || null,
    });
    if (error) { toast({ title: "Add failed", description: error.message, variant: "destructive" }); return; }
    load();
  };

  const deleteTask = async (t: Task) => {
    const subCount = subsByParent.get(t.id)?.length ?? 0;
    const msg = subCount > 0 ? `Delete task “${t.title}” and its ${subCount} subtask${subCount > 1 ? "s" : ""}?` : `Delete task “${t.title}”?`;
    if (!confirm(msg)) return;
    const { error } = await supabase.from("admin_tasks").delete().eq("id", t.id);
    if (error) { toast({ title: "Delete failed", description: error.message, variant: "destructive" }); return; }
    load();
  };

  const deleteSubtask = async (s: Task) => {
    const { error } = await supabase.from("admin_tasks").delete().eq("id", s.id);
    if (error) { toast({ title: "Delete failed", description: error.message, variant: "destructive" }); return; }
    load();
  };

  /* ---------- render ---------- */

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const dueChip = (t: Task) => {
    if (!t.due_date) return null;
    const overdue = isOverdue(t);
    const in7 = new Date(`${today}T12:00:00`); in7.setDate(in7.getDate() + 7);
    const soon = t.status !== "done" && !overdue && t.due_date <= in7.toISOString().slice(0, 10);
    return (
      <span className={`text-xs whitespace-nowrap rounded-full px-2 py-0.5 font-medium ${
        overdue ? "bg-[#FFEAE7] text-[#C84B3F]" : soon ? "bg-[#FFF4DC] text-[#9A7B1E]" : "bg-muted text-muted-foreground"
      }`}>
        {overdue ? "⚠ " : ""}{fmtDay(t.due_date)}
      </span>
    );
  };

  const groups: { label: string; items: Task[] }[] = (() => {
    const overdue = tasks.filter(isOverdue);
    const upcoming = tasks.filter((t) => !isOverdue(t) && t.due_date);
    const noDate = tasks.filter((t) => !t.due_date);
    return [
      { label: "Overdue", items: overdue },
      { label: "Upcoming", items: upcoming },
      { label: "No due date", items: noDate },
    ].filter((g) => g.items.length > 0);
  })();

  const TaskRow = ({ t }: { t: Task }) => {
    const editing = editingId === t.id;
    const pr = PRIORITIES.find((p) => p.v === t.priority) ?? PRIORITIES[1];
    const subs = subsByParent.get(t.id) ?? [];
    const subsDone = subs.filter((s) => s.status === "done").length;
    const [subDraft, setSubDraft] = useState("");
    return (
      <div className={`border rounded-xl px-3 py-2.5 ${t.status === "done" ? "opacity-55" : ""}`}>
        {/* Ligne principale : chips collées au titre (25 nov 2026) */}
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="checkbox"
            checked={t.status === "done"}
            onChange={() => toggleDone(t)}
            className="w-4 h-4 accent-[#79B84B] cursor-pointer shrink-0"
            title={t.status === "done" ? "Reopen" : "Mark done"}
          />
          <button
            type="button"
            onClick={() => setEditingId(editing ? null : t.id)}
            className={`text-left text-sm font-medium ${t.status === "done" ? "line-through" : ""}`}
          >
            {t.title}
            {t.repeats !== "none" && <Repeat className="inline w-3 h-3 ml-1.5 text-muted-foreground" />}
          </button>
          {t.area && <span className="text-xs rounded-full bg-secondary px-2 py-0.5 text-secondary-foreground">{t.area}</span>}
          {t.category && <span className="text-xs rounded-full border border-border px-2 py-0.5 text-muted-foreground">{t.category}</span>}
          <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${pr.cls}`}>{pr.label}</span>
          {propertyFilter === "all" && (
            <span className="text-[10px] font-semibold rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
              {PROPERTY_SHORT[(t.property === "terra" ? "terra" : "quinta")]}
            </span>
          )}
          {t.status === "in_progress" && <span className="text-[11px] rounded-full bg-[#EDF5FF] text-[#4a86e0] px-2 py-0.5 font-semibold">In progress</span>}
          {dueChip(t)}
          {subs.length > 0 && (
            <span className="text-xs rounded-full bg-muted px-2 py-0.5 text-muted-foreground flex items-center gap-1">
              <CornerDownRight className="w-3 h-3" />{subsDone}/{subs.length}
            </span>
          )}
          {assigneeLabel(t.assignee_id) && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <UserRound className="w-3 h-3" />{assigneeLabel(t.assignee_id)}
            </span>
          )}
        </div>
        {!editing && t.notes && <div className="mt-1 ml-6 text-xs text-muted-foreground">{t.notes}</div>}
        {/* Sous-tâches */}
        {subs.length > 0 && (
          <div className="mt-1.5 ml-6 space-y-1">
            {subs.map((s) => (
              <div key={s.id} className="flex items-center gap-2 text-sm group">
                <input type="checkbox" checked={s.status === "done"} onChange={() => toggleDone(s)}
                  className="w-3.5 h-3.5 accent-[#79B84B] cursor-pointer shrink-0" />
                {editingSubId === s.id ? (
                  <Input autoFocus defaultValue={s.title} className="h-7 max-w-md"
                    onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== s.title) patchTask(s.id, { title: v }); setEditingSubId(null); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") setEditingSubId(null);
                    }} />
                ) : (
                  <button type="button" onClick={() => setEditingSubId(s.id)} title="Click to edit"
                    className={`text-left ${s.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                    {s.title}
                  </button>
                )}
                <button className="opacity-0 group-hover:opacity-100 text-muted-foreground/60 hover:text-destructive" onClick={() => deleteSubtask(s)} title="Delete subtask">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        {editing && (
          <div className="mt-3 pt-3 border-t border-border/60 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Input defaultValue={t.title} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.title) patchTask(t.id, { title: v }); }} className="h-8 lg:col-span-2" />
            <Input defaultValue={t.area ?? ""} placeholder="Area (Barn, Oasis…)" list="task-areas"
              onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== t.area) patchTask(t.id, { area: v }); }} className="h-8" />
            <Input defaultValue={t.category ?? ""} placeholder="Category" list="task-categories"
              onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== t.category) patchTask(t.id, { category: v }); }} className="h-8" />
            <PriorityButtons compact value={t.priority} onChange={(v) => patchTask(t.id, { priority: v })} />
            <select value={t.status} onChange={(e) => patchTask(t.id, { status: e.target.value, completed_at: e.target.value === "done" ? new Date().toISOString() : null } as Partial<Task>)}
              className="h-8 rounded-md border bg-background px-2 text-sm">
              {STATUSES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
            </select>
            <Input type="date" defaultValue={t.due_date ?? ""}
              onBlur={(e) => { const v = e.target.value || null; if (v !== t.due_date) patchTask(t.id, { due_date: v }); }} className="h-8" />
            <select value={t.repeats} onChange={(e) => patchTask(t.id, { repeats: e.target.value })}
              className="h-8 rounded-md border bg-background px-2 text-sm">
              {REPEATS.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
            </select>
            <select value={t.assignee_id ?? ""} onChange={(e) => patchTask(t.id, { assignee_id: e.target.value || null })}
              className="h-8 rounded-md border bg-background px-2 text-sm">
              <option value="">Unassigned</option>
              {assignable.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <Input defaultValue={t.notes ?? ""} placeholder="Notes"
              onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== t.notes) patchTask(t.id, { notes: v }); }} className="h-8 lg:col-span-2" />
            <div className="flex items-center gap-2 lg:col-span-3">
              <CornerDownRight className="w-4 h-4 text-muted-foreground shrink-0" />
              <Input value={subDraft} placeholder="Add a subtask — press Enter"
                onChange={(e) => setSubDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { addSubtask(t, subDraft); setSubDraft(""); } }}
                className="h-8" />
            </div>
            <div className="flex items-center justify-between gap-2 lg:col-span-3 text-xs text-muted-foreground">
              <span>Created by {t.created_by?.split("@")[0] ?? "?"} on {fmtDay(t.created_at.slice(0, 10))}</span>
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => deleteTask(t)}>
                <Trash2 className="w-4 h-4 mr-1" /> Delete
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Stats cliquables : chaque carte applique le filtre correspondant */}
      <div className="flex flex-wrap gap-2.5">
        {([
          { n: stats.overdue, l: "Overdue", cls: "text-destructive", f: "overdue" },
          { n: stats.due7, l: "Due in 7 days", cls: "text-amber-600", f: "due7" },
          { n: stats.open, l: "Open", cls: "text-foreground", f: "open" },
          { n: stats.done, l: "Done", cls: "text-success", f: "done" },
        ] as const).map((k) => (
          <button key={k.l} type="button" onClick={() => setFilter(filter === k.f ? "all" : k.f)}
            className={`min-w-[110px] rounded-xl border bg-card px-4 py-2.5 text-left transition-colors hover:bg-secondary/60 ${
              filter === k.f ? "border-primary ring-1 ring-primary" : "border-border"
            }`}>
            <div className={`text-xl font-bold ${k.cls}`}>{k.n}</div>
            <div className="text-xs text-muted-foreground">{k.l}</div>
          </button>
        ))}
      </div>

      {/* Barre IA : taper ou dicter une liste de tâches en vrac */}
      <div className="rounded-2xl border border-border bg-card p-3 space-y-2">
        <div className="flex items-start gap-2">
          <Sparkles className="w-4 h-4 text-[#79B84B] mt-3 shrink-0" />
          <textarea
            value={aiText}
            onChange={(e) => setAiText(e.target.value)}
            placeholder={speechSupported
              ? "Describe your tasks — type or tap the mic and speak (e.g. “fix the pool pump before Friday, Luis mows the field every month…”)"
              : "Describe your tasks, one sentence each…"}
            rows={aiText.length > 120 ? 3 : 1}
            className="flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm min-h-[40px]"
          />
          {speechSupported && (
            <button type="button" onClick={toggleMic}
              title={listening ? "Stop dictation" : "Dictate your tasks"}
              className={`p-2.5 rounded-full border transition-colors ${listening ? "bg-[#F36F63] border-[#F36F63] text-white animate-pulse" : "border-border text-muted-foreground hover:bg-secondary"}`}>
              <Mic className="w-4 h-4" />
            </button>
          )}
          <Button onClick={aiGenerate} disabled={aiBusy || aiText.trim().length < 3}>
            {aiBusy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Sparkles className="w-4 h-4 mr-1" />} Generate
          </Button>
        </div>
        {listening && <div className="pl-6 text-xs font-medium text-[#C84B3F]">● Listening — speak your task list, tap the mic again to stop.</div>}
        {aiPreview && (
          <div className="pl-6 space-y-1.5">
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground/70">
              Preview · untick what you don't want
            </div>
            {aiPreview.map((t, i) => (
              <div key={i} className="flex items-center gap-2 flex-wrap rounded-xl border px-3 py-2 text-sm">
                <input type="checkbox" checked={t.checked}
                  onChange={() => setAiPreview((p) => p!.map((x, xi) => (xi === i ? { ...x, checked: !x.checked } : x)))}
                  className="w-4 h-4 accent-[#79B84B] cursor-pointer" />
                <span className={`font-medium ${t.checked ? "" : "line-through text-muted-foreground"}`}>{t.title}</span>
                {t.area && <span className="text-xs rounded-full bg-secondary px-2 py-0.5 text-secondary-foreground">{t.area}</span>}
                {t.category && <span className="text-xs rounded-full border border-border px-2 py-0.5 text-muted-foreground">{t.category}</span>}
                <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${(PRIORITIES.find((p) => p.v === t.priority) ?? PRIORITIES[1]).cls}`}>
                  {(PRIORITIES.find((p) => p.v === t.priority) ?? PRIORITIES[1]).label}
                </span>
                {t.due_date && <span className="text-xs rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{fmtDay(t.due_date)}</span>}
                {t.repeats !== "none" && <Repeat className="w-3 h-3 text-muted-foreground" />}
                {t.assignee && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1"><UserRound className="w-3 h-3" />{t.assignee}</span>
                )}
                {t.notes && <span className="w-full pl-6 text-xs text-muted-foreground">{t.notes}</span>}
              </div>
            ))}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAiPreview(null)}>Cancel</Button>
              <Button onClick={aiCreate} disabled={aiSaving || !aiPreview.some((t) => t.checked)}>
                {aiSaving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <CheckSquare className="w-4 h-4 mr-1" />}
                Create {aiPreview.filter((t) => t.checked).length} task{aiPreview.filter((t) => t.checked).length > 1 ? "s" : ""}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Barre d'outils */}
      <div className="flex flex-wrap items-center gap-2">
        {([["open", "Open"], ["overdue", "Overdue"], ["done", "Done"], ["all", "All"]] as const).map(([f, label]) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
              filter === f ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card text-foreground/70 hover:bg-secondary"
            }`}>
            {label}
          </button>
        ))}
        <button onClick={() => setMineOnly((v) => !v)}
          className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
            mineOnly ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card text-foreground/70 hover:bg-secondary"
          }`}>
          My tasks
        </button>
        <span className="flex-1" />
        <select value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)}
          className={`h-9 rounded-full border px-3 text-sm ${areaFilter ? "border-primary bg-primary/10 font-medium" : "border-border bg-card text-foreground/70"}`}>
          <option value="">All areas</option>
          {areas.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}
          className={`h-9 rounded-full border px-3 text-sm ${categoryFilter ? "border-primary bg-primary/10 font-medium" : "border-border bg-card text-foreground/70"}`}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={personFilter} onChange={(e) => setPersonFilter(e.target.value)}
          className={`h-9 rounded-full border px-3 text-sm ${personFilter ? "border-primary bg-primary/10 font-medium" : "border-border bg-card text-foreground/70"}`}>
          <option value="">Everyone</option>
          {assignable.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          <option value="unassigned">Unassigned</option>
        </select>
        <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}
          className={`h-9 rounded-full border px-3 text-sm ${priorityFilter ? "border-primary bg-primary/10 font-medium" : "border-border bg-card text-foreground/70"}`}>
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
        </select>
        <Button onClick={() => setShowAdd((v) => !v)}>
          <Plus className="w-4 h-4 mr-1" /> Add task
        </Button>
      </div>

      {/* Formulaire de création */}
      {showAdd && (
        <div className="rounded-2xl border border-border bg-card p-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Input placeholder="Task *" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="lg:col-span-2" autoFocus />
          <select value={draft.area} onChange={(e) => setDraft({ ...draft, area: e.target.value })} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">No area</option>
            {areas.map((a) => <option key={a} value={a}>{a}</option>)}
            <option value="__new__">+ New area…</option>
          </select>
          <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">No category</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            <option value="__new__">+ New category…</option>
          </select>
          {draft.area === "__new__" && (
            <Input placeholder="New area name" value={newArea} onChange={(e) => setNewArea(e.target.value)} autoFocus />
          )}
          {draft.category === "__new__" && (
            <Input placeholder="New category name" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
          )}
          <div className="flex items-center lg:col-span-2">
            <PriorityButtons value={draft.priority} onChange={(v) => setDraft({ ...draft, priority: v })} />
          </div>
          <Input type="date" value={draft.due_date} onChange={(e) => setDraft({ ...draft, due_date: e.target.value })} />
          <select value={draft.repeats} onChange={(e) => setDraft({ ...draft, repeats: e.target.value })} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
            {REPEATS.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
          </select>
          <select value={draft.assignee_id} onChange={(e) => setDraft({ ...draft, assignee_id: e.target.value })} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">Unassigned</option>
            {assignable.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <Input placeholder="Notes" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} className="lg:col-span-3" />
          <div className="flex gap-2 lg:col-span-4 justify-end">
            <Button variant="outline" onClick={() => { setShowAdd(false); setDraft(emptyDraft); setNewArea(""); setNewCategory(""); }}>Cancel</Button>
            <Button onClick={addTask} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <CheckSquare className="w-4 h-4 mr-1" />} Save task
            </Button>
          </div>
        </div>
      )}

      <datalist id="task-areas">
        {areas.map((a) => <option key={a} value={a} />)}
      </datalist>
      <datalist id="task-categories">
        {categories.map((c) => <option key={c} value={c} />)}
      </datalist>

      {/* Liste groupée */}
      {tasks.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
          {filter === "overdue" ? "Nothing overdue. 🎉" : "No tasks here — add the first one. 🎉"}
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.label} className="space-y-1.5">
            <div className="px-1 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground/70">
              {g.label} · {g.items.length}
            </div>
            {g.items.map((t) => <TaskRow key={t.id} t={t} />)}
          </div>
        ))
      )}
    </div>
  );
}
