import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveBooking } from '@/contexts/BookingContext';
import { useGuestProfile } from '@/hooks/useGuestProfile';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { getGuestStatus } from '@/lib/editLock';
import { calculateFoodCostMulti } from '@/lib/foodPricing';
import { calculateTransportationCost } from '@/lib/transportationPricing';
import { GuestAreaHeader } from '@/components/guest-area/GuestAreaHeader';
import { StayDatesPicker } from '@/components/guest-area/StayDatesPicker';
import { ToolTile } from '@/components/guest-area/ToolTile';
import { GlobalSummary } from '@/components/guest-area/GlobalSummary';
import { EditLockBanner } from '@/components/guest-area/EditLockBanner';
import { ProfileCompletionModal } from '@/components/guest-area/ProfileCompletionModal';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { featureFlags } from '@/lib/featureFlags';
import { isAdminEmail } from '@/lib/admin';
import { Button } from '@/components/ui/button';
import { Loader2, Send, RefreshCw, LogOut, AlertCircle, CreditCard, Download, Utensils, Car, FileText, MessageCircle, Sun, Cloud, CloudSun, CloudRain, CloudSnow, CloudLightning, CloudFog } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { FoodDaySelection, TransportationTrip, DietConfig } from '@/types/guest';
import { dietConfigTotal, EMPTY_DIET_CONFIG } from '@/types/guest';
import { usePaymentData, type PaymentInstallment } from '@/hooks/usePaymentData';

const DashboardContent = () => {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const { bookingsPersonal, activeBookingId, activeBooking, isImpersonating, isLoading: bookingsLoading } = useActiveBooking();
  const queryClient = useQueryClient();
  
  const { 
    profile, 
    toolStatuses, 
    isLoading, 
    hasDatesSet,
    needsProfileCompletion,
    error,
    timedOut,
    updateCheckInDate,
    updateCheckOutDate,
    updateGuestsCount,
    completeProfile,
    submitProfile,
    refreshProfile,
    retryLoad,
  } = useGuestProfile();

  const [roomSetupData, setRoomSetupData] = useState<any>(null);
  const [transportationTrips, setTransportationTrips] = useState<TransportationTrip[]>([]);
  const [foodData, setFoodData] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Stay dates and guest count come from the active booking (source of truth).
  // profile is only used for name and status_overall.
  const bookingCheckIn = activeBooking?.check_in_date ?? null;
  const bookingCheckOut = activeBooking?.check_out_date ?? null;
  const bookingGuestsCount = activeBooking?.guest_count ?? 1;

  const guestStatus = getGuestStatus(bookingCheckIn, profile?.status_overall ?? 'draft', {
    unlocked: isImpersonating || !!activeBooking?.edit_lock_override,
  });
  const isLocked = guestStatus.isEditingLocked;

  const transportationData = useMemo(() => {
    if (transportationTrips.length === 0) return null;
    return calculateTransportationCost(transportationTrips);
  }, [transportationTrips]);

  // Diet validation: total assigned guests must not exceed guests_count
  const dietConfig: DietConfig | null = foodData?.dietConfig || null;
  const dietExceedsGuests = !!dietConfig && dietConfigTotal(dietConfig) > bookingGuestsCount;

  // Fetch summary data for tools
  useEffect(() => {
    const fetchSummaryData = async () => {
      if (!user || !profile) return;

      const scope = <T extends { eq: any }>(q: T) =>
        activeBookingId ? q.eq('booking_id', activeBookingId) : q.eq('user_id', user.id);

      // Fetch room setup data
      const { data: roomData } = await scope(
        supabase
          .from('room_setups')
          .select('queen_shared_qty, twins_shared_qty, queen_ensuite_qty, twins_ensuite_qty, room_plan')
      ).maybeSingle();

      if (roomData) {
        setRoomSetupData({
          queenSharedCount: roomData.queen_shared_qty,
          twinsSharedCount: roomData.twins_shared_qty,
          queenEnsuiteCount: roomData.queen_ensuite_qty,
          twinsEnsuiteCount: roomData.twins_ensuite_qty,
          roomPlan: Array.isArray(roomData.room_plan) ? roomData.room_plan : null,
        });
      }

      // Fetch live transportation trip records (single source of truth for pricing)
      const { data: tripData } = await scope(
        supabase
          .from('transportation_trips')
          .select('*')
      );

      setTransportationTrips((tripData || []) as TransportationTrip[]);

      // Fetch food data
      const { data: foodPlanData } = await scope(
        supabase
          .from('food_plans')
          .select('selections, diet_preference, diet_config, meal_times')
      ).maybeSingle();

      if (foodPlanData?.selections && Array.isArray(foodPlanData.selections)) {
        const rawSelections = foodPlanData.selections as unknown as FoodDaySelection[];
        const guestsCount = bookingGuestsCount;
        // Backfill guests_count_day default for legacy records
        const selections: FoodDaySelection[] = rawSelections.map((s) => ({
          ...s,
          guests_count_day: typeof s.guests_count_day === 'number' && s.guests_count_day >= 0
            ? s.guests_count_day
            : guestsCount,
        }));
        const rawConfig = (foodPlanData as any).diet_config as DietConfig | null;
        const dietConfig: DietConfig = rawConfig && typeof rawConfig === 'object'
          ? {
              vegetarian_count: rawConfig.vegetarian_count || 0,
              meat_dinner_count: rawConfig.meat_dinner_count || 0,
              meat_lunch_dinner_count: rawConfig.meat_lunch_dinner_count || 0,
            }
          : { ...EMPTY_DIET_CONFIG };
        const rawMealTimes = (foodPlanData as any).meal_times as { breakfast_time: string | null; lunch_time: string | null; dinner_time: string | null } | null;
        const mealTimes = rawMealTimes && typeof rawMealTimes === 'object'
          ? {
              breakfast_time: rawMealTimes.breakfast_time || null,
              lunch_time: rawMealTimes.lunch_time || null,
              dinner_time: rawMealTimes.dinner_time || null,
            }
          : { breakfast_time: null, lunch_time: null, dinner_time: null };

        const costSummary = calculateFoodCostMulti(selections, dietConfig, guestsCount);

        setFoodData({
          fullBoardDays: costSummary.fullBoardDays,
          breakfastOnlyDays: costSummary.breakfastCount,
          customDays: costSummary.lunchCount + costSummary.dinnerCount > 0 ? 1 : 0,
          dietPreference: foodPlanData.diet_preference,
          dietConfig,
          dietBreakdown: costSummary.dietBreakdown,
          dietTotal: costSummary.dietTotal,
          totalCost: costSummary.grandTotal,
          mealTimes,
          selections,
        });
      }
    };

    fetchSummaryData();
  }, [user, profile, toolStatuses, activeBookingId]);

  useEffect(() => {
    if (!user) return;

    const bookingFilter = activeBookingId
      ? `booking_id=eq.${activeBookingId}`
      : `user_id=eq.${user.id}`;

    const channel = supabase
      .channel(`dashboard-transportation-${activeBookingId || user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'transportation_trips',
          filter: bookingFilter,
        },
        async (payload) => {
          const row = (payload.new || payload.old || {}) as Partial<TransportationTrip> & { booking_id?: string | null };

          setTransportationTrips((prev) => {
            const nextTrips = payload.eventType === 'DELETE'
              ? prev.filter((trip) => trip.id !== row.id)
              : payload.eventType === 'INSERT'
                ? [...prev.filter((trip) => trip.id !== row.id), row as TransportationTrip]
                : prev.map((trip) => trip.id === row.id ? { ...trip, ...(row as Partial<TransportationTrip>) } : trip);

            if (import.meta.env.DEV) {
              const summary = calculateTransportationCost(nextTrips as TransportationTrip[]);
              console.debug('[transport-sync][dashboard]', {
                booking_id: activeBookingId ?? row.booking_id ?? null,
                trip_id: row.id ?? null,
                displayed_price: row.custom_price ?? row.price_estimate ?? null,
                transportation_subtotal_source: 'transportation_trips_live',
                manual_override_value: row.custom_price ?? null,
                recalculated_total: summary.subtotal,
              });
            }

            return nextTrips as TransportationTrip[];
          });

          await queryClient.invalidateQueries({ queryKey: ['transportation_trips', activeBookingId ?? user.id] });
          await queryClient.invalidateQueries({ queryKey: ['booking_summary', activeBookingId ?? user.id] });
          await queryClient.invalidateQueries({ queryKey: ['guest_overview', activeBookingId ?? user.id] });
          await queryClient.invalidateQueries({ queryKey: ['booking_totals', activeBookingId ?? user.id] });

          const scope = <T extends { eq: any }>(q: T) =>
            activeBookingId ? q.eq('booking_id', activeBookingId) : q.eq('user_id', user.id);
          const { data } = await scope(
            supabase
              .from('transportation_trips')
              .select('id, price_estimate, pickup_location, dropoff_location, taxi_size, custom_price, trip_date, trip_time, passengers_count, trip_direction, user_id, created_at, updated_at')
          );
          setTransportationTrips((data || []) as TransportationTrip[]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, activeBookingId, queryClient]);

  const handleSubmitInformation = async () => {
    if (!profile || !hasDatesSet) {
      toast({
        title: 'Missing information',
        description: 'Please set your check-in and check-out dates before submitting.',
        variant: 'destructive',
      });
      return;
    }

    if (!bookingGuestsCount || bookingGuestsCount < 1) {
      toast({
        title: 'Missing information',
        description: 'Please specify the number of guests.',
        variant: 'destructive',
      });
      return;
    }

    if (dietExceedsGuests) {
      toast({
        title: 'Invalid food preferences',
        description: 'The total number of meal preferences exceeds the number of guests.',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Submit the profile
      await submitProfile();

      // Send summary email via edge function
      const response = await supabase.functions.invoke('send-guest-summary', {
        body: {
          fullName: profile.full_name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
          firstName: profile.first_name || null,
          email: profile.email,
          checkInDate: bookingCheckIn,
          checkOutDate: bookingCheckOut,
          guestsCount: bookingGuestsCount,
          roomSetup: roomSetupData,
          transportation: transportationData ? { ...transportationData, trips: transportationTrips } : null,
          food: foodData ? {
            ...foodData,
            selections: foodData.selections || [],
          } : null,
        },
      });

      if (response.error) throw response.error;

      toast({
        title: 'Summary sent',
        description: 'A confirmation email has been sent to you. You can keep editing until 3 days before arrival.',
      });

      refreshProfile();
    } catch (error: any) {
      console.error('Error submitting:', error);
      toast({
        title: 'Error',
        description: 'Failed to submit. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await signOut();
  };

  // Admins land on their own dashboard: send them to /admin unless they are
  // deliberately impersonating a guest ("Open as guest").
  if (user && isAdminEmail(user.email) && !isImpersonating) {
    return <Navigate to="/admin" replace />;
  }

  // Multi-booking: route to selector if user has >1 bookings and none is active
  if (!bookingsLoading && bookingsPersonal.length > 1 && !activeBookingId) {
    return <Navigate to="/bookings" replace />;
  }

  // Loading state
  if (isLoading || bookingsLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading your profile...</p>
      </div>
    );
  }

  // Error or timeout state
  if (error || timedOut || !profile) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6 px-4">
        <div className="text-center space-y-2">
          <h2 className="text-xl font-medium">We couldn't load your profile</h2>
          <p className="text-muted-foreground max-w-md">
            {error || 'Something went wrong. Please try again or contact support if the issue persists.'}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <Button onClick={retryLoad} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Retry
          </Button>
          <Button variant="outline" onClick={handleLogout} className="gap-2">
            <LogOut className="h-4 w-4" />
            Log out
          </Button>
        </div>
      </div>
    );
  }

  // No booking linked to this account: show a clear explanation instead of
  // half-working tools (dates would silently fail to save without a booking).
  if (!activeBookingId && bookingsPersonal.length === 0) {
    const pendingInvite = localStorage.getItem('qda_pending_invite');
    if (pendingInvite) {
      return <Navigate to={`/invite/${pendingInvite}`} replace />;
    }
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <GuestAreaHeader />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="max-w-md w-full text-center space-y-4 bg-card rounded-2xl border border-border p-8">
            <h2 className="text-xl font-medium">No stay linked to your account yet</h2>
            <p className="text-muted-foreground">
              Your Guest Area activates once your booking is connected. If you received
              an <strong>invitation link</strong> from us, open it while logged in with
              this account ({profile.email}).
            </p>
            <p className="text-muted-foreground">
              No invitation yet? Write to us at{' '}
              <a href="mailto:hello@quintamor.com" className="text-primary underline">
                hello@quintamor.com
              </a>{' '}
              and we'll connect your stay.
            </p>
          </div>
        </main>
      </div>
    );
  }

  const displayName = profile.first_name || profile.full_name?.split(' ')[0] || '';

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <GuestAreaHeader />

      {/* Profile Completion Modal */}
      <ProfileCompletionModal
        isOpen={needsProfileCompletion}
        onComplete={completeProfile}
      />

      <main className="container mx-auto px-4 py-8 flex-1">
        <div className="max-w-4xl mx-auto space-y-8 animate-fade-up">
          {/* Welcome */}
          <div className="text-center">
            <h1 className="text-3xl md:text-4xl mb-2">
              {displayName ? `Hi, ${displayName}` : 'Welcome'}
            </h1>
            <p className="text-muted-foreground">
              Manage your stay at Quinta do Amor
            </p>
          </div>

          {/* Status Banner */}
          <EditLockBanner statusInfo={guestStatus} />

          {/* Section 1: Stay Dates */}
          <StayDatesPicker
            checkInDate={bookingCheckIn}
            checkOutDate={bookingCheckOut}
            guestsCount={bookingGuestsCount}
            statusOverall={profile?.status_overall ?? 'draft'}
            onCheckInChange={updateCheckInDate}
            onCheckOutChange={updateCheckOutDate}
            onGuestsCountChange={updateGuestsCount}
          />

          {/* WhatsApp group link (if admin set one) */}
          <WhatsAppGroupCard url={activeBooking?.whatsapp_group_url ?? null} />

          {/* Section 2: Tool Tiles — Room Setup, Food, Transportation */}
          <div>
            <h2 className="text-xl font-medium mb-4">Your setup</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <ToolTile
                title="Room Setup"
                description="Configure bed types for your group"
                icon="room"
                status={toolStatuses.roomSetup}
                href="/room-setup"
                disabled={isLocked}
              />
              <ToolTile
                title="Food"
                description="Plan your meals"
                icon="food"
                status={toolStatuses.food}
                href="/food"
                disabled={!hasDatesSet || isLocked}
              />
              <ToolTile
                title="Transportation"
                description="Arrange taxi transfers"
                icon="transport"
                status={toolStatuses.transportation}
                href="/transportation"
                disabled={isLocked}
              />
              {featureFlags.showDocumentation && (
                <ToolTile
                  title="Documentation"
                  description="Property info & house rules"
                  icon="docs"
                  status={toolStatuses.documentation}
                  href="/documentation"
                />
              )}
            </div>
          </div>

          {/* Weather block (Arrábida) */}
          <WeatherCard
            checkIn={bookingCheckIn}
            checkOut={bookingCheckOut}
            bookingId={activeBookingId ?? null}
          />

          {/* Payment Overview (read-only) */}
          <PaymentOverview bookingId={activeBookingId} />


          {/* Section 3: Global Summary */}
          <GlobalSummary
            profile={profile}
            toolStatuses={toolStatuses}
            roomSetupData={roomSetupData}
            transportationData={transportationData}
            foodData={foodData}
            disabledRooms={((activeBooking as unknown as { disabled_rooms?: number[] | null })?.disabled_rooms ?? []) as number[]}
          />

          {/* Diet validation banner */}
          {dietExceedsGuests && (
            <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
              <p className="text-sm text-destructive font-medium">
                The total number of meal preferences exceeds the number of guests. Please adjust them in the Food tool before submitting.
              </p>
            </div>
          )}

          {/* Submit Button */}
          <div className="bg-card rounded-2xl border border-border p-6">
            <Button
              onClick={handleSubmitInformation}
              disabled={isSubmitting || !hasDatesSet || isLocked || dietExceedsGuests}
              size="lg"
              className="w-full sm:w-auto gap-2"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              Send summary
            </Button>
            <p className="text-sm text-muted-foreground mt-3">
              {guestStatus.message}
            </p>
          </div>
        </div>
      </main>

      <footer className="border-t border-border py-6 mt-12">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>Quinta do Amor © {new Date().getFullYear()}</p>
        </div>
      </footer>
    </div>
  );
};

// Wrap Dashboard with ProtectedRoute
const Dashboard = () => {
  return (
    <ProtectedRoute>
      <DashboardContent />
    </ProtectedRoute>
  );
};



// ============================================================
// PaymentOverview — read-only payment summary for guests
// ============================================================

function fmtEur(n: number | null | undefined) {
  const v = Number(n ?? 0);
  return `€${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00');
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function installmentBadge(s: PaymentInstallment) {
  const todayIso = new Date().toISOString().slice(0, 10);
  let kind: 'paid' | 'overdue' | 'pending' = 'pending';
  if (s.status === 'paid') kind = 'paid';
  else if (s.due_date && s.due_date < todayIso) kind = 'overdue';
  const map = {
    paid: { label: 'Paid', cls: 'bg-green-100 text-green-800 border border-green-300' },
    overdue: { label: 'Overdue', cls: 'bg-red-100 text-red-800 border border-red-300' },
    pending: { label: 'Pending', cls: 'bg-amber-100 text-amber-900 border border-amber-300' },
  } as const;
  const cfg = map[kind];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${cfg.cls}`}>{cfg.label}</span>;
}

async function downloadInstallmentInvoice(inst: PaymentInstallment) {
  const path = inst.invoice_file_url;
  if (!path) return;
  const { data, error } = await supabase.storage.from('invoices').createSignedUrl(path, 60 * 60);
  if (error || !data?.signedUrl) {
    console.error('[invoice download]', error);
    return;
  }
  window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
}

function InstallmentRow({ inst }: { inst: PaymentInstallment }) {
  return (
    <div className="py-2.5 flex items-center justify-between gap-3 border-t border-border first:border-t-0">
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">{inst.label}</div>
        <div className="text-xs text-muted-foreground">
          Due {fmtDate(inst.due_date) || '—'}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-sm font-medium">{fmtEur(inst.amount_due)}</span>
        {installmentBadge(inst)}
        {inst.invoice_file_url && (
          <Button size="sm" variant="outline" onClick={() => downloadInstallmentInvoice(inst)}>
            <Download className="w-3.5 h-3.5 mr-1" /> Invoice
          </Button>
        )}
      </div>
    </div>
  );
}

function PaymentOverview({ bookingId }: { bookingId: string | null | undefined }) {
  const { booking, payments, isLoading } = usePaymentData(bookingId);

  if (isLoading) return null;

  const rental = payments.filter((i) => (i.category ?? 'rental') === 'rental');
  const extras = payments.filter((i) => i.category === 'extra');

  const hasAccommodation = rental.length > 0 || (booking?.total_rental_price ?? 0) > 0;
  const hasExtras = extras.length > 0;

  if (!hasAccommodation && !hasExtras) {
    return (
      <div className="bg-card rounded-2xl border border-border p-6 flex items-start gap-3">
        <CreditCard className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
        <div>
          <div className="font-medium">Payment</div>
          <div className="text-sm text-muted-foreground">Payment details will appear here once confirmed.</div>
        </div>
      </div>
    );
  }

  const totalDue = Number(booking?.total_rental_price ?? 0);
  const totalPaid = rental.filter((i) => i.status === 'paid').reduce((s, i) => s + Number(i.amount_due || 0), 0);
  const remaining = Math.max(totalDue - totalPaid, 0);
  const pct = totalDue > 0 ? Math.min(100, Math.round((totalPaid / totalDue) * 100)) : 0;

  const extrasTotal = extras.reduce((s, i) => s + Number(i.amount_due || 0), 0);
  const extrasPaid = extras.filter((i) => i.status === 'paid').reduce((s, i) => s + Number(i.amount_due || 0), 0);
  const extrasOutstanding = Math.max(extrasTotal - extrasPaid, 0);

  return (
    <div className="space-y-4">
      {hasAccommodation && (
        <section className="bg-card rounded-2xl border border-border p-6">
          <div className="flex items-center gap-2 mb-4">
            <CreditCard className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-medium">Accommodation</h2>
          </div>

          {totalDue > 0 && (
            <div className="mb-4">
              <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-green-500 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-2 flex justify-between text-sm">
                <span className="text-foreground">{fmtEur(totalPaid)} paid</span>
                <span className="text-muted-foreground">{fmtEur(remaining)} remaining</span>
              </div>
            </div>
          )}

          {rental.length > 0 && (
            <div>{rental.map((i) => <InstallmentRow key={i.id} inst={i} />)}</div>
          )}

          {totalDue > 0 && (
            <div className="mt-3 pt-3 border-t border-border text-sm text-muted-foreground">
              {fmtEur(totalPaid)} paid of {fmtEur(totalDue)} · {fmtEur(remaining)} remaining
            </div>
          )}
        </section>
      )}

      {hasExtras && (
        <section className="bg-card rounded-2xl border border-border p-6">
          <div className="flex items-center gap-2 mb-4">
            <FileText className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-medium">Extras</h2>
          </div>

          <div>{extras.map((i) => <InstallmentRow key={i.id} inst={i} />)}</div>

          <div className="mt-3 pt-3 border-t border-border text-sm text-muted-foreground">
            Extras total: {fmtEur(extrasTotal)} · {fmtEur(extrasPaid)} paid · {fmtEur(extrasOutstanding)} outstanding
          </div>
        </section>
      )}
    </div>
  );
}

// ---------- WhatsApp group card ----------
function WhatsAppGroupCard({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <section className="bg-card rounded-2xl border border-border p-6">
      <div className="flex items-start gap-4">
        <div className="rounded-full bg-primary/10 p-3 text-primary shrink-0">
          <MessageCircle className="w-6 h-6" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-medium">Group chat</h2>
          <p className="text-sm text-muted-foreground">Communicate with the Quinta team before, during and after your stay</p>
        </div>
        <a href={url} target="_blank" rel="noopener noreferrer">
          <Button size="sm">Open WhatsApp group</Button>
        </a>
      </div>
    </section>
  );
}

// ---------- Weather card ----------
const QUINTA_LAT = 38.4847;
const QUINTA_LON = -8.9942;

function weatherIconFor(code: number) {
  if (code === 0) return Sun;
  if (code <= 3) return CloudSun;
  if (code <= 48) return CloudFog;
  if (code <= 67) return CloudRain;
  if (code <= 77) return CloudSnow;
  if (code <= 82) return CloudRain;
  if (code <= 86) return CloudSnow;
  if (code <= 99) return CloudLightning;
  return Cloud;
}

function parseLocalDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function fmtISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function enumerateDates(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  const start = parseLocalDate(startISO);
  const end = parseLocalDate(endISO);
  const cursor = new Date(start);
  while (cursor <= end) {
    out.push(fmtISO(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

type DayWeather = {
  date: string;
  weather_code: number;
  temp_max: number;
  temp_min: number;
  source: 'forecast' | 'history';
};

async function fetchForecast(start: string, end: string) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${QUINTA_LAT}&longitude=${QUINTA_LON}&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Europe/Lisbon&start_date=${start}&end_date=${end}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = await res.json();
  return json.daily as { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[] };
}

async function fetchArchive(start: string, end: string) {
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${QUINTA_LAT}&longitude=${QUINTA_LON}&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Europe/Lisbon&start_date=${start}&end_date=${end}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = await res.json();
  return json.daily as { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[] };
}

function modeOf(arr: number[]): number {
  const counts = new Map<number, number>();
  let best = arr[0];
  let bestCount = 0;
  for (const v of arr) {
    const c = (counts.get(v) || 0) + 1;
    counts.set(v, c);
    if (c > bestCount) { bestCount = c; best = v; }
  }
  return best;
}

async function buildWeather(checkIn: string, checkOut: string): Promise<DayWeather[]> {
  const allDates = enumerateDates(checkIn, checkOut);
  const byDate = new Map<string, DayWeather>();

  const forecast = await fetchForecast(checkIn, checkOut).catch(() => null);
  if (forecast) {
    forecast.time.forEach((iso, i) => {
      if (
        typeof forecast.weather_code[i] === 'number' &&
        typeof forecast.temperature_2m_max[i] === 'number' &&
        typeof forecast.temperature_2m_min[i] === 'number'
      ) {
        byDate.set(iso, {
          date: iso,
          weather_code: forecast.weather_code[i],
          temp_max: Math.round(forecast.temperature_2m_max[i]),
          temp_min: Math.round(forecast.temperature_2m_min[i]),
          source: 'forecast',
        });
      }
    });
  }

  const missing = allDates.filter((d) => !byDate.has(d));
  if (missing.length > 0) {
    const currentYear = new Date().getFullYear();
    const years = [currentYear - 5, currentYear - 4, currentYear - 3, currentYear - 2, currentYear - 1];
    const perDayHist = new Map<string, { codes: number[]; maxs: number[]; mins: number[] }>();
    missing.forEach((d) => perDayHist.set(d, { codes: [], maxs: [], mins: [] }));

    const shiftYear = (iso: string, targetYear: number) => {
      const d = parseLocalDate(iso);
      const month = d.getMonth();
      let day = d.getDate();
      if (month === 1 && day === 29) day = 28;
      return fmtISO(new Date(targetYear, month, day));
    };

    const results = await Promise.all(
      years.map(async (year) => {
        const start = shiftYear(checkIn, year);
        const end = shiftYear(checkOut, year);
        return { year, data: await fetchArchive(start, end).catch(() => null) };
      })
    );

    for (const { data } of results) {
      if (!data) continue;
      data.time.forEach((histIso, i) => {
        const hd = parseLocalDate(histIso);
        const stayIso = missing.find((m) => {
          const md = parseLocalDate(m);
          return md.getMonth() === hd.getMonth() && md.getDate() === hd.getDate();
        });
        if (!stayIso) return;
        const bucket = perDayHist.get(stayIso);
        if (!bucket) return;
        if (typeof data.weather_code[i] === 'number') bucket.codes.push(data.weather_code[i]);
        if (typeof data.temperature_2m_max[i] === 'number') bucket.maxs.push(data.temperature_2m_max[i]);
        if (typeof data.temperature_2m_min[i] === 'number') bucket.mins.push(data.temperature_2m_min[i]);
      });
    }

    for (const date of missing) {
      const b = perDayHist.get(date);
      if (!b || b.maxs.length === 0) continue;
      byDate.set(date, {
        date,
        weather_code: b.codes.length ? modeOf(b.codes) : 1,
        temp_max: Math.round(b.maxs.reduce((s, v) => s + v, 0) / b.maxs.length),
        temp_min: Math.round(b.mins.reduce((s, v) => s + v, 0) / b.mins.length),
        source: 'history',
      });
    }
  }

  return allDates.map((d) => byDate.get(d)).filter((x): x is DayWeather => !!x);
}

function WeatherCard({ checkIn, checkOut, bookingId }: { checkIn: string | null; checkOut: string | null; bookingId: string | null }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const checkInDate = checkIn ? parseLocalDate(checkIn) : null;
  const checkOutDate = checkOut ? parseLocalDate(checkOut) : null;
  const isPast = !!checkOutDate && checkOutDate < today;
  const hasDates = !!checkInDate && !!checkOutDate;

  const { data, isLoading } = useQuery({
    queryKey: ['weather-v2', bookingId, checkIn, checkOut],
    enabled: hasDates && !isPast,
    staleTime: 1000 * 60 * 60 * 6,
    gcTime: 1000 * 60 * 60 * 24,
    retry: 0,
    queryFn: () => buildWeather(checkIn!, checkOut!),
  });

  if (!hasDates || isPast) return null;

  if (isLoading) {
    return (
      <section className="bg-card rounded-2xl border border-border p-6">
        <h2 className="text-lg font-medium mb-3">Weather forecast</h2>
        <div className="flex gap-3 overflow-x-auto">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="w-24 h-28 rounded-xl bg-muted animate-pulse shrink-0" />
          ))}
        </div>
      </section>
    );
  }

  if (!data || data.length === 0) return null;

  const forecastCount = data.filter((d) => d.source === 'forecast').length;
  const historyCount = data.filter((d) => d.source === 'history').length;
  const mixed = forecastCount > 0 && historyCount > 0;
  const showBadge = historyCount > 0;
  const badgeText = mixed ? 'Partial estimate' : 'Seasonal estimate';
  const monthName = checkInDate!.toLocaleString('en-US', { month: 'long' });
  const noteText = mixed
    ? `Forecast available for the first ${forecastCount} day${forecastCount === 1 ? '' : 's'}. Remaining days based on historical averages.`
    : `Based on historical averages for ${monthName}. Detailed forecast available 14 days before your stay.`;

  return (
    <section className="bg-card rounded-2xl border border-border p-6">
      <div className="flex items-start justify-between mb-3 gap-2">
        <h2 className="text-lg font-medium">Weather forecast</h2>
        {showBadge && (
          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
            {badgeText}
          </span>
        )}
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {data.map((d) => {
          const dt = parseLocalDate(d.date);
          const label = dt.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
          const Icon = weatherIconFor(d.weather_code);
          return (
            <div
              key={d.date}
              className="shrink-0 w-24 rounded-xl border border-border bg-background p-3 flex flex-col items-center gap-1"
            >
              <div className="text-xs text-muted-foreground">{label}</div>
              <Icon className="w-7 h-7 text-primary" />
              <div className="text-sm">
                <span className="font-medium">{d.temp_max}°</span>
                <span className="text-muted-foreground"> / {d.temp_min}°</span>
              </div>
            </div>
          );
        })}
      </div>
      {showBadge && (
        <p className="mt-3 text-xs text-muted-foreground">{noteText}</p>
      )}
    </section>
  );
}



export default Dashboard;
