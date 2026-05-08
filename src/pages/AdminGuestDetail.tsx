import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { isAdminEmail } from "@/lib/admin";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, BedDouble, Utensils, Car, Loader2, Mail, Euro, Users, Calendar, Clock, Trash2,
} from "lucide-react";
import { DeleteGuestDialog } from "@/components/admin/DeleteGuestDialog";
import { calculateFoodCostMulti } from "@/lib/foodPricing";
import { calculateTransportationCost, getTripPriceNumeric } from "@/lib/transportationPricing";
import { EMPTY_DIET_CONFIG, type DietConfig } from "@/types/guest";

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
  passengers_count: number; taxi_size: "4 seats" | "6 seats";
  price_estimate: string;
};
type Passenger = {
  id: string; user_id: string; trip_id: string;
  first_name: string; phone: string; flight_number: string | null;
};
type FoodPlan = {
  user_id: string; selections: any[]; diet_preference: string | null;
  diet_config: DietConfig | null; notes_food: string | null; status_food: string;
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
  const { user, signOut } = useAuth();
  const { guestId } = useParams<{ guestId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [resending, setResending] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (!isAdminEmail(user?.email)) return <Navigate to="/dashboard" replace />;

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
  const grandTotal = foodCost.grandTotal + transportCost.fixedPriceTotal;

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
            tripCount: transportCost.totalTrips,
            totalPrice: transportCost.fixedPriceTotal,
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
                const isCustom = getTripPriceNumeric(t.pickup_location, t.dropoff_location, t.taxi_size) === null;
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
                    <Row label="Price" value={t.price_estimate} />
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
                    {isCustom && <p className="text-xs italic text-muted-foreground mt-1">Custom offer — quoted separately.</p>}
                  </div>
                );
              })}
              <div className="pt-3 border-t border-border flex justify-between items-center">
                <span className="font-semibold">Transportation subtotal</span>
                <span className="font-bold text-primary">€{transportCost.fixedPriceTotal}</span>
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

const AdminGuestDetail = () => (
  <ProtectedRoute>
    <AdminGuestDetailContent />
  </ProtectedRoute>
);

export default AdminGuestDetail;
