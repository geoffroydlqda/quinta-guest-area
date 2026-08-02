import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { CalendarPlus, ExternalLink, Loader2, Pencil, Sparkles, Trash2, Users } from "lucide-react";

/**
 * Planning housekeeping (1 août 2026) — onglet Housekeeping.
 * Par booking : sessions de ménage (date, heures, équipe, notes).
 * Chaque session créée/modifiée est poussée dans le calendrier Google
 * "Housekeeping" dédié via l'Edge Function sync-housekeeping-calendar.
 */

export const HK_TEAM = ["Tina", "Vanessa", "Anabella", "Extra"] as const;

const HK_CAL_URL =
  "https://calendar.google.com/calendar/embed?src=c_4895f757dd0e751ce2493d925a8fa416ef346b8f616dae3777bffb234c396174%40group.calendar.google.com&ctz=Europe%2FLisbon";

export type HkBooking = {
  id: string;
  name: string;
  check_in_date: string | null;
  check_out_date: string | null;
  guest_count: number | null;
};

type Session = {
  id: string;
  booking_id: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  team: string[];
  notes: string | null;
  gcal_event_id: string | null;
};

const fmtD = (d: string | null) =>
  d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "—";
const hhmm = (t: string | null) => (t ?? "").slice(0, 5);

function SessionForm({ booking, initial, onCancel, onSaved }: {
  booking: HkBooking;
  initial?: Session;
  onCancel: () => void;
  onSaved: (s: Session) => void;
}) {
  const { toast } = useToast();
  const [date, setDate] = useState(initial?.date ?? booking.check_out_date ?? "");
  const [startTime, setStartTime] = useState(hhmm(initial?.start_time ?? "10:00"));
  const [endTime, setEndTime] = useState(hhmm(initial?.end_time ?? "14:00"));
  const [team, setTeam] = useState<string[]>(initial?.team ?? []);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [saving, setSaving] = useState(false);

  const toggle = (name: string) =>
    setTeam((t) => (t.includes(name) ? t.filter((n) => n !== name) : [...t, name]));

  const save = async () => {
    if (!date) { toast({ title: "Pick a date", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const payload = {
        booking_id: booking.id,
        date,
        start_time: startTime || null,
        end_time: endTime || null,
        team,
        notes: notes.trim() || null,
        updated_at: new Date().toISOString(),
      };
      let row: Session;
      if (initial) {
        const { data, error } = await supabase.from("housekeeping_sessions")
          .update(payload).eq("id", initial.id).select("*").single();
        if (error) throw new Error(error.message);
        row = data as Session;
      } else {
        const { data, error } = await supabase.from("housekeeping_sessions")
          .insert(payload).select("*").single();
        if (error) throw new Error(error.message);
        row = data as Session;
      }
      // Push vers le calendrier Google Housekeeping (best effort)
      const { data: cal, error: calErr } = await supabase.functions.invoke("sync-housekeeping-calendar", {
        body: { action: "upsert", session_id: row.id },
      });
      if (calErr || cal?.error) {
        toast({
          title: "Saved, but calendar sync failed",
          description: String(cal?.error || calErr?.message) + " — check the Housekeeping calendar is shared with the sync account.",
          variant: "destructive",
        });
      } else if (cal?.skipped) {
        toast({ title: "Session saved", description: "Calendar sync skipped (service account not configured)." });
      } else {
        toast({ title: "Housekeeping scheduled", description: "Added to the Housekeeping Google calendar." });
        if (cal?.event_id) row = { ...row, gcal_event_id: cal.event_id };
      }
      onSaved(row);
    } catch (e) {
      toast({ title: "Save failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-primary/50 bg-primary/5 p-3 space-y-2.5 text-sm">
      <div className="grid sm:grid-cols-3 gap-2">
        <label className="space-y-1">
          <div className="text-xs text-muted-foreground">Date *</div>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9" />
        </label>
        <label className="space-y-1">
          <div className="text-xs text-muted-foreground">Start</div>
          <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="h-9" />
        </label>
        <label className="space-y-1">
          <div className="text-xs text-muted-foreground">End</div>
          <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="h-9" />
        </label>
      </div>
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground flex items-center gap-1"><Users className="w-3.5 h-3.5" /> Team</div>
        <div className="flex items-center gap-4 flex-wrap">
          {HK_TEAM.map((name) => (
            <label key={name} className="flex items-center gap-1.5 cursor-pointer select-none">
              <Checkbox checked={team.includes(name)} onCheckedChange={() => toggle(name)} />
              <span>{name}</span>
            </label>
          ))}
        </div>
      </div>
      <label className="block space-y-1">
        <div className="text-xs text-muted-foreground">Notes</div>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Deep clean the Barn, extra towels in room 3…"
          className="placeholder:italic placeholder:text-muted-foreground/50"
        />
      </label>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <CalendarPlus className="w-4 h-4 mr-1" />}
          {initial ? "Save changes" : "Schedule"}
        </Button>
      </div>
    </div>
  );
}

export function HousekeepingScheduler({ bookings }: { bookings: HkBooking[] }) {
  const { toast } = useToast();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [formFor, setFormFor] = useState<string | null>(null);       // booking_id
  const [editing, setEditing] = useState<Session | null>(null);
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    supabase.from("housekeeping_sessions").select("*").order("date", { ascending: true })
      .then(({ data }) => { setSessions((data as Session[] | null) ?? []); setLoading(false); });
  }, []);

  const todayIso = new Date().toISOString().slice(0, 10);
  const byBooking = useMemo(() => {
    const m = new Map<string, Session[]>();
    for (const s of sessions) {
      const a = m.get(s.booking_id) || [];
      a.push(s);
      m.set(s.booking_id, a);
    }
    return m;
  }, [sessions]);

  const upcoming = useMemo(
    () => bookings.filter((b) => (b.check_out_date ?? "") >= todayIso)
      .sort((a, b) => (a.check_in_date ?? "").localeCompare(b.check_in_date ?? "")),
    [bookings, todayIso]
  );
  const past = useMemo(
    () => bookings.filter((b) => (b.check_out_date ?? "") < todayIso && (byBooking.get(b.id)?.length ?? 0) > 0)
      .sort((a, b) => (b.check_in_date ?? "").localeCompare(a.check_in_date ?? "")),
    [bookings, byBooking, todayIso]
  );

  const remove = async (s: Session) => {
    if (!confirm("Delete this housekeeping session? The calendar event will be removed too.")) return;
    if (s.gcal_event_id) {
      await supabase.functions.invoke("sync-housekeeping-calendar", {
        body: { action: "delete", event_id: s.gcal_event_id },
      });
    }
    const { error } = await supabase.from("housekeeping_sessions").delete().eq("id", s.id);
    if (error) { toast({ title: "Delete failed", description: error.message, variant: "destructive" }); return; }
    setSessions((arr) => arr.filter((x) => x.id !== s.id));
    toast({ title: "Session deleted" });
  };

  const onSaved = (row: Session) => {
    setSessions((arr) => {
      const i = arr.findIndex((x) => x.id === row.id);
      const next = i >= 0 ? arr.map((x) => (x.id === row.id ? row : x)) : [...arr, row];
      return next.sort((a, b) => a.date.localeCompare(b.date));
    });
    setFormFor(null);
    setEditing(null);
  };

  const renderBooking = (b: HkBooking) => {
    const rows = byBooking.get(b.id) ?? [];
    return (
      <div key={b.id} className="px-4 py-3 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <div className="font-medium text-sm">{b.name}</div>
            <div className="text-xs text-muted-foreground">
              {fmtD(b.check_in_date)} → {fmtD(b.check_out_date)}{b.guest_count ? ` · ${b.guest_count} guests` : ""}
            </div>
          </div>
          <Button size="sm" variant="secondary" onClick={() => { setEditing(null); setFormFor(formFor === b.id ? null : b.id); }}>
            <CalendarPlus className="w-4 h-4 mr-1" /> Schedule
          </Button>
        </div>

        {rows.map((s) => (
          <div key={s.id} className="flex items-center gap-2 flex-wrap rounded-lg border border-border bg-background px-3 py-2 text-sm">
            <Sparkles className="w-3.5 h-3.5 text-[#8a63d2] shrink-0" />
            <span className="font-medium">{fmtD(s.date)}</span>
            {s.start_time && (
              <span className="text-muted-foreground">{hhmm(s.start_time)}{s.end_time ? `–${hhmm(s.end_time)}` : ""}</span>
            )}
            {s.team.length > 0 && (
              <span className="flex items-center gap-1 flex-wrap">
                {s.team.map((t) => (
                  <span key={t} className="rounded-full bg-secondary text-secondary-foreground px-2 py-0.5 text-[11px] font-medium">{t}</span>
                ))}
              </span>
            )}
            {s.notes && <span className="text-xs text-muted-foreground italic truncate max-w-[260px]" title={s.notes}>{s.notes}</span>}
            {s.gcal_event_id && <span className="text-[10px] text-[#35532A] font-medium">📅 synced</span>}
            <span className="ml-auto flex items-center gap-0.5">
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setFormFor(b.id); setEditing(s); }}>
                <Pencil className="w-3.5 h-3.5" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => remove(s)}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </span>
          </div>
        ))}

        {formFor === b.id && (
          <SessionForm
            booking={b}
            initial={editing ?? undefined}
            onCancel={() => { setFormFor(null); setEditing(null); }}
            onSaved={onSaved}
          />
        )}
      </div>
    );
  };

  return (
    <section className="rounded-2xl bg-card shadow-sm border border-border/60">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2 flex-wrap">
        <div className="font-semibold text-sm flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-[#EAF7EF] text-[#35B86E] flex items-center justify-center">
            <Sparkles className="w-4 h-4" />
          </span>
          Housekeeping schedule
        </div>
        <a
          href={HK_CAL_URL}
          target="_blank" rel="noopener noreferrer"
          className="text-xs text-[#35532A] font-medium hover:underline flex items-center gap-1"
        >
          <ExternalLink className="w-3.5 h-3.5" /> Open the Housekeeping calendar
        </a>
      </div>
      {loading ? (
        <div className="px-4 py-6 text-sm text-muted-foreground italic">Loading…</div>
      ) : (
        <div className="divide-y divide-border">
          {upcoming.length === 0 && (
            <div className="px-4 py-6 text-sm text-muted-foreground italic">No upcoming stays.</div>
          )}
          {upcoming.map(renderBooking)}
          {past.length > 0 && (
            <div className="px-4 py-2.5">
              <button type="button" className="text-sm font-medium hover:underline" onClick={() => setShowPast((v) => !v)}>
                {showPast ? "Hide" : "Show"} past sessions ({past.length} stay{past.length === 1 ? "" : "s"})
              </button>
            </div>
          )}
          {showPast && past.map(renderBooking)}
        </div>
      )}
    </section>
  );
}
