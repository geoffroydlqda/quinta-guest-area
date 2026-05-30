import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminGuard } from "@/lib/adminGuard";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Download, RefreshCw, LogOut, Trash2, FileDown, Mail, ChevronDown, ChevronRight, Plus, Copy, Check, ExternalLink } from "lucide-react";
import { generateAirportSignPdf, resolveAirportSignNames } from "@/lib/airportSignPdf";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

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
  payment_status_override?: string | null;
  total_rental_price?: number | null;
  
};

type Installment = {
  id: string; booking_id: string; amount_due: number;
  due_date: string | null; status: string; category?: string | null;
};

interface Data {
  profiles: Profile[]; rooms: Room[]; trips: Trip[]; food: FoodPlan[];
  bookings?: BookingRow[];
}

type ResolvedPaymentStatus = "paid_in_full" | "overdue" | "deposit_paid" | "pending";

function deriveStatusFromInstallments(installments: Installment[]): ResolvedPaymentStatus {
  const rentals = installments.filter((i) => (i.category ?? "rental") === "rental");
  if (rentals.length === 0) return "pending";
  const todayIso = new Date().toISOString().slice(0, 10);
  const hasOverdue = rentals.some((i) =>
    i.status !== "paid" && i.due_date && i.due_date < todayIso
  );
  if (hasOverdue) return "overdue";
  const allPaid = rentals.every((i) => i.status === "paid");
  if (allPaid) return "paid_in_full";
  const anyPaid = rentals.some((i) => i.status === "paid");
  if (anyPaid) return "deposit_paid";
  return "pending";
}

function resolvePaymentStatus(
  booking: { payment_status_override?: string | null } | null | undefined,
  installments: Installment[]
): ResolvedPaymentStatus {
  const override = booking?.payment_status_override;
  if (override && ["paid_in_full", "overdue", "deposit_paid", "pending"].includes(override)) {
    return override as ResolvedPaymentStatus;
  }
  return deriveStatusFromInstallments(installments);
}

const PAYMENT_BADGE: Record<ResolvedPaymentStatus, { label: string; className: string }> = {
  paid_in_full: { label: "Paid", className: "bg-green-100 text-green-800 border border-green-300" },
  overdue: { label: "Overdue", className: "bg-red-100 text-red-800 border border-red-300" },
  deposit_paid: { label: "Deposit", className: "bg-amber-100 text-amber-900 border border-amber-300" },
  pending: { label: "Pending", className: "bg-muted text-muted-foreground border border-border" },
};

function PaymentBadge({ status, onClick }: { status: ResolvedPaymentStatus; onClick?: (e: React.MouseEvent) => void }) {
  const cfg = PAYMENT_BADGE[status];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${cfg.className} ${onClick ? "hover:opacity-80 cursor-pointer" : ""}`}
    >
      {cfg.label}
    </button>
  );
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
  
  const [createBookingOpen, setCreateBookingOpen] = useState(false);
  const [tab, setTab] = useState<string>("overview");

  const [installments, setInstallments] = useState<Installment[]>([]);

  const load = async (opts?: { silent?: boolean }) => {
    const silent = !!opts?.silent;
    if (!silent) setLoading(true);
    const [res, instRes] = await Promise.all([
      supabase.functions.invoke("admin-list-data"),
      supabase.from("payment_installments").select("id,booking_id,amount_due,due_date,status,category"),
    ]);
    if (res.error) {
      toast({ title: "Error", description: res.error.message, variant: "destructive" });
    } else {
      setData(res.data as Data);
    }
    if (!instRes.error && instRes.data) {
      setInstallments(instRes.data as Installment[]);
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


  // Unified event row: one entry per booking (claimed or manual).
  type EventRow = {
    bookingId: string;
    userId: string | null;
    firstName: string | null;
    lastName: string | null;
    email: string;
    checkIn: string | null;
    checkOut: string | null;
    guestsCount: number;
    statusOverall: string;
    submittedAt: string | null;
    invitationClaimed: boolean;
    invitationToken: string | null;
    paymentStatusOverride: string | null;
  };

  const events: EventRow[] = useMemo(() => {
    const list: EventRow[] = [];
    const seen = new Set<string>();
    for (const b of data?.bookings || []) {
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      // Tool status (room/food submission state) still comes from the user's profile,
      // but all displayed booking fields (names, email, dates, guest count) MUST be
      // read directly from the booking row — bookings is the single source of truth.
      const p = b.user_id ? profileById.get(b.user_id) : undefined;
      list.push({
        bookingId: b.id,
        userId: b.user_id,
        firstName: b.first_name,
        lastName: b.last_name,
        email: b.email,
        checkIn: b.check_in_date,
        checkOut: b.check_out_date,
        guestsCount: b.guest_count,
        statusOverall: p?.status_overall ?? "draft",
        submittedAt: p?.submitted_at ?? null,
        invitationClaimed: b.invitation_claimed,
        invitationToken: b.invitation_token,
        paymentStatusOverride: b.payment_status_override ?? null,
        
      });
    }
    return list;
  }, [data, profileById]);

  const categoryOfEvent = (e: EventRow): "upcoming" | "past" | "live" | "none" => {
    if (!e.checkIn) return "none";
    if (e.checkOut && e.checkOut < todayIso) return "past";
    if (e.checkIn <= todayIso && (e.checkOut ?? todayIso) >= todayIso) return "live";
    if (e.checkIn > todayIso) return "upcoming";
    return "past";
  };

  const filteredEvents = useMemo(() => {
    const s = search.toLowerCase().trim();
    return events.filter((e) => {
      if (statusFilter !== "all" && e.statusOverall !== statusFilter) return false;
      if (!s) return true;
      return (
        (e.firstName || "").toLowerCase().includes(s) ||
        (e.lastName || "").toLowerCase().includes(s) ||
        (e.email || "").toLowerCase().includes(s) ||
        `${e.firstName ?? ""} ${e.lastName ?? ""}`.toLowerCase().includes(s)
      );
    });
  }, [events, search, statusFilter]);

  const { upcomingEvents, pastEvents, unscheduledEvents } = useMemo(() => {
    const upcoming: EventRow[] = [];
    const past: EventRow[] = [];
    const none: EventRow[] = [];
    for (const e of filteredEvents) {
      const c = categoryOfEvent(e);
      if (c === "past") past.push(e);
      else if (c === "none") none.push(e);
      else upcoming.push(e); // upcoming + live
    }
    upcoming.sort((a, b) => (a.checkIn || "").localeCompare(b.checkIn || ""));
    past.sort((a, b) => (b.checkOut || "").localeCompare(a.checkOut || ""));
    return { upcomingEvents: upcoming, pastEvents: past, unscheduledEvents: none };
  }, [filteredEvents, todayIso]);

  const visibleUpcoming = useMemo(() => {
    if (categoryFilter === "past") return [];
    if (categoryFilter === "live") return upcomingEvents.filter((e) => categoryOfEvent(e) === "live");
    if (categoryFilter === "upcoming") return upcomingEvents.filter((e) => categoryOfEvent(e) === "upcoming");
    return upcomingEvents;
  }, [upcomingEvents, categoryFilter, todayIso]);

  const visiblePast = useMemo(() => {
    if (categoryFilter === "upcoming" || categoryFilter === "live") return [];
    return pastEvents;
  }, [pastEvents, categoryFilter]);

  const visibleUnscheduled = categoryFilter === "all" ? unscheduledEvents : [];

  const toolStatus = (uid: string | null) => {
    if (!uid) return { room: "—", trip: "—", food: "—" };
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

  const installmentsByBooking = useMemo(() => {
    const m = new Map<string, Installment[]>();
    for (const i of installments) {
      const arr = m.get(i.booking_id) || [];
      arr.push(i);
      m.set(i.booking_id, arr);
    }
    return m;
  }, [installments]);

  const navigateToBooking = (bookingId: string) => {
    navigate(`/admin/guest/${bookingId}?bookingId=${bookingId}`);
  };

  const paymentForEvent = (e: EventRow): ResolvedPaymentStatus => {
    const inst = installmentsByBooking.get(e.bookingId) || [];
    return resolvePaymentStatus({ payment_status_override: e.paymentStatusOverride }, inst);
  };

  const deleteBookingDirect = async (bookingId: string, _label: string) => {
    const ok = confirm(
      "Delete this booking and all its data (rooms, food, transport, payments)?\n\nThe guest's account and other bookings are kept."
    );
    if (!ok) return;
    const res = await supabase.functions.invoke("admin-delete-guest", {
      body: { booking_id: bookingId },
    });
    if (res.error || (res.data && (res.data as any).error)) {
      const msg = (res.data as any)?.error || res.error?.message || "Delete failed";
      toast({ title: "Delete failed", description: String(msg), variant: "destructive" });
      return;
    }
    setData((d) => d ? { ...d, bookings: (d.bookings || []).filter((b) => b.id !== bookingId) } : d);
    toast({ title: "Booking deleted" });
    load({ silent: true });
  };

  const claimBookingAsAdmin = async (bookingId: string) => {
    const ok = confirm(
      "Attach this booking to your admin account so you can edit Room / Food / Transportation as the guest?\n\nYou can release it later from the guest detail page."
    );
    if (!ok) return;
    const res = await supabase.functions.invoke("admin-claim-booking", {
      body: { booking_id: bookingId },
    });
    if (res.error || (res.data && (res.data as any).error)) {
      const msg = (res.data as any)?.error || res.error?.message || "Claim failed";
      toast({ title: "Claim failed", description: String(msg), variant: "destructive" });
      return;
    }
    toast({ title: "Booking attached to your account" });
    load({ silent: true });
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
            <TabsTrigger value="payments">Payments</TabsTrigger>
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
                ["First name","Last name","Email","Check-in","Check-out","Guests","Room","Food","Transport","Status","Submitted at","Claimed"],
                ...filteredEvents.map((e) => {
                  const ts = toolStatus(e.userId);
                  return [e.firstName||"", e.lastName||"", e.email, e.checkIn||"", e.checkOut||"", e.guestsCount, ts.room, ts.food, ts.trip, e.statusOverall, e.submittedAt||"", e.invitationClaimed ? "yes" : "no"];
                }),
              ])}><Download className="w-4 h-4 mr-1" />CSV</Button>
            </div>

            {(categoryFilter === "all" || categoryFilter === "live" || categoryFilter === "upcoming") && (
              <section className="mb-6">
                <h2 className="text-base font-medium mb-2">Upcoming events <span className="text-muted-foreground text-sm font-normal">({visibleUpcoming.length})</span></h2>
                {visibleUpcoming.length === 0 ? (
                  <div className="border border-border rounded-lg bg-card p-6 text-sm text-muted-foreground text-center">No upcoming events.</div>
                ) : (
                  <EventTable
                    events={visibleUpcoming}
                    toolStatus={toolStatus}
                    categoryOf={categoryOfEvent}
                    paymentForEvent={paymentForEvent}
                    onRowClick={(bookingId) => navigateToBooking(bookingId)}
                    onDeleteBooking={deleteBookingDirect}
                    onClaimAsMe={claimBookingAsAdmin}
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
                    <EventTable
                      events={visiblePast}
                      toolStatus={toolStatus}
                      categoryOf={categoryOfEvent}
                      paymentForEvent={paymentForEvent}
                      onRowClick={(bookingId) => navigateToBooking(bookingId)}
                      onDeleteBooking={deleteBookingDirect}
                    onClaimAsMe={claimBookingAsAdmin}
                    />
                  )
                )}
              </section>
            )}

            {visibleUnscheduled.length > 0 && (
              <section className="mb-6">
                <h2 className="text-base font-medium mb-2">No dates set <span className="text-muted-foreground text-sm font-normal">({visibleUnscheduled.length})</span></h2>
                <EventTable
                  events={visibleUnscheduled}
                  toolStatus={toolStatus}
                  categoryOf={categoryOfEvent}
                  paymentForEvent={paymentForEvent}
                  onRowClick={(bookingId) => navigateToBooking(bookingId)}
                  onDeleteBooking={deleteBookingDirect}
                    onClaimAsMe={claimBookingAsAdmin}
                />
              </section>
            )}
          </TabsContent>

          <TabsContent value="payments">
            <PaymentsView
              bookings={data.bookings || []}
              installments={installments}
              guestName={(uid) => uid ? guestName(uid) : ""}
              onOpen={navigateToBooking}
            />
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


      <CreateBookingDialog
        open={createBookingOpen}
        onOpenChange={setCreateBookingOpen}
        onCreated={load}
      />
    </div>
  );
};

function PaymentsView({
  bookings,
  installments,
  guestName,
  onOpen,
}: {
  bookings: BookingRow[];
  installments: Installment[];
  guestName: (uid: string | null) => string;
  onOpen: (bookingId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"check_in" | "status">("check_in");

  const instByBooking = useMemo(() => {
    const m = new Map<string, Installment[]>();
    for (const i of installments) {
      const arr = m.get(i.booking_id) || [];
      arr.push(i);
      m.set(i.booking_id, arr);
    }
    return m;
  }, [installments]);

  type Row = {
    booking: BookingRow;
    name: string;
    total: number;
    accomPaid: number;
    accomRemaining: number;
    extrasTotal: number;
    extrasPaid: number;
    status: ResolvedPaymentStatus;
  };

  const rows: Row[] = useMemo(() => {
    return bookings.map((b) => {
      const inst = instByBooking.get(b.id) || [];
      const rentals = inst.filter((i) => (i.category ?? "rental") === "rental");
      const extras = inst.filter((i) => i.category === "extra");
      const accomPaid = rentals
        .filter((i) => i.status === "paid")
        .reduce((s, i) => s + Number(i.amount_due || 0), 0);
      const extrasTotal = extras.reduce((s, i) => s + Number(i.amount_due || 0), 0);
      const extrasPaid = extras
        .filter((i) => i.status === "paid")
        .reduce((s, i) => s + Number(i.amount_due || 0), 0);
      const total = Number(b.total_rental_price || 0);
      const name = b.user_id
        ? guestName(b.user_id)
        : `${b.first_name ?? ""} ${b.last_name ?? ""}`.trim() || b.email;
      return {
        booking: b,
        name,
        total,
        accomPaid,
        accomRemaining: Math.max(0, total - accomPaid),
        extrasTotal,
        extrasPaid,
        status: resolvePaymentStatus({ payment_status_override: b.payment_status_override }, inst),
      };
    });
  }, [bookings, instByBooking, guestName]);

  const filtered = useMemo(() => {
    const s = search.toLowerCase().trim();
    let list = rows.filter((r) => {
      if (!s) return true;
      return (
        r.name.toLowerCase().includes(s) ||
        (r.booking.email || "").toLowerCase().includes(s) ||
        (r.booking.retreat_name || "").toLowerCase().includes(s)
      );
    });
    if (sortBy === "check_in") {
      list = [...list].sort((a, b) => (a.booking.check_in_date || "").localeCompare(b.booking.check_in_date || ""));
    } else {
      const order: Record<ResolvedPaymentStatus, number> = { overdue: 0, pending: 1, deposit_paid: 2, paid_in_full: 3 };
      list = [...list].sort((a, b) => order[a.status] - order[b.status]);
    }
    return list;
  }, [rows, search, sortBy]);

  const totals = useMemo(() => {
    let expected = 0, collected = 0;
    for (const r of rows) {
      expected += r.total;
      collected += r.accomPaid + r.extrasPaid;
    }
    return { expected, collected, outstanding: Math.max(0, expected - collected) };
  }, [rows]);

  const fmt = (n: number) => `€${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input placeholder="Search name, email or retreat" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} className="border border-border rounded-md px-3 py-2 text-sm bg-background">
          <option value="check_in">Sort by check-in</option>
          <option value="status">Sort by status</option>
        </select>
      </div>

      <div className="overflow-x-auto border border-border rounded-md bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Retreat / Guest</th>
              <th className="px-3 py-2 font-medium">Check-in</th>
              <th className="px-3 py-2 font-medium text-right">Total</th>
              <th className="px-3 py-2 font-medium text-right">Accom. paid</th>
              <th className="px-3 py-2 font-medium text-right">Accom. remaining</th>
              <th className="px-3 py-2 font-medium text-right">Extras total</th>
              <th className="px-3 py-2 font-medium text-right">Extras paid</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">No bookings</td></tr>
            ) : filtered.map((r) => (
              <tr
                key={r.booking.id}
                onClick={() => onOpen(r.booking.id)}
                className="border-t border-border hover:bg-muted/40 cursor-pointer"
              >
                <td className="px-3 py-2">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-muted-foreground">{r.booking.retreat_name || "—"} · {r.booking.email}</div>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{r.booking.check_in_date || "—"}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">{r.total > 0 ? fmt(r.total) : "—"}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">{fmt(r.accomPaid)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">{fmt(r.accomRemaining)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">{fmt(r.extrasTotal)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">{fmt(r.extrasPaid)}</td>
                <td className="px-3 py-2"><PaymentBadge status={r.status} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-muted/30 font-medium">
              <td className="px-3 py-2" colSpan={2}>Totals ({filtered.length} bookings)</td>
              <td className="px-3 py-2 text-right whitespace-nowrap">{fmt(totals.expected)}</td>
              <td className="px-3 py-2 text-right whitespace-nowrap" colSpan={2}>
                <span className="text-muted-foreground">Collected:</span> {fmt(totals.collected)}
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap" colSpan={2}>
                <span className="text-muted-foreground">Outstanding:</span> {fmt(totals.outstanding)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

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
          const hasSubtotal = g.cost.subtotal > 0;
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
                  {hasSubtotal && <span className="font-medium text-foreground">Total: €{g.cost.subtotal}</span>}
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

type EventRowProps = {
  bookingId: string;
  userId: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string;
  checkIn: string | null;
  checkOut: string | null;
  guestsCount: number;
  statusOverall: string;
  submittedAt: string | null;
  invitationClaimed: boolean;
  invitationToken: string | null;
  paymentStatusOverride: string | null;
  
};

function EventTable({
  events,
  toolStatus,
  categoryOf,
  paymentForEvent,
  onRowClick,
  onDeleteBooking,
  onClaimAsMe,
  showLive,
}: {
  events: EventRowProps[];
  toolStatus: (uid: string | null) => { room: string; food: string; trip: string };
  categoryOf: (e: EventRowProps) => "upcoming" | "past" | "live" | "none";
  paymentForEvent: (e: EventRowProps) => ResolvedPaymentStatus;
  onRowClick: (bookingId: string) => void;
  onDeleteBooking: (bookingId: string, email: string) => void;
  onClaimAsMe: (bookingId: string) => void;
  showLive?: boolean;
}) {
  const { toast } = useToast();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyInvite = async (e: React.MouseEvent, token: string | null, bookingId: string) => {
    e.stopPropagation();
    let t = token;
    if (!t) {
      const { data, error } = await supabase.functions.invoke("admin-generate-invite-token", {
        body: { booking_id: bookingId },
      });
      if (error || !data?.token) {
        toast({ title: "Could not generate invite", description: error?.message || data?.error || "Unknown error", variant: "destructive" });
        return;
      }
      t = data.token;
    }
    const url = `${window.location.origin}/invite/${t}`;
    await navigator.clipboard.writeText(url);
    setCopiedId(bookingId);
    toast({ title: "Invite link copied" });
    setTimeout(() => setCopiedId((c) => (c === bookingId ? null : c)), 2000);
  };

  return (
    <div className="overflow-auto border border-border rounded-lg bg-card max-h-[70vh]">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted">
          <tr className="text-left">
            {["First","Last","Email","Check-in","Check-out","Guests","Room","Food","Transport","Status","Payment","Invite",""].map((h, i) => (
              <th key={i} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {events.map((ev) => {
            const ts = toolStatus(ev.userId);
            const label = (`${ev.firstName ?? ""} ${ev.lastName ?? ""}`.trim() || ev.email);
            const isLive = showLive && categoryOf(ev) === "live";
            const payStatus = paymentForEvent(ev);
            const canCopyInvite = !ev.invitationClaimed;
            return (
              <tr
                key={ev.bookingId}
                className="border-t border-border hover:bg-muted/40 cursor-pointer"
                onClick={() => onRowClick(ev.bookingId)}
              >
                <td className="px-3 py-2 underline-offset-2 hover:underline">
                  <span className="inline-flex items-center gap-2">
                    {ev.firstName}
                    {isLive && (
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-green-100 text-green-800 border border-green-300">
                        Live
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2">{ev.lastName}</td>
                <td className="px-3 py-2">{ev.email}</td>
                <td className="px-3 py-2 whitespace-nowrap">{ev.checkIn}</td>
                <td className="px-3 py-2 whitespace-nowrap">{ev.checkOut}</td>
                <td className="px-3 py-2">{ev.guestsCount}</td>
                <td className="px-3 py-2">{ts.room}</td>
                <td className="px-3 py-2">{ts.food}</td>
                <td className="px-3 py-2">{ts.trip}</td>
                <td className="px-3 py-2"><StatusBadge checkIn={ev.checkIn} statusOverall={ev.statusOverall} /></td>
                <td className="px-3 py-2">
                  <PaymentBadge
                    status={payStatus}
                    onClick={(e) => { e.stopPropagation(); onRowClick(ev.bookingId); }}
                  />
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {ev.invitationClaimed ? (
                    <span className="text-xs text-muted-foreground">Claimed</span>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" variant="outline" onClick={(e) => copyInvite(e, ev.invitationToken, ev.bookingId)}>
                        {copiedId === ev.bookingId ? <Check className="w-3.5 h-3.5 mr-1" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
                        Copy invite link
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => { e.stopPropagation(); onClaimAsMe(ev.bookingId); }}
                        title="Attach this booking to your admin account"
                      >
                        Claim as me
                      </Button>
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`Delete ${label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteBooking(ev.bookingId, ev.email);
                    }}

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




