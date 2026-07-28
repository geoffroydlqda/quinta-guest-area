import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminGuard } from "@/lib/adminGuard";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Download, RefreshCw, Trash2, FileDown, Mail, ChevronDown, ChevronLeft, ChevronRight, Plus, Copy, Check, ExternalLink, Pencil, Phone, MapPin, Globe2, ReceiptText } from "lucide-react";
import { generateAirportSignPdf, resolveAirportSignNames } from "@/lib/airportSignPdf";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { useToast } from "@/hooks/use-toast";

import { CreateBookingDialog } from "@/components/admin/CreateBookingDialog";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { MonthlyRevenueChart, OccupancyChart } from "@/components/admin/DashboardCharts";
import { PaymentsPage } from "@/components/admin/PaymentsPage";
import { renderRoomMapCanvas, downloadRoomMapPdf, type RoomMapEntry } from "@/lib/roomMapPdf";
import roomsArrangement from "@/assets/rooms-arrangement_floor-plan.jpg";
import { PaymentRemindersCard } from "@/components/admin/PaymentRemindersCard";
import { getGuestStatus, type GuestStatusKind } from "@/lib/editLock";
import { syncTripCalendar, backfillTripCalendars, forceResyncTripCalendars } from "@/lib/calendarSync";
import { CalendarCheck, AlertTriangle } from "lucide-react";
import { calculateTransportationCost } from "@/lib/transportationPricing";
import { getDietPricing } from "@/lib/pricing";
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

type Room = { user_id: string; booking_id?: string | null; email: string; queen_shared_qty: number; twins_shared_qty: number; queen_ensuite_qty: number; twins_ensuite_qty: number; remarks_roomsetup: string | null; remarks: string | null; status_roomsetup: string };
type Passenger = { id: string; first_name: string; last_name?: string | null; phone: string | null; flight_number: string | null };
type Trip = { id: string; user_id: string; booking_id?: string | null; trip_direction: string; pickup_location: string; dropoff_location: string; trip_date: string; trip_time: string; passengers_count: number; taxi_size: string; price_estimate: string; custom_price: number | null; google_calendar_event_id?: string | null; sync_status?: string | null; last_synced_at?: string | null; sync_error?: string | null; passengers?: Passenger[] };
type FoodPlan = { user_id: string; booking_id?: string | null; selections: any; diet_preference: string | null; status_food: string };

type BookingRow = {
  id: string; retreat_name: string; first_name: string | null; last_name: string | null;
  email: string; guest_count: number;
  check_in_date: string | null; check_out_date: string | null;
  payment_status: string; invitation_token: string | null; invitation_claimed: boolean;
  user_id: string | null; created_at: string;
  payment_status_override?: string | null;
  total_rental_price?: number | null;
  event_type?: string | null;
  catering_expected?: boolean | null;
  client_id?: string | null;
  check_in_time?: string | null;
  check_out_time?: string | null;
  google_calendar_event_id?: string | null;
};

const EVENT_TYPE_LABEL: Record<string, string> = {
  retreat: "Retreat", wedding: "Wedding", other: "Other", day_retreat: "Day",
};

type Installment = {
  id: string; booking_id: string; label?: string | null; amount_due: number;
  amount_excl_vat?: number | null;
  due_date: string | null; status: string; category?: string | null;
  invoice_file_url?: string | null; invoice_file_name?: string | null;
  payment_link?: string | null;
  is_cash?: boolean;
};

const SECTION_TITLES: Record<string, string> = {
  dashboard: "Dashboard",
  bookings: "Bookings",
  guests: "Guests",
  payments: "Payments",
  catering: "Catering",
  transportation: "Transportation",
  rooms: "Room setup",
};

const fmtShort = (d: string | null) =>
  d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—";

const fmtMoney = (v: number) =>
  `${v < 0 ? "−" : ""}€${Math.abs(v).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

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
  const { section } = useParams<{ section?: string }>();
  // "users" est l'ancien nom de l'onglet Guests — on garde la redirection.
  const normalizedSection = section === "users" ? "guests" : section;
  const view = normalizedSection && SECTION_TITLES[normalizedSection] ? normalizedSection : "dashboard";

  const [installments, setInstallments] = useState<Installment[]>([]);

  const load = async (opts?: { silent?: boolean }) => {
    const silent = !!opts?.silent;
    if (!silent) setLoading(true);
    const [res, instRes] = await Promise.all([
      supabase.functions.invoke("admin-list-data"),
      supabase.from("payment_installments").select("id,booking_id,label,amount_due,amount_excl_vat,due_date,status,category,invoice_file_url,invoice_file_name,payment_link,is_cash"),
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
    eventType: string;
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
        eventType: b.event_type ?? "retreat",
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

  const toolStatus = (uid: string | null, bookingId?: string | null) => {
    const matchRoom = (r: any) =>
      (bookingId && r.booking_id === bookingId) || (uid && r.user_id === uid);
    const matchTrip = (t: any) =>
      (bookingId && t.booking_id === bookingId) || (uid && t.user_id === uid);
    const matchFood = (f: any) =>
      (bookingId && f.booking_id === bookingId) || (uid && f.user_id === uid);
    const room = data?.rooms.find(matchRoom);
    const trip = data?.trips.find(matchTrip);
    const food = data?.food.find(matchFood);
    const hasFood = food?.selections && Array.isArray(food.selections) &&
      (food.selections as any[]).some((s: any) => s.fullBoard || s.breakfast || s.lunch || s.dinner);
    return {
      room: room ? (room.status_roomsetup || "draft") : "—",
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

  const setEventTypeDirect = async (bookingId: string, v: string) => {
    const { error } = await supabase.from("bookings").update({ event_type: v } as any).eq("id", bookingId);
    if (error) {
      toast({ title: "Could not save event type", description: error.message, variant: "destructive" });
      return;
    }
    setData((d) =>
      d ? { ...d, bookings: (d.bookings || []).map((b) => b.id === bookingId ? { ...b, event_type: v } : b) } : d
    );
  };

  const renameBookingDirect = async (
    bookingId: string,
    patch: { first_name?: string | null; last_name?: string | null }
  ) => {
    const { error } = await supabase.from("bookings").update(patch).eq("id", bookingId);
    if (error) {
      toast({ title: "Could not save name", description: error.message, variant: "destructive" });
      return;
    }
    setData((d) =>
      d
        ? {
            ...d,
            bookings: (d.bookings || []).map((b) =>
              b.id === bookingId ? { ...b, ...patch } : b
            ),
          }
        : d
    );
    toast({ title: "Saved" });
  };



  if (loading || !data) {
    return (
      <AdminLayout>
        <div className="min-h-[60vh] flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <main className="px-4 md:px-6 py-6 max-w-[1400px]">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
          <h1 className="text-xl font-semibold">{SECTION_TITLES[view]}</h1>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setCreateBookingOpen(true)}>
              <Plus className="w-4 h-4 mr-1" />New booking
            </Button>
            <Button size="sm" variant="outline" onClick={() => load()}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
            {view === "bookings" && (
              <Button size="sm" variant="outline" onClick={sync} disabled={syncing}>
                {syncing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                Sync to Google Sheets
              </Button>
            )}
          </div>
        </div>

        {view === "dashboard" && (
          <DashboardView
            data={data}
            installments={installments}
            events={events}
            categoryOf={categoryOfEvent}
            todayIso={todayIso}
            onOpen={navigateToBooking}
          />
        )}

        {view === "guests" && (
          <GuestsView bookings={data.bookings || []} installments={installments} onOpen={navigateToBooking} onReload={() => load({ silent: true })} />
        )}

        {view === "catering" && (
          <CateringView bookings={data.bookings || []} todayIso={todayIso} onOpen={navigateToBooking} />
        )}

        {view === "bookings" && (
          <div>
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
                  const ts = toolStatus(e.userId, e.bookingId);
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
                    onRenameBooking={renameBookingDirect}
                    onSetEventType={setEventTypeDirect}
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
                    onRenameBooking={renameBookingDirect}
                    onSetEventType={setEventTypeDirect}
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
                    onRenameBooking={renameBookingDirect}
                    onSetEventType={setEventTypeDirect}
                />
              </section>
            )}
          </div>
        )}

        {view === "payments" && (
          <div>
            <PaymentRemindersCard />
            <PaymentsPage
              bookings={data.bookings || []}
              installments={installments}
              onReload={() => load({ silent: true })}
              onOpen={navigateToBooking}
            />
          </div>
        )}

        {view === "transportation" && (
          <TransportView data={data} guestName={guestName} onTripPatched={patchTrip} onReload={() => load({ silent: true })} onInvalidateTransport={(bookingId, userId) => Promise.all([
            queryClient.invalidateQueries({ queryKey: ['transportation_trips', bookingId ?? userId] }),
            queryClient.invalidateQueries({ queryKey: ['booking_summary', bookingId ?? userId] }),
            queryClient.invalidateQueries({ queryKey: ['guest_overview', bookingId ?? userId] }),
            queryClient.invalidateQueries({ queryKey: ['booking_totals', bookingId ?? userId] }),
          ]).then(() => undefined)} />
        )}

        {view === "rooms" && <RoomsView data={data} onOpen={navigateToBooking} />}
      </main>

      <CreateBookingDialog
        open={createBookingOpen}
        onOpenChange={setCreateBookingOpen}
        onCreated={load}
      />
    </AdminLayout>
  );
};

// ------------------------------------------------------- Booking calendar
// Vue mensuelle maison : une barre par booking (nom de l'événement), couleurs
// par type, clic → fiche booking. Reflète la table bookings (source de vérité).
const EVENT_TYPE_COLOR: Record<string, string> = {
  retreat: "#57761f", wedding: "#2a78d6", other: "#c2622f", day_retreat: "#8a6a2f",
};

function BookingCalendar({ bookings, todayIso, onOpen }: {
  bookings: BookingRow[];
  todayIso: string;
  onOpen: (bookingId: string) => void;
}) {
  const [month, setMonth] = useState(() => todayIso.slice(0, 7)); // "YYYY-MM"
  const [yy, mm] = month.split("-").map(Number);

  const shift = (delta: number) => {
    const d = new Date(yy, mm - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  // Semaines du mois (lundi → dimanche), avec débordement sur les mois voisins.
  const weeks = useMemo(() => {
    const first = new Date(yy, mm - 1, 1);
    const start = new Date(first);
    start.setDate(1 - ((first.getDay() + 6) % 7));
    const out: Date[][] = [];
    const cur = new Date(start);
    do {
      const week: Date[] = [];
      for (let i = 0; i < 7; i++) { week.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }
      out.push(week);
    } while (cur.getMonth() === mm - 1 && cur.getFullYear() === yy);
    return out;
  }, [yy, mm]);

  const monthLabel = new Date(yy, mm - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  const eventName = (b: BookingRow) =>
    b.retreat_name || `${b.first_name ?? ""} ${b.last_name ?? ""}`.trim() || b.email;

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="font-medium text-sm">Booking calendar</div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => shift(-1)} className="w-7 h-7 rounded-md border border-border hover:bg-muted flex items-center justify-center" aria-label="Previous month"><ChevronLeft className="w-4 h-4" /></button>
          <span className="text-sm font-medium w-36 text-center">{monthLabel}</span>
          <button type="button" onClick={() => shift(1)} className="w-7 h-7 rounded-md border border-border hover:bg-muted flex items-center justify-center" aria-label="Next month"><ChevronRight className="w-4 h-4" /></button>
          <button type="button" onClick={() => setMonth(todayIso.slice(0, 7))} className="ml-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted">Today</button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="px-1.5">{d}</div>)}
      </div>
      <div className="space-y-px">
        {weeks.map((week, wi) => {
          const wStart = iso(week[0]);
          const wEnd = iso(week[6]);
          // Segments des bookings qui touchent cette semaine (check-out inclus).
          type Seg = { b: BookingRow; s: number; e: number; startsHere: boolean; lane: number };
          const segs: Seg[] = [];
          for (const b of bookings) {
            if (!b.check_in_date || !b.check_out_date) continue;
            if (b.check_in_date > wEnd || b.check_out_date < wStart) continue;
            const s = b.check_in_date <= wStart ? 0 : week.findIndex((d) => iso(d) === b.check_in_date);
            const e = b.check_out_date >= wEnd ? 6 : week.findIndex((d) => iso(d) === b.check_out_date);
            if (s === -1 || e === -1) continue;
            segs.push({ b, s, e, startsHere: b.check_in_date >= wStart, lane: 0 });
          }
          segs.sort((a, b) => a.s - b.s || b.e - a.e);
          const laneEnds: number[] = [];
          for (const seg of segs) {
            let lane = laneEnds.findIndex((end) => end < seg.s);
            if (lane === -1) { lane = laneEnds.length; laneEnds.push(seg.e); }
            else laneEnds[lane] = seg.e;
            seg.lane = lane;
          }
          const lanes = Math.min(3, Math.max(1, laneEnds.length));
          return (
            <div key={wi} className="relative">
              <div className="grid grid-cols-7 gap-px">
                {week.map((d, di) => {
                  const inMonth = d.getMonth() === mm - 1;
                  const isToday = iso(d) === todayIso;
                  return (
                    <div key={di} className={`rounded-sm px-1.5 pt-1 ${inMonth ? "bg-muted/40" : "bg-muted/10"}`} style={{ height: `${26 + lanes * 24}px` }}>
                      <span className={`inline-flex items-center justify-center text-[11px] w-5 h-5 rounded-full ${isToday ? "bg-primary text-primary-foreground font-semibold" : inMonth ? "text-foreground" : "text-muted-foreground/50"}`}>
                        {d.getDate()}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="absolute left-0 right-0 top-[26px] grid grid-cols-7 gap-px pointer-events-none">
                {segs.filter((seg) => seg.lane < 3).map((seg) => (
                  <button
                    key={seg.b.id + wi}
                    type="button"
                    onClick={() => onOpen(seg.b.id)}
                    title={`${eventName(seg.b)} · ${seg.b.check_in_date} → ${seg.b.check_out_date}`}
                    className="pointer-events-auto text-left text-[11px] leading-none text-white px-1.5 h-[20px] flex items-center truncate hover:opacity-85"
                    style={{
                      gridColumn: `${seg.s + 1} / ${seg.e + 2}`,
                      gridRow: 1,
                      marginTop: `${seg.lane * 24}px`,
                      background: EVENT_TYPE_COLOR[seg.b.event_type ?? "retreat"] ?? EVENT_TYPE_COLOR.retreat,
                      borderRadius: seg.startsHere && (seg.b.check_out_date! <= wEnd) ? "6px" : seg.startsHere ? "6px 2px 2px 6px" : (seg.b.check_out_date! <= wEnd) ? "2px 6px 6px 2px" : "2px",
                    }}
                  >
                    <span className="truncate">{(seg.startsHere || seg.s === 0) ? eventName(seg.b) : ""}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-4 mt-3 text-[11px] text-muted-foreground flex-wrap">
        {Object.entries(EVENT_TYPE_COLOR).map(([k, c]) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: c }} />
            {EVENT_TYPE_LABEL[k]}
          </span>
        ))}
        <a
          className="ml-auto underline hover:text-foreground"
          href="https://calendar.google.com/calendar/u/1?cid=Y18yNGY1NmEwZTgxYjY4OWVkMjk0MDU0NjdiZDJjMWRhZDg2ZTA0MWE5NWVlNWEyNGExMTU2YjE0ZWRlZWNiMzA0QGdyb3VwLmNhbGVuZGFyLmdvb2dsZS5jb20"
          target="_blank" rel="noreferrer"
        >
          Open in Google Calendar
        </a>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- Dashboard
function DashboardView({
  data, installments, events, categoryOf, todayIso, onOpen,
}: {
  data: Data;
  installments: Installment[];
  events: { bookingId: string; firstName: string | null; lastName: string | null; email: string; checkIn: string | null; checkOut: string | null; guestsCount: number }[];
  categoryOf: (e: any) => "upcoming" | "past" | "live" | "none";
  todayIso: string;
  onOpen: (bookingId: string) => void;
}) {
  const bookings = data.bookings || [];
  const bookingById = useMemo(() => new Map(bookings.map((b) => [b.id, b])), [bookings]);
  const years = useMemo(() => {
    const ys = new Set<string>();
    for (const b of bookings) if (b.check_in_date) ys.add(b.check_in_date.slice(0, 4));
    return [...ys].sort();
  }, [bookings]);
  const currentYear = todayIso.slice(0, 4);
  const [year, setYear] = useState(currentYear);
  useEffect(() => {
    if (years.length && !years.includes(year)) setYear(years.includes(currentYear) ? currentYear : years[years.length - 1]);
  }, [years, year, currentYear]);

  const eventName = (bookingId: string) => {
    const b = bookingById.get(bookingId);
    if (!b) return "Unknown";
    return b.retreat_name || `${b.first_name ?? ""} ${b.last_name ?? ""}`.trim() || b.email;
  };

  const kpis = useMemo(() => {
    const thisYear = installments.filter((i) =>
      (bookingById.get(i.booking_id)?.check_in_date || "").startsWith(year)
    );
    const contracted = thisYear.reduce((s, i) => s + Number(i.amount_due || 0), 0);
    // Même règle que la carte "Revenue vs target" : HT manquant estimé
    // (13 % catering, 23 % ailleurs) pour que les deux chiffres concordent.
    const contractedHt = thisYear.reduce((s, i) =>
      s + (i.amount_excl_vat != null
        ? Number(i.amount_excl_vat)
        : Number(i.amount_due || 0) / (i.category === "catering" ? 1.13 : 1.23)), 0);
    const collected = thisYear.filter((i) => i.status === "paid").reduce((s, i) => s + Number(i.amount_due || 0), 0);
    const overdue = installments.filter((i) => i.status !== "paid" && i.due_date && i.due_date < todayIso);
    const overdueTotal = overdue.reduce((s, i) => s + Number(i.amount_due || 0), 0);
    const outstanding = installments.filter((i) => i.status !== "paid").reduce((s, i) => s + Number(i.amount_due || 0), 0);

    return {
      contracted, contractedHt, collected, overdueTotal, outstanding,
      overdueCount: overdue.length,
    };
  }, [installments, bookingById, todayIso, year]);

  const charts = useMemo(() => {
    const rev = Array.from({ length: 12 }, () => ({ rental: 0, catering: 0, extra: 0, collected: 0 }));
    for (const i of installments) {
      const ci = bookingById.get(i.booking_id)?.check_in_date || "";
      if (!ci.startsWith(year)) continue;
      const m = Number(ci.slice(5, 7)) - 1;
      if (m < 0 || m > 11) continue;
      const cat = i.category === "catering" ? "catering" : i.category === "extra" ? "extra" : "rental";
      const amount = Number(i.amount_due || 0);
      rev[m][cat] += amount;
      if (i.status === "paid") rev[m].collected += amount;
    }
    const yNum = Number(year);
    const occupied: Set<string>[] = Array.from({ length: 12 }, () => new Set());
    for (const b of bookings) {
      if (!b.check_in_date || !b.check_out_date) continue;
      const d = new Date(`${b.check_in_date}T12:00:00`);
      const end = new Date(`${b.check_out_date}T12:00:00`);
      while (d < end) {
        if (d.getFullYear() === yNum) occupied[d.getMonth()].add(d.toISOString().slice(0, 10));
        d.setDate(d.getDate() + 1);
        if (d.getFullYear() > yNum) break;
      }
    }
    const occ = occupied.map((s, m) => ({ nights: s.size, days: new Date(yNum, m + 1, 0).getDate() }));
    return { rev, occ };
  }, [installments, bookings, bookingById, year]);

  // Objectifs P&L + saison d'exploitation (app_settings key='targets')
  type TargetsCfg = Record<string, { net_revenue?: number; rental?: number; catering?: number; extras?: number; season_start?: string; season_end?: string }>;
  const [targets, setTargets] = useState<TargetsCfg | null>(null);
  useEffect(() => {
    supabase.from("app_settings").select("value").eq("key", "targets").maybeSingle()
      .then(({ data }) => setTargets((data?.value as TargetsCfg) ?? null));
  }, []);

  const seasonStats = useMemo(() => {
    const cfg = targets?.[year];
    const start = cfg?.season_start ?? `${year}-05-01`;
    const end = cfg?.season_end ?? `${year}-11-01`;
    const s = new Date(`${start}T12:00:00`);
    const e = new Date(`${end}T12:00:00`);
    const totalNights = Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000));
    const occupied = new Set<string>();
    for (const b of bookings) {
      if (!b.check_in_date || !b.check_out_date) continue;
      const d = new Date(`${b.check_in_date}T12:00:00`);
      const endB = new Date(`${b.check_out_date}T12:00:00`);
      while (d < endB) {
        if (d >= s && d < e) occupied.add(d.toISOString().slice(0, 10));
        if (d > e) break;
        d.setDate(d.getDate() + 1);
      }
    }
    // Nuit de turnaround : la nuit du jour de check-out est bloquée (ménage,
    // pas de check-in le même jour) — comptée seulement si elle est dans la
    // saison et pas déjà occupée par un autre séjour.
    const turnaround = new Set<string>();
    for (const b of bookings) {
      if (!b.check_out_date) continue;
      const d = new Date(`${b.check_out_date}T12:00:00`);
      const iso = d.toISOString().slice(0, 10);
      if (d >= s && d < e && !occupied.has(iso)) turnaround.add(iso);
    }
    const inSeasonMonths = Array.from({ length: 12 }, (_, m) => {
      const mid = new Date(Number(year), m, 15, 12);
      return mid >= s && mid < e;
    });
    return {
      start, end, totalNights,
      nights: occupied.size,
      pct: (occupied.size / totalNights) * 100,
      turnaround: turnaround.size,
      pctBlocked: ((occupied.size + turnaround.size) / totalNights) * 100,
      inSeasonMonths,
    };
  }, [bookings, year, targets]);

  const targetStats = useMemo(() => {
    const cfg = targets?.[year];
    if (!cfg?.net_revenue) return null;
    // CA contracté HT de l'année, ventilé rental / catering / extras, vs P&L.
    // HT manquant : estimation à TVA 23 % (13 % pour le catering — taux food PT).
    const actual = { rental: 0, catering: 0, extra: 0 };
    for (const i of installments) {
      const ci = bookingById.get(i.booking_id)?.check_in_date || "";
      if (!ci.startsWith(year)) continue;
      const cat = i.category === "catering" ? "catering" : i.category === "extra" ? "extra" : "rental";
      const vat = cat === "catering" ? 1.13 : 1.23;
      actual[cat] += i.amount_excl_vat != null ? Number(i.amount_excl_vat) : Number(i.amount_due || 0) / vat;
    }
    // Catering ATTENDU (projection) : retraites pas encore commencées, sans
    // catering validé — 14 participants × prix moyen des 3 formules :
    // dîner le jour d'arrivée + full board les jours pleins + petit-déj au départ.
    const dp = getDietPricing();
    const avg = {
      fullBoard: (dp.vegetarian.fullBoard + dp.meat_dinner.fullBoard + dp.meat_lunch_dinner.fullBoard) / 3,
      dinner: (dp.vegetarian.dinner + dp.meat_dinner.dinner + dp.meat_lunch_dinner.dinner) / 3,
      breakfast: (dp.vegetarian.breakfast + dp.meat_dinner.breakfast + dp.meat_lunch_dinner.breakfast) / 3,
    };
    const hasCatering = new Set(
      installments.filter((i) => i.category === "catering").map((i) => i.booking_id)
    );
    let expectedCateringTvac = 0;
    for (const b of bookings) {
      if ((b.event_type ?? "retreat") !== "retreat") continue;
      if (b.catering_expected === false) continue; // organisateur sans catering
      if (!b.check_in_date || !b.check_out_date) continue;
      if (!b.check_in_date.startsWith(year)) continue;
      if (b.check_in_date <= todayIso) continue; // déjà commencé / passé
      if (hasCatering.has(b.id)) continue;       // catering déjà validé
      const nights = Math.round(
        (new Date(`${b.check_out_date}T12:00:00`).getTime() - new Date(`${b.check_in_date}T12:00:00`).getTime()) / 86400000
      );
      if (nights <= 0) continue;
      const perPax = avg.dinner + Math.max(0, nights - 1) * avg.fullBoard + avg.breakfast;
      expectedCateringTvac += 14 * perPax;
    }
    const expectedCatering = expectedCateringTvac / 1.13; // HT (TVA food 13 %)

    const total = actual.rental + actual.catering + actual.extra;
    const rows = [
      { label: "Rental", actual: actual.rental, target: cfg.rental ?? null, expected: 0 },
      { label: "Catering", actual: actual.catering, target: cfg.catering ?? null, expected: expectedCatering },
      { label: "Extras", actual: actual.extra, target: cfg.extras ?? null, expected: 0 },
    ];
    return {
      target: cfg.net_revenue,
      actual: total,
      pct: ((total + expectedCatering) / cfg.net_revenue) * 100,
      rows,
    };
  }, [installments, bookings, bookingById, targets, year, todayIso]);

  const Tile = ({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "danger" | "success" }) => (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${tone === "danger" ? "text-destructive" : tone === "success" ? "text-primary" : ""}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );

  return (
    <div className="space-y-6">
      {years.length > 1 && (
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-muted-foreground mr-1">Year</span>
          {years.map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => setYear(y)}
              className={`rounded-full px-3 py-1 text-sm border transition-colors ${
                y === year
                  ? "bg-primary text-primary-foreground border-primary font-medium"
                  : "bg-background border-border hover:bg-muted"
              }`}
            >
              {y}
            </button>
          ))}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <BookingCalendar bookings={bookings} todayIso={todayIso} onOpen={onOpen} />

        <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Tile
            label={`Revenue ${year} (incl. VAT)`}
            value={fmtMoney(kpis.contracted)}
            sub={`${fmtMoney(kpis.contractedHt)} excl. VAT`}
          />
          <Tile
            label={`Collected ${year}`}
            value={fmtMoney(kpis.collected)}
            sub={kpis.contracted > 0 ? `${Math.round((kpis.collected / kpis.contracted) * 100)}% of contracted` : undefined}
            tone="success"
          />
          <Tile
            label="Overdue"
            value={fmtMoney(kpis.overdueTotal)}
            sub={`${kpis.overdueCount} payment${kpis.overdueCount === 1 ? "" : "s"} late · ${fmtMoney(kpis.outstanding)} outstanding total`}
            tone={kpis.overdueTotal > 0 ? "danger" : undefined}
          />
        </div>

        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <div className="font-medium text-sm">Season occupancy · {year}</div>
            <div className="text-xs text-muted-foreground">{fmtShort(seasonStats.start)} → {fmtShort(seasonStats.end)}</div>
          </div>
          <div className="flex items-baseline gap-3 mt-2">
            <div className="text-3xl font-semibold">{Math.round(seasonStats.pct)}%</div>
            <div className="text-xs text-muted-foreground">
              {Math.round(seasonStats.pctBlocked)}% incl. turnaround
            </div>
          </div>
          <div className="mt-2.5 h-2.5 rounded-full bg-[#dfe5d2] overflow-hidden flex">
            <div className="h-full bg-primary" style={{ width: `${Math.min(100, seasonStats.pct)}%` }} />
            <div className="h-full bg-primary/40" style={{ width: `${Math.max(0, Math.min(100, seasonStats.pctBlocked) - Math.min(100, seasonStats.pct))}%` }} />
          </div>
          <div className="text-xs text-muted-foreground mt-1.5">
            {seasonStats.nights} of {seasonStats.totalNights} season nights with guests on site
            {seasonStats.turnaround > 0 && ` · +${seasonStats.turnaround} blocked for cleaning`}
          </div>
        </section>
        {targetStats ? (
          <section className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <div className="font-medium text-sm">Revenue vs target · {year}</div>
              <div className="text-xs text-muted-foreground">net of VAT (P&L)</div>
            </div>
            <div className="flex items-baseline gap-3 mt-2">
              <div className="text-3xl font-semibold">{Math.round(targetStats.pct)}%</div>
              <div className="text-xs text-muted-foreground">
                {fmtMoney(targetStats.actual)} contracted
                {targetStats.rows.some((r) => r.expected > 0) &&
                  ` + ${fmtMoney(targetStats.rows.reduce((s, r) => s + r.expected, 0))} expected`}
                {" "}of {fmtMoney(targetStats.target)}
              </div>
            </div>
            <div className="mt-2 space-y-2">
              {targetStats.rows.map((r) => {
                const pct = r.target ? (r.actual / r.target) * 100 : null;
                const pctExp = r.target ? (r.expected / r.target) * 100 : 0;
                return (
                  <div key={r.label}>
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="text-muted-foreground">{r.label}</span>
                      <span>
                        {fmtMoney(r.actual)}
                        {r.expected > 0 && <span className="text-muted-foreground"> + {fmtMoney(r.expected)} expected</span>}
                        {r.target != null && (
                          <span className="text-muted-foreground">
                            {" "}/ {fmtMoney(r.target)} · {Math.round((pct ?? 0) + pctExp)}%
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-[#dfe5d2] overflow-hidden flex">
                      <div className="h-full bg-primary" style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
                      {r.expected > 0 && (
                        <div className="h-full bg-primary/40" style={{ width: `${Math.max(0, Math.min(100, (pct ?? 0) + pctExp) - Math.min(100, pct ?? 0))}%` }} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : (
          <section className="rounded-xl border border-border bg-card p-4 flex items-center justify-center text-sm text-muted-foreground italic">
            No revenue target set for {year}.
          </section>
        )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="font-medium text-sm mb-2">Revenue by month · {year} <span className="text-muted-foreground font-normal">(incl. VAT)</span></div>
          <MonthlyRevenueChart months={charts.rev} />
        </section>
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="font-medium text-sm mb-2">Occupancy · {year} <span className="text-muted-foreground font-normal">(nights with guests on site — off-season dimmed)</span></div>
          <OccupancyChart months={charts.occ} inSeason={seasonStats.inSeasonMonths} />
        </section>
      </div>

    </div>
  );
}

// ---------------------------------------------------------------- Catering
// Staff assigné par événement : nom, rémunération journalière, jours payés.
// Convention maison : kitchen staff payé (nuits + 1) jours — pré-rempli.
type StaffRow = {
  id: string; booking_id: string; name: string; role: string | null;
  daily_fee: number; paid_days: number;
};

function CateringView({ bookings, todayIso, onOpen }: {
  bookings: BookingRow[];
  todayIso: string;
  onOpen: (bookingId: string) => void;
}) {
  const { toast } = useToast();
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [pastOpen, setPastOpen] = useState(false);

  const loadStaff = async () => {
    const { data, error } = await supabase.from("event_staff")
      .select("id,booking_id,name,role,daily_fee,paid_days");
    if (!error && data) setStaff(data as StaffRow[]);
  };
  useEffect(() => { loadStaff(); }, []);

  const byBooking = useMemo(() => {
    const m = new Map<string, StaffRow[]>();
    for (const s of staff) {
      const arr = m.get(s.booking_id) || [];
      arr.push(s);
      m.set(s.booking_id, arr);
    }
    return m;
  }, [staff]);

  const knownNames = useMemo(() => [...new Set(staff.map((s) => s.name))].sort(), [staff]);

  const dated = bookings.filter((b) => b.check_in_date && b.check_out_date);
  const upcoming = dated
    .filter((b) => b.check_out_date! >= todayIso)
    .sort((a, b) => a.check_in_date!.localeCompare(b.check_in_date!));
  const past = dated
    .filter((b) => b.check_out_date! < todayIso)
    .sort((a, b) => b.check_in_date!.localeCompare(a.check_in_date!));

  const addStaff = async (bookingId: string, v: { name: string; role: string | null; daily_fee: number; paid_days: number }) => {
    const { error } = await supabase.from("event_staff").insert({ booking_id: bookingId, ...v });
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
    else await loadStaff();
    return !error;
  };
  const updateStaff = async (id: string, patch: Partial<Pick<StaffRow, "daily_fee" | "paid_days">>) => {
    setStaff((rows) => rows.map((r) => r.id === id ? { ...r, ...patch } : r));
    const { error } = await supabase.from("event_staff").update(patch).eq("id", id);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); await loadStaff(); }
  };
  const removeStaff = async (id: string, name: string) => {
    if (!window.confirm(`Remove ${name} from this event?`)) return;
    const { error } = await supabase.from("event_staff").delete().eq("id", id);
    if (error) toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    else await loadStaff();
  };

  const totalFor = (rows: StaffRow[]) => rows.reduce((s, r) => s + Number(r.daily_fee) * r.paid_days, 0);

  return (
    <div className="space-y-4">
      <datalist id="staff-names">
        {knownNames.map((n) => <option key={n} value={n} />)}
      </datalist>

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">Upcoming & current events</h2>
        <div className="space-y-3">
          {upcoming.map((b) => (
            <CateringEventCard key={b.id} booking={b} rows={byBooking.get(b.id) || []} todayIso={todayIso}
              onOpen={onOpen} onAdd={addStaff} onUpdate={updateStaff} onRemove={removeStaff} totalFor={totalFor} />
          ))}
          {upcoming.length === 0 && <p className="text-sm text-muted-foreground italic">No upcoming events.</p>}
        </div>
      </div>

      <div>
        <button type="button" onClick={() => setPastOpen(!pastOpen)}
          className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2 hover:text-foreground">
          {pastOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          Past events ({past.length})
        </button>
        {pastOpen && (
          <div className="space-y-3">
            {past.map((b) => (
              <CateringEventCard key={b.id} booking={b} rows={byBooking.get(b.id) || []} todayIso={todayIso}
                onOpen={onOpen} onAdd={addStaff} onUpdate={updateStaff} onRemove={removeStaff} totalFor={totalFor} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CateringEventCard({ booking: b, rows, todayIso, onOpen, onAdd, onUpdate, onRemove, totalFor }: {
  booking: BookingRow;
  rows: StaffRow[];
  todayIso: string;
  onOpen: (id: string) => void;
  onAdd: (bookingId: string, v: { name: string; role: string | null; daily_fee: number; paid_days: number }) => Promise<boolean>;
  onUpdate: (id: string, patch: Partial<Pick<StaffRow, "daily_fee" | "paid_days">>) => void;
  onRemove: (id: string, name: string) => void;
  totalFor: (rows: StaffRow[]) => number;
}) {
  const nights = Math.max(0, Math.round(
    (new Date(`${b.check_out_date}T12:00:00`).getTime() - new Date(`${b.check_in_date}T12:00:00`).getTime()) / 86400000
  ));
  const suggestedDays = nights + 1;
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [fee, setFee] = useState("");
  const [days, setDays] = useState(String(suggestedDays));
  const [saving, setSaving] = useState(false);

  const isLive = b.check_in_date! <= todayIso && b.check_out_date! >= todayIso;
  const eventName = b.retreat_name || `${b.first_name ?? ""} ${b.last_name ?? ""}`.trim() || b.email;

  const submit = async () => {
    if (!name.trim() || !fee) return;
    setSaving(true);
    const ok = await onAdd(b.id, {
      name: name.trim(),
      role: role.trim() || null,
      daily_fee: Number(fee),
      paid_days: Math.max(1, Number(days) || suggestedDays),
    });
    setSaving(false);
    if (ok) { setName(""); setRole(""); setFee(""); setDays(String(suggestedDays)); setAdding(false); }
  };

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="px-4 py-3 border-b border-border flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <button type="button" onClick={() => onOpen(b.id)} className="font-medium text-sm hover:underline text-left">
            {eventName}
          </button>
          {isLive && <span className="ml-2 text-[10px] uppercase px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground">Live</span>}
          <span className="ml-2 text-[10px] uppercase px-1.5 py-0.5 rounded-full border border-border bg-muted text-muted-foreground">
            {EVENT_TYPE_LABEL[b.event_type ?? "retreat"] ?? "Retreat"}
          </span>
          <div className="text-xs text-muted-foreground mt-0.5">
            {fmtShort(b.check_in_date)} → {fmtShort(b.check_out_date)} · <strong className="text-foreground">{nights} night{nights !== 1 ? "s" : ""}</strong>
            <span> · kitchen staff usually paid {suggestedDays} days (nights + 1)</span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-semibold">{rows.length ? fmtMoney(totalFor(rows)) : "—"}</div>
          <div className="text-[11px] text-muted-foreground">staff cost</div>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="divide-y divide-border">
          {rows.map((r) => (
            <div key={r.id} className="px-4 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="font-medium min-w-[120px]">{r.name}</span>
              {r.role && <span className="text-xs text-muted-foreground">{r.role}</span>}
              <span className="flex items-center gap-1.5 ml-auto">
                <Input type="number" min="0" step="1" value={String(r.daily_fee)}
                  onChange={(e) => onUpdate(r.id, { daily_fee: Number(e.target.value) || 0 })}
                  className="h-7 w-20 text-right px-1.5" aria-label="Daily fee" />
                <span className="text-xs text-muted-foreground">€/day ×</span>
                <Input type="number" min="1" step="1" value={String(r.paid_days)}
                  onChange={(e) => onUpdate(r.id, { paid_days: Math.max(1, Number(e.target.value) || 1) })}
                  className="h-7 w-14 text-right px-1.5" aria-label="Paid days" />
                <span className="text-xs text-muted-foreground">days</span>
              </span>
              <span className="w-24 text-right font-medium tabular-nums">{fmtMoney(Number(r.daily_fee) * r.paid_days)}</span>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => onRemove(r.id, r.name)} aria-label={`Remove ${r.name}`}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="px-4 py-2.5 border-t border-border">
        {adding ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-0.5">
              <div className="text-[11px] text-muted-foreground">Name *</div>
              <Input list="staff-names" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jake" className="h-8 w-36" autoFocus />
            </label>
            <label className="space-y-0.5">
              <div className="text-[11px] text-muted-foreground">Role</div>
              <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Chef…" className="h-8 w-28" />
            </label>
            <label className="space-y-0.5">
              <div className="text-[11px] text-muted-foreground">Daily fee (€) *</div>
              <Input type="number" min="0" step="1" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="200" className="h-8 w-24" />
            </label>
            <label className="space-y-0.5">
              <div className="text-[11px] text-muted-foreground">Paid days</div>
              <Input type="number" min="1" step="1" value={days} onChange={(e) => setDays(e.target.value)} className="h-8 w-20" />
            </label>
            <Button size="sm" className="h-8" onClick={submit} disabled={saving || !name.trim() || !fee}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add"}
            </Button>
            <Button size="sm" variant="ghost" className="h-8" onClick={() => setAdding(false)} disabled={saving}>Cancel</Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" className="h-8" onClick={() => { setDays(String(suggestedDays)); setAdding(true); }}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Add staff member
          </Button>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- Guests
// Fiche client façon "PMS" : liste à gauche, profil + historique à droite.
// Un guest = une fiche client_profiles ; chaque booking pointe vers elle via
// bookings.client_id (fallback : regroupement par email pour les bookings
// pas encore rattachés). Merge = re-pointer les bookings vers une autre fiche.

type ClientProfile = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  tax_number: string | null;
  address: string | null;
  nationality: string | null;
};

type ClientForm = Omit<ClientProfile, "id">;

const EMPTY_CLIENT: ClientForm = {
  email: "", first_name: null, last_name: null, phone: null, tax_number: null, address: null, nationality: null,
};

function GuestsView({ bookings, installments, onOpen, onReload }: {
  bookings: BookingRow[];
  installments: Installment[];
  onOpen: (bookingId: string) => void;
  onReload: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [profilesArr, setProfilesArr] = useState<ClientProfile[]>([]);
  const [form, setForm] = useState<ClientForm>(EMPTY_CLIENT);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  const fetchProfiles = async () => {
    const { data, error } = await supabase.from("client_profiles")
      .select("id,email,first_name,last_name,phone,tax_number,address,nationality");
    if (!error && data) setProfilesArr(data as ClientProfile[]);
  };
  useEffect(() => { fetchProfiles(); }, []);

  const profileById = useMemo(() => new Map(profilesArr.map((p) => [p.id, p])), [profilesArr]);
  const profileByEmail = useMemo(() => new Map(profilesArr.map((p) => [p.email.toLowerCase(), p])), [profilesArr]);

  type SpendSplit = { rental: number; catering: number; extra: number; total: number };
  const splitFor = (instList: Installment[]): SpendSplit => {
    const s: SpendSplit = { rental: 0, catering: 0, extra: 0, total: 0 };
    for (const i of instList) {
      const amt = Number(i.amount_due || 0);
      const cat = i.category ?? "rental";
      // Les discounts (montants négatifs) sont aujourd'hui tous liés au rental.
      if (cat === "rental" || cat === "discount") s.rental += amt;
      else if (cat === "catering") s.catering += amt;
      else s.extra += amt;
      s.total += amt;
    }
    return s;
  };

  const instByBooking = useMemo(() => {
    const m = new Map<string, Installment[]>();
    for (const i of installments) {
      const arr = m.get(i.booking_id) || [];
      arr.push(i);
      m.set(i.booking_id, arr);
    }
    return m;
  }, [installments]);

  type GuestRow = {
    key: string;                    // client_id, sinon email (bookings non rattachés)
    profile: ClientProfile | null;
    name: string;
    email: string;
    bookings: BookingRow[];
    spend: SpendSplit;
  };

  const rows: GuestRow[] = useMemo(() => {
    const byKey = new Map<string, BookingRow[]>();
    for (const b of bookings) {
      const key = b.client_id || (b.email || "").toLowerCase();
      const arr = byKey.get(key) || [];
      arr.push(b);
      byKey.set(key, arr);
    }
    const list: GuestRow[] = [];
    for (const [key, bs] of byKey) {
      const sorted = [...bs].sort((a, b) => (a.check_in_date || "").localeCompare(b.check_in_date || ""));
      const ref = sorted[sorted.length - 1];
      const profile = profileById.get(key) ?? profileByEmail.get((ref.email || "").toLowerCase()) ?? null;
      const name =
        `${profile?.first_name ?? ref.first_name ?? ""} ${profile?.last_name ?? ref.last_name ?? ""}`.trim() ||
        ref.retreat_name || ref.email;
      list.push({
        key,
        profile,
        name,
        email: profile?.email ?? ref.email,
        bookings: sorted,
        spend: splitFor(sorted.flatMap((b) => instByBooking.get(b.id) || [])),
      });
    }
    const s = search.toLowerCase().trim();
    return list
      .filter((r) => !s || r.name.toLowerCase().includes(s) || r.email.toLowerCase().includes(s))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [bookings, search, profileById, profileByEmail, instByBooking]);

  const current = rows.find((r) => r.key === selected) ?? null;

  // Recharge le formulaire quand on change de client sélectionné.
  useEffect(() => {
    if (!current) return;
    const ref = current.bookings[current.bookings.length - 1];
    setForm({
      email: current.email,
      first_name: current.profile?.first_name ?? ref.first_name,
      last_name: current.profile?.last_name ?? ref.last_name,
      phone: current.profile?.phone ?? null,
      tax_number: current.profile?.tax_number ?? null,
      address: current.profile?.address ?? null,
      nationality: current.profile?.nationality ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, profilesArr]);

  const linkBookings = async (clientId: string, bookingIds: string[]) => {
    if (!bookingIds.length) return;
    const { error } = await supabase.from("bookings").update({ client_id: clientId }).in("id", bookingIds);
    if (error) throw error;
  };

  const saveProfile = async () => {
    if (!current) return;
    const newEmail = (form.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      toast({ title: "Invalid email", description: "Please enter a valid email address.", variant: "destructive" });
      return;
    }
    const emailChanged = newEmail !== (current.email || "").toLowerCase();
    if (emailChanged) {
      const ok = window.confirm(
        `Change this guest's email to ${newEmail}?\n\n` +
        `It will be applied to their ${current.bookings.length} booking${current.bookings.length === 1 ? "" : "s"} ` +
        `and used for guest-area invitations and payment reminders.`
      );
      if (!ok) return;
    }
    setSaving(true);
    try {
      const payload = { ...form, email: newEmail };
      let profileId = current.profile?.id;
      if (profileId) {
        const { error } = await supabase.from("client_profiles")
          .update(payload).eq("id", profileId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("client_profiles")
          .upsert(payload, { onConflict: "email" }).select("id").single();
        if (error) throw error;
        profileId = data.id;
        await linkBookings(profileId, current.bookings.filter((b) => !b.client_id).map((b) => b.id));
      }
      if (emailChanged) {
        const { error } = await supabase.from("bookings")
          .update({ email: newEmail })
          .in("id", current.bookings.map((b) => b.id));
        if (error) throw error;
        await onReload();
      }
      await fetchProfiles();
      toast({ title: "Guest profile saved" });
    } catch (e: any) {
      const msg = /duplicate|unique/i.test(e.message || "")
        ? "Another guest already uses this email — use Merge into… instead."
        : e.message;
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const mergeInto = async (targetKey: string) => {
    const target = rows.find((r) => r.key === targetKey);
    if (!current || !target || target.key === current.key) return;
    if (!target.profile) {
      toast({ title: "Cannot merge", description: "Target guest has no profile yet — open it and save its profile first.", variant: "destructive" });
      return;
    }
    const ok = window.confirm(
      `Merge "${current.name}" into "${target.name}"?\n\n` +
      `${current.bookings.length} booking${current.bookings.length === 1 ? "" : "s"} will be moved to ${target.name}. ` +
      `The duplicate guest entry will disappear. Nothing is deleted from the bookings themselves.`
    );
    if (!ok) return;
    setBusy(true);
    try {
      await linkBookings(target.profile.id, current.bookings.map((b) => b.id));
      if (current.profile && current.profile.id !== target.profile.id) {
        await supabase.from("client_profiles").delete().eq("id", current.profile.id);
      }
      await Promise.all([fetchProfiles(), onReload()]);
      setSelected(target.key);
      toast({ title: "Guests merged", description: `${current.name} → ${target.name}` });
    } catch (e: any) {
      toast({ title: "Merge failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const deleteGuest = async () => {
    if (!current) return;
    const n = current.bookings.length;
    const ok = window.confirm(
      `Delete guest "${current.name}"?\n\n` +
      `This permanently deletes their ${n} booking${n === 1 ? "" : "s"} (${current.bookings.map((b) => b.retreat_name).join(", ")}) ` +
      `including room setups, food plans, transportation and payment installments. This cannot be undone.\n\n` +
      `If this guest is a duplicate, use "Merge into…" instead.`
    );
    if (!ok) return;
    setBusy(true);
    try {
      for (const b of current.bookings) {
        const res = await supabase.functions.invoke("admin-delete-guest", { body: { booking_id: b.id } });
        if (res.error) throw new Error(`${b.retreat_name}: ${res.error.message}`);
      }
      if (current.profile) {
        await supabase.from("client_profiles").delete().eq("id", current.profile.id);
      }
      setSelected(null);
      await Promise.all([fetchProfiles(), onReload()]);
      toast({ title: "Guest deleted", description: current.name });
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const initials = (name: string) =>
    name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";

  const nightsOf = (b: BookingRow) => {
    if (!b.check_in_date || !b.check_out_date) return null;
    const n = Math.round((new Date(b.check_out_date).getTime() - new Date(b.check_in_date).getTime()) / 86400000);
    return n > 0 ? n : null;
  };

  const field = (label: string, key: keyof ClientForm, placeholder: string) => (
    <div>
      <label className="block text-xs text-muted-foreground mb-1">{label}</label>
      <Input
        value={form[key] ?? ""}
        placeholder={placeholder}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value || null }))}
        className="h-9"
      />
    </div>
  );

  const CAT_STYLE = {
    rental: { label: "Rental", dot: "#57761f" },
    catering: { label: "Catering", dot: "#2a78d6" },
    extra: { label: "Extras", dot: "#c2622f" },
  } as const;

  return (
    <div className="grid gap-4 lg:grid-cols-[300px,1fr] items-start">
      {/* -------- Liste des guests -------- */}
      <div className="border border-border rounded-xl bg-card overflow-hidden">
        <div className="p-3 border-b border-border">
          <Input placeholder="Search name or email" value={search} onChange={(e) => setSearch(e.target.value)} />
          <p className="mt-1.5 text-xs text-muted-foreground">{rows.length} guest{rows.length === 1 ? "" : "s"}</p>
        </div>
        <ul className="divide-y divide-border max-h-[70vh] overflow-y-auto">
          {rows.map((r) => (
            <li key={r.key}>
              <button
                type="button"
                onClick={() => setSelected(r.key)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/60 ${r.key === selected ? "bg-primary/10 border-l-2 border-primary" : "border-l-2 border-transparent"}`}
              >
                <span className="shrink-0 w-9 h-9 rounded-full bg-primary/15 text-primary text-xs font-semibold flex items-center justify-center">
                  {initials(r.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium truncate">{r.name}</span>
                  <span className="block text-xs text-muted-foreground truncate">{r.email}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground text-right">
                  <span className="block font-medium text-foreground">{fmtMoney(r.spend.total)}</span>
                  <span>{r.bookings.length} booking{r.bookings.length === 1 ? "" : "s"}</span>
                </span>
              </button>
            </li>
          ))}
          {rows.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground italic">No guests found.</li>}
        </ul>
      </div>

      {/* -------- Fiche du guest sélectionné -------- */}
      {!current ? (
        <div className="border border-dashed border-border rounded-xl bg-card/50 p-10 text-center text-sm text-muted-foreground">
          Select a guest on the left to see their profile and booking history.
        </div>
      ) : (
        <div className="space-y-4 min-w-0">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr),260px]">
            {/* Profil */}
            <section className="border border-border rounded-xl bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-4 min-w-0">
                  <span className="w-14 h-14 shrink-0 rounded-full bg-primary/15 text-primary text-lg font-semibold flex items-center justify-center">
                    {initials(current.name)}
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold leading-tight truncate">{current.name}</h2>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-0.5 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" />{current.email}</span>
                      {form.phone && <span className="inline-flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" />{form.phone}</span>}
                      {form.nationality && <span className="inline-flex items-center gap-1.5"><Globe2 className="w-3.5 h-3.5" />{form.nationality}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <select
                    className="border border-border rounded-md px-2 py-1.5 text-xs bg-background text-muted-foreground max-w-[160px]"
                    value=""
                    disabled={busy}
                    onChange={(e) => { if (e.target.value) mergeInto(e.target.value); e.target.value = ""; }}
                    title="Move all bookings of this guest to another guest"
                  >
                    <option value="">Merge into…</option>
                    {rows.filter((r) => r.key !== current.key).map((r) => (
                      <option key={r.key} value={r.key}>{r.name} — {r.email}</option>
                    ))}
                  </select>
                  <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={deleteGuest} disabled={busy} title="Delete guest and all their bookings">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-border">
                <h3 className="text-sm font-medium mb-3">Personal information</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {field("First name", "first_name", "First name")}
                  {field("Last name", "last_name", "Last name")}
                  <div className="sm:col-span-2">
                    <label className="block text-xs text-muted-foreground mb-1">Email</label>
                    <Input
                      type="email"
                      value={form.email ?? ""}
                      placeholder="guest@email.com"
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                      className="h-9"
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Used for guest-area invitations and payment reminders — applies to all this guest's bookings.
                    </p>
                  </div>
                  {field("Phone number", "phone", "+351 …")}
                  {field("Tax number", "tax_number", "VAT / NIF")}
                  {field("Nationality", "nationality", "e.g. Belgian")}
                  {field("Address", "address", "Street, city, country")}
                </div>
                <div className="mt-3 flex justify-end">
                  <Button size="sm" onClick={saveProfile} disabled={saving}>
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save profile"}
                  </Button>
                </div>
              </div>
            </section>

            {/* Total dépensé, par catégorie */}
            <section className="border border-border rounded-xl bg-card p-5">
              <h3 className="text-sm font-medium mb-1 flex items-center gap-1.5"><ReceiptText className="w-4 h-4 text-muted-foreground" />Total spent</h3>
              <p className="text-2xl font-semibold">{fmtMoney(current.spend.total)}</p>
              <p className="text-xs text-muted-foreground mb-3">incl. VAT · discounts deducted</p>
              <ul className="space-y-2">
                {(Object.keys(CAT_STYLE) as Array<keyof typeof CAT_STYLE>).map((k) => (
                  <li key={k} className="flex items-center justify-between text-sm">
                    <span className="inline-flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: CAT_STYLE[k].dot }} />
                      {CAT_STYLE[k].label}
                    </span>
                    <span className="font-medium">{fmtMoney(current.spend[k])}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {/* Historique des bookings */}
          <section className="border border-border rounded-xl bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border font-medium text-sm">Booking history</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Event</th>
                    <th className="px-4 py-2.5 font-medium">Check-in</th>
                    <th className="px-4 py-2.5 font-medium">Check-out</th>
                    <th className="px-4 py-2.5 font-medium">Nights</th>
                    <th className="px-4 py-2.5 font-medium">Guests</th>
                    <th className="px-4 py-2.5 font-medium text-right">Rental</th>
                    <th className="px-4 py-2.5 font-medium text-right">Catering</th>
                    <th className="px-4 py-2.5 font-medium text-right">Extras</th>
                    <th className="px-4 py-2.5 font-medium text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {[...current.bookings].reverse().map((b) => {
                    const sp = splitFor(instByBooking.get(b.id) || []);
                    const nights = nightsOf(b);
                    return (
                      <tr key={b.id} className="hover:bg-muted/50 cursor-pointer" onClick={() => onOpen(b.id)}>
                        <td className="px-4 py-2.5">
                          <span className="font-medium">{b.retreat_name}</span>
                          <span className="ml-2 text-[10px] uppercase px-1.5 py-0.5 rounded-full border border-border bg-muted text-muted-foreground">
                            {EVENT_TYPE_LABEL[b.event_type ?? "retreat"] ?? "Retreat"}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">{b.check_in_date ?? "—"}</td>
                        <td className="px-4 py-2.5">{b.check_out_date ?? "—"}</td>
                        <td className="px-4 py-2.5">{nights ?? "—"}</td>
                        <td className="px-4 py-2.5">{b.guest_count || "—"}</td>
                        <td className="px-4 py-2.5 text-right">{sp.rental ? fmtMoney(sp.rental) : "—"}</td>
                        <td className="px-4 py-2.5 text-right">{sp.catering ? fmtMoney(sp.catering) : "—"}</td>
                        <td className="px-4 py-2.5 text-right">{sp.extra ? fmtMoney(sp.extra) : "—"}</td>
                        <td className="px-4 py-2.5 text-right font-medium">{sp.total ? fmtMoney(sp.total) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
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

  const { groups, tripNames } = useMemo(() => {
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
    const tripNames = new Map<string, string>();

    for (const t of data.trips) {
      const b = (t.booking_id && bookingsById.get(t.booking_id)) || bookingsByUser.get(t.user_id);

      const paxNames = ((t as any).passengers || [])
        .map((p: any) => (p.first_name || "").trim())
        .filter(Boolean);
      let name = "";
      if (paxNames.length > 0) {
        name = paxNames.join(", ");
      } else if (b) {
        name = [b.first_name, b.last_name].filter(Boolean).join(" ").trim()
          || b.retreat_name || b.email || "";
      }
      if (!name) {
        const g = guestName(t.user_id);
        name = g && g !== "Unknown" ? g : "Guest";
      }
      tripNames.set(t.id, name);

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

    const groups = Array.from(map.values())
      .map((g) => ({
        ...g,
        trips: g.trips.sort((a, b) => `${a.trip_date} ${a.trip_time}`.localeCompare(`${b.trip_date} ${b.trip_time}`)),
        cost: calculateTransportationCost(g.trips as unknown as TransportationTrip[]),
        isPast: g.sortKey.startsWith("2"),
      }))
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    return { groups, tripNames };
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
            return [t.trip_date, t.trip_time, tripNames.get(t.id) || guestName(t.user_id), t.trip_direction, t.pickup_location, t.dropoff_location, t.taxi_size, t.passengers_count, t.price_estimate, t.custom_price ?? "", isCustom ? "yes" : "", t.google_calendar_event_id ?? "", t.sync_status ?? ""];
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
                        const gName = tripNames.get(t.id) || guestName(t.user_id);
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

/**
 * Room setup admin : un plan de chambres annoté par séjour.
 * Le prochain séjour est mis en avant (plan affiché + téléchargement PDF) ;
 * les autres séjours sont listés et affichables/téléchargeables d'un clic.
 */
function RoomsView({ data, onOpen }: { data: Data; onOpen: (bookingId: string) => void }) {
  type StayPlan = {
    booking: BookingRow;
    name: string;
    entries: RoomMapEntry[];
    guestsPlaced: number;
    remarks: string | null;
  };

  const todayIso = new Date().toISOString().slice(0, 10);

  const stays: StayPlan[] = useMemo(() => {
    const list: StayPlan[] = [];
    for (const b of data.bookings || []) {
      const room: any = (data.rooms as any[]).find(
        (r) => r.booking_id === b.id || (b.user_id && r.user_id === b.user_id && !r.booking_id)
      );
      const plan = Array.isArray(room?.room_plan) ? (room.room_plan as any[]) : [];
      if (plan.length === 0) continue;
      const disabled = new Set<number>((b as any).disabled_rooms || []);
      const entries: RoomMapEntry[] = plan
        .filter((e) => Number.isFinite(Number(e?.roomId)) && !disabled.has(Number(e.roomId)))
        .map((e) => ({
          roomId: Number(e.roomId),
          guests: Array.isArray(e.guests) ? e.guests.filter((g: unknown) => typeof g === "string" && g.trim()) : [],
          bedType: Number(e.roomId) === 1 || Number(e.roomId) === 6 ? "king" : (e.bedType === "king" ? "king" : "twin"),
        }));
      if (entries.length === 0) continue;
      list.push({
        booking: b,
        name: b.retreat_name || `${b.first_name ?? ""} ${b.last_name ?? ""}`.trim() || b.email,
        entries,
        guestsPlaced: entries.reduce((s, e) => s + e.guests.length, 0),
        remarks: room?.remarks_roomsetup || room?.remarks || null,
      });
    }
    return list;
  }, [data, todayIso]);

  // "Next" = premier séjour dont le check-in est à venir (un séjour en cours
  // n'est pas "next" : il est live, et rejoint le groupe replié avec les passés).
  const upcoming = useMemo(
    () => stays.filter((s) => (s.booking.check_in_date ?? "") > todayIso)
      .sort((a, b) => (a.booking.check_in_date ?? "").localeCompare(b.booking.check_in_date ?? "")),
    [stays, todayIso]
  );
  const pastAndLive = useMemo(
    () => stays.filter((s) => (s.booking.check_in_date ?? "") <= todayIso)
      .sort((a, b) => (b.booking.check_in_date ?? "").localeCompare(a.booking.check_in_date ?? "")),
    [stays, todayIso]
  );
  const isLive = (s: StayPlan) =>
    (s.booking.check_in_date ?? "") <= todayIso && (s.booking.check_out_date ?? s.booking.check_in_date ?? "") >= todayIso;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pastOpen, setPastOpen] = useState(false);
  const selected = stays.find((s) => s.booking.id === selectedId) ?? upcoming[0] ?? pastAndLive[0] ?? null;
  const isNext = selected != null && upcoming[0] != null && selected.booking.id === upcoming[0].booking.id;

  const [mapUrl, setMapUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setMapUrl(null);
    if (!selected) return;
    renderRoomMapCanvas(roomsArrangement, selected.entries)
      .then((canvas) => { if (!cancelled) setMapUrl(canvas.toDataURL("image/jpeg", 0.85)); })
      .catch(() => { if (!cancelled) setMapUrl(null); });
    return () => { cancelled = true; };
  }, [selected?.booking.id, stays.length]);

  const fmtD = (d: string | null) =>
    d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

  const download = (s: StayPlan) =>
    downloadRoomMapPdf(roomsArrangement, s.entries, {
      title: `Quinta do Amor — Room map — ${s.name}`,
      subtitle: `${fmtD(s.booking.check_in_date)} → ${fmtD(s.booking.check_out_date)} · ${s.guestsPlaced} guests placed`,
    });

  if (stays.length === 0) {
    return (
      <div className="border border-border rounded-xl bg-card p-8 text-center text-sm text-muted-foreground">
        No room plans yet — plans appear here once a guest (or you, via "Open as guest") assigns rooms in Room Setup.
      </div>
    );
  }

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-4 items-start">
      {/* Plan mis en avant */}
      <section className="rounded-xl border border-border bg-card p-4">
        {selected && (
          <>
            <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <button type="button" className="font-semibold hover:underline" onClick={() => onOpen(selected.booking.id)}>
                    {selected.name}
                  </button>
                  {isNext && (
                    <span className="text-[10px] uppercase px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground font-medium">
                      Next stay
                    </span>
                  )}
                  {!isNext && isLive(selected) && (
                    <span className="text-[10px] uppercase px-1.5 py-0.5 rounded-full border border-primary text-primary font-medium">
                      Live now
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {fmtD(selected.booking.check_in_date)} → {fmtD(selected.booking.check_out_date)} · {selected.guestsPlaced}/{selected.booking.guest_count} guests placed
                </div>
              </div>
              <Button size="sm" onClick={() => download(selected)}>
                <FileDown className="w-4 h-4 mr-1" /> Download PDF
              </Button>
            </div>
            {mapUrl ? (
              <img src={mapUrl} alt={`Room map — ${selected.name}`} className="w-full h-auto rounded-lg border border-border" />
            ) : (
              <div className="h-64 flex items-center justify-center text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            )}
            {selected.remarks && (
              <p className="text-xs text-muted-foreground italic mt-2 whitespace-pre-wrap">{selected.remarks}</p>
            )}
          </>
        )}
      </section>

      {/* Liste des séjours */}
      <section className="rounded-xl border border-border bg-card">
        <div className="px-4 py-3 border-b border-border font-medium text-sm">Upcoming stays</div>
        <ul className="divide-y divide-border max-h-[70vh] overflow-y-auto">
          {upcoming.length === 0 && (
            <li className="px-4 py-3 text-sm text-muted-foreground italic">No upcoming stay with a room plan.</li>
          )}
          {upcoming.map((s, i) => (
            <li key={s.booking.id}>
              <StayRow s={s} tag={i === 0 ? "next" : null} />
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => setPastOpen((v) => !v)}
              className="w-full flex items-center gap-1 px-4 py-2.5 text-sm font-medium hover:bg-muted/60"
            >
              {pastOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              Past & current stays <span className="text-muted-foreground font-normal">({pastAndLive.length})</span>
            </button>
          </li>
          {pastOpen && pastAndLive.map((s) => (
            <li key={s.booking.id}>
              <StayRow s={s} tag={isLive(s) ? "live" : null} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );

  function StayRow({ s, tag }: { s: StayPlan; tag: "next" | "live" | null }) {
    return (
      <div
        className={`flex items-center justify-between gap-2 px-4 py-2.5 cursor-pointer ${selected?.booking.id === s.booking.id ? "bg-primary/10" : "hover:bg-muted/60"}`}
        onClick={() => setSelectedId(s.booking.id)}
      >
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">
            {s.name}
            {tag && <span className="ml-1.5 text-[10px] uppercase text-primary font-semibold">{tag}</span>}
          </div>
          <div className="text-xs text-muted-foreground">
            {fmtD(s.booking.check_in_date)} · {s.guestsPlaced} guests placed
          </div>
        </div>
        <Button
          size="icon" variant="ghost" className="h-7 w-7 shrink-0"
          title="Download PDF"
          onClick={(e) => { e.stopPropagation(); download(s); }}
        >
          <FileDown className="w-3.5 h-3.5" />
        </Button>
      </div>
    );
  }
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
  eventType: string;
};

function EventTable({
  events,
  toolStatus,
  categoryOf,
  paymentForEvent,
  onRowClick,
  onDeleteBooking,
  onRenameBooking,
  onSetEventType,
  showLive,
}: {
  events: EventRowProps[];
  toolStatus: (uid: string | null, bookingId?: string | null) => { room: string; food: string; trip: string };
  categoryOf: (e: EventRowProps) => "upcoming" | "past" | "live" | "none";
  paymentForEvent: (e: EventRowProps) => ResolvedPaymentStatus;
  onRowClick: (bookingId: string) => void;
  onDeleteBooking: (bookingId: string, email: string) => void;
  onRenameBooking: (bookingId: string, patch: { first_name?: string | null; last_name?: string | null }) => Promise<void> | void;
  onSetEventType: (bookingId: string, v: string) => Promise<void> | void;
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
    // Domaine officiel des invitations (indépendant de l'URL d'accès à l'admin)
    const url = `https://guest.quintamor.com/invite/${t}`;
    await navigator.clipboard.writeText(url);
    setCopiedId(bookingId);
    toast({ title: "Invite link copied" });
    setTimeout(() => setCopiedId((c) => (c === bookingId ? null : c)), 2000);
  };

  const [sendingInviteId, setSendingInviteId] = useState<string | null>(null);
  const sendInvite = async (e: React.MouseEvent, bookingId: string, guestLabel: string) => {
    e.stopPropagation();
    if (!window.confirm(`Send the invitation email to ${guestLabel}?`)) return;
    setSendingInviteId(bookingId);
    try {
      const { data, error } = await supabase.functions.invoke("send-invite-email", {
        body: { booking_id: bookingId },
      });
      if (error || data?.error) {
        toast({ title: "Invitation not sent", description: error?.message || data?.error || "Unknown error", variant: "destructive" });
      } else {
        toast({ title: "Invitation sent", description: `Email sent to ${data.sent_to}` });
      }
    } finally {
      setSendingInviteId(null);
    }
  };

  const openAsGuest = (e: React.MouseEvent, bookingId: string) => {
    e.stopPropagation();
    window.open(`/dashboard?impersonate=${bookingId}`, "_blank");
  };

  return (
    <div className="overflow-auto border border-border rounded-lg bg-card max-h-[70vh]">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted">
          <tr className="text-left">
            {["First","Last","Email","Type","Check-in","Check-out","Guests","Status","Payment","Actions"].map((h, i) => (
              <th key={i} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {events.map((ev) => {
            const label = (`${ev.firstName ?? ""} ${ev.lastName ?? ""}`.trim() || ev.email);
            const isLive = showLive && categoryOf(ev) === "live";
            const payStatus = paymentForEvent(ev);
            return (
              <tr
                key={ev.bookingId}
                className="border-t border-border hover:bg-muted/40 cursor-pointer"
                onClick={() => onRowClick(ev.bookingId)}
              >
                <td className="px-3 py-2">
                  <div className="inline-flex items-center gap-2">
                    <InlineNameCell
                      value={ev.firstName}
                      placeholder="First"
                      onSave={(v) => onRenameBooking(ev.bookingId, { first_name: v })}
                    />
                    {isLive && (
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-green-100 text-green-800 border border-green-300">
                        Live
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <InlineNameCell
                    value={ev.lastName}
                    placeholder="Last"
                    onSave={(v) => onRenameBooking(ev.bookingId, { last_name: v })}
                  />
                </td>
                <td className="px-3 py-2">{ev.email}</td>
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <select
                    className="h-7 rounded-md border border-input bg-background px-1.5 text-xs"
                    value={ev.eventType}
                    onChange={(e) => onSetEventType(ev.bookingId, e.target.value)}
                  >
                    <option value="retreat">Retreat</option>
                    <option value="wedding">Wedding</option>
                    <option value="other">Other</option>
                    <option value="day_retreat">Day retreat</option>
                  </select>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{ev.checkIn}</td>
                <td className="px-3 py-2 whitespace-nowrap">{ev.checkOut}</td>
                <td className="px-3 py-2">{ev.guestsCount}</td>
                <td className="px-3 py-2"><StatusBadge checkIn={ev.checkIn} statusOverall={ev.statusOverall} /></td>
                <td className="px-3 py-2">
                  <PaymentBadge
                    status={payStatus}
                    onClick={(e) => { e.stopPropagation(); onRowClick(ev.bookingId); }}
                  />
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <div className="flex items-center gap-1.5 justify-end">
                    <div className="w-16 flex justify-center gap-0.5">
                      {!ev.invitationClaimed && (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={(e) => copyInvite(e, ev.invitationToken, ev.bookingId)}
                            aria-label="Copy invite link"
                            title="Copy invite link"
                          >
                            {copiedId === ev.bookingId ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            disabled={sendingInviteId === ev.bookingId}
                            onClick={(e) => sendInvite(e, ev.bookingId, label)}
                            aria-label="Send invitation email"
                            title="Send invitation email"
                          >
                            {sendingInviteId === ev.bookingId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                          </Button>
                        </>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="min-w-[140px] justify-center"
                      onClick={(e) => openAsGuest(e, ev.bookingId)}
                      title="Open guest dashboard in a new tab"
                    >
                      <ExternalLink className="w-3.5 h-3.5 mr-1" />
                      Open as guest
                    </Button>
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
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}





function InlineNameCell({
  value,
  placeholder,
  onSave,
}: {
  value: string | null;
  placeholder: string;
  onSave: (next: string | null) => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [value, editing]);

  const start = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(value ?? "");
    setEditing(true);
  };

  const cancel = () => {
    setDraft(value ?? "");
    setEditing(false);
  };

  const commit = async () => {
    const trimmed = draft.trim();
    const next = trimmed.length ? trimmed : null;
    if (next === (value ?? null)) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          else if (e.key === "Escape") { e.preventDefault(); cancel(); }
        }}
        onBlur={commit}
        disabled={saving}
        placeholder={placeholder}
        className="h-7 px-2 py-1 text-sm w-32"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      className="group inline-flex items-center gap-1 text-left hover:underline underline-offset-2"
      title="Click to edit"
    >
      <span>{value || <span className="text-muted-foreground italic">{placeholder}</span>}</span>
      <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
    </button>
  );
}
