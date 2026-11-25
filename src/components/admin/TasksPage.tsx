import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { todayLisbon } from "@/lib/dates";
import { getProperty, usePropertyFilter, PROPERTY_SHORT } from "@/lib/property";
import { notifyAdmins } from "@/lib/notifications";
import { normalizeEmail } from "@/lib/admin";
import { CheckSquare, Loader2, Plus, Repeat, Trash2, UserRound } from "lucide-react";

/**
 * Onglet Operations > Tasks (25 nov 2026, demande Geoffroy) — centralise le
 * « Quinta task tracker » créé par Loïs en artifact. Modèle repris de son
 * tracker : Area libre, priorité High/Medium/Low, statuts To do / In progress
 * / Done, due date, récurrence (none/weekly/monthly/quarterly), notes, stats
 * Overdue / Due in 7 days / Open / Done, vues By date / By area. Ajouts :
 * assigné (staff), créateur visible, lieu (switcher), notifications fan-out.
 * Récurrence façon Todoist : compléter une tâche récurrente recrée la
 * prochaine occurrence (échéance décalée, même paramètres).
 */

type Task = {
  id: string; title: string; notes: string | null; area: string | null;
  property: string; priority: string; status: string; due_date: string | null;
  repeats: string; assignee_id: string | null; created_by: string | null;
  created_at: string; completed_at: string | null;
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
] as const;

export function nextOccurrence(due: string | null, repeats: string, today: string): string | null {
  // Prochaine échéance : à partir de l'échéance prévue (ou d'aujourd'hui si
  // aucune), décalée d'un pas de récurrence.
  const base = new Date(`${due ?? today}T12:00:00`);
  if (repeats === "weekly") base.setDate(base.getDate() + 7);
  else if (repeats === "monthly") base.setMonth(base.getMonth() + 1);
  else if (repeats === "quarterly") base.setMonth(base.getMonth() + 3);
  else return null;
  return base.toISOString().slice(0, 10);
}

const fmtDay = (iso: string | null) =>
  iso ? new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : null;

export function TasksPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const myEmail = normalizeEmail(user?.email) ?? "";
  const today = todayLisbon();
  const [propertyFilter] = usePropertyFilter();

  const [tasksAll, setTasksAll] = useState<Task[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"open" | "done" | "all">("open");
  const [mineOnly, setMineOnly] = useState(false);
  const [groupBy, setGroupBy] = useState<"date" | "area">("date");
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const emptyDraft = { title: "", area: "", priority: "medium", due_date: "", repeats: "none", assignee_id: "", notes: "" };
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);

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
  const myStaffIds = useMemo(
    () => new Set(staff.filter((s) => normalizeEmail(s.email) === myEmail).map((s) => s.id)),
    [staff, myEmail]
  );

  const tasks = useMemo(() => {
    let list = propertyFilter === "all" ? tasksAll : tasksAll.filter((t) => t.property === propertyFilter);
    if (mineOnly) list = list.filter((t) => (t.assignee_id && myStaffIds.has(t.assignee_id)) || normalizeEmail(t.created_by) === myEmail);
    if (filter === "open") list = list.filter((t) => t.status !== "done");
    if (filter === "done") list = list.filter((t) => t.status === "done");
    return list;
  }, [tasksAll, propertyFilter, mineOnly, filter, myStaffIds, myEmail]);

  const stats = useMemo(() => {
    const scoped = propertyFilter === "all" ? tasksAll : tasksAll.filter((t) => t.property === propertyFilter);
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

  const areas = useMemo(
    () => [...new Set(tasksAll.map((t) => (t.area ?? "").trim()).filter(Boolean))].sort(),
    [tasksAll]
  );

  const assigneeName = (t: Task) => (t.assignee_id ? staffById.get(t.assignee_id)?.name ?? "?" : null);

  const addTask = async () => {
    const title = draft.title.trim();
    if (!title) { toast({ title: "Task title required", variant: "destructive" }); return; }
    setSaving(true);
    const property = propertyFilter !== "all" ? propertyFilter : getProperty();
    const payload = {
      title, area: draft.area.trim() || null, property,
      priority: draft.priority, due_date: draft.due_date || null,
      repeats: draft.repeats, assignee_id: draft.assignee_id || null,
      notes: draft.notes.trim() || null, created_by: myEmail || null,
    };
    const { data, error } = await supabase.from("admin_tasks").insert(payload).select("id").single();
    setSaving(false);
    if (error) { toast({ title: "Add failed", description: error.message, variant: "destructive" }); return; }
    const assignee = draft.assignee_id ? staffById.get(draft.assignee_id) : null;
    const who = user?.email?.split("@")[0] ?? "Someone";
    const bits = [assignee ? `for ${assignee.name}` : null, draft.due_date ? `due ${fmtDay(draft.due_date)}` : null].filter(Boolean).join(", ");
    // Notification : l'assigné d'abord (message dédié), puis les autres admins.
    const assigneeEmail = normalizeEmail(assignee?.email);
    if (assigneeEmail && assigneeEmail !== myEmail) {
      notifyAdmins({ message: `${who} assigned you a task: “${title}”${draft.due_date ? ` (due ${fmtDay(draft.due_date)})` : ""}`, taskId: data.id, only: [assigneeEmail], createdBy: myEmail });
    }
    notifyAdmins({ message: `${who} created a task: “${title}”${bits ? ` (${bits})` : ""}`, taskId: data.id, exclude: [myEmail, assigneeEmail], createdBy: myEmail });
    setDraft(emptyDraft); setShowAdd(false);
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
    if (!done) return;
    const who = user?.email?.split("@")[0] ?? "Someone";
    const creator = normalizeEmail(t.created_by);
    if (creator && creator !== myEmail) {
      notifyAdmins({ message: `${who} completed “${t.title}”`, taskId: t.id, only: [creator], createdBy: myEmail });
    }
    // Récurrence : recrée la prochaine occurrence (mêmes paramètres).
    const next = nextOccurrence(t.due_date, t.repeats, today);
    if (next) {
      const { error } = await supabase.from("admin_tasks").insert({
        title: t.title, area: t.area, property: t.property, priority: t.priority,
        due_date: next, repeats: t.repeats, assignee_id: t.assignee_id,
        notes: t.notes, created_by: t.created_by,
      });
      if (!error) toast({ title: `Recurring task — next occurrence created (due ${fmtDay(next)})` });
      load();
    }
  };

  const deleteTask = async (t: Task) => {
    if (!confirm(`Delete task “${t.title}”?`)) return;
    const { error } = await supabase.from("admin_tasks").delete().eq("id", t.id);
    if (error) { toast({ title: "Delete failed", description: error.message, variant: "destructive" }); return; }
    load();
  };

  /* ---------- render ---------- */

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const dueChip = (t: Task) => {
    if (!t.due_date) return null;
    const overdue = t.status !== "done" && t.due_date < today;
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
    if (groupBy === "area") {
      const m = new Map<string, Task[]>();
      for (const t of tasks) {
        const k = (t.area ?? "").trim() || "No area";
        m.set(k, [...(m.get(k) ?? []), t]);
      }
      return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, items]) => ({ label, items }));
    }
    const overdue = tasks.filter((t) => t.status !== "done" && t.due_date && t.due_date < today);
    const upcoming = tasks.filter((t) => !(t.status !== "done" && t.due_date && t.due_date < today) && t.due_date);
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
    return (
      <div className={`border rounded-xl px-3 py-2.5 ${t.status === "done" ? "opacity-55" : ""}`}>
        <div className="flex items-center gap-2.5 flex-wrap">
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
            className={`text-left text-sm font-medium flex-1 min-w-[140px] ${t.status === "done" ? "line-through" : ""}`}
          >
            {t.title}
            {t.repeats !== "none" && <Repeat className="inline w-3 h-3 ml-1.5 text-muted-foreground" />}
          </button>
          {propertyFilter === "all" && (
            <span className="text-[10px] font-semibold rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
              {PROPERTY_SHORT[(t.property === "terra" ? "terra" : "quinta")]}
            </span>
          )}
          {t.area && <span className="text-xs rounded-full bg-secondary px-2 py-0.5 text-secondary-foreground">{t.area}</span>}
          <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${pr.cls}`}>{pr.label}</span>
          {t.status === "in_progress" && <span className="text-[11px] rounded-full bg-[#EDF5FF] text-[#4a86e0] px-2 py-0.5 font-semibold">In progress</span>}
          {dueChip(t)}
          {assigneeName(t) && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <UserRound className="w-3 h-3" />{assigneeName(t)}
            </span>
          )}
        </div>
        {editing && (
          <div className="mt-3 pt-3 border-t border-border/60 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Input defaultValue={t.title} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.title) patchTask(t.id, { title: v }); }} className="h-8 lg:col-span-2" />
            <Input defaultValue={t.area ?? ""} placeholder="Area" list="task-areas"
              onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== t.area) patchTask(t.id, { area: v }); }} className="h-8" />
            <select value={t.priority} onChange={(e) => patchTask(t.id, { priority: e.target.value })}
              className="h-8 rounded-md border bg-background px-2 text-sm">
              {PRIORITIES.map((p) => <option key={p.v} value={p.v}>{p.label} priority</option>)}
            </select>
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
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <Input defaultValue={t.notes ?? ""} placeholder="Notes"
              onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== t.notes) patchTask(t.id, { notes: v }); }} className="h-8 lg:col-span-2" />
            <div className="flex items-center justify-between gap-2 lg:col-span-3 text-xs text-muted-foreground">
              <span>Created by {t.created_by?.split("@")[0] ?? "?"} on {fmtDay(t.created_at.slice(0, 10))}</span>
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => deleteTask(t)}>
                <Trash2 className="w-4 h-4 mr-1" /> Delete
              </Button>
            </div>
          </div>
        )}
        {!editing && t.notes && <div className="mt-1 ml-7 text-xs text-muted-foreground">{t.notes}</div>}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Stats — légende du tracker de Loïs */}
      <div className="flex flex-wrap gap-2.5">
        {[
          { n: stats.overdue, l: "Overdue", cls: "text-destructive" },
          { n: stats.due7, l: "Due in 7 days", cls: "text-amber-600" },
          { n: stats.open, l: "Open", cls: "text-foreground" },
          { n: stats.done, l: "Done", cls: "text-success" },
        ].map((k) => (
          <div key={k.l} className="min-w-[110px] rounded-xl border border-border bg-card px-4 py-2.5">
            <div className={`text-xl font-bold ${k.cls}`}>{k.n}</div>
            <div className="text-xs text-muted-foreground">{k.l}</div>
          </div>
        ))}
      </div>

      {/* Barre d'outils */}
      <div className="flex flex-wrap items-center gap-2">
        {(["open", "done", "all"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
              filter === f ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card text-foreground/70 hover:bg-secondary"
            }`}>
            {f === "open" ? "Open" : f === "done" ? "Done" : "All"}
          </button>
        ))}
        <button onClick={() => setMineOnly((v) => !v)}
          className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
            mineOnly ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card text-foreground/70 hover:bg-secondary"
          }`}>
          My tasks
        </button>
        <span className="flex-1" />
        <div className="flex rounded-full bg-secondary p-0.5 text-sm">
          {(["date", "area"] as const).map((g) => (
            <button key={g} onClick={() => setGroupBy(g)}
              className={`rounded-full px-3 py-1 font-medium ${groupBy === g ? "bg-card shadow-sm" : "text-muted-foreground"}`}>
              {g === "date" ? "By date" : "By area"}
            </button>
          ))}
        </div>
        <Button onClick={() => setShowAdd((v) => !v)}>
          <Plus className="w-4 h-4 mr-1" /> Add task
        </Button>
      </div>

      {/* Formulaire de création */}
      {showAdd && (
        <div className="rounded-2xl border border-border bg-card p-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Input placeholder="Task *" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="lg:col-span-2" autoFocus />
          <Input placeholder="Area (pool, garden…)" list="task-areas" value={draft.area} onChange={(e) => setDraft({ ...draft, area: e.target.value })} />
          <select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
            {PRIORITIES.map((p) => <option key={p.v} value={p.v}>{p.label} priority</option>)}
          </select>
          <Input type="date" value={draft.due_date} onChange={(e) => setDraft({ ...draft, due_date: e.target.value })} />
          <select value={draft.repeats} onChange={(e) => setDraft({ ...draft, repeats: e.target.value })} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
            {REPEATS.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
          </select>
          <select value={draft.assignee_id} onChange={(e) => setDraft({ ...draft, assignee_id: e.target.value })} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">Unassigned</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <Input placeholder="Notes" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          <div className="flex gap-2 lg:col-span-4 justify-end">
            <Button variant="outline" onClick={() => { setShowAdd(false); setDraft(emptyDraft); }}>Cancel</Button>
            <Button onClick={addTask} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <CheckSquare className="w-4 h-4 mr-1" />} Save task
            </Button>
          </div>
        </div>
      )}

      <datalist id="task-areas">
        {areas.map((a) => <option key={a} value={a} />)}
      </datalist>

      {/* Liste groupée */}
      {tasks.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
          No tasks here — add the first one. 🎉
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
