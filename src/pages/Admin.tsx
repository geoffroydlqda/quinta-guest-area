import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminGuard } from "@/lib/adminGuard";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Download, RefreshCw, LogOut, Trash2, FileDown, Mail, ChevronDown, ChevronRight, Plus, Copy, Check } from "lucide-react";
import { generateAirportSignPdf, resolveAirportSignNames } from "@/lib/airportSignPdf";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { DeleteGuestDialog } from "@/components/admin/DeleteGuestDialog";
import { CreateBookingDialog } from "@/components/admin/CreateBookingDialog";
import { getGuestStatus, type GuestStatusKind } from "@/lib/editLock";
import { syncTripCalendar, backfillTripCalendars, forceResyncTripCalendars } from "@/lib/calendarSync";
import { CalendarCheck, AlertTriangle } from "lucide-react";
import { calculateTransportationCost } from "@/lib/transportationPricing";
import type { TransportationTrip } from "@/types/guest";

const STATUS_BADGE: Record<GuestStatusKind, { label: string; className: string }> = {
  pending: { label: "Pending completion", className: "bg-muted text-foreground border border-border" },
  late_updates: { label: "Late updates", className: "bg-yellow-100 text-yellow-900 border border-yellow-400" },
  finalized: { label: "Finalized", className: "bg-destructive/15 text-destructive border border-destructive/30" },
  finalized_in_progress: { label: "Finalized", className: "bg-muted text-muted-foreground border border-border" },
};

function StatusBadge({ checkIn, statusOverall }: { checkIn: string | null; statusOverall: string }) {
  const info = getGuestStatus(checkIn, statusOverall);
  const cfg = STATUS_BADGE[info.status];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

type Profile = {
  user_id: string; first_name: string | null; last_name: string | null;
  full_name: string; email: string;
  check_in_date: string | null; check_out_date: string | null;
  guests_count: number; status_overall: string; submitted_at: string | null;
};

type Room = { user_id: string; email: string; queen_shared_qty: number; twins_shared_qty: number; queen_ensuite_qty: number; twins_ensuite_qty: number; remarks_roomsetup: string | null; remarks: string | null; status_roomsetup: string };
type Passenger = { id: string; first_name: string; last_name?: string | null; phone: string | null; flight_number: string | null };
type Trip = { id: string; user_id: string; booking_id?: string | null; trip_direction: string; pickup_location: string; dropoff_location: string; trip_date: string; trip_time: string; passengers_count: number; taxi_size: string; price_estimate: string; custom_price: number | null; google_calendar_event_id?: string | null; sync_status?: string | null; last_synced_at?: string | null; sync_error?: string | null; passengers?: Passenger[] };
type FoodPlan = { user_id: string; selections: any; diet_preference: string | null; status_food: string };

type BookingRow = {
  id: string; retreat_name: string; first_name: string | null; last_name: string | null;
  email: string; guest_count: number;
  check_in_date: string | null; check_out_date: string | null;
  payment_status: string; invitation_token: string | null; invitation_claimed: boolean;
  user_id: string | null; created_at: string;
};

interface Data {
  profiles: Profile[]; rooms: Room[]; trips: Trip[]; food: FoodPlan[];
  bookings?: BookingRow[];
}

function csvEscape(v: any): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCSV(filename: string, rows: any[][]) {
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const AdminContent = () => {
  const { signOut } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "submitted">("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | "live" | "upcoming" | "past">("all");
  const [pastCollapsed, setPastCollapsed] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [createBookingOpen, setCreateBookingOpen] = useState(false);
  const [tab, setTab] = useState<string>("overview");

  const load = async (opts?: { silent?: boolean }) => {
    const silent = !!opts?.silent;
    if (!silent) setLoading(true);
    const res = await supabase.functions.invoke("admin-list-data");
    if (res.error) {
      toast({ title: "Error", description: res.error.message, variant: "destructive" });
    } else {
      setData(res.data as Data);
    }
    if (!silent) setLoading(false);
  };

  const patchTrip = (id: string, patch: Partial<Trip>) => {
    setData((d) => d ? { ...d, trips: d.trips.map((t) => t.id === id ? { ...t, ...patch } : t) } : d);
  };

  useEffect(() => { load(); }, []);

  // Auto-backfill any unsynced transportation trips on admin load (silent, fire-and-forget).
  // Runs once per browser session to avoid hammering on every refresh.
  useEffect(() => {
    if (!data) return;
    const KEY = "admin_calendar_backfilled_v1";
    if (sessionStorage.getItem(KEY)) return;
    const unsynced = data.trips.filter((t) => !t.google_calendar_event_id);
    if (unsynced.length === 0) {
      sessionStorage.setItem(KEY, "1");
      return;
    }
    sessionStorage.setItem(KEY, "1");
    console.log(`[admin] Auto-backfilling ${unsynced.length} unsynced trip(s) to Google Calendar`);
    backfillTripCalendars().then((res) => {
      if (res) {
        console.log(`[admin] Auto-backfill complete: ${res.synced}/${res.total} synced, ${res.failed} failed`);
        if (res.synced > 0) {
          toast({
            title: "Calendar synced",
            description: `${res.synced} transportation trip(s) added to Google Calendar.`,
          });
          load();
        }
      }
    });
  }, [data]);

  const sync = async () => {
    setSyncing(true);
    const res = await supabase.functions.invoke("sync-google-sheets");
    setSyncing(false);
    if (res.error) toast({ title: "Sync failed", description: res.error.message, variant: "destructive" });
    else toast({ title: "Synced to Google Sheets" });
  };

  const profileById = useMemo(() => new Map((data?.profiles || []).map((p) => [p.user_id, p])), [data]);
  const guestName = (uid: string) => {
    const p = profileById.get(uid);
    if (!p) return "Unknown";
    return p.full_name || `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || p.email;
  };

  const todayIso = useMemo(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  }, []);

  const categoryOf = (p: Profile): "upcoming" | "past" | "live" | "none" => {
    if (!p.check_out_date) return "none";
    if (p.check_out_date < todayIso) return "past";
    if (p.check_in_date && p.check_in_date <= todayIso && p.check_out_date >= todayIso) return "live";
    return "upcoming";
  };

  const filteredProfiles = useMemo(() => {
    if (!data) return [];
    const s = search.toLowerCase().trim();
    return data.profiles.filter((p) => {
      if (statusFilter !== "all" && p.status_overall !== statusFilter) return false;
      if (!s) return true;
      return (
        (p.full_name || "").toLowerCase().includes(s) ||
        (p.email || "").toLowerCase().includes(s) ||
        (p.first_name || "").toLowerCase().includes(s) ||
        (p.last_name || "").toLowerCase().includes(s)
      );
    });
  }, [data, search, statusFilter]);

  const { upcomingProfiles, pastProfiles, unscheduledProfiles } = useMemo(() => {
    const upcoming: Profile[] = [];
    const past: Profile[] = [];
    const none: Profile[] = [];
    for (const p of filteredProfiles) {
      const c = categoryOf(p);
      if (c === "past") past.push(p);
      else if (c === "none") none.push(p);
      else upcoming.push(p); // upcoming + live
    }
    upcoming.sort((a, b) => (a.check_out_date || "").localeCompare(b.check_out_date || ""));
    past.sort((a, b) => (b.check_out_date || "").localeCompare(a.check_out_date || ""));
    return { upcomingProfiles: upcoming, pastProfiles: past, unscheduledProfiles: none };
  }, [filteredProfiles, todayIso]);

  const visibleUpcoming = useMemo(() => {
    if (categoryFilter === "past") return [];
    if (categoryFilter === "live") return upcomingProfiles.filter((p) => categoryOf(p) === "live");
    if (categoryFilter === "upcoming") return upcomingProfiles.filter((p) => categoryOf(p) === "upcoming");
    return upcomingProfiles;
  }, [upcomingProfiles, categoryFilter, todayIso]);

  const visiblePast = useMemo(() => {
    if (categoryFilter === "upcoming" || categoryFilter === "live") return [];
    return pastProfiles;
  }, [pastProfiles, categoryFilter]);

  const visibleUnscheduled = categoryFilter === "all" ? unscheduledProfiles : [];

  const toolStatus = (uid: string) => {
    const room = data?.rooms.find((r) => r.user_id === uid);
    const trip = data?.trips.find((t) => t.user_id === uid);
    const food = data?.food.find((f) => f.user_id === uid);
    const hasFood = food?.selections && Array.isArray(food.selections) &&
      (food.selections as any[]).some((s: any) => s.fullBoard || s.breakfast || s.lunch || s.dinner);
    return {
      room: room ? room.status_roomsetup : "—",
      trip: trip ? "set" : "—",
      food: hasFood ? (food?.status_food || "draft") : "—",
    };
  };

  if (loading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card sticky top-0 z-20">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-xl font-medium">Admin · Quinta do Amor</h1>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setCreateBookingOpen(true)}>
              <Plus className="w-4 h-4 mr-1" />New booking
            </Button>
            <Button size="sm" variant="outline" onClick={() => load()}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
            <Button size="sm" variant="outline" onClick={sync} disabled={syncing}>
              {syncing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              Sync to Google Sheets
            </Button>
            <Button size="sm" variant="ghost" onClick={signOut}><LogOut className="w-4 h-4" /></Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-4 flex flex-wrap">
            <TabsTrigger value="overview">Guests Overview</TabsTrigger>
            <TabsTrigger value="food">Food Planning</TabsTrigger>
            <TabsTrigger value="transport">Transportation</TabsTrigger>
            <TabsTrigger value="rooms">Room Setup</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <div className="flex flex-wrap gap-2 mb-3">
              <Input placeholder="Search name or email" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="border border-border rounded-md px-3 py-2 text-sm bg-background">
                <option value="all">All statuses</option>
                <option value="draft">Draft</option>
                <option value="submitted">Submitted</option>
              </select>
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as any)} className="border border-border rounded-md px-3 py-2 text-sm bg-background">
                <option value="all">All events</option>
                <option value="live">Live</option>
                <option value="upcoming">Upcoming</option>
                <option value="past">Past</option>
              </select>
              <Button size="sm" variant="outline" onClick={() => downloadCSV("guests.csv", [
                ["First name","Last name","Email","Check-in","Check-out","Guests","Room","Food","Transport","Status","Submitted at"],
                ...filteredProfiles.map((p) => {
                  const ts = toolStatus(p.user_id);
                  return [p.first_name||"", p.last_name||"", p.email, p.check_in_date||"", p.check_out_date||"", p.guests_count, ts.room, ts.food, ts.trip, p.status_overall, p.submitted_at||""];
                }),
              ])}><Download className="w-4 h-4 mr-1" />CSV</Button>
            </div>

            {categoryFilter === "all" && (data.bookings || []).filter((b) => !b.invitation_claimed).length > 0 && (
              <PendingInvitationsSection bookings={(data.bookings || []).filter((b) => !b.invitation_claimed)} onChanged={load} />
            )}

            {(categoryFilter === "all" || categoryFilter === "live" || categoryFilter === "upcoming") && (
              <section className="mb-6">
                <h2 className="text-base font-medium mb-2">Upcoming events <span className="text-muted-foreground text-sm font-normal">({visibleUpcoming.length})</span></h2>
                {visibleUpcoming.length === 0 ? (
                  <div className="border border-border rounded-lg bg-card p-6 text-sm text-muted-foreground text-center">No upcoming events.</div>
                ) : (
                  <ProfileTable
                    profiles={visibleUpcoming}
                    toolStatus={toolStatus}
                    categoryOf={categoryOf}
                    onRowClick={(uid) => navigate(`/admin/guest/${uid}`)}
                    onDelete={(id, label) => setDeleteTarget({ id, label })}
                    showLive
                  />
                )}
              </section>
            )}

            {(categoryFilter === "all" || categoryFilter === "past") && (
              <section className="mb-6">
                <button
                  type="button"
                  onClick={() => setPastCollapsed((v) => !v)}
                  className="flex items-center gap-1 text-base font-medium mb-2 hover:underline"
                >
                  {pastCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  Past events <span className="text-muted-foreground text-sm font-normal">({visiblePast.length})</span>
                </button>
                {!pastCollapsed && (
                  visiblePast.length === 0 ? (
                    <div className="border border-border rounded-lg bg-card p-6 text-sm text-muted-foreground text-center">No past events.</div>
                  ) : (
                    <ProfileTable
                      profiles={visiblePast}
                      toolStatus={toolStatus}
                      categoryOf={categoryOf}
                      onRowClick={(uid) => navigate(`/admin/guest/${uid}`)}
                      onDelete={(id, label) => setDeleteTarget({ id, label })}
                    />
                  )
                )}
              </section>
            )}

            {visibleUnscheduled.length > 0 && (
              <section className="mb-6">
                <h2 className="text-base font-medium mb-2">No dates set <span className="text-muted-foreground text-sm font-normal">({visibleUnscheduled.length})</span></h2>
                <ProfileTable
                  profiles={visibleUnscheduled}
                  toolStatus={toolStatus}
                  categoryOf={categoryOf}
                  onRowClick={(uid) => navigate(`/admin/guest/${uid}`)}
                  onDelete={(id, label) => setDeleteTarget({ id, label })}
                />
              </section>
            )}
          </TabsContent>

          <TabsContent value="food">
            <FoodView data={data} guestName={guestName} />
          </TabsContent>

          <TabsContent value="transport">
            <TransportView data={data} guestName={guestName} onTripPatched={patchTrip} onReload={() => load({ silent: true })} onInvalidateTransport={(bookingId, userId) => Promise.all([
              queryClient.invalidateQueries({ queryKey: ['transportation_trips', bookingId ?? userId] }),
              queryClient.invalidateQueries({ queryKey: ['booking_summary', bookingId ?? userId] }),
              queryClient.invalidateQueries({ queryKey: ['guest_overview', bookingId ?? userId] }),
              queryClient.invalidateQueries({ queryKey: ['booking_totals', bookingId ?? userId] }),
            ]).then(() => undefined)} />
          </TabsContent>

          <TabsContent value="rooms">
            <RoomsView data={data} guestName={guestName} />
          </TabsContent>
        </Tabs>
      </main>

      <DeleteGuestDialog
        open={!!deleteTarget}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
        guestId={deleteTarget?.id ?? null}
        guestLabel={deleteTarget?.label}
        onDeleted={(id) => {
          setData((d) => d ? {
            ...d,
            profiles: d.profiles.filter((p) => p.user_id !== id),
            rooms: d.rooms.filter((r) => r.user_id !== id),
            trips: d.trips.filter((t) => t.user_id !== id),
            food: d.food.filter((f) => f.user_id !== id),
          } : d);
        }}
      />

      <CreateBookingDialog
        open={createBookingOpen}
        onOpenChange={setCreateBookingOpen}
        onCreated={load}
      />
    </div>
  );
};

function FoodView({ data, guestName }: { data: Data; guestName: (u: string) => string }) {
  const rows = useMemo(() => {
    const out: { date: string; guest: string; guests: number; diet: string; meals: string }[] = [];
    for (const fp of data.food) {
      const sels = Array.isArray(fp.selections) ? fp.selections : [];
      const p = data.profiles.find((pp) => pp.user_id === fp.user_id);
      const gc = p?.guests_count ?? 1;
      for (const s of sels as any[]) {
        const meals = s.fullBoard ? "Full board" : ["breakfast","lunch","dinner"].filter((m) => s[m]).join(", ");
        if (!meals) continue;
        out.push({ date: s.date, guest: guestName(fp.user_id), guests: gc, diet: fp.diet_preference || "", meals });
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }, [data, guestName]);

  const totalsByDate = useMemo(() => {
    const map = new Map<string, { breakfast: number; lunch: number; dinner: number; fullBoard: number }>();
    for (const fp of data.food) {
      const p = data.profiles.find((pp) => pp.user_id === fp.user_id);
      const gc = p?.guests_count ?? 1;
      const sels = Array.isArray(fp.selections) ? fp.selections : [];
      for (const s of sels as any[]) {
        const t = map.get(s.date) || { breakfast: 0, lunch: 0, dinner: 0, fullBoard: 0 };
        if (s.fullBoard) t.fullBoard += gc;
        else { if (s.breakfast) t.breakfast += gc; if (s.lunch) t.lunch += gc; if (s.dinner) t.dinner += gc; }
        map.set(s.date, t);
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => downloadCSV("food.csv", [
          ["Date","Guest","Guests","Diet","Meals"],
          ...rows.map((r) => [r.date, r.guest, r.guests, r.diet, r.meals]),
        ])}><Download className="w-4 h-4 mr-1" />CSV</Button>
      </div>
      <div className="overflow-auto border border-border rounded-lg bg-card max-h-[40vh]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted"><tr className="text-left">
            {["Date","Guest","Guests","Diet","Meals"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-3 py-2">{r.date}</td>
                <td className="px-3 py-2">{r.guest}</td>
                <td className="px-3 py-2">{r.guests}</td>
                <td className="px-3 py-2">{r.diet}</td>
                <td className="px-3 py-2">{r.meals}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="font-medium mt-6">Totals per day</h3>
      <div className="overflow-auto border border-border rounded-lg bg-card">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted"><tr className="text-left">
            {["Date","Breakfast","Lunch","Dinner","Full board"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
          </tr></thead>
          <tbody>
            {totalsByDate.map(([date, t]) => (
              <tr key={date} className="border-t border-border">
                <td className="px-3 py-2">{date}</td>
                <td className="px-3 py-2">{t.breakfast}</td>
                <td className="px-3 py-2">{t.lunch}</td>
                <td className="px-3 py-2">{t.dinner}</td>
                <td className="px-3 py-2">{t.fullBoard}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TransportView({ data, guestName, onTripPatched, onReload, onInvalidateTransport }: { data: Data; guestName: (u: string) => string; onTripPatched: (id: string, patch: Partial<Trip>) => void; onReload: () => void; onInvalidateTransport: (bookingId: string | null | undefined, userId: string) => Promise<void> }) {
  const { toast } = useToast();
  const [syncingAll, setSyncingAll] = useState(false);
  const [forceResyncing, setForceResyncing] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const todayIso = useMemo(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  }, []);

  const groups = useMemo(() => {
    const bookingsById = new Map((data.bookings || []).map((b) => [b.id, b]));
    // pick a "primary" booking per user_id (latest by check_in_date) for trips with no booking_id
    const bookingsByUser = new Map<string, BookingRow>();
    for (const b of data.bookings || []) {
      if (!b.user_id) continue;
      const cur = bookingsByUser.get(b.user_id);
      if (!cur || (b.check_in_date || "") > (cur.check_in_date || "")) {
        bookingsByUser.set(b.user_id, b);
      }
    }

    type Group = {
      key: string;
      retreatName: string;
      checkIn: string | null;
      checkOut: string | null;
      sortKey: string;
      trips: Trip[];
    };
    const map = new Map<string, Group>();

    for (const t of data.trips) {
      const b = (t.booking_id && bookingsById.get(t.booking_id)) || bookingsByUser.get(t.user_id);
      const key = b?.id || `user:${t.user_id}`;
      const retreatName = b?.retreat_name?.trim() || guestName(t.user_id);
      const checkIn = b?.check_in_date || null;
      const checkOut = b?.check_out_date || null;
      // Sort key: upcoming first (future check-in ascending), then past (descending);
      // Fallback to earliest trip date for groups with no stay dates.
      const stayRef = checkIn || t.trip_date;
      const isPast = (checkOut || stayRef) < todayIso;
      const sortKey = `${isPast ? "2" : "1"}_${stayRef || "9999-99-99"}`;
      if (!map.has(key)) {
        map.set(key, { key, retreatName, checkIn, checkOut, sortKey, trips: [] });
      }
      map.get(key)!.trips.push(t);
    }

    return Array.from(map.values())
      .map((g) => ({
        ...g,
        trips: g.trips.sort((a, b) => `${a.trip_date} ${a.trip_time}`.localeCompare(`${b.trip_date} ${b.trip_time}`)),
        cost: calculateTransportationCost(g.trips as unknown as TransportationTrip[]),
        isPast: g.sortKey.startsWith("2"),
      }))
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [data, guestName, todayIso]);

  const allTripsForCSV = useMemo(
    () => groups.flatMap((g) => g.trips),
    [groups]
  );

  const handleBackfill = async () => {
    setSyncingAll(true);
    const res = await backfillTripCalendars();
    setSyncingAll(false);
    if (!res) {
      toast({ title: "Sync failed", description: "Could not reach calendar sync.", variant: "destructive" });
      return;
    }
    toast({
      title: "Calendar sync complete",
      description: `${res.synced} synced, ${res.failed} failed (out of ${res.total}).`,
    });
    onReload();
  };

  const handleForceResync = async () => {
    if (!confirm("Delete and recreate calendar events for ALL trips? Existing event IDs will be replaced.")) return;
    setForceResyncing(true);
    const res = await forceResyncTripCalendars();
    setForceResyncing(false);
    if (!res) {
      toast({ title: "Force resync failed", description: "Could not reach calendar sync.", variant: "destructive" });
      return;
    }
    toast({
      title: "Force resync complete",
      description: `${res.synced} recreated, ${res.failed} failed (out of ${res.total}).`,
    });
    onReload();
  };

  const isCollapsed = (g: typeof groups[number]) =>
    g.key in collapsed ? collapsed[g.key] : g.isPast; // upcoming expanded by default

  const fmtDate = (d: string | null) =>
    d ? new Date(d + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

  return (
    <div className="space-y-3">
      <div className="flex justify-end gap-2 flex-wrap">
        <Button size="sm" variant="outline" onClick={handleBackfill} disabled={syncingAll || forceResyncing}>
          {syncingAll ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <CalendarCheck className="w-4 h-4 mr-1" />}
          Sync all existing trips
        </Button>
        <Button size="sm" variant="outline" onClick={handleForceResync} disabled={syncingAll || forceResyncing}>
          {forceResyncing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <CalendarCheck className="w-4 h-4 mr-1" />}
          Force resync all trips
        </Button>
        <Button size="sm" variant="outline" onClick={() => downloadCSV("transport.csv", [
          ["Date","Time","Guest","Direction","Pickup","Dropoff","Taxi","Passengers","Price","Custom price (€)","Custom","Calendar event","Sync status"],
          ...allTripsForCSV.map((t) => {
            const isCustom = t.price_estimate?.toLowerCase().includes("custom");
            return [t.trip_date, t.trip_time, guestName(t.user_id), t.trip_direction, t.pickup_location, t.dropoff_location, t.taxi_size, t.passengers_count, t.price_estimate, t.custom_price ?? "", isCustom ? "yes" : "", t.google_calendar_event_id ?? "", t.sync_status ?? ""];
          }),
        ])}><Download className="w-4 h-4 mr-1" />CSV</Button>
      </div>

      {groups.length === 0 && (
        <div className="border border-border rounded-lg bg-card p-6 text-sm text-muted-foreground text-center">
          No transportation trips yet.
        </div>
      )}

      <div className="space-y-4">
        {groups.map((g) => {
          const collapsedNow = isCollapsed(g);
          const hasFixedTotal = g.cost.fixedPriceTotal > 0;
          return (
            <section key={g.key} className="border border-border rounded-lg bg-card overflow-hidden">
              <button
                type="button"
                onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !collapsedNow }))}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-muted/40 hover:bg-muted/60 text-left"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {collapsedNow ? <ChevronRight className="w-4 h-4 shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />}
                  <div className="min-w-0">
                    <div className="font-medium truncate">{g.retreatName}</div>
                    <div className="text-xs text-muted-foreground">
                      {fmtDate(g.checkIn)} → {fmtDate(g.checkOut)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground whitespace-nowrap">
                  <span>{g.cost.totalTrips} trip{g.cost.totalTrips === 1 ? "" : "s"}</span>
                  {hasFixedTotal && <span className="font-medium text-foreground">Total: €{g.cost.fixedPriceTotal}</span>}
                  {g.cost.customOfferCount > 0 && <span>{g.cost.customOfferCount} custom offer{g.cost.customOfferCount === 1 ? "" : "s"}</span>}
                </div>
              </button>

              {!collapsedNow && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/20"><tr className="text-left">
                      {["Date","Time","Guest","Direction","Pickup","Dropoff","Taxi","Pax","Price","Price (€)","Sign","Notify"].map((h) => <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {g.trips.map((t) => {
                        const gName = guestName(t.user_id);
                        const hasManualPrice = t.custom_price !== null && t.custom_price !== undefined;
                        const syncFailed = t.sync_status === "failed";
                        const handleSign = () => {
                          const names = resolveAirportSignNames({ passengers: t.passengers, guestFullName: gName });
                          if (import.meta.env.DEV) console.log("[airport-sign] trip", { trip_id: t.id, names });
                          const slug = gName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "guest";
                          const filename = `airport-sign-${slug}-${t.trip_date}.pdf`;
                          const ok = generateAirportSignPdf(names, filename);
                          if (!ok) {
                            import("sonner").then(({ toast }) => toast.error("Unable to generate airport sign PDF."));
                          }
                        };
                        return (
                          <tr key={t.id} className="border-t border-border">
                            <td className="px-3 py-2"><TripDateEditor trip={t} onPatch={(d) => onTripPatched(t.id, { trip_date: d })} /></td>
                            <td className="px-3 py-2 whitespace-nowrap">{t.trip_time}</td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <span>{gName}</span>
                                {syncFailed && (
                                  <span title={t.sync_error || "Calendar sync failed"} className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 text-destructive px-2 py-0.5 text-[10px] font-medium whitespace-nowrap">
                                    <AlertTriangle className="w-3 h-3" />
                                    Calendar sync failed
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2">{t.trip_direction}</td>
                            <td className="px-3 py-2">{t.pickup_location}</td>
                            <td className="px-3 py-2">{t.dropoff_location}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{t.taxi_size}</td>
                            <td className="px-3 py-2">{t.passengers_count}</td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <span>{hasManualPrice ? `${Number(t.custom_price)}€` : t.price_estimate}</span>
                                {hasManualPrice && (
                                  <span className="inline-flex items-center rounded-full border border-primary/40 bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-medium whitespace-nowrap">
                                    Manual price
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <CustomPriceEditor trip={t} bookingId={t.booking_id} userId={t.user_id} onPatch={(v) => onTripPatched(t.id, { custom_price: v })} onInvalidateTransport={onInvalidateTransport} />
                            </td>
                            <td className="px-3 py-2">
                              <Button size="sm" variant="outline" onClick={handleSign}>
                                <FileDown className="w-4 h-4 mr-1" />Airport sign
                              </Button>
                            </td>
                            <td className="px-3 py-2">
                              <NotifyGuestButton userId={t.user_id} guestName={gName} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function CustomPriceEditor({ trip, bookingId, userId, onSaved, onPatch, onInvalidateTransport }: { trip: { id: string; custom_price: number | null }; bookingId?: string | null; userId?: string; onSaved?: (v: number | null) => void; onPatch?: (v: number | null) => void; onInvalidateTransport?: (bookingId: string | null | undefined, userId: string) => Promise<void> }) {
  const [value, setValue] = useState<string>(
    trip.custom_price !== null && trip.custom_price !== undefined ? String(trip.custom_price) : ""
  );
  const [saving, setSaving] = useState(false);
  const [savedValue, setSavedValue] = useState<number | null>(trip.custom_price);
  const { toast } = useToast();

  // Keep local state in sync if the parent updates the trip's custom_price
  // (e.g., after optimistic patch from another control / reload).
  useEffect(() => {
    setSavedValue(trip.custom_price);
    setValue(trip.custom_price !== null && trip.custom_price !== undefined ? String(trip.custom_price) : "");
  }, [trip.id, trip.custom_price]);


  const dirty = (value === "" ? null : Number(value)) !== savedValue;
  const isMissing = savedValue === null || savedValue === undefined;

  const save = async () => {
    const trimmed = value.trim();
    let next: number | null = null;
    if (trimmed !== "") {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < 0 || n > 100000) {
        toast({ title: "Invalid price", description: "Enter a number between 0 and 100000.", variant: "destructive" });
        return;
      }
      next = Math.round(n * 100) / 100;
    }
    setSaving(true);
    const { error } = await supabase
      .from("transportation_trips")
      .update({ custom_price: next })
      .eq("id", trip.id);
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    setSavedValue(next);
    onSaved?.(next);
    onPatch?.(next);
    if (import.meta.env.DEV) {
      console.debug('[transport-sync][admin]', {
        booking_id: bookingId ?? null,
        trip_id: trip.id,
        displayed_price: next,
        transportation_subtotal_source: 'transportation_trips_live',
        manual_override_value: next,
      });
    }
    if (onInvalidateTransport && userId) {
      await onInvalidateTransport(bookingId, userId);
    }
    // Push the new price to Google Calendar (fire-and-forget).
    syncTripCalendar(trip.id);
    toast({ title: "Saved", description: next === null ? "Custom price cleared" : `Custom price set to €${next}` });
  };

  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        step="1"
        placeholder="€"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-8 w-24"
      />
      <Button size="sm" variant={dirty ? "default" : "outline"} disabled={saving || !dirty} onClick={save}>
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
      </Button>
      {isMissing && (
        <span className="inline-flex items-center rounded-full border border-yellow-400 bg-yellow-100 text-yellow-900 px-2 py-0.5 text-[10px] font-medium whitespace-nowrap">
          Price missing
        </span>
      )}
    </div>
  );
}

export { CustomPriceEditor };

function TripDateEditor({ trip, onSaved, onPatch }: { trip: { id: string; trip_date: string; user_id: string }; onSaved?: () => void; onPatch?: (d: string) => void }) {
  const [value, setValue] = useState<string>(trip.trip_date || "");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  // Check if guest has stay dates and compare
  const save = async (next: string) => {
    if (!next || next === trip.trip_date) return;
    setSaving(true);
    const { error } = await supabase
      .from("transportation_trips")
      .update({ trip_date: next })
      .eq("id", trip.id);
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      setValue(trip.trip_date);
      return;
    }
    toast({ title: "Trip date updated" });
    syncTripCalendar(trip.id);
    onSaved?.();
    onPatch?.(next);
  };

  return (
    <div className="flex items-center gap-1">
      <Input
        type="date"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => save(value)}
        disabled={saving}
        className="h-8 w-[150px]"
      />
      {saving && <Loader2 className="w-3 h-3 animate-spin" />}
    </div>
  );
}


function NotifyGuestButton({ userId, guestName }: { userId: string; guestName: string }) {
  const [sending, setSending] = useState(false);
  const { toast } = useToast();
  const send = async () => {
    if (!confirm(`Send updated transportation pricing email to ${guestName}?`)) return;
    setSending(true);
    const { error } = await supabase.functions.invoke("notify-transport-pricing", { body: { user_id: userId } });
    setSending(false);
    if (error) toast({ title: "Notify failed", description: error.message, variant: "destructive" });
    else toast({ title: `Notification sent to ${guestName}` });
  };
  return (
    <Button size="sm" variant="outline" onClick={send} disabled={sending}>
      {sending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Mail className="w-4 h-4 mr-1" />}
      Notify guest
    </Button>
  );
}

function RoomsView({ data, guestName }: { data: Data; guestName: (u: string) => string }) {
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => downloadCSV("rooms.csv", [
          ["Guest","Email","Queen shared","Twin shared","Queen ensuite","Twin ensuite","Remarks"],
          ...data.rooms.map((r) => [guestName(r.user_id), r.email, r.queen_shared_qty, r.twins_shared_qty, r.queen_ensuite_qty, r.twins_ensuite_qty, r.remarks_roomsetup || r.remarks || ""]),
        ])}><Download className="w-4 h-4 mr-1" />CSV</Button>
      </div>
      <div className="overflow-auto border border-border rounded-lg bg-card max-h-[70vh]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted"><tr className="text-left">
            {["Guest","Queen shared","Twin shared","Queen ensuite","Twin ensuite","Remarks"].map((h) => <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>)}
          </tr></thead>
          <tbody>
            {data.rooms.map((r, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-3 py-2">{guestName(r.user_id)}</td>
                <td className="px-3 py-2">{r.queen_shared_qty}</td>
                <td className="px-3 py-2">{r.twins_shared_qty}</td>
                <td className="px-3 py-2">{r.queen_ensuite_qty}</td>
                <td className="px-3 py-2">{r.twins_ensuite_qty}</td>
                <td className="px-3 py-2">{r.remarks_roomsetup || r.remarks || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const Admin = () => (
  <ProtectedRoute>
    <AdminGuard>
      <AdminContent />
    </AdminGuard>
  </ProtectedRoute>
);

export default Admin;

function ProfileTable({
  profiles,
  toolStatus,
  categoryOf,
  onRowClick,
  onDelete,
  showLive,
}: {
  profiles: Profile[];
  toolStatus: (uid: string) => { room: string; food: string; trip: string };
  categoryOf: (p: Profile) => "upcoming" | "past" | "live" | "none";
  onRowClick: (uid: string) => void;
  onDelete: (id: string, label: string) => void;
  showLive?: boolean;
}) {
  return (
    <div className="overflow-auto border border-border rounded-lg bg-card max-h-[70vh]">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted">
          <tr className="text-left">
            {["First","Last","Email","Check-in","Check-out","Guests","Room","Food","Transport","Status",""].map((h, i) => (
              <th key={i} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {profiles.map((p) => {
            const ts = toolStatus(p.user_id);
            const label = (p.full_name || `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || p.email);
            const isLive = showLive && categoryOf(p) === "live";
            return (
              <tr
                key={p.user_id}
                className="border-t border-border hover:bg-muted/40 cursor-pointer"
                onClick={() => onRowClick(p.user_id)}
              >
                <td className="px-3 py-2 underline-offset-2 hover:underline">
                  <span className="inline-flex items-center gap-2">
                    {p.first_name}
                    {isLive && (
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-green-100 text-green-800 border border-green-300">
                        Live
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2">{p.last_name}</td>
                <td className="px-3 py-2">{p.email}</td>
                <td className="px-3 py-2 whitespace-nowrap">{p.check_in_date}</td>
                <td className="px-3 py-2 whitespace-nowrap">{p.check_out_date}</td>
                <td className="px-3 py-2">{p.guests_count}</td>
                <td className="px-3 py-2">{ts.room}</td>
                <td className="px-3 py-2">{ts.food}</td>
                <td className="px-3 py-2">{ts.trip}</td>
                <td className="px-3 py-2"><StatusBadge checkIn={p.check_in_date} statusOverall={p.status_overall} /></td>
                <td className="px-3 py-2 text-right">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`Delete ${label}`}
                    onClick={(e) => { e.stopPropagation(); onDelete(p.user_id, label); }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PendingInvitationsSection({ bookings, onChanged }: { bookings: BookingRow[]; onChanged: () => void }) {
  const { toast } = useToast();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const inviteUrl = (token: string | null) =>
    token ? `${window.location.origin}/invite/${token}` : "";

  const copy = async (b: BookingRow) => {
    const url = inviteUrl(b.invitation_token);
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopiedId(b.id);
    toast({ title: "Invitation link copied" });
    setTimeout(() => setCopiedId((c) => (c === b.id ? null : c)), 2000);
  };

  const remove = async (b: BookingRow) => {
    if (!confirm(`Delete pending booking for ${b.email}?`)) return;
    const { error } = await supabase.from("bookings").delete().eq("id", b.id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Booking deleted" });
    onChanged();
  };

  return (
    <section className="mb-6">
      <h2 className="text-base font-medium mb-2">
        Pending invitations <span className="text-muted-foreground text-sm font-normal">({bookings.length})</span>
      </h2>
      <div className="border border-border rounded-lg bg-card overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Retreat</th>
              <th className="px-3 py-2">Guest</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Dates</th>
              <th className="px-3 py-2">Payment</th>
              <th className="px-3 py-2">Invite link</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {bookings.map((b) => {
              const name = [b.first_name, b.last_name].filter(Boolean).join(" ").trim();
              return (
                <tr key={b.id} className="border-t border-border">
                  <td className="px-3 py-2">{b.retreat_name || "—"}</td>
                  <td className="px-3 py-2">{name || "—"}</td>
                  <td className="px-3 py-2">{b.email}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {b.check_in_date || "—"} → {b.check_out_date || "—"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{b.payment_status}</td>
                  <td className="px-3 py-2">
                    {b.invitation_token ? (
                      <Button size="sm" variant="outline" onClick={() => copy(b)}>
                        {copiedId === b.id ? <Check className="w-3.5 h-3.5 mr-1" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
                        Copy link
                      </Button>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => remove(b)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

