import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  BedDouble, Camera, CalendarPlus, ChevronDown, ChevronRight, ExternalLink,
  FileDown, Loader2, Pencil, Sparkles, Trash2, Users,
} from "lucide-react";
import { renderRoomMapCanvas, downloadRoomMapPdf, type RoomMapEntry } from "@/lib/roomMapPdf";
import roomsArrangement from "@/assets/rooms-arrangement_floor-plan.jpg";

/**
 * Onglet Housekeeping (1 août 2026) — une seule liste de séjours.
 * Cliquer un séjour déplie tout ce qui le concerne :
 *  - sessions de ménage (date, heures, équipe Tina/Vanessa/Anabella/Extra,
 *    notes) — chaque session est poussée dans le calendrier Google dédié ;
 *  - le room plan (carte annotée + PDF) quand le bedroom arrangement existe ;
 *  - le suivi incidents / dégâts : description + photos (bucket privé).
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

export type HkRoomPlan = {
  entries: RoomMapEntry[];
  remarks: string | null;
  guestsPlaced: number;
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

type Incident = {
  id: string;
  booking_id: string;
  description: string | null;
  photo_urls: string[];
  created_at: string;
};

const fmtD = (d: string | null) =>
  d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "—";
const fmtDY = (d: string | null) =>
  d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
const hhmm = (t: string | null) => (t ?? "").slice(0, 5);

// ------------------------------------------------------------ session form
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

// ------------------------------------------------------------ room plan
function RoomPlanInline({ booking, plan }: { booking: HkBooking; plan: HkRoomPlan }) {
  const [mapUrl, setMapUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    renderRoomMapCanvas(roomsArrangement, plan.entries)
      .then((canvas) => { if (!cancelled) setMapUrl(canvas.toDataURL("image/jpeg", 0.85)); })
      .catch(() => { if (!cancelled) setMapUrl(null); });
    return () => { cancelled = true; };
  }, [booking.id]);

  const download = () =>
    downloadRoomMapPdf(roomsArrangement, plan.entries, {
      title: `Quinta do Amor — Room map — ${booking.name}`,
      subtitle: `${fmtDY(booking.check_in_date)} → ${fmtDY(booking.check_out_date)} · ${plan.guestsPlaced} guests placed`,
    });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs uppercase text-muted-foreground flex items-center gap-1.5">
          <BedDouble className="w-3.5 h-3.5" /> Bedroom arrangement · {plan.guestsPlaced} guests placed
        </div>
        <Button size="sm" variant="outline" onClick={download}>
          <FileDown className="w-4 h-4 mr-1" /> PDF
        </Button>
      </div>
      {mapUrl ? (
        <img src={mapUrl} alt={`Room map — ${booking.name}`} className="w-full h-auto rounded-lg border border-border" />
      ) : (
        <div className="h-48 flex items-center justify-center text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      )}
      {plan.remarks && (
        <p className="text-xs text-muted-foreground italic whitespace-pre-wrap">{plan.remarks}</p>
      )}
    </div>
  );
}

// ------------------------------------------------------------ incidents
function IncidentsSection({ bookingId }: { bookingId: string }) {
  const { toast } = useToast();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({}); // path -> signed url
  const [showForm, setShowForm] = useState(false);
  const [desc, setDesc] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  const loadThumbs = async (rows: Incident[]) => {
    const paths = rows.flatMap((r) => r.photo_urls);
    if (!paths.length) return;
    const { data } = await supabase.storage.from("incidents").createSignedUrls(paths, 3600);
    const m: Record<string, string> = {};
    for (const d of data ?? []) if (d.path && d.signedUrl) m[d.path] = d.signedUrl;
    setThumbs((t) => ({ ...t, ...m }));
  };

  useEffect(() => {
    supabase.from("hk_incidents").select("*").eq("booking_id", bookingId)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        const rows = (data as Incident[] | null) ?? [];
        setIncidents(rows);
        loadThumbs(rows);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  const save = async () => {
    if (!desc.trim() && files.length === 0) return;
    setSaving(true);
    try {
      const paths: string[] = [];
      for (const [i, f] of files.entries()) {
        const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
        const path = `${bookingId}/${Date.now()}-${i}.${ext}`;
        const { error } = await supabase.storage.from("incidents").upload(path, f, { contentType: f.type || "image/jpeg" });
        if (error) throw new Error(`Photo upload failed: ${error.message}`);
        paths.push(path);
      }
      const { data, error } = await supabase.from("hk_incidents")
        .insert({ booking_id: bookingId, description: desc.trim() || null, photo_urls: paths })
        .select("*").single();
      if (error) throw new Error(error.message);
      const row = data as Incident;
      setIncidents((arr) => [row, ...arr]);
      loadThumbs([row]);
      setDesc(""); setFiles([]); setShowForm(false);
      toast({ title: "Incident logged" });
    } catch (e) {
      toast({ title: "Could not log incident", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (inc: Incident) => {
    if (!confirm("Delete this incident (photos included)?")) return;
    if (inc.photo_urls.length) await supabase.storage.from("incidents").remove(inc.photo_urls);
    const { error } = await supabase.from("hk_incidents").delete().eq("id", inc.id);
    if (error) { toast({ title: "Delete failed", description: error.message, variant: "destructive" }); return; }
    setIncidents((arr) => arr.filter((x) => x.id !== inc.id));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs uppercase text-muted-foreground flex items-center gap-1.5">
          <Camera className="w-3.5 h-3.5" /> Incidents & damages
          {incidents.length > 0 && <span className="normal-case">({incidents.length})</span>}
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowForm((v) => !v)}>
          <Camera className="w-4 h-4 mr-1" /> Report
        </Button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-[#EFC75B]/70 bg-[#FFF8E4]/50 p-3 space-y-2 text-sm">
          <Textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            rows={2}
            placeholder="Broken glass in room 4, wine stain on the Barn sofa…"
            className="placeholder:italic placeholder:text-muted-foreground/50 bg-background"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              type="file" accept="image/*" multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              className="max-w-[320px] h-9 text-xs"
            />
            {files.length > 0 && <span className="text-xs text-muted-foreground">{files.length} photo{files.length === 1 ? "" : "s"}</span>}
            <span className="ml-auto flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setShowForm(false); setDesc(""); setFiles([]); }} disabled={saving}>Cancel</Button>
              <Button size="sm" onClick={save} disabled={saving || (!desc.trim() && files.length === 0)}>
                {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                Save
              </Button>
            </span>
          </div>
        </div>
      )}

      {incidents.map((inc) => (
        <div key={inc.id} className="rounded-lg border border-border bg-background px-3 py-2 text-sm space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs text-muted-foreground">{fmtDY(inc.created_at.slice(0, 10))}</div>
              {inc.description && <p className="whitespace-pre-wrap">{inc.description}</p>}
            </div>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive shrink-0" onClick={() => remove(inc)}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
          {inc.photo_urls.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {inc.photo_urls.map((p) => thumbs[p] ? (
                <a key={p} href={thumbs[p]} target="_blank" rel="noopener noreferrer">
                  <img src={thumbs[p]} alt="Incident photo" className="w-20 h-20 object-cover rounded-lg border border-border" />
                </a>
              ) : (
                <div key={p} className="w-20 h-20 rounded-lg border border-border bg-muted animate-pulse" />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------ main list
export function HousekeepingScheduler({ bookings, planByBooking, onOpenBooking }: {
  bookings: HkBooking[];
  planByBooking: Map<string, HkRoomPlan>;
  onOpenBooking: (bookingId: string) => void;
}) {
  const { toast } = useToast();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [formFor, setFormFor] = useState<string | null>(null);
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
    () => bookings.filter((b) => (b.check_out_date ?? "") < todayIso)
      .sort((a, b) => (b.check_in_date ?? "").localeCompare(a.check_in_date ?? "")),
    [bookings, todayIso]
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

  const renderBooking = (b: HkBooking, tag: string | null) => {
    const rows = byBooking.get(b.id) ?? [];
    const plan = planByBooking.get(b.id) ?? null;
    const open = expandedId === b.id;
    return (
      <div key={b.id}>
        {/* Ligne cliquable — tout se déplie ici */}
        <button
          type="button"
          onClick={() => setExpandedId(open ? null : b.id)}
          className={`w-full flex items-center gap-2.5 px-4 py-3 text-left transition-colors ${open ? "bg-primary/10" : "hover:bg-muted/50"}`}
        >
          {open ? <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />}
          <div className="min-w-0 flex-1">
            <div className="font-medium text-sm truncate">
              {b.name}
              {tag && <span className="ml-1.5 text-[10px] uppercase text-[#35532A] font-semibold">{tag}</span>}
            </div>
            <div className="text-xs text-muted-foreground">
              {fmtD(b.check_in_date)} → {fmtD(b.check_out_date)}{b.guest_count ? ` · ${b.guest_count} guests` : ""}
            </div>
          </div>
          <span className="flex items-center gap-1.5 shrink-0">
            {rows.length > 0 && (
              <span className="rounded-full bg-secondary text-secondary-foreground px-2 py-0.5 text-[11px] font-medium flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> {rows.length}
              </span>
            )}
            {plan && (
              <span className="rounded-full bg-[#EDF5FF] text-[#1D4F96] px-2 py-0.5 text-[11px] font-medium flex items-center gap-1">
                <BedDouble className="w-3 h-3" /> plan
              </span>
            )}
          </span>
        </button>

        {open && (
          <div className="px-4 pb-4 pl-10 space-y-4">
            {/* Sessions ménage */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs uppercase text-muted-foreground flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" /> Housekeeping sessions
                </div>
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    className="text-xs text-[#35532A] font-medium hover:underline flex items-center gap-1"
                    onClick={() => onOpenBooking(b.id)}
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Booking
                  </button>
                  <Button size="sm" variant="secondary" onClick={() => { setEditing(null); setFormFor(formFor === b.id ? null : b.id); }}>
                    <CalendarPlus className="w-4 h-4 mr-1" /> Schedule
                  </Button>
                </span>
              </div>
              {rows.length === 0 && formFor !== b.id && (
                <p className="text-xs text-muted-foreground italic">Nothing scheduled yet.</p>
              )}
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

            {/* Room plan inline */}
            {plan ? (
              <RoomPlanInline booking={b} plan={plan} />
            ) : (
              <p className="text-xs text-muted-foreground italic">
                No bedroom arrangement yet — it appears here once rooms are assigned in Room Setup.
              </p>
            )}

            {/* Incidents & dégâts */}
            <IncidentsSection bookingId={b.id} />
          </div>
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
          Housekeeping
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
          {upcoming.map((b, i) => renderBooking(b, i === 0 && (b.check_in_date ?? "") > todayIso ? "next" : (b.check_in_date ?? "") <= todayIso ? "live" : null))}
          {past.length > 0 && (
            <div className="px-4 py-2.5">
              <button type="button" className="text-sm font-medium hover:underline" onClick={() => setShowPast((v) => !v)}>
                {showPast ? "Hide" : "Show"} past stays ({past.length})
              </button>
            </div>
          )}
          {showPast && past.map((b) => renderBooking(b, null))}
        </div>
      )}
    </section>
  );
}
