import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminGuard } from "@/lib/adminGuard";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

interface Detail {
  profile: Profile;
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
  const navigate = useNavigate();
  const { toast } = useToast();
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [resending, setResending] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = async () => {
    if (!guestId) return;
    setLoading(true);
    const res = await supabase.functions.invoke("admin-guest-detail", {
      body: { guest_id: guestId },
    });
    if (res.error) {
      toast({ title: "Error", description: res.error.message, variant: "destructive" });
      setData(null);
    } else {
      setData(res.data as Detail);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [guestId]);

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
    const guestsCount = data?.profile?.guests_count || 1;
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

  if (!data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
        <p>Guest not found.</p>
        <Button onClick={() => navigate("/admin")}><ArrowLeft className="w-4 h-4 mr-1" />Back</Button>
      </div>
    );
  }

  const { profile, room, food } = data;
  const fullName = profile.full_name ||
    `${profile.first_name || ""} ${profile.last_name || ""}`.trim() ||
    profile.email;
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
              <div className="font-medium">{profile.first_name || "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Last name</div>
              <div className="font-medium">{profile.last_name || "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Email</div>
              <div className="font-medium break-all">{profile.email}</div>
            </div>
            <div>
              <div className="text-muted-foreground flex items-center gap-1"><Users className="w-3 h-3" /> Guests</div>
              <div className="font-medium">{profile.guests_count}</div>
            </div>
            <div>
              <div className="text-muted-foreground flex items-center gap-1"><Calendar className="w-3 h-3" /> Stay dates</div>
              <div className="font-medium">{fmtDate(profile.check_in_date)} → {fmtDate(profile.check_out_date)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Status</div>
              <div className="font-medium">{getGuestStatus(profile.check_in_date, profile.status_overall).label}</div>
            </div>
          </div>
        </section>

        {/* Room Setup */}
        <section className="bg-card rounded-2xl border border-border p-6">
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
            <BedDouble className="w-4 h-4 text-primary" /> Room Setup
          </h2>
          {room ? (
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
        <PaymentSection userId={profile.user_id} />


        {/* Timestamps */}
        <section className="text-xs text-muted-foreground text-center pb-6">
          <div>Last updated: {fmtTimestamp(profile.updated_at)}</div>
          {profile.submitted_at && <div>Submitted at: {fmtTimestamp(profile.submitted_at)}</div>}
        </section>
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
};

type Installment = {
  id: string;
  booking_id: string;
  label: string;
  amount_due: number;
  due_date: string | null;
  amount_paid: number;
  paid_at: string | null;
  status: "pending" | "paid" | "overdue" | "partial";
  notes: string | null;
};

type Invoice = {
  id: string;
  booking_id: string;
  type: "rental" | "food" | "transport";
  period: "pre" | "post";
  label: string | null;
  file_url: string;
  file_name: string;
  uploaded_at: string;
};

function computeStatus(amount_due: number, amount_paid: number, due_date: string | null, override?: Installment["status"]): Installment["status"] {
  if (override === "paid" || override === "overdue" || override === "partial" || override === "pending") {
    // allow manual override to pass through only if user changed it explicitly; handled in form
  }
  if (amount_paid >= amount_due && amount_due > 0) return "paid";
  if (amount_paid > 0) return "partial";
  if (due_date) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const d = parseLocalDate(due_date);
    if (d < today && amount_paid === 0) return "overdue";
  }
  return "pending";
}

const STATUS_STYLES: Record<Installment["status"], string> = {
  pending: "bg-amber-100 text-amber-900 border-amber-300",
  paid: "bg-green-100 text-green-900 border-green-300",
  overdue: "bg-red-100 text-red-900 border-red-300",
  partial: "bg-orange-100 text-orange-900 border-orange-300",
};

function PaymentSection({ userId }: { userId: string }) {
  const { toast } = useToast();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [installments, setInstallments] = useState<Installment[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [editingRental, setEditingRental] = useState(false);
  const [rentalInput, setRentalInput] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteInstId, setDeleteInstId] = useState<string | null>(null);
  const [deleteInvId, setDeleteInvId] = useState<string | null>(null);

  const loadAll = async () => {
    setLoading(true);
    const bRes = await supabase
      .from("bookings")
      .select("id,total_rental_price")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (bRes.error || !bRes.data) {
      setBooking(null);
      setInstallments([]);
      setInvoices([]);
      setLoading(false);
      return;
    }
    const b = bRes.data as Booking;
    setBooking(b);
    setRentalInput(b.total_rental_price != null ? String(b.total_rental_price) : "");

    const [iRes, vRes] = await Promise.all([
      supabase.from("payment_installments").select("*").eq("booking_id", b.id).order("due_date", { ascending: true, nullsFirst: false }),
      supabase.from("invoices").select("*").eq("booking_id", b.id).order("uploaded_at", { ascending: false }),
    ]);
    if (!iRes.error) setInstallments((iRes.data || []) as Installment[]);
    if (!vRes.error) setInvoices((vRes.data || []) as Invoice[]);
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, [userId]);

  const totals = useMemo(() => {
    const totalDue = installments.reduce((s, i) => s + Number(i.amount_due || 0), 0);
    const totalPaid = installments.reduce((s, i) => s + Number(i.amount_paid || 0), 0);
    const rental = Number(booking?.total_rental_price || 0);
    const remaining = Math.max(0, rental - totalPaid);
    const pct = rental > 0 ? Math.min(100, (totalPaid / rental) * 100) : 0;
    return { totalDue, totalPaid, rental, remaining, pct };
  }, [installments, booking]);

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

  const upsertInstallment = async (id: string | null, values: Omit<Installment, "id" | "booking_id" | "status"> & { status?: Installment["status"] }) => {
    if (!booking) return;
    const status = values.status ?? computeStatus(Number(values.amount_due), Number(values.amount_paid), values.due_date);
    const payload: any = {
      booking_id: booking.id,
      label: values.label,
      amount_due: Number(values.amount_due),
      amount_paid: Number(values.amount_paid || 0),
      due_date: values.due_date || null,
      paid_at: values.paid_at || null,
      notes: values.notes || null,
      status,
    };
    let error;
    if (id) {
      ({ error } = await supabase.from("payment_installments").update(payload).eq("id", id));
    } else {
      ({ error } = await supabase.from("payment_installments").insert(payload));
    }
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return false;
    }
    toast({ title: "Saved" });
    await loadAll();
    return true;
  };

  const deleteInstallment = async () => {
    if (!deleteInstId) return;
    const { error } = await supabase.from("payment_installments").delete().eq("id", deleteInstId);
    if (error) toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Deleted" }); await loadAll(); }
    setDeleteInstId(null);
  };

  const deleteInvoice = async () => {
    if (!deleteInvId) return;
    const inv = invoices.find((i) => i.id === deleteInvId);
    if (inv) {
      // file_url stores the storage path
      await supabase.storage.from("invoices").remove([inv.file_url]);
    }
    const { error } = await supabase.from("invoices").delete().eq("id", deleteInvId);
    if (error) toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Deleted" }); await loadAll(); }
    setDeleteInvId(null);
  };

  const downloadInvoice = async (inv: Invoice) => {
    const { data, error } = await supabase.storage.from("invoices").createSignedUrl(inv.file_url, 60 * 60);
    if (error || !data) {
      toast({ title: "Failed to get download URL", description: error?.message, variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
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
        <p className="text-sm text-muted-foreground italic">No booking found for this guest.</p>
      </section>
    );
  }

  return (
    <section className="bg-card rounded-2xl border border-border p-6 space-y-6">
      <h2 className="text-base font-semibold flex items-center gap-2">
        <Wallet className="w-4 h-4 text-primary" /> Payments
      </h2>

      {/* Total rental price */}
      <div className="space-y-2">
        <div className="text-xs uppercase text-muted-foreground">Total rental price (€)</div>
        {editingRental ? (
          <div className="flex gap-2 items-center">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={rentalInput}
              onChange={(e) => setRentalInput(e.target.value)}
              className="max-w-[180px]"
              autoFocus
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

      {/* Progress bar */}
      {totals.rental > 0 && (
        <div className="space-y-1">
          <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all"
              style={{ width: `${totals.pct}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>€{totals.totalPaid} paid of €{totals.rental}</span>
            <span>Remaining €{totals.remaining}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Installments scheduled: €{totals.totalDue}
          </div>
        </div>
      )}

      {/* Installments */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase text-muted-foreground">Installments</div>
          {!showAdd && (
            <Button size="sm" variant="outline" onClick={() => setShowAdd(true)}>
              <Plus className="w-4 h-4 mr-1" /> Add installment
            </Button>
          )}
        </div>

        {installments.length === 0 && !showAdd && (
          <p className="text-sm text-muted-foreground italic">No installments yet.</p>
        )}

        {installments.map((inst) =>
          editingId === inst.id ? (
            <InstallmentForm
              key={inst.id}
              initial={inst}
              onCancel={() => setEditingId(null)}
              onSave={async (vals) => {
                const ok = await upsertInstallment(inst.id, vals);
                if (ok) setEditingId(null);
              }}
            />
          ) : (
            <div key={inst.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex justify-between items-start gap-2 mb-1">
                <div className="font-semibold">{inst.label}</div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_STYLES[inst.status]}`}>
                    {inst.status}
                  </span>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingId(inst.id)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setDeleteInstId(inst.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              <Row label="Amount due" value={`€${inst.amount_due}`} />
              <Row label="Due date" value={fmtDate(inst.due_date)} />
              <Row label="Amount paid" value={`€${inst.amount_paid}`} />
              <Row label="Paid at" value={fmtDate(inst.paid_at)} />
              {inst.notes && (
                <p className="mt-2 text-xs italic text-muted-foreground whitespace-pre-wrap">{inst.notes}</p>
              )}
            </div>
          )
        )}

        {showAdd && (
          <InstallmentForm
            onCancel={() => setShowAdd(false)}
            onSave={async (vals) => {
              const ok = await upsertInstallment(null, vals);
              if (ok) setShowAdd(false);
            }}
          />
        )}
      </div>

      {/* Invoices */}
      <div className="space-y-4 pt-2 border-t border-border">
        <div className="text-xs uppercase text-muted-foreground">Invoices</div>
        {(["rental", "food", "transport"] as const).map((cat) => (
          <InvoiceCategory
            key={cat}
            category={cat}
            bookingId={booking.id}
            invoices={invoices.filter((i) => i.type === cat)}
            onUploaded={loadAll}
            onDownload={downloadInvoice}
            onDelete={(id) => setDeleteInvId(id)}
          />
        ))}
      </div>

      {/* Delete confirms */}
      <AlertDialog open={!!deleteInstId} onOpenChange={(o) => !o && setDeleteInstId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete installment?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteInstallment}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteInvId} onOpenChange={(o) => !o && setDeleteInvId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete invoice?</AlertDialogTitle>
            <AlertDialogDescription>The file will be removed from storage.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteInvoice}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function InstallmentForm({
  initial,
  onCancel,
  onSave,
}: {
  initial?: Installment;
  onCancel: () => void;
  onSave: (v: Omit<Installment, "id" | "booking_id">) => Promise<void> | void;
}) {
  const [label, setLabel] = useState(initial?.label || "");
  const [amountDue, setAmountDue] = useState(initial?.amount_due != null ? String(initial.amount_due) : "");
  const [dueDate, setDueDate] = useState(initial?.due_date || "");
  const [amountPaid, setAmountPaid] = useState(initial?.amount_paid != null ? String(initial.amount_paid) : "0");
  const [paidAt, setPaidAt] = useState(initial?.paid_at || "");
  const [notes, setNotes] = useState(initial?.notes || "");
  const [status, setStatus] = useState<Installment["status"] | "auto">(initial ? initial.status : "auto");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!label.trim() || !amountDue) return;
    setSaving(true);
    const due = Number(amountDue);
    const paid = Number(amountPaid || 0);
    const resolvedStatus = status === "auto"
      ? computeStatus(due, paid, dueDate || null)
      : status;
    await onSave({
      label: label.trim(),
      amount_due: due,
      due_date: dueDate || null,
      amount_paid: paid,
      paid_at: paidAt || null,
      notes: notes.trim() || null,
      status: resolvedStatus,
    });
    setSaving(false);
  };

  return (
    <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-2 text-sm">
      <div className="grid sm:grid-cols-2 gap-2">
        <label className="space-y-1">
          <div className="text-xs text-muted-foreground">Label *</div>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Deposit, balance, etc." />
        </label>
        <label className="space-y-1">
          <div className="text-xs text-muted-foreground">Amount due (€) *</div>
          <Input type="number" min="0" step="0.01" value={amountDue} onChange={(e) => setAmountDue(e.target.value)} />
        </label>
        <label className="space-y-1">
          <div className="text-xs text-muted-foreground">Due date</div>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
        <label className="space-y-1">
          <div className="text-xs text-muted-foreground">Amount paid (€)</div>
          <Input type="number" min="0" step="0.01" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} />
        </label>
        <label className="space-y-1">
          <div className="text-xs text-muted-foreground">Paid at</div>
          <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        </label>
        <label className="space-y-1">
          <div className="text-xs text-muted-foreground">Status</div>
          <select
            className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as any)}
          >
            <option value="auto">Auto</option>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="partial">Partial</option>
            <option value="overdue">Overdue</option>
          </select>
        </label>
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

function InvoiceCategory({
  category,
  bookingId,
  invoices,
  onUploaded,
  onDownload,
  onDelete,
}: {
  category: "rental" | "food" | "transport";
  bookingId: string;
  invoices: Invoice[];
  onUploaded: () => void | Promise<void>;
  onDownload: (inv: Invoice) => void;
  onDelete: (id: string) => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [label, setLabel] = useState("");
  const [period, setPeriod] = useState<"pre" | "post">("pre");

  const onPick = () => fileRef.current?.click();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const allowed = ["application/pdf", "image/jpeg", "image/png"];
    if (!allowed.includes(file.type)) {
      toast({ title: "Unsupported file type", description: "PDF, JPG, or PNG only.", variant: "destructive" });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast({ title: "File too large", description: "Max 20MB.", variant: "destructive" });
      return;
    }
    setUploading(true);
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${bookingId}/${category}/${Date.now()}_${safeName}`;
    const up = await supabase.storage.from("invoices").upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (up.error) {
      toast({ title: "Upload failed", description: up.error.message, variant: "destructive" });
      setUploading(false);
      return;
    }
    const { error } = await supabase.from("invoices").insert({
      booking_id: bookingId,
      type: category,
      period,
      label: label.trim() || null,
      file_url: path,
      file_name: file.name,
    });
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      await supabase.storage.from("invoices").remove([path]);
    } else {
      toast({ title: "Uploaded" });
      setLabel("");
      await onUploaded();
    }
    setUploading(false);
  };

  return (
    <div className="rounded-lg border border-border p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-medium capitalize">{category}</div>
        <div className="flex items-center gap-2">
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            value={period}
            onChange={(e) => setPeriod(e.target.value as "pre" | "post")}
          >
            <option value="pre">Pre</option>
            <option value="post">Post</option>
          </select>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (optional)"
            className="h-8 text-xs max-w-[180px]"
          />
          <Button size="sm" variant="outline" onClick={onPick} disabled={uploading}>
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Upload className="w-4 h-4 mr-1" /> Upload</>}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            className="hidden"
            onChange={onFile}
          />
        </div>
      </div>
      {invoices.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">No invoices.</p>
      ) : (
        <ul className="space-y-1">
          {invoices.map((inv) => (
            <li key={inv.id} className="flex items-center justify-between gap-2 text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <span className="truncate">{inv.label || inv.file_name}</span>
                <span className="text-[10px] uppercase px-1.5 py-0.5 rounded border border-border bg-muted text-muted-foreground">
                  {inv.period}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onDownload(inv)}>
                  <Download className="w-3.5 h-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => onDelete(inv.id)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
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
