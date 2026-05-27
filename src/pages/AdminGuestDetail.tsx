import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminGuard } from "@/lib/adminGuard";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, BedDouble, Utensils, Car, Loader2, Mail, Euro, Users, Calendar, Clock, Trash2, FileDown,
  Pencil, Check, X, Plus, Download, Upload, Wallet,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { generateAirportSignPdf, resolveAirportSignNames } from "@/lib/airportSignPdf";
import { DeleteGuestDialog } from "@/components/admin/DeleteGuestDialog";
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
type Room = {
  user_id: string; queen_shared_qty: number; twins_shared_qty: number;
  queen_ensuite_qty: number; twins_ensuite_qty: number;
  remarks_roomsetup: string | null; remarks: string | null; status_roomsetup: string;
  updated_at: string;
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
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [resending, setResending] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

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
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
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

  return (
    <div className="min-h-screen bg-background">
      {/* Sticky header */}
      <header className="border-b border-border bg-card sticky top-0 z-20">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate("/admin")}>
              <ArrowLeft className="w-4 h-4 mr-1" />Back
            </Button>
            <h1 className="text-lg sm:text-xl font-medium truncate">{fullName}</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={resendEmail} disabled={resending}>
              {resending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Mail className="w-4 h-4 mr-1" />}
              Resend summary email
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
        {/* Guest header card */}
        <section className="bg-card rounded-2xl border border-border p-6">
          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-muted-foreground">First name</div>
              <div className="font-medium">{firstName || "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Last name</div>
              <div className="font-medium">{lastName || "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Email</div>
              <div className="font-medium break-all">{email || "—"}</div>
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
              <div className="text-muted-foreground">Status</div>
              <div className="font-medium">
                {isPending
                  ? "Invitation pending"
                  : getGuestStatus(checkIn, profile!.status_overall).label}
              </div>
            </div>
          </div>
          {isPending && (
            <p className="mt-4 text-xs italic text-muted-foreground">
              This booking has not been claimed by the guest yet.
            </p>
          )}
        </section>

        {/* Room Setup */}
        <section className="bg-card rounded-2xl border border-border p-6">
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
            <BedDouble className="w-4 h-4 text-primary" /> Room Setup
          </h2>
          {isPending ? (
            <p className="text-sm text-muted-foreground italic">This booking has not been claimed by the guest yet.</p>
          ) : room ? (
            <div className="text-sm space-y-1">
              <Row label="King (en-suite bathroom) — fixed" value="2" />
              <Row label="Queen (shared bathroom)" value={room.queen_shared_qty} />
              <Row label="Twin (shared bathroom)" value={room.twins_shared_qty} />
              <Row label="Queen (en-suite bathroom)" value={room.queen_ensuite_qty} />
              <Row label="Twin (en-suite bathroom)" value={room.twins_ensuite_qty} />
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
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
            <Utensils className="w-4 h-4 text-primary" /> Food
          </h2>
          {isPending ? (
            <p className="text-sm text-muted-foreground italic">This booking has not been claimed by the guest yet.</p>
          ) : food ? (
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
                <span className="font-bold text-primary">€{foodCost.grandTotal}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">Not set</p>
          )}
        </section>

        {/* Transportation */}
        <section className="bg-card rounded-2xl border border-border p-6">
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
            <Car className="w-4 h-4 text-primary" /> Transportation
          </h2>
          {isPending ? (
            <p className="text-sm text-muted-foreground italic">This booking has not been claimed by the guest yet.</p>
          ) : sortedTrips.length === 0 ? (
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
                <span className="font-bold text-primary">€{transportCost.subtotal}</span>
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
              <Euro className="w-4 h-4 text-primary" /> Estimated total (Food + Transportation)
            </span>
            <span className="text-xl font-bold text-primary">€{grandTotal}</span>
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
  payment_status: "pending" | "deposit_paid" | "paid_in_full" | "overdue";
  payment_status_override: "pending" | "deposit_paid" | "paid_in_full" | "overdue" | null;
  check_in_date: string | null;
};

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
  due_date: string | null;
  status: "pending" | "paid";
  category: "rental" | "extra";
  invoice_file_url: string | null;
  invoice_file_name: string | null;
  notes: string | null;
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
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteInstId, setDeleteInstId] = useState<string | null>(null);
  const [savingOverride, setSavingOverride] = useState(false);
  const [generating, setGenerating] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    let q = supabase.from("bookings").select("id,total_rental_price,payment_status,payment_status_override,check_in_date");
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

    const iRes = await supabase
      .from("payment_installments")
      .select("id,booking_id,label,amount_due,due_date,status,category,invoice_file_url,invoice_file_name,notes")
      .eq("booking_id", b.id)
      .order("due_date", { ascending: true, nullsFirst: false });
    if (!iRes.error) setInstallments((iRes.data || []) as Installment[]);
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, [userId, bookingIdParam]);

  const rentalInst = useMemo(() => installments.filter((i) => i.category === "rental"), [installments]);
  const extraInst = useMemo(() => installments.filter((i) => i.category === "extra"), [installments]);

  const totals = useMemo(() => {
    const totalDue = rentalInst.reduce((s, i) => s + Number(i.amount_due || 0), 0);
    const totalPaid = rentalInst.filter((i) => i.status === "paid").reduce((s, i) => s + Number(i.amount_due || 0), 0);
    const rental = Number(booking?.total_rental_price || 0);
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
    values: { label: string; amount_due: number; due_date: string | null; status: "pending" | "paid"; category: "rental" | "extra"; notes: string | null },
    file?: File | null
  ) => {
    if (!booking) return false;
    const payload: any = {
      booking_id: booking.id,
      label: values.label,
      amount_due: values.amount_due,
      due_date: values.due_date,
      status: values.status,
      category: values.category,
      notes: values.notes,
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
    const total = Number(booking.total_rental_price);
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
          <Wallet className="w-4 h-4 text-primary" /> Payments
        </h2>
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </section>
    );
  }

  if (!booking) {
    return (
      <section className="bg-card rounded-2xl border border-border p-6">
        <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
          <Wallet className="w-4 h-4 text-primary" /> Payments
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
            <div className="font-semibold truncate">{inst.label}</div>
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
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingId(inst.id)}>
              <Pencil className="w-3.5 h-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setDeleteInstId(inst.id)}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
        <Row label="Amount" value={`€${inst.amount_due}`} />
        <Row label="Due date" value={fmtDate(inst.due_date)} />
        {inst.notes && (
          <p className="text-xs italic text-muted-foreground whitespace-pre-wrap">{inst.notes}</p>
        )}
        <InvoiceFileControl
          inst={inst}
          onUpload={(f) => uploadInvoice(inst, f)}
          onDownload={() => downloadInvoice(inst)}
          onRemove={() => removeInvoice(inst)}
        />
      </div>
    );
  };

  return (
    <section className="bg-card rounded-2xl border border-border p-6 space-y-6">
      <h2 className="text-base font-semibold flex items-center gap-2">
        <Wallet className="w-4 h-4 text-primary" /> Payments
      </h2>

      {/* Total rental price + status */}
      <div className="grid sm:grid-cols-2 gap-4">
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
              <span className="text-xl font-bold text-primary">
                {booking.total_rental_price != null ? `€${booking.total_rental_price}` : "—"}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setEditingRental(true)}>
                <Pencil className="w-4 h-4" />
              </Button>
            </div>
          )}
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
    v: { label: string; amount_due: number; due_date: string | null; status: "pending" | "paid"; category: "rental" | "extra"; notes: string | null },
    file?: File | null
  ) => Promise<void> | void;
}) {
  const [label, setLabel] = useState(initial?.label || "");
  const [amountDue, setAmountDue] = useState(initial?.amount_due != null ? String(initial.amount_due) : "");
  const [dueDate, setDueDate] = useState(initial?.due_date || "");
  const [dueDateTouched, setDueDateTouched] = useState(!!initial?.due_date);
  const [notes, setNotes] = useState(initial?.notes || "");
  const [status, setStatus] = useState<"pending" | "paid">(initial?.status ?? "pending");
  const [category, setCategory] = useState<"rental" | "extra">(initial?.category ?? "rental");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);

  // Auto-fill due_date when category changes to "extra" (if not touched)
  useEffect(() => {
    if (initial) return;
    if (dueDateTouched) return;
    if (category === "extra" && checkInDate) {
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

  const submit = async () => {
    if (!label.trim() || !amountDue) return;
    setSaving(true);
    await onSave(
      {
        label: label.trim(),
        amount_due: Number(amountDue),
        due_date: dueDate || null,
        status,
        category,
        notes: notes.trim() || null,
      },
      file
    );
    setSaving(false);
  };

  return (
    <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-2 text-sm">
      {/* Category toggle */}
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">Category *</div>
        <div className="inline-flex rounded-md border border-input overflow-hidden">
          {(["rental", "extra"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
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
          <div className="text-xs text-muted-foreground">Amount (€) *</div>
          <Input type="number" min="0" step="0.01" value={amountDue} onChange={(e) => setAmountDue(e.target.value)} />
        </label>
        <label className="space-y-1">
          <div className="text-xs text-muted-foreground">Due date</div>
          <Input
            type="date"
            value={dueDate}
            onChange={(e) => { setDueDate(e.target.value); setDueDateTouched(true); }}
          />
        </label>
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
      </div>

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
      <AdminGuestDetailContent />
    </AdminGuard>
  </ProtectedRoute>
);

export default AdminGuestDetail;
