import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminGuard } from "@/lib/adminGuard";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, BedDouble, Utensils, Car, Loader2, Mail, Euro, Users, Calendar, Clock, Trash2, FileDown,
  Pencil, Check, X, Plus, Download, Upload, Wallet, StickyNote, ExternalLink, Printer, Copy, Lock, LockOpen, FlaskConical,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { generateAirportSignPdf, resolveAirportSignNames } from "@/lib/airportSignPdf";
import { DeleteGuestDialog } from "@/components/admin/DeleteGuestDialog";
import { PaymentEmailDialog } from "@/components/admin/PaymentEmailDialog";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { calculateFoodCostMulti } from "@/lib/foodPricing";
import { calculateTransportationCost, getFixedTripPriceNumeric, getEffectiveTripPrice } from "@/lib/transportationPricing";
import { CustomPriceEditor } from "@/pages/Admin";
import { EMPTY_DIET_CONFIG, type DietConfig } from "@/types/guest";
import { getGuestStatus } from "@/lib/editLock";

type Profile = {
  user_id: string; first_name: string | null; last_name: string | null;
  full_name: string; email: string;
  check_in_date: string | null; check_out_date: string | null;
  guests_count: number; status_overall: string;
  submitted_at: string | null; updated_at: string;
};
type RoomPlanEntry = {
  roomId: number;
  bedType: 'king' | 'queen' | 'twin' | null;
  bathroomType: 'shared' | 'en-suite';
  isFixed?: boolean;
  note?: string;
  guests?: string[];
};
type Room = {
  user_id: string; queen_shared_qty: number; twins_shared_qty: number;
  queen_ensuite_qty: number; twins_ensuite_qty: number;
  remarks_roomsetup: string | null; remarks: string | null; status_roomsetup: string;
  updated_at: string;
  room_plan?: RoomPlanEntry[] | null;
};

const BATHROOM_PARTNER: Record<number, number> = {
  2: 3, 3: 2, 4: 5, 5: 4, 7: 8, 8: 7,
};
type Trip = {
  id: string; user_id: string; trip_direction: string;
  pickup_location: string; dropoff_location: string;
  trip_date: string; trip_time: string;
  passengers_count: number; taxi_size: "4 seats" | "6 seats" | "8 seats";
  price_estimate: string;
  custom_price: number | null;
};
type Passenger = {
  id: string; user_id: string; trip_id: string;
  first_name: string; phone: string; flight_number: string | null;
};
type FoodPlan = {
  user_id: string; selections: any[]; diet_preference: string | null;
  diet_config: DietConfig | null;
  meal_times: { breakfast_time: string | null; lunch_time: string | null; dinner_time: string | null } | null;
  notes_food: string | null; status_food: string;
  updated_at: string;
};

type BookingRow = {
  id: string;
  user_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string;
  guest_count: number;
  check_in_date: string | null;
  check_out_date: string | null;
  payment_status: string;
  invitation_claimed: boolean;
  whatsapp_group_url: string | null;
  admin_managed: boolean;
  internal_notes: string | null;
  disabled_rooms: number[] | null;
  edit_lock_override: boolean;
  retreat_name?: string | null;
};

interface Detail {
  booking: BookingRow | null;
  profile: Profile | null;
  room: Room | null;
  food: FoodPlan | null;
  trips: Trip[];
  passengers: Passenger[];
}

function parseLocalDate(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day);
}
function fmtDate(d?: string | null): string {
  if (!d) return "—";
  return parseLocalDate(d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}
function fmtDateLong(d: string): string {
  return parseLocalDate(d).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}
function fmtTimestamp(t?: string | null): string {
  if (!t) return "—";
  return new Date(t).toLocaleString("en-GB");
}

const AdminGuestDetailContent = () => {
  const { guestId } = useParams<{ guestId: string }>();
  const [searchParams] = useSearchParams();
  const bookingIdParam = searchParams.get("bookingId");
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const { setActiveBookingId, refresh: refreshBookings } = useActiveBooking();
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [resending, setResending] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [togglingLock, setTogglingLock] = useState(false);
  const [lockOverride, setLockOverride] = useState<boolean | null>(null);

  const load = async () => {
    if (!guestId && !bookingIdParam) return;
    setLoading(true);
    const body: { guest_id?: string; booking_id?: string } = {};
    if (bookingIdParam) body.booking_id = bookingIdParam;
    if (guestId && /^[0-9a-f-]{36}$/i.test(guestId)) body.guest_id = guestId;
    const res = await supabase.functions.invoke("admin-guest-detail", { body });
    if (res.error) {
      toast({ title: "Error", description: res.error.message, variant: "destructive" });
      setData(null);
    } else {
      setData(res.data as Detail);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [guestId, bookingIdParam]);

  const dietConfig: DietConfig = useMemo(() => {
    const dc = data?.food?.diet_config;
    if (dc && typeof dc === "object") {
      return {
        vegetarian_count: (dc as any).vegetarian_count || 0,
        meat_dinner_count: (dc as any).meat_dinner_count || 0,
        meat_lunch_dinner_count: (dc as any).meat_lunch_dinner_count || 0,
      };
    }
    return { ...EMPTY_DIET_CONFIG };
  }, [data]);

  const foodCost = useMemo(() => {
    const rawSels = Array.isArray(data?.food?.selections) ? data!.food!.selections : [];
    const guestsCount = data?.profile?.guests_count ?? data?.booking?.guest_count ?? 1;
    const sels = rawSels.map((s: any) => ({
      ...s,
      guests_count_day: typeof s?.guests_count_day === 'number' && s.guests_count_day >= 0
        ? s.guests_count_day
        : guestsCount,
    }));
    return calculateFoodCostMulti(sels as any, dietConfig, guestsCount);
  }, [data, dietConfig]);

  const transportCost = useMemo(() => calculateTransportationCost((data?.trips || []) as any), [data]);
  const grandTotal = foodCost.grandTotal + transportCost.subtotal;

  const passengersByTrip = useMemo(() => {
    const map = new Map<string, Passenger[]>();
    for (const p of data?.passengers || []) {
      const arr = map.get(p.trip_id) || [];
      arr.push(p);
      map.set(p.trip_id, arr);
    }
    return map;
  }, [data]);

  const sortedTrips = useMemo(() =>
    [...(data?.trips || [])].sort((a, b) =>
      `${a.trip_date} ${a.trip_time}`.localeCompare(`${b.trip_date} ${b.trip_time}`)
    ), [data]);

  const resendEmail = async () => {
    if (!data?.profile) return;
    setResending(true);
    try {
      const p = data.profile;
      const res = await supabase.functions.invoke("send-guest-summary", {
        body: {
          fullName: p.full_name || `${p.first_name || ""} ${p.last_name || ""}`.trim(),
          firstName: p.first_name || null,
          email: p.email,
          checkInDate: p.check_in_date,
          checkOutDate: p.check_out_date,
          guestsCount: p.guests_count,
          roomSetup: data.room ? {
            queenSharedCount: data.room.queen_shared_qty,
            twinsSharedCount: data.room.twins_shared_qty,
            queenEnsuiteCount: data.room.queen_ensuite_qty,
            twinsEnsuiteCount: data.room.twins_ensuite_qty,
          } : null,
          transportation: data.trips.length > 0 ? {
            totalTrips: transportCost.totalTrips,
            subtotal: transportCost.subtotal,
            fixedPriceTotal: transportCost.subtotal,
            customOfferCount: transportCost.customOfferCount,
            trips: data.trips,
          } : null,
          food: data.food ? {
            fullBoardDays: foodCost.fullBoardDays,
            breakfastOnlyDays: foodCost.breakfastCount,
            customDays: foodCost.lunchCount + foodCost.dinnerCount > 0 ? 1 : 0,
            dietPreference: data.food.diet_preference,
            totalCost: foodCost.grandTotal,
            selections: data.food.selections || [],
            dietBreakdown: foodCost.dietBreakdown.map((d) => ({
              type: d.type, label: d.label, guests: d.guests, total: d.total,
            })),
            dietTotal: foodCost.dietTotal,
          } : null,
        },
      });
      if (res.error) throw res.error;
      toast({ title: "Email sent" });
    } catch (e: any) {
      toast({ title: "Failed to send", description: e.message, variant: "destructive" });
    } finally {
      setResending(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-[#35532A]" />
      </div>
    );
  }

  if (!data || (!data.profile && !data.booking)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
        <p>Guest not found.</p>
        <Button onClick={() => navigate("/admin")}><ArrowLeft className="w-4 h-4 mr-1" />Back</Button>
      </div>
    );
  }

  const { profile, room, food, booking } = data;
  const isPending = !profile;
  const firstName = profile?.first_name ?? booking?.first_name ?? null;
  const lastName = profile?.last_name ?? booking?.last_name ?? null;
  const email = profile?.email ?? booking?.email ?? "";
  const checkIn = profile?.check_in_date ?? booking?.check_in_date ?? null;
  const checkOut = profile?.check_out_date ?? booking?.check_out_date ?? null;
  const guestsCount = profile?.guests_count ?? booking?.guest_count ?? 1;
  const fullName = profile?.full_name ||
    `${firstName || ""} ${lastName || ""}`.trim() ||
    email || "Guest";
  const activeDiets = foodCost.dietBreakdown.filter((d) => d.guests > 0);
  const activeFoodDays = (food?.selections || []).filter(
    (s: any) => s.fullBoard || s.breakfast || s.lunch || s.dinner
  ).sort((a: any, b: any) => a.date.localeCompare(b.date));

  const buildFoodSections = () => {
    const mt = food?.meal_times;
    const times: string[] = [];
    if (mt?.breakfast_time) times.push(`Breakfast ${mt.breakfast_time}`);
    if (mt?.lunch_time) times.push(`Lunch ${mt.lunch_time}`);
    if (mt?.dinner_time) times.push(`Dinner ${mt.dinner_time}`);

    const prefs = activeDiets.map((d) => `${d.label}: ${d.guests}`);

    const days = activeFoodDays.map((s: any) => {
      const meals: string[] = [];
      if (s.fullBoard) meals.push("Full board");
      else {
        if (s.breakfast) meals.push("Breakfast");
        if (s.lunch) meals.push("Lunch");
        if (s.dinner) meals.push("Dinner (+ dessert)");
      }
      return { date: s.date, guests: s.guests_count_day, meals };
    });

    return { times, prefs, days, notes: food?.notes_food || "" };
  };

  const handleCopyFoodInfo = async () => {
    if (!food) return;
    try {
      const { times, prefs, days, notes } = buildFoodSections();
      // Émojis par repas — format pensé pour un copier-coller WhatsApp vers l'équipe
      const mealEmoji = (m: string) =>
        m === "Full board" ? "🍳🥘🍽️ Full board"
        : m === "Breakfast" ? "🍳 Breakfast"
        : m === "Lunch" ? "🥘 Lunch"
        : `🍽️ ${m}`;
      const lines: string[] = [];
      lines.push("🌿 *Quinta do Amor — Catering*");
      const who = [fullName, booking?.retreat_name].filter(Boolean).join(" · ");
      lines.push(`👤 ${who}`);
      lines.push(`📅 ${fmtDate(checkIn)} → ${fmtDate(checkOut)}`);
      lines.push(`👥 ${guestsCount} guests`);
      if (times.length) {
        lines.push("");
        lines.push("🕐 *Meal times*");
        lines.push(times.join(" · "));
      }
      if (prefs.length) {
        lines.push("");
        lines.push("🥗 *Dietary preferences*");
        for (const p of prefs) lines.push(`• ${p}`);
      }
      if (days.length) {
        lines.push("");
        lines.push("📋 *Day by day*");
        for (const d of days) {
          const g = typeof d.guests === "number" ? ` — ${d.guests} guests` : "";
          lines.push("");
          lines.push(`*${fmtDateLong(d.date)}*${g}`);
          lines.push(d.meals.map(mealEmoji).join(" · "));
        }
      }
      if (notes.trim()) {
        lines.push("");
        lines.push("⚠️ *Notes*");
        lines.push(notes.trim());
      }
      await navigator.clipboard.writeText(lines.join("\n"));
      toast({ title: "Catering info copied", description: "Ready to paste in WhatsApp." });
    } catch (e) {
      toast({ title: "Could not copy", description: String((e as any)?.message || e), variant: "destructive" });
    }
  };

  const handlePrintFood = () => {
    if (!food) return;
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const { times, prefs, days, notes } = buildFoodSections();

    const sections: string[] = [];
    if (times.length) {
      sections.push(`<h2>Meal times</h2>`);
      for (const t of times) {
        const [label, ...rest] = t.split(" ");
        sections.push(`<div class="row"><span>${esc(label)}</span><span>${esc(rest.join(" "))}</span></div>`);
      }
    }
    if (prefs.length) {
      sections.push(`<h2>Preferences</h2>`);
      for (const d of activeDiets) {
        sections.push(`<div class="row"><span>${esc(d.label)}</span><span>${d.guests} guest${d.guests !== 1 ? "s" : ""}</span></div>`);
      }
    }
    if (days.length) {
      sections.push(`<h2>Daily meals</h2>`);
      for (const d of days) {
        const g = typeof d.guests === "number" ? ` — ${d.guests} guest${d.guests !== 1 ? "s" : ""}` : "";
        sections.push(
          `<div class="day"><b>${esc(fmtDateLong(d.date))}${esc(g)}</b><ul>${d.meals
            .map((m) => `<li>${esc(m)}</li>`)
            .join("")}</ul></div>`
        );
      }
    }
    if (notes.trim()) {
      sections.push(`<h2>Notes</h2><div class="notes">${esc(notes).replace(/\n/g, "<br/>")}</div>`);
    }
    sections.push(`<div class="total"><span>Food subtotal</span><span>€${foodCost.grandTotal}</span></div>`);

    const w = window.open("", "_blank", "width=800,height=1000");
    if (!w) {
      toast({ title: "Allow pop-ups to print", variant: "destructive" });
      return;
    }
    w.document.write(`<html><head><title>Food — ${esc(fullName)}</title>
      <style>
        body{font-family:system-ui,sans-serif;padding:32px;color:#1a1a1a;}
        h1{font-size:20px;margin:0 0 4px;}
        .sub{color:#666;margin:0 0 20px;font-size:14px;}
        h2{font-size:13px;text-transform:uppercase;color:#888;margin:20px 0 6px;letter-spacing:.05em;}
        .row{display:flex;justify-content:space-between;border-bottom:1px solid #eee;padding:4px 0;font-size:14px;}
        .day{margin:8px 0;font-size:14px;}
        .day b{display:block;}
        .day ul{margin:2px 0 0 18px;padding:0;color:#444;}
        .total{display:flex;justify-content:space-between;font-weight:700;border-top:2px solid #333;margin-top:20px;padding-top:8px;font-size:15px;}
        .notes{background:#faf8f0;border:1px solid #eee;border-radius:8px;padding:10px;font-size:14px;margin-top:8px;}
      </style></head><body>
      <h1>Quinta do Amor — Food</h1>
      <p class="sub">${esc(fullName)} · ${esc(fmtDate(checkIn))} → ${esc(fmtDate(checkOut))} · ${guestsCount} guests</p>
      ${sections.join("\n")}
      </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };


  const isAdminManagedByMe = !!booking?.admin_managed && !!user && booking?.user_id === user.id;

  const openAsGuest = () => {
    if (!booking) return;
    setActiveBookingId(booking.id);
    navigate("/dashboard");
  };

  const releaseBooking = async () => {
    if (!booking) return;
    const ok = confirm(
      "Release this booking from your admin account?\n\nThe booking will become unclaimed and you'll need to regenerate an invite link to send to the guest again."
    );
    if (!ok) return;
    setReleasing(true);
    const { error } = await supabase
      .from("bookings")
      .update({ user_id: null, invitation_claimed: false, admin_managed: false })
      .eq("id", booking.id);
    setReleasing(false);
    if (error) {
      toast({ title: "Could not release booking", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Booking released" });
    await refreshBookings();
    navigate("/admin");
  };


  return (
    <div className="min-h-screen bg-background">
      {/* Sticky header */}
      <header className="border-b border-border bg-card sticky top-0 z-20">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate("/admin")}>
              <ArrowLeft className="w-4 h-4 mr-1" />Back
            </Button>
            <button
              type="button"
              className="text-lg sm:text-xl font-medium truncate text-left hover:underline decoration-primary/60 underline-offset-4"
              title="Open the guest file"
              onClick={() => {
                const key = ((booking as any)?.client_id as string | null) || (email || "").toLowerCase();
                if (key) navigate(`/admin/guests?guest=${encodeURIComponent(key)}`);
              }}
            >
              {fullName}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => booking && window.open(`/dashboard?impersonate=${booking.id}`, "_blank")}
              disabled={!booking}
              title="Open guest dashboard in a new tab"
            >
              <ExternalLink className="w-4 h-4 mr-1" /> Open as guest
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={togglingLock || !booking}
              title="When unlocked, the guest can keep editing even within 3 days of arrival."
              onClick={async () => {
                if (!booking) return;
                const next = !(lockOverride ?? booking.edit_lock_override);
                setTogglingLock(true);
                const { error } = await supabase
                  .from("bookings")
                  .update({ edit_lock_override: next })
                  .eq("id", booking.id);
                setTogglingLock(false);
                if (error) {
                  toast({ title: "Could not update lock", description: error.message, variant: "destructive" });
                } else {
                  setLockOverride(next);
                  (booking as BookingRow).edit_lock_override = next;
                  toast({
                    title: next ? "Editing unlocked" : "Editing lock restored",
                    description: next
                      ? "The guest can now make last-minute changes."
                      : "Standard rules apply again (locked from 3 days before arrival).",
                  });
                }
              }}
            >
              {togglingLock
                ? <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                : (lockOverride ?? booking?.edit_lock_override)
                  ? <Lock className="w-4 h-4 mr-1" />
                  : <LockOpen className="w-4 h-4 mr-1" />}
              {(lockOverride ?? booking?.edit_lock_override) ? "Restore lock" : "Unlock editing"}
            </Button>
            <Button size="sm" variant="outline" onClick={resendEmail} disabled={resending || !data?.profile}>
              {resending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Mail className="w-4 h-4 mr-1" />}
              Resend summary email
            </Button>
            <Button
              size="sm"
              variant={(booking as any)?.is_test ? "secondary" : "ghost"}
              className={(booking as any)?.is_test ? "border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100" : ""}
              title="Test bookings are excluded from dashboard stats and payment totals."
              onClick={async () => {
                if (!booking) return;
                const next = !(booking as any).is_test;
                const { error } = await supabase.from("bookings").update({ is_test: next }).eq("id", booking.id);
                if (error) {
                  toast({ title: "Could not update", description: error.message, variant: "destructive" });
                } else {
                  (booking as any).is_test = next;
                  toast({ title: next ? "Marked as test booking" : "No longer a test booking", description: next ? "Excluded from stats and totals." : "Counted in stats again." });
                  load();
                }
              }}
            >
              <FlaskConical className="w-4 h-4 mr-1" /> {(booking as any)?.is_test ? "Test booking" : "Mark as test"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => window.print()}>Print / PDF</Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="w-4 h-4 mr-1" /> Delete guest
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-3xl space-y-6">
        {isAdminManagedByMe && (
          <section className="rounded-2xl border border-primary/30 bg-primary/5 p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <div className="font-medium">You are managing this booking on behalf of the guest.</div>
              <div className="text-muted-foreground text-xs mt-0.5">
                You can edit Room / Food / Transportation from the guest dashboard.
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={openAsGuest}>
                Open guest dashboard
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={releaseBooking}
                disabled={releasing}
              >
                {releasing ? <Loader2 className="w-4 h-4 animate-spin" /> : "Release this booking"}
              </Button>
            </div>
          </section>
        )}
        {/* Guest header card */}
        <section className="bg-card rounded-2xl border border-border p-6">
          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            <div className="sm:col-span-2">
              <div className="text-muted-foreground">Retreat / event name</div>
              <NameField
                bookingId={booking?.id ?? null}
                value={booking?.retreat_name || null}
                placeholder="Event name"
                field="retreat_name"
                onSaved={(v) => {
                  setData((d) => d ? {
                    ...d,
                    booking: d.booking ? { ...d.booking, retreat_name: v ?? "" } : d.booking,
                  } : d);
                  if (booking) supabase.functions.invoke("sync-booking-calendar", { body: { booking_id: booking.id } }).catch(() => {});
                }}
              />
            </div>
            <div>
              <div className="text-muted-foreground">First name</div>
              <NameField
                bookingId={booking?.id ?? null}
                value={firstName}
                placeholder="First name"
                onSaved={(v) => {
                  setData((d) => d ? {
                    ...d,
                    booking: d.booking ? { ...d.booking, first_name: v } : d.booking,
                    profile: d.profile ? { ...d.profile, first_name: v } : d.profile,
                  } : d);
                }}
              />
            </div>
            <div>
              <div className="text-muted-foreground">Last name</div>
              <NameField
                bookingId={booking?.id ?? null}
                value={lastName}
                placeholder="Last name"
                onSaved={(v) => {
                  setData((d) => d ? {
                    ...d,
                    booking: d.booking ? { ...d.booking, last_name: v } : d.booking,
                    profile: d.profile ? { ...d.profile, last_name: v } : d.profile,
                  } : d);
                }}
              />
            </div>
            <div>
              <div className="text-muted-foreground">Email</div>
              <BookingEmailField
                booking={booking}
                display={email}
                onSaved={(newEmail) => {
                  setData((d) => d ? {
                    ...d,
                    booking: d.booking ? { ...d.booking, email: newEmail } : d.booking,
                    profile: d.profile ? { ...d.profile, email: newEmail } : d.profile,
                  } : d);
                }}
              />
            </div>
            <div>
              <div className="text-muted-foreground flex items-center gap-1"><Users className="w-3 h-3" /> Guests</div>
              <div className="font-medium">{guestsCount}</div>
            </div>
            <div>
              <div className="text-muted-foreground flex items-center gap-1"><Calendar className="w-3 h-3" /> Stay dates</div>
              <div className="font-medium">{fmtDate(checkIn)} → {fmtDate(checkOut)}</div>
            </div>
            <div>
              <div className="text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> Check-in · check-out time</div>
              <div className="mt-0.5 flex items-center gap-1.5">
                {(["check_in_time", "check_out_time"] as const).map((field, i) => (
                  <span key={field} className="flex items-center gap-1.5">
                    {i === 1 && <span className="text-muted-foreground text-xs">→</span>}
                    <input
                      type="time"
                      disabled={!booking}
                      defaultValue={(((booking as any)?.[field] as string | null) ?? (field === "check_in_time" ? "15:00" : "11:00")).slice(0, 5)}
                      className="h-8 rounded-md border border-input bg-background px-2 text-sm font-medium"
                      onBlur={async (e) => {
                        if (!booking) return;
                        const v = e.target.value;
                        const prev = (((booking as any)?.[field] as string | null) ?? (field === "check_in_time" ? "15:00" : "11:00")).slice(0, 5);
                        if (!v || v === prev) return;
                        const { error } = await supabase.from("bookings").update({ [field]: v } as any).eq("id", booking.id);
                        if (error) toast({ title: "Failed to save", description: error.message, variant: "destructive" });
                        else {
                          (booking as any)[field] = v;
                          toast({ title: field === "check_in_time" ? "Check-in time saved" : "Check-out time saved" });
                          // Répercute sur l'événement Google Calendar (no-op tant que le service account n'est pas configuré)
                          supabase.functions.invoke("sync-booking-calendar", { body: { booking_id: booking.id } }).catch(() => {});
                        }
                      }}
                    />
                  </span>
                ))}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Status</div>
              <div className="font-medium">
                {isPending
                  ? "Invitation pending"
                  : getGuestStatus(checkIn, profile!.status_overall).label}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Event type</div>
              <select
                className="mt-0.5 h-8 rounded-md border border-input bg-background px-2 text-sm font-medium"
                value={(booking as any)?.event_type ?? "retreat"}
                disabled={!booking}
                onChange={async (e) => {
                  if (!booking) return;
                  const v = e.target.value;
                  const { error } = await supabase.from("bookings").update({ event_type: v } as any).eq("id", booking.id);
                  if (error) toast({ title: "Failed to save", description: error.message, variant: "destructive" });
                  else {
                    (booking as any).event_type = v;
                    toast({ title: "Event type saved" });
                  }
                }}
              >
                <option value="retreat">Retreat</option>
                <option value="wedding">Wedding</option>
                <option value="other">Other</option>
                <option value="day_retreat">Day retreat</option>
              </select>
            </div>
            <div>
              <div className="text-muted-foreground">Expected catering</div>
              <label className="mt-1.5 flex items-center gap-2 text-sm font-medium cursor-pointer select-none">
                <Checkbox
                  checked={(booking as any)?.catering_expected !== false}
                  disabled={!booking}
                  onCheckedChange={async (v) => {
                    if (!booking) return;
                    const next = v === true;
                    const { error } = await supabase.from("bookings").update({ catering_expected: next } as any).eq("id", booking.id);
                    if (error) toast({ title: "Failed to save", description: error.message, variant: "destructive" });
                    else {
                      (booking as any).catering_expected = next;
                      setData((d) => d ? { ...d } : d);
                      toast({ title: next ? "Included in expected catering" : "Excluded from expected catering" });
                    }
                  }}
                />
                <span className="text-xs text-muted-foreground font-normal">
                  Include in the dashboard catering projection
                </span>
              </label>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-border">
            <WhatsAppLinkEditor
              bookingId={booking?.id ?? null}
              initialValue={booking?.whatsapp_group_url ?? null}
              onSaved={(v) => {
                if (booking) {
                  // mutate local copy so UI reflects immediately
                  (booking as BookingRow).whatsapp_group_url = v;
                }
              }}
            />
          </div>
          {isPending && (
            <p className="mt-4 text-xs italic text-muted-foreground">
              This booking has not been claimed by the guest yet.
            </p>
          )}
        </section>

        {/* Internal Notes (admin-only) */}
        <NotesBlock
          bookingId={booking?.id ?? null}
          initialValue={booking?.internal_notes ?? null}
          onSaved={(v) => { if (booking) (booking as BookingRow).internal_notes = v; }}
        />

        {/* Room Setup */}
        <section className="bg-card rounded-2xl border border-border p-6">
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
            <BedDouble className="w-4 h-4 text-[#35532A]" /> Room Setup
          </h2>
          {booking && (
            <div className="mb-4 pb-4 border-b border-border">
              <div className="text-muted-foreground text-xs uppercase mb-2">Available rooms for this stay</div>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: 11 }, (_, i) => i + 1).map((roomId) => {
                  const disabled = booking.disabled_rooms || [];
                  const enabled = !disabled.includes(roomId);
                  return (
                    <label
                      key={roomId}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs cursor-pointer select-none ${
                        enabled ? 'bg-primary/10 border-primary/30 text-foreground' : 'bg-muted border-border text-muted-foreground'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5"
                        checked={enabled}
                        onChange={async (e) => {
                          const checked = e.target.checked;
                          const current = booking.disabled_rooms || [];
                          const next = checked
                            ? current.filter((r) => r !== roomId)
                            : Array.from(new Set([...current, roomId])).sort((a, b) => a - b);
                          const { error } = await supabase
                            .from('bookings')
                            .update({ disabled_rooms: next })
                            .eq('id', booking.id);
                          if (error) {
                            toast({ title: 'Failed to save', description: error.message, variant: 'destructive' });
                            return;
                          }
                          setData((d) => d && d.booking ? { ...d, booking: { ...d.booking, disabled_rooms: next } } : d);
                          toast({ title: 'Saved' });
                        }}
                      />
                      Room {roomId}
                    </label>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Unchecked rooms won't be shown to the guest.</p>
            </div>
          )}
          {room ? (
            <div className="text-sm space-y-1">
              <Row label="King (en-suite bathroom) — fixed" value="2" />
              <Row label="King size bed (shared bathroom)" value={room.queen_shared_qty} />
              <Row label="Twin (shared bathroom)" value={room.twins_shared_qty} />
              <Row label="King size bed (en-suite bathroom)" value={room.queen_ensuite_qty} />
              <Row label="Twin (en-suite bathroom)" value={room.twins_ensuite_qty} />
              {Array.isArray(room.room_plan) && room.room_plan.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border">
                  <div className="text-muted-foreground text-xs uppercase mb-1">Per-room arrangement</div>
                  <ul className="space-y-1">
                    {[...room.room_plan].sort((a, b) => a.roomId - b.roomId).map((r) => {
                      const bedLabel = r.bedType === 'king'
                        ? 'King'
                        : r.bedType === 'queen'
                          ? 'King size bed'
                          : r.bedType === 'twin'
                            ? 'Twin'
                            : 'Not set';
                      const partner = BATHROOM_PARTNER[r.roomId];
                      const bathSuffix = r.bathroomType === 'shared'
                        ? (partner ? `shared with Room ${partner}` : 'shared')
                        : 'en-suite';
                      const parts = [bedLabel, bathSuffix];
                      if (r.note) parts.push(r.note);
                      const guests = (r.guests || []).map((g) => g.trim()).filter(Boolean);
                      return (
                        <li key={r.roomId} className="text-sm">
                          <span className="font-medium">Room {r.roomId}</span>
                          <span className="text-muted-foreground"> · {parts.join(' · ')}</span>
                          {guests.length > 0 && (
                            <span className="text-muted-foreground"> · {guests.join(', ')}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {(room.remarks_roomsetup || room.remarks) && (
                <div className="mt-3 pt-3 border-t border-border">
                  <div className="text-muted-foreground text-xs uppercase mb-1">Remarks</div>
                  <p className="whitespace-pre-wrap">{room.remarks_roomsetup || room.remarks}</p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">Not set</p>
          )}
        </section>

        {/* Food */}
        <section className="bg-card rounded-2xl border border-border p-6">
          <div className="flex items-center justify-between mb-3 gap-2">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Utensils className="w-4 h-4 text-[#35532A]" /> Food
            </h2>
            {food && (
              <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" onClick={handleCopyFoodInfo}>
                  <Copy className="w-3.5 h-3.5 mr-1" /> Copy info
                </Button>
                <Button size="sm" variant="outline" onClick={handlePrintFood}>
                  <Printer className="w-3.5 h-3.5 mr-1" /> Print
                </Button>
              </div>
            )}
          </div>
          {food ? (
            <div className="space-y-4 text-sm">
              {(() => {
                const mt = food.meal_times;
                const has = mt && (mt.breakfast_time || mt.lunch_time || mt.dinner_time);
                if (!has) return null;
                return (
                  <div>
                    <div className="text-xs uppercase text-muted-foreground mb-1">Meal times</div>
                    <div className="space-y-1">
                      {mt!.breakfast_time && <Row label="Breakfast" value={mt!.breakfast_time} />}
                      {mt!.lunch_time && <Row label="Lunch" value={mt!.lunch_time} />}
                      {mt!.dinner_time && <Row label="Dinner" value={mt!.dinner_time} />}
                    </div>
                  </div>
                );
              })()}

              <div>
                <div className="text-xs uppercase text-muted-foreground mb-1">Food preferences</div>
                {activeDiets.length === 0 ? (
                  <p className="italic text-muted-foreground">No diet assigned</p>
                ) : (
                  <div className="space-y-1">
                    {activeDiets.map((d) => (
                      <Row key={d.type} label={d.label} value={`${d.guests} guest${d.guests !== 1 ? "s" : ""}`} />
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="text-xs uppercase text-muted-foreground mb-1">Daily meal selections</div>
                {activeFoodDays.length === 0 ? (
                  <p className="italic text-muted-foreground">No meals selected</p>
                ) : (
                  <ul className="space-y-2">
                    {activeFoodDays.map((s: any) => {
                      const meals: string[] = [];
                      if (s.fullBoard) meals.push("Full board");
                      else {
                        if (s.breakfast) meals.push("Breakfast");
                        if (s.lunch) meals.push("Lunch");
                        if (s.dinner) meals.push("Dinner (+ dessert)");
                      }
                      return (
                        <li key={s.date}>
                          <div className="font-medium">
                            {fmtDateLong(s.date)}
                            {typeof s.guests_count_day === 'number' && (
                              <span className="text-muted-foreground font-normal"> — {s.guests_count_day} guest{s.guests_count_day !== 1 ? 's' : ''}</span>
                            )}
                          </div>
                          <ul className="list-disc list-inside text-muted-foreground">
                            {meals.map((m) => <li key={m}>{m}</li>)}
                          </ul>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {food.notes_food && (
                <div className="pt-3 border-t border-border">
                  <div className="text-xs uppercase text-muted-foreground mb-1">Notes</div>
                  <p className="whitespace-pre-wrap">{food.notes_food}</p>
                </div>
              )}

              <div className="pt-3 border-t border-border flex justify-between items-center">
                <span className="font-semibold">Food subtotal</span>
                <span className="font-bold text-[#35532A]">€{foodCost.grandTotal}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">Not set</p>
          )}
        </section>

        {/* Transportation */}
        <section className="bg-card rounded-2xl border border-border p-6">
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
            <Car className="w-4 h-4 text-[#35532A]" /> Transportation
          </h2>
          {sortedTrips.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No trips</p>
          ) : (
            <div className="space-y-3 text-sm">
              {sortedTrips.map((t, i) => {
                const pax = passengersByTrip.get(t.id) || [];
                const isCustom = getFixedTripPriceNumeric(t.pickup_location, t.dropoff_location, t.taxi_size) === null;
                const effective = getEffectiveTripPrice(t as any);
                return (
                  <div key={t.id} className="rounded-lg border border-border p-3">
                    <div className="flex justify-between items-start gap-2 mb-1">
                      <div className="font-semibold">Trip {i + 1} — {t.trip_direction}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {t.trip_time}
                      </div>
                    </div>
                    <Row label="Date" value={fmtDateLong(t.trip_date)} />
                    <Row label="Pickup" value={t.pickup_location} />
                    <Row label="Drop-off" value={t.dropoff_location} />
                    <Row label="Vehicle" value={t.taxi_size} />
                    <Row label="Passengers" value={t.passengers_count} />
                    <Row
                      label="Price"
                      value={effective !== null ? `€${effective}` : t.price_estimate}
                    />
                    {isCustom && (
                      <div className="mt-2 pt-2 border-t border-border">
                        <div className="text-xs uppercase text-muted-foreground mb-1">Custom price (admin)</div>
                        <CustomPriceEditor
                          trip={{ id: t.id, custom_price: t.custom_price }}
                          onSaved={(v) => {
                            setData((d) => d ? {
                              ...d,
                              trips: d.trips.map((x) => x.id === t.id ? { ...x, custom_price: v } : x),
                            } : d);
                          }}
                        />
                      </div>
                    )}
                    {pax.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-border">
                        <div className="text-xs uppercase text-muted-foreground mb-1">Passengers</div>
                        <ul className="space-y-1">
                          {pax.map((p) => (
                            <li key={p.id} className="text-xs">
                              <span className="font-medium">{p.first_name}</span>
                              {p.phone && <> · {p.phone}</>}
                              {p.flight_number && <> · Flight {p.flight_number}</>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {isCustom && effective === null && (
                      <p className="text-xs italic text-muted-foreground mt-1">Custom offer — no price set yet.</p>
                    )}
                    <div className="mt-3 pt-3 border-t border-border flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const names = resolveAirportSignNames({
                            passengers: pax,
                            guestFullName: fullName,
                          });
                          if (import.meta.env.DEV) console.log("[airport-sign] trip", { trip_id: t.id, names });
                          const ok = generateAirportSignPdf(names);
                          if (!ok) toast({ title: "Unable to generate airport sign PDF.", variant: "destructive" });
                        }}
                      >
                        <FileDown className="w-4 h-4 mr-1" /> Download airport sign
                      </Button>
                    </div>
                  </div>
                );
              })}
              <div className="pt-3 border-t border-border flex justify-between items-center">
                <span className="font-semibold">Transportation subtotal</span>
                <span className="font-bold text-[#35532A]">€{transportCost.subtotal}</span>
              </div>
              {transportCost.customOfferCount > 0 && (
                <p className="text-xs italic text-muted-foreground">
                  Excludes {transportCost.customOfferCount} custom offer trip{transportCost.customOfferCount !== 1 ? "s" : ""}.
                </p>
              )}
            </div>
          )}
        </section>

        {/* Grand Total */}
        {grandTotal > 0 && (
          <section className="bg-primary/5 rounded-2xl border border-primary/30 p-6 flex justify-between items-center">
            <span className="font-semibold flex items-center gap-2">
              <Euro className="w-4 h-4 text-[#35532A]" /> Estimated total (Food + Transportation)
            </span>
            <span className="text-xl font-bold text-[#35532A]">€{grandTotal}</span>
          </section>
        )}

        {/* Payments */}
        <PaymentSection userId={profile?.user_id ?? booking?.user_id ?? ""} />


        {/* Timestamps */}
        {profile && (
          <section className="text-xs text-muted-foreground text-center pb-6">
            <div>Last updated: {fmtTimestamp(profile.updated_at)}</div>
            {profile.submitted_at && <div>Submitted at: {fmtTimestamp(profile.submitted_at)}</div>}
          </section>
        )}
      </main>

      <DeleteGuestDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        guestId={guestId ?? null}
        guestLabel={fullName}
        onDeleted={() => navigate("/admin")}
      />
    </div>
  );
};

function Row({ label, value }: { label: string; value: any }) {
  return (
    <div className="flex justify-between gap-4 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{String(value ?? "—")}</span>
    </div>
  );
}

// ============================================================
// Payments
// ============================================================

type Booking = {
  id: string;
  total_rental_price: number | null;
  rental_discount: number | null;
  payment_status: "pending" | "deposit_paid" | "paid_in_full" | "overdue";
  payment_status_override: "pending" | "deposit_paid" | "paid_in_full" | "overdue" | null;
  check_in_date: string | null;
  check_out_date: string | null;
  email: string | null;
  first_name: string | null;
  retreat_name: string | null;
};

// TVA par catégorie : rental 23 %, catering 13 %, extra au choix (6/13/23).
const VAT_DEFAULT: Record<string, number> = { rental: 23, catering: 13, extra: 23, discount: 23 };
const exclVatOf = (incl: number, rate: number) => Math.round((incl / (1 + rate / 100)) * 100) / 100;

// Date helpers (return ISO YYYY-MM-DD, local-time)
function toIsoLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function todayIso(): string {
  return toIsoLocal(new Date());
}
function shiftDaysIso(iso: string, days: number): string {
  const d = parseLocalDate(iso);
  d.setDate(d.getDate() + days);
  return toIsoLocal(d);
}
function shiftMonthsIso(iso: string, months: number): string {
  const d = parseLocalDate(iso);
  d.setMonth(d.getMonth() + months);
  return toIsoLocal(d);
}

type Installment = {
  id: string;
  booking_id: string;
  label: string;
  amount_due: number;
  amount_excl_vat: number | null;
  due_date: string | null;
  status: "pending" | "paid";
  category: "rental" | "catering" | "extra" | "discount" | "bar";
  invoice_file_url: string | null;
  invoice_file_name: string | null;
  notes: string | null;
  is_cash?: boolean;
  vat_rate?: number | null;
  group_id?: string | null;
};

const fmtEUR = (v: number | string) => {
  const n = Number(v);
  const s = Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? "−" : ""}€${s}`;
};

type BookingStatus = "pending" | "deposit_paid" | "paid_in_full" | "overdue";

function isOverdue(inst: Installment): boolean {
  if (inst.status === "paid" || !inst.due_date) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return parseLocalDate(inst.due_date) < today;
}

function displayStatus(inst: Installment): "paid" | "overdue" | "pending" {
  if (inst.status === "paid") return "paid";
  if (isOverdue(inst)) return "overdue";
  return "pending";
}

function deriveBookingStatus(installments: Installment[]): BookingStatus {
  const rentals = installments.filter((i) => i.category === "rental");
  if (rentals.length === 0) return "pending";
  if (rentals.some((i) => isOverdue(i))) return "overdue";
  if (rentals.every((i) => i.status === "paid")) return "paid_in_full";
  if (rentals.some((i) => i.status === "paid")) return "deposit_paid";
  return "pending";
}

const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  pending: "Pending",
  deposit_paid: "Deposit paid",
  paid_in_full: "Paid in full",
  overdue: "Overdue",
};

const BOOKING_STATUS_STYLES: Record<BookingStatus, string> = {
  pending: "bg-amber-100 text-amber-900 border-amber-300",
  deposit_paid: "bg-orange-100 text-orange-900 border-orange-300",
  paid_in_full: "bg-green-100 text-green-900 border-green-300",
  overdue: "bg-red-100 text-red-900 border-red-300",
};

const STATUS_STYLES: Record<"pending" | "paid" | "overdue", string> = {
  pending: "bg-amber-100 text-amber-900 border-amber-300",
  paid: "bg-green-100 text-green-900 border-green-300",
  overdue: "bg-red-100 text-red-900 border-red-300",
};

function PaymentSection({ userId }: { userId: string }) {
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const bookingIdParam = searchParams.get("bookingId");

  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [installments, setInstallments] = useState<Installment[]>([]);
  const [editingRental, setEditingRental] = useState(false);
  const [rentalInput, setRentalInput] = useState("");
  const [editingDiscount, setEditingDiscount] = useState(false);
  const [discountInput, setDiscountInput] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteInstId, setDeleteInstId] = useState<string | null>(null);
  const [emailTarget, setEmailTarget] = useState<{ inst: Installment; kind: "request" | "confirmation"; group?: Installment[] } | null>(null);
  // Groupage de paiements : échéances cochées -> bouton flottant "Group
  // payments" -> le groupe est PERSISTÉ (group_id) et affiché dans l'admin ;
  // l'email (un lien Stripe, une fatura-recibo multi-lignes) part quand
  // Geoffroy le décide, depuis le bloc du groupe.
  const [groupSel, setGroupSel] = useState<Set<string>>(new Set());

  const createGroup = async () => {
    const ids = installments.filter((i) => groupSel.has(i.id) && i.status !== "paid" && !i.group_id).map((i) => i.id);
    if (ids.length < 2) return;
    const gid = crypto.randomUUID();
    const { error } = await supabase.from("payment_installments").update({ group_id: gid }).in("id", ids);
    if (error) { toast({ title: "Grouping failed", description: error.message, variant: "destructive" }); return; }
    setInstallments((arr) => arr.map((i) => (ids.includes(i.id) ? { ...i, group_id: gid } : i)));
    setGroupSel(new Set());
    toast({ title: "Payments grouped", description: "Send the request whenever you're ready — one link, one invoice." });
  };

  const ungroup = async (gid: string) => {
    const ids = installments.filter((i) => i.group_id === gid).map((i) => i.id);
    const { error } = await supabase.from("payment_installments").update({ group_id: null }).in("id", ids);
    if (error) { toast({ title: "Ungroup failed", description: error.message, variant: "destructive" }); return; }
    setInstallments((arr) => arr.map((i) => (i.group_id === gid ? { ...i, group_id: null } : i)));
  };

  const paymentGroups = useMemo(() => {
    const m = new Map<string, Installment[]>();
    for (const i of installments) {
      if (!i.group_id) continue;
      const a = m.get(i.group_id) || [];
      a.push(i);
      m.set(i.group_id, a);
    }
    return [...m.entries()];
  }, [installments]);
  const [savingOverride, setSavingOverride] = useState(false);
  const [generating, setGenerating] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    let q = supabase.from("bookings").select("id,total_rental_price,rental_discount,payment_status,payment_status_override,check_in_date,check_out_date,email,first_name,retreat_name");
    if (bookingIdParam) {
      q = q.eq("id", bookingIdParam);
    } else {
      q = q.eq("user_id", userId).order("created_at", { ascending: true }).limit(1);
    }
    const bRes = await q.maybeSingle();

    if (bRes.error || !bRes.data) {
      setBooking(null);
      setInstallments([]);
      setLoading(false);
      return;
    }
    const b = bRes.data as Booking;
    setBooking(b);
    setRentalInput(b.total_rental_price != null ? String(b.total_rental_price) : "");
    setDiscountInput(b.rental_discount != null ? String(b.rental_discount) : "");

    const iRes = await supabase
      .from("payment_installments")
      .select("id,booking_id,label,amount_due,amount_excl_vat,due_date,status,category,invoice_file_url,invoice_file_name,notes,is_cash,vat_rate,group_id")
      .eq("booking_id", b.id)
      .order("due_date", { ascending: true, nullsFirst: false });
    if (!iRes.error) setInstallments((iRes.data || []) as Installment[]);
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, [userId, bookingIdParam]);

  const rentalInst = useMemo(() => installments.filter((i) => i.category === "rental" || i.category === "discount"), [installments]);
  const extraInst = useMemo(() => installments.filter((i) => i.category !== "rental" && i.category !== "discount" && i.category !== "bar"), [installments]);
  // Honesty bar (Revolut) — lignes auto-gérées par revolut-bar-sync, admin only
  const barInst = useMemo(() => installments.filter((i) => i.category === "bar"), [installments]);

  const totals = useMemo(() => {
    const totalDue = rentalInst.reduce((s, i) => s + Number(i.amount_due || 0), 0);
    const totalPaid = rentalInst.filter((i) => i.status === "paid").reduce((s, i) => s + Number(i.amount_due || 0), 0);
    // Convention (définitive, 29 juil. 2026) : total_rental_price = prix de base ;
    // le client paie total − discount. Les échéances somment à total − discount.
    const rental = Math.max(0, Number(booking?.total_rental_price || 0) - Number(booking?.rental_discount || 0));
    const remaining = Math.max(0, rental - totalPaid);
    const pct = rental > 0 ? Math.min(100, (totalPaid / rental) * 100) : 0;
    const mismatch = rental > 0 && rentalInst.length > 0 && Math.abs(totalDue - rental) > 0.001;
    return { totalDue, totalPaid, rental, remaining, pct, mismatch };
  }, [rentalInst, booking]);

  const derivedStatus = useMemo(() => deriveBookingStatus(installments), [installments]);
  const resolvedStatus: BookingStatus = (booking?.payment_status_override as BookingStatus | null) ?? derivedStatus;
  const usingOverride = !!booking?.payment_status_override;

  const saveRental = async () => {
    if (!booking) return;
    const v = rentalInput.trim() === "" ? null : Number(rentalInput);
    if (v !== null && (Number.isNaN(v) || v < 0)) {
      toast({ title: "Invalid amount", variant: "destructive" });
      return;
    }
    const { error } = await supabase.from("bookings").update({ total_rental_price: v }).eq("id", booking.id);
    if (error) {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
      return;
    }
    setBooking({ ...booking, total_rental_price: v });
    setEditingRental(false);
    toast({ title: "Saved" });
  };

  const saveDiscount = async () => {
    if (!booking) return;
    const v = discountInput.trim() === "" ? null : Number(discountInput);
    if (v !== null && (Number.isNaN(v) || v < 0)) {
      toast({ title: "Invalid amount", variant: "destructive" });
      return;
    }
    const { error } = await supabase.from("bookings").update({ rental_discount: v }).eq("id", booking.id);
    if (error) {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
      return;
    }
    setBooking({ ...booking, rental_discount: v });
    setEditingDiscount(false);
    toast({ title: "Saved", description: v ? "The discount will be split pro-rata across rental invoice lines." : undefined });
  };

  const setOverride = async (value: BookingStatus | null) => {
    if (!booking) return;
    setSavingOverride(true);
    const { error } = await supabase.from("bookings").update({ payment_status_override: value }).eq("id", booking.id);
    if (error) {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    } else {
      setBooking({ ...booking, payment_status_override: value });
      toast({ title: value ? "Override saved" : "Override cleared" });
    }
    setSavingOverride(false);
  };

  const uploadInvoiceToPath = async (
    bookingId: string,
    installmentId: string,
    file: File
  ): Promise<{ path: string; name: string } | null> => {
    const allowed = ["application/pdf", "image/jpeg", "image/png"];
    if (!allowed.includes(file.type)) {
      toast({ title: "Unsupported file type", description: "PDF, JPG, or PNG only.", variant: "destructive" });
      return null;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast({ title: "File too large", description: "Max 20MB.", variant: "destructive" });
      return null;
    }
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${bookingId}/${installmentId}/${Date.now()}_${safeName}`;
    const up = await supabase.storage.from("invoices").upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) {
      toast({ title: "Upload failed", description: up.error.message, variant: "destructive" });
      return null;
    }
    return { path, name: file.name };
  };

  const upsertInstallment = async (
    id: string | null,
    values: { label: string; amount_due: number; amount_excl_vat: number | null; due_date: string | null; status: "pending" | "paid"; category: "rental" | "catering" | "extra" | "discount"; notes: string | null; is_cash: boolean; vat_rate: number },
    file?: File | null
  ) => {
    if (!booking) return false;
    const payload: any = {
      booking_id: booking.id,
      label: values.label,
      amount_due: values.amount_due,
      amount_excl_vat: values.amount_excl_vat,
      due_date: values.due_date,
      status: values.status,
      category: values.category,
      notes: values.notes,
      is_cash: values.is_cash,
      vat_rate: values.vat_rate,
    };
    let installmentId = id;
    if (id) {
      const { error } = await supabase.from("payment_installments").update(payload).eq("id", id);
      if (error) {
        toast({ title: "Save failed", description: error.message, variant: "destructive" });
        return false;
      }
    } else {
      const { data, error } = await supabase
        .from("payment_installments")
        .insert(payload)
        .select("id")
        .single();
      if (error || !data) {
        toast({ title: "Save failed", description: error?.message, variant: "destructive" });
        return false;
      }
      installmentId = data.id;
    }
    if (file && installmentId) {
      const existing = id ? installments.find((i) => i.id === id) : null;
      const uploaded = await uploadInvoiceToPath(booking.id, installmentId, file);
      if (uploaded) {
        if (existing?.invoice_file_url) {
          await supabase.storage.from("invoices").remove([existing.invoice_file_url]);
        }
        await supabase
          .from("payment_installments")
          .update({ invoice_file_url: uploaded.path, invoice_file_name: uploaded.name })
          .eq("id", installmentId);
      }
    }
    toast({ title: "Saved" });
    await loadAll();
    return true;
  };

  const deleteInstallment = async () => {
    if (!deleteInstId) return;
    const inst = installments.find((i) => i.id === deleteInstId);
    if (inst?.invoice_file_url) {
      await supabase.storage.from("invoices").remove([inst.invoice_file_url]);
    }
    const { error } = await supabase.from("payment_installments").delete().eq("id", deleteInstId);
    if (error) toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Deleted" }); await loadAll(); }
    setDeleteInstId(null);
  };

  const generate3070 = async () => {
    if (!booking?.total_rental_price || rentalInst.length > 0) return;
    setGenerating(true);
    // Le plan 30/70 porte sur ce que le client paie : total − discount.
    const total = Math.max(0, Number(booking.total_rental_price) - Number(booking.rental_discount || 0));
    const deposit = Math.round(total * 0.3 * 100) / 100;
    const balance = Math.round((total - deposit) * 100) / 100;
    const depositDue = todayIso();
    const balanceDue = booking.check_in_date ? shiftMonthsIso(booking.check_in_date, -2) : null;
    const rows = [
      { label: "Deposit (30%)", amount_due: deposit, due_date: depositDue },
      { label: "Balance (70%)", amount_due: balance, due_date: balanceDue },
    ];
    const { error } = await supabase.from("payment_installments").insert(
      rows.map((r) => ({
        booking_id: booking.id,
        label: r.label,
        amount_due: r.amount_due,
        amount_excl_vat: exclVatOf(r.amount_due, 23),
        vat_rate: 23,
        due_date: r.due_date,
        category: "rental",
        status: "pending",
      }))
    );
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else { toast({ title: "30/70 plan created" }); await loadAll(); }
    setGenerating(false);
  };

  const setPaidStatus = async (inst: Installment, paid: boolean) => {
    const next = paid ? "paid" : "pending";
    const { error } = await supabase.from("payment_installments").update({ status: next }).eq("id", inst.id);
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else await loadAll();
  };

  const downloadInvoice = async (inst: Installment) => {
    if (!inst.invoice_file_url) return;
    const { data, error } = await supabase.storage.from("invoices").createSignedUrl(inst.invoice_file_url, 60 * 60);
    if (error || !data) {
      toast({ title: "Failed to get download URL", description: error?.message, variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const uploadInvoice = async (inst: Installment, file: File) => {
    if (!booking) return;
    const allowed = ["application/pdf", "image/jpeg", "image/png"];
    if (!allowed.includes(file.type)) {
      toast({ title: "Unsupported file type", description: "PDF, JPG, or PNG only.", variant: "destructive" });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast({ title: "File too large", description: "Max 20MB.", variant: "destructive" });
      return;
    }
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${booking.id}/${inst.id}/${Date.now()}_${safeName}`;
    const up = await supabase.storage.from("invoices").upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) {
      toast({ title: "Upload failed", description: up.error.message, variant: "destructive" });
      return;
    }
    // remove old file if any
    if (inst.invoice_file_url) {
      await supabase.storage.from("invoices").remove([inst.invoice_file_url]);
    }
    const { error } = await supabase
      .from("payment_installments")
      .update({ invoice_file_url: path, invoice_file_name: file.name })
      .eq("id", inst.id);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      await supabase.storage.from("invoices").remove([path]);
      return;
    }
    toast({ title: "Invoice uploaded" });
    await loadAll();
  };

  const removeInvoice = async (inst: Installment) => {
    if (!inst.invoice_file_url) return;
    await supabase.storage.from("invoices").remove([inst.invoice_file_url]);
    const { error } = await supabase
      .from("payment_installments")
      .update({ invoice_file_url: null, invoice_file_name: null })
      .eq("id", inst.id);
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Invoice removed" }); await loadAll(); }
  };

  if (loading) {
    return (
      <section className="bg-card rounded-2xl border border-border p-6">
        <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
          <Wallet className="w-4 h-4 text-[#35532A]" /> Payments
        </h2>
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </section>
    );
  }

  if (!booking) {
    return (
      <section className="bg-card rounded-2xl border border-border p-6">
        <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
          <Wallet className="w-4 h-4 text-[#35532A]" /> Payments
        </h2>
        <p className="text-sm text-muted-foreground italic">No booking linked yet.</p>
      </section>
    );
  }

  const renderInstallment = (inst: Installment) => {
    const overdue = inst.status === "pending" && isOverdue(inst);
    return editingId === inst.id ? (
      <InstallmentForm
        key={inst.id}
        initial={inst}
        checkInDate={booking.check_in_date}
        onCancel={() => setEditingId(null)}
        onSave={async (vals, file) => {
          const ok = await upsertInstallment(inst.id, vals, file);
          if (ok) setEditingId(null);
        }}
      />
    ) : (
      <div key={inst.id} className="rounded-lg border border-border p-3 text-sm space-y-2">
        <div className="flex justify-between items-start gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            {inst.status !== "paid" && !inst.is_cash && inst.category !== "discount" && !inst.group_id && Number(inst.amount_due) > 0 && (
              <Checkbox
                checked={groupSel.has(inst.id)}
                onCheckedChange={(v) => setGroupSel((s) => {
                  const n = new Set(s);
                  if (v === true) n.add(inst.id); else n.delete(inst.id);
                  return n;
                })}
                title="Select to group with other payments (one link, one invoice)"
              />
            )}
            <div className="font-semibold truncate">{inst.label}</div>
            {inst.group_id && (
              <span className="text-[10px] uppercase px-1.5 py-0.5 rounded border border-[#CAE8BD] bg-primary/15 text-[#35532A] font-semibold whitespace-nowrap">
                Grouped
              </span>
            )}
            <span className="text-[10px] uppercase px-1.5 py-0.5 rounded border border-border bg-muted text-muted-foreground">
              {inst.category}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
              <Checkbox
                checked={inst.status === "paid"}
                onCheckedChange={(v) => setPaidStatus(inst, v === true)}
              />
              <span>Paid</span>
            </label>
            {overdue && (
              <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_STYLES.overdue}`}>
                Overdue
              </span>
            )}
            {!inst.is_cash && inst.category !== "discount" && booking.email && (
              <Button
                size="icon" variant="ghost" className="h-7 w-7"
                title={inst.status === "paid" ? "Send payment confirmation (invoice attached)" : "Send payment request email"}
                onClick={() => setEmailTarget({ inst, kind: inst.status === "paid" ? "confirmation" : "request" })}
              >
                <Mail className="w-3.5 h-3.5" />
              </Button>
            )}
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingId(inst.id)}>
              <Pencil className="w-3.5 h-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setDeleteInstId(inst.id)}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
        <Row
          label="Amount"
          value={
            inst.is_cash
              ? `${fmtEUR(inst.amount_due)} · cash (no VAT)`
              : inst.amount_excl_vat != null
                ? `${fmtEUR(inst.amount_due)} incl. VAT · ${fmtEUR(inst.amount_excl_vat)} excl. VAT`
                : fmtEUR(inst.amount_due)
          }
        />
        <Row label="Due date" value={fmtDate(inst.due_date)} />
        {inst.notes && (
          <p className="text-xs italic text-muted-foreground whitespace-pre-wrap">{inst.notes}</p>
        )}
        {!inst.is_cash && (
          <InvoiceFileControl
            inst={inst}
            onUpload={(f) => uploadInvoice(inst, f)}
            onDownload={() => downloadInvoice(inst)}
            onRemove={() => removeInvoice(inst)}
          />
        )}
      </div>
    );
  };

  return (
    <section className="bg-card rounded-2xl border border-border p-6 space-y-6">
      <h2 className="text-base font-semibold flex items-center gap-2">
        <Wallet className="w-4 h-4 text-[#35532A]" /> Payments
      </h2>

      {/* Total rental price + discount + status */}
      <div className="grid sm:grid-cols-3 gap-4">
        <div className="space-y-2">
          <div className="text-xs uppercase text-muted-foreground">Total rental price (€)</div>
          {editingRental ? (
            <div className="flex gap-2 items-center">
              <Input
                type="number" min="0" step="0.01"
                value={rentalInput}
                onChange={(e) => setRentalInput(e.target.value)}
                className="max-w-[180px]" autoFocus
              />
              <Button size="sm" onClick={saveRental}><Check className="w-4 h-4" /></Button>
              <Button size="sm" variant="ghost" onClick={() => {
                setEditingRental(false);
                setRentalInput(booking.total_rental_price != null ? String(booking.total_rental_price) : "");
              }}><X className="w-4 h-4" /></Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-[#35532A]">
                {booking.total_rental_price != null ? `€${booking.total_rental_price}` : "—"}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setEditingRental(true)}>
                <Pencil className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-1">
          <div className="text-xs uppercase text-muted-foreground">Discount (€, incl. VAT)</div>
          {editingDiscount ? (
            <div className="flex items-center gap-2">
              <Input
                type="number" min="0" step="0.01"
                value={discountInput}
                onChange={(e) => setDiscountInput(e.target.value)}
                className="max-w-[140px]" autoFocus
              />
              <Button size="sm" onClick={saveDiscount}><Check className="w-4 h-4" /></Button>
              <Button size="sm" variant="ghost" onClick={() => {
                setEditingDiscount(false);
                setDiscountInput(booking.rental_discount != null ? String(booking.rental_discount) : "");
              }}><X className="w-4 h-4" /></Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className={`text-xl font-bold ${booking.rental_discount ? "text-amber-700" : "text-muted-foreground"}`}>
                {booking.rental_discount ? `−€${booking.rental_discount}` : "—"}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setEditingDiscount(true)}>
                <Pencil className="w-4 h-4" />
              </Button>
            </div>
          )}
          <div className="text-[11px] text-muted-foreground">
            Deducted from the total — the client pays total − discount. Shown on invoices, split pro-rata across rental payments.
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs uppercase text-muted-foreground">
            Payment status {usingOverride ? "(override)" : "(automatic)"}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs px-2 py-1 rounded-full border ${BOOKING_STATUS_STYLES[resolvedStatus]}`}>
              {BOOKING_STATUS_LABEL[resolvedStatus]}
            </span>
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              value={booking.payment_status_override ?? ""}
              onChange={(e) => setOverride((e.target.value || null) as BookingStatus | null)}
              disabled={savingOverride}
            >
              <option value="">Automatic</option>
              <option value="pending">Pending</option>
              <option value="deposit_paid">Deposit paid</option>
              <option value="paid_in_full">Paid in full</option>
              <option value="overdue">Overdue</option>
            </select>
            {usingOverride && (
              <Button size="sm" variant="ghost" onClick={() => setOverride(null)} disabled={savingOverride}>
                Clear override
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Progress bar — accommodation only */}
      {totals.rental > 0 && (
        <div className="space-y-1">
          <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-green-500 transition-all" style={{ width: `${totals.pct}%` }} />
          </div>
          <div className="text-xs text-muted-foreground">
            €{totals.totalPaid} paid of €{totals.rental} · €{totals.remaining} remaining
          </div>
          {totals.mismatch && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
              Rental installments (€{totals.totalDue}) do not match rental price (€{totals.rental}).
            </p>
          )}
        </div>
      )}

      {/* Groupes de paiements persistés — l'email part d'ici, quand il veut */}
      {paymentGroups.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs uppercase text-muted-foreground">Grouped payments</div>
          {paymentGroups.map(([gid, members]) => {
            const pending = members.filter((m) => m.status !== "paid");
            const total = members.reduce((s, m) => s + Number(m.amount_due || 0), 0);
            const pendingTotal = pending.reduce((s, m) => s + Number(m.amount_due || 0), 0);
            return (
              <div key={gid} className="rounded-lg border border-[#CAE8BD] bg-primary/10 p-3 text-sm flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="font-semibold">
                    {members.length} payments together · €{total.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {members.map((m) => `${m.label || m.category} (€${Number(m.amount_due).toLocaleString("en-GB", { maximumFractionDigits: 2 })})`).join(" + ")}
                  </div>
                  {pending.length === 0 ? (
                    <div className="text-xs text-[#35532A] font-medium mt-0.5">All paid ✓</div>
                  ) : (
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      One email, one payment link — a single multi-line invoice on payment.
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {pending.length > 0 && booking.email && (
                    <Button
                      size="sm"
                      onClick={() => setEmailTarget({ inst: pending[0], kind: "request", group: pending })}
                    >
                      <Mail className="w-4 h-4 mr-1" />
                      Send request (€{pendingTotal.toLocaleString("en-GB", { maximumFractionDigits: 2 })})
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => ungroup(gid)}>Ungroup</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Rental installments */}
      {/* Top action bar: single Add payment + 30/70 quick action */}
      <div className="flex items-center justify-end flex-wrap gap-2">
        {rentalInst.length === 0 && booking.total_rental_price != null && booking.total_rental_price > 0 && (
          <Button size="sm" variant="outline" onClick={generate3070} disabled={generating}>
            {generating ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            Generate 30/70 plan
          </Button>
        )}
        {!showAdd && (
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="w-4 h-4 mr-1" /> Add payment
          </Button>
        )}
      </div>

      {showAdd && (
        <InstallmentForm
          checkInDate={booking.check_in_date}
          onCancel={() => setShowAdd(false)}
          onSave={async (vals, file) => {
            const ok = await upsertInstallment(null, vals, file);
            if (ok) setShowAdd(false);
          }}
        />
      )}

      {/* Accommodation group */}
      <div className="space-y-3">
        <div className="text-xs uppercase text-muted-foreground">Accommodation</div>
        {rentalInst.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No accommodation payments yet.</p>
        ) : (
          rentalInst.map(renderInstallment)
        )}
      </div>

      {/* Extras group */}
      <div className="space-y-3 pt-2 border-t border-border">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-xs uppercase text-muted-foreground">Extras</div>
          <div className="text-xs text-muted-foreground">
            Subtotal: €{extraInst.reduce((s, i) => s + Number(i.amount_due || 0), 0)}
          </div>
        </div>
        {extraInst.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No extras yet.</p>
        ) : (
          extraInst.map(renderInstallment)
        )}
      </div>

      {/* Honesty bar group — auto (Revolut sync), admin only */}
      {barInst.length > 0 && (
        <div className="space-y-3 pt-2 border-t border-border">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-xs uppercase text-muted-foreground">Honesty bar <span className="normal-case">(auto · Revolut · not visible to the guest)</span></div>
            <div className="text-xs text-muted-foreground">
              Subtotal: €{barInst.reduce((s, i) => s + Number(i.amount_due || 0), 0).toLocaleString("en-GB", { maximumFractionDigits: 2 })}
            </div>
          </div>
          {barInst.map(renderInstallment)}
        </div>
      )}


      {/* Barre flottante de groupage — visible dès 2 échéances cochées */}
      {groupSel.size >= 2 && (() => {
        const selTotal = installments
          .filter((i) => groupSel.has(i.id))
          .reduce((s, i) => s + Number(i.amount_due || 0), 0);
        return (
          <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-full bg-card border border-border shadow-xl pl-4 pr-2 py-2">
            <span className="text-sm font-medium whitespace-nowrap">
              {groupSel.size} selected · €{selTotal.toLocaleString("en-GB", { maximumFractionDigits: 2 })}
            </span>
            <Button size="sm" className="rounded-full" onClick={createGroup}>
              Group payments
            </Button>
            <Button size="sm" variant="ghost" className="rounded-full" onClick={() => setGroupSel(new Set())}>
              Cancel
            </Button>
          </div>
        );
      })()}

      {/* Delete confirm */}
      <AlertDialog open={!!deleteInstId} onOpenChange={(o) => !o && setDeleteInstId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete installment?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone. Any attached invoice file will also be deleted.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteInstallment}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Compose email de paiement (demande / confirmation) */}
      {emailTarget && booking.email && (() => {
        const siblings = installments
          .filter((i) => i.category !== "discount" && Number(i.amount_due) > 0)
          .sort((a, b) => (a.due_date ?? "0000").localeCompare(b.due_date ?? "0000"));
        const idx = siblings.findIndex((i) => i.id === emailTarget.inst.id);
        return (
          <PaymentEmailDialog
            open={!!emailTarget}
            onOpenChange={(v) => { if (!v) setEmailTarget(null); }}
            kind={emailTarget.kind}
            booking={{
              email: booking.email,
              first_name: booking.first_name,
              retreat_name: booking.retreat_name,
              check_in_date: booking.check_in_date,
              check_out_date: booking.check_out_date,
            }}
            inst={emailTarget.inst}
            groupInsts={emailTarget.group}
            ordinal={idx >= 0 ? idx + 1 : 1}
            isLast={idx >= 0 && idx === siblings.length - 1}
            allSettled={siblings.every((i) => i.id === emailTarget.inst.id || i.status === "paid")}
            onSent={() => setGroupSel(new Set())}
          />
        );
      })()}
    </section>
  );
}

function InstallmentForm({
  initial,
  checkInDate,
  onCancel,
  onSave,
}: {
  initial?: Installment;
  checkInDate?: string | null;
  onCancel: () => void;
  onSave: (
    v: { label: string; amount_due: number; amount_excl_vat: number | null; due_date: string | null; status: "pending" | "paid"; category: "rental" | "catering" | "extra" | "discount"; notes: string | null; is_cash: boolean; vat_rate: number },
    file?: File | null
  ) => Promise<void> | void;
}) {
  const [label, setLabel] = useState(initial?.label || "");
  const [amountDue, setAmountDue] = useState(initial?.amount_due != null ? String(Math.abs(initial.amount_due)) : "");
  // TVA choisie au radio (extra ET catering — demande Geoffroy 31 juil. 2026) :
  // extra par défaut 23 %, catering par défaut 13 %, choix 6/13/23 possible.
  const [chosenVat, setChosenVat] = useState<number>(
    (initial?.category === "extra" || initial?.category === "catering") && initial?.vat_rate != null
      ? initial.vat_rate
      : initial?.category === "catering" ? 13 : 23
  );
  const [isCash, setIsCash] = useState(initial?.is_cash ?? false);
  const [dueDate, setDueDate] = useState(initial?.due_date || "");
  const [dueDateTouched, setDueDateTouched] = useState(!!initial?.due_date);
  const [notes, setNotes] = useState(initial?.notes || "");
  const [status, setStatus] = useState<"pending" | "paid">(initial?.status ?? "pending");
  // "bar" est auto-géré par revolut-bar-sync — l'édition retombe sur "extra"
  const [category, setCategory] = useState<"rental" | "catering" | "extra" | "discount">(
    initial?.category === "bar" ? "extra" : (initial?.category ?? "rental")
  );
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);

  // Auto-fill due_date when category changes to "extra" (if not touched)
  useEffect(() => {
    if (initial) return;
    if (dueDateTouched) return;
    if (category !== "rental" && checkInDate) {
      setDueDate(shiftDaysIso(checkInDate, -7));
    } else if (category === "rental") {
      setDueDate("");
    }
  }, [category, checkInDate, dueDateTouched, initial]);

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    e.target.value = "";
    setFile(f);
  };

  // TVA automatique : rental 23 %, catering 13 %, extra au choix (6/13/23).
  // Cash : pas de TVA (HT = TVAC).
  const vatRate = isCash ? 0 : (category === "extra" || category === "catering" ? chosenVat : (VAT_DEFAULT[category] ?? 23));
  const amountNum = Math.abs(Number(amountDue) || 0);
  const computedExcl = isCash ? amountNum : exclVatOf(amountNum, vatRate);

  const submit = async () => {
    if (!label.trim() || !amountDue) return;
    setSaving(true);
    // Remise : saisie en positif, stockée en négatif, toujours 'paid'
    // (jamais en attente, jamais de rappel) — se déduit du revenu.
    const isDiscount = category === "discount";
    const sign = isDiscount ? -1 : 1;
    await onSave(
      {
        label: label.trim(),
        amount_due: sign * amountNum,
        amount_excl_vat: sign * computedExcl,
        due_date: isDiscount ? null : (dueDate || null),
        status: isDiscount ? "paid" : status,
        category,
        notes: notes.trim() || null,
        is_cash: isCash,
        vat_rate: vatRate,
      },
      isCash ? null : file
    );
    setSaving(false);
  };

  return (
    <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-2 text-sm">
      {/* Category toggle */}
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">Category *</div>
        <div className="inline-flex rounded-md border border-input overflow-hidden">
          {(["rental", "catering", "extra", "discount"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => { setCategory(c); setChosenVat(c === "catering" ? 13 : 23); }}
              className={`px-3 py-1.5 text-xs capitalize ${category === c ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-2">
        <label className="space-y-1">
          <div className="text-xs text-muted-foreground">Label *</div>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Deposit, balance, food, taxi, etc." />
        </label>
        <label className="space-y-1">
          <div className="text-xs text-muted-foreground">{isCash ? "Amount (€) *" : "Amount incl. VAT (€) *"}</div>
          <Input type="number" min="0" step="0.01" value={amountDue} onChange={(e) => setAmountDue(e.target.value)} />
        </label>
        {!isCash && (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">VAT</div>
            {category === "extra" || category === "catering" ? (
              <div className="flex items-center gap-3 h-9">
                {[6, 13, 23].map((r) => (
                  <label key={r} className="flex items-center gap-1.5 cursor-pointer select-none text-sm">
                    <input
                      type="radio"
                      name="inst-vat"
                      checked={chosenVat === r}
                      onChange={() => setChosenVat(r)}
                      className="accent-primary"
                    />
                    {r}%
                  </label>
                ))}
                {category === "catering" && <span className="text-[11px] text-muted-foreground">(13% by default)</span>}
              </div>
            ) : (
              <div className="h-9 flex items-center text-sm">{vatRate}% <span className="text-muted-foreground ml-1">({category})</span></div>
            )}
            {amountNum > 0 && (
              <div className="text-[11px] text-muted-foreground">= €{computedExcl.toLocaleString("en-GB", { minimumFractionDigits: 2 })} excl. VAT</div>
            )}
          </div>
        )}
        <label className="flex items-center gap-2 cursor-pointer select-none self-end pb-1.5">
          <Checkbox checked={isCash} onCheckedChange={(v) => setIsCash(v === true)} />
          <span>
            <span className="font-medium">Cash payment</span>
            <span className="block text-xs text-muted-foreground">No VAT (excl. = incl.) · no invoice</span>
          </span>
        </label>
        {category !== "discount" && (
          <label className="space-y-1">
            <div className="text-xs text-muted-foreground">Due date</div>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => { setDueDate(e.target.value); setDueDateTouched(true); }}
            />
          </label>
        )}
        {category !== "discount" && (
          <label className="space-y-1">
            <div className="text-xs text-muted-foreground">Status</div>
            <select
              className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value as "pending" | "paid")}
            >
              <option value="pending">Pending</option>
              <option value="paid">Paid</option>
            </select>
          </label>
        )}
        {category === "discount" && (
          <div className="sm:col-span-2 text-xs text-muted-foreground italic self-end pb-1">
            Enter the discount as a positive amount — it is stored as a deduction and reduces revenue.
          </div>
        )}
      </div>

      {!isCash && (
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">Invoice file (optional)</div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="w-3.5 h-3.5 mr-1" /> {file ? "Replace file" : "Choose file"}
          </Button>
          {file && (
            <>
              <span className="text-xs text-muted-foreground truncate max-w-[200px]">{file.name}</span>
              <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => setFile(null)}>
                <X className="w-3.5 h-3.5" />
              </Button>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            className="hidden"
            onChange={onFileSelected}
          />
        </div>
      </div>
      )}

      <label className="space-y-1 block">
        <div className="text-xs text-muted-foreground">Notes</div>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </label>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={saving || !label.trim() || !amountDue}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
        </Button>
      </div>
    </div>
  );
}

function InvoiceFileControl({
  inst,
  onUpload,
  onDownload,
  onRemove,
}: {
  inst: Installment;
  onUpload: (file: File) => Promise<void> | void;
  onDownload: () => void;
  onRemove: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onPick = () => fileRef.current?.click();

  const onSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    await onUpload(file);
    setBusy(false);
  };

  return (
    <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
      <div className="text-xs text-muted-foreground min-w-0 truncate">
        {inst.invoice_file_url ? (
          <span className="truncate">📎 {inst.invoice_file_name || "Invoice attached"}</span>
        ) : (
          <span className="italic">No invoice file attached</span>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {inst.invoice_file_url ? (
          <>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onDownload} title="Download">
              <Download className="w-3.5 h-3.5" />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onPick} disabled={busy}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Replace"}
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={onRemove} title="Remove invoice">
              <X className="w-3.5 h-3.5" />
            </Button>
          </>
        ) : (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onPick} disabled={busy}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Upload className="w-3.5 h-3.5 mr-1" />}
            Upload invoice
          </Button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          className="hidden"
          onChange={onSelected}
        />
      </div>
    </div>
  );
}





const AdminGuestDetail = () => (
  <ProtectedRoute>
    <AdminGuard>
      <AdminLayout>
        <AdminGuestDetailContent />
      </AdminLayout>
    </AdminGuard>
  </ProtectedRoute>
);

function WhatsAppLinkEditor({
  bookingId,
  initialValue,
  onSaved,
}: {
  bookingId: string | null;
  initialValue: string | null;
  onSaved: (v: string | null) => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string>(initialValue ?? "");
  const [current, setCurrent] = useState<string | null>(initialValue);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCurrent(initialValue);
    setValue(initialValue ?? "");
  }, [initialValue]);

  if (!bookingId) return null;

  const startEdit = () => { setValue(current ?? ""); setEditing(true); };
  const cancel = () => { setValue(current ?? ""); setEditing(false); };

  const save = async () => {
    const trimmed = value.trim();
    const next = trimmed.length ? trimmed : null;
    setSaving(true);
    const { error } = await supabase
      .from("bookings")
      .update({ whatsapp_group_url: next })
      .eq("id", bookingId);
    setSaving(false);
    if (error) {
      toast({ title: "Could not save link", description: error.message, variant: "destructive" });
      return;
    }
    setCurrent(next);
    setEditing(false);
    onSaved(next);
    toast({ title: "WhatsApp link saved" });
  };

  return (
    <div className="text-sm">
      <div className="text-muted-foreground mb-1">WhatsApp group link</div>
      {editing ? (
        <div className="flex items-center gap-2">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="https://chat.whatsapp.com/..."
            className="h-9"
            autoFocus
          />
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          </Button>
          <Button size="sm" variant="ghost" onClick={cancel} disabled={saving}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {current ? (
            <a
              href={current}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium break-all underline text-[#35532A]"
            >
              {current}
            </a>
          ) : (
            <span className="italic text-muted-foreground">Not set</span>
          )}
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={startEdit}>
            <Pencil className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}


function NotesBlock({
  bookingId,
  initialValue,
  onSaved,
}: {
  bookingId: string | null;
  initialValue: string | null;
  onSaved: (value: string | null) => void;
}) {
  const { toast } = useToast();
  const [value, setValue] = useState<string>(initialValue ?? "");
  const [draft, setDraft] = useState<string>(initialValue ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Sync when booking changes
  useEffect(() => {
    setValue(initialValue ?? "");
    setDraft(initialValue ?? "");
    setEditing(false);
  }, [initialValue, bookingId]);

  if (!bookingId) return null;

  const startEdit = () => {
    setDraft(value);
    setEditing(true);
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  const save = async () => {
    setSaving(true);
    const trimmed = draft.trim();
    const next = trimmed.length ? trimmed : null;
    const { error } = await supabase
      .from("bookings")
      .update({ internal_notes: next })
      .eq("id", bookingId);
    setSaving(false);
    if (error) {
      toast({ title: "Could not save note", description: error.message, variant: "destructive" });
      return;
    }
    setValue(next ?? "");
    setEditing(false);
    onSaved(next);
    toast({ title: "Note saved" });
  };

  const hasNote = value.trim().length > 0;

  return (
    <section className="bg-card rounded-2xl border border-border p-6">
      <div className="flex items-start justify-between mb-3 gap-2">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <StickyNote className="w-4 h-4 text-[#35532A]" /> Notes
        </h2>
        {!editing && hasNote && (
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={startEdit} aria-label="Edit note">
            <Pencil className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      {editing ? (
        <div className="space-y-3">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.max(4, draft.split("\n").length)}
            placeholder="Add an internal note for this booking…"
            autoFocus
            className="min-h-[6rem]"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={cancel} disabled={saving}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save"}
            </Button>
          </div>
        </div>
      ) : hasNote ? (
        <p className="text-sm whitespace-pre-wrap">{value}</p>
      ) : (
        <button
          type="button"
          onClick={startEdit}
          className="w-full text-left text-sm italic text-muted-foreground hover:text-foreground transition-colors"
        >
          No notes yet. Click to add one.
        </button>
      )}
    </section>
  );
}


export default AdminGuestDetail;

function NameField({
  bookingId,
  value,
  placeholder,
  field,
  onSaved,
}: {
  bookingId: string | null;
  value: string | null;
  placeholder: string;
  field?: "first_name" | "last_name" | "retreat_name";
  onSaved: (next: string | null) => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [value, editing]);

  if (!bookingId) {
    return <div className="font-medium">{value || "—"}</div>;
  }

  const start = () => {
    setDraft(value ?? "");
    setEditing(true);
  };

  const cancel = () => {
    setDraft(value ?? "");
    setEditing(false);
  };

  const save = async () => {
    const trimmed = draft.trim();
    const next = trimmed.length ? trimmed : null;
    if (next === (value ?? null)) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const patch: Record<string, string | null> = field
      ? { [field]: next }
      : placeholder.toLowerCase().includes("first")
        ? { first_name: next }
        : { last_name: next };
    const { error } = await supabase.from("bookings").update(patch as any).eq("id", bookingId);
    setSaving(false);
    if (error) {
      toast({ title: "Could not save", description: error.message, variant: "destructive" });
      return;
    }
    onSaved(next);
    setEditing(false);
    toast({ title: "Saved" });
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); save(); }
            else if (e.key === "Escape") { e.preventDefault(); cancel(); }
          }}
          disabled={saving}
          placeholder={placeholder}
          className="h-8"
        />
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={save} disabled={saving} aria-label="Save">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
        </Button>
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={cancel} disabled={saving} aria-label="Cancel">
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      className="group inline-flex items-center gap-2 text-left"
      title="Click to edit"
    >
      <span className="font-medium">{value || "—"}</span>
      <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
    </button>
  );
}

// Email du booking, éditable depuis la fiche. À la sauvegarde : met à jour
// bookings.email et rattache le booking à la fiche guest correspondant au
// nouvel email (créée au besoin) — cohérent avec l'onglet Guests.
function BookingEmailField({
  booking,
  display,
  onSaved,
}: {
  booking: { id: string; email: string; first_name: string | null; last_name: string | null } | null;
  display: string;
  onSaved: (newEmail: string) => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(display);
  const [saving, setSaving] = useState(false);

  if (!booking) return <div className="font-medium break-all">{display || "—"}</div>;

  const save = async () => {
    const newEmail = draft.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      toast({ title: "Invalid email", variant: "destructive" });
      return;
    }
    if (newEmail === (booking.email || "").toLowerCase()) { setEditing(false); return; }
    if (!window.confirm(`Change this booking's email to ${newEmail}?\n\nGuest-area invitations and payment reminders will go there.`)) return;
    setSaving(true);
    try {
      // Fiche guest du nouvel email : réutilisée si elle existe, créée sinon.
      let clientId: string | null = null;
      const { data: existing } = await supabase.from("client_profiles").select("id").eq("email", newEmail).maybeSingle();
      if (existing) {
        clientId = existing.id;
      } else {
        const { data: created, error: insErr } = await supabase.from("client_profiles")
          .insert({ email: newEmail, first_name: booking.first_name, last_name: booking.last_name })
          .select("id").single();
        if (insErr) throw insErr;
        clientId = created.id;
      }
      const { error } = await supabase.from("bookings")
        .update({ email: newEmail, client_id: clientId })
        .eq("id", booking.id);
      if (error) throw error;
      onSaved(newEmail);
      setEditing(false);
      toast({ title: "Email updated" });
    } catch (e: any) {
      toast({ title: "Could not save", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          type="email"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); save(); }
            else if (e.key === "Escape") { e.preventDefault(); setDraft(display); setEditing(false); }
          }}
          disabled={saving}
          className="h-8"
        />
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={save} disabled={saving} aria-label="Save">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
        </Button>
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => { setDraft(display); setEditing(false); }} disabled={saving} aria-label="Cancel">
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => { setDraft(display); setEditing(true); }}
      className="group inline-flex items-center gap-2 text-left"
      title="Click to edit"
    >
      <span className="font-medium break-all">{display || "—"}</span>
      <Pencil className="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
    </button>
  );
}
