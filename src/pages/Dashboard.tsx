import { useEffect, useMemo, useRef, useState } from 'react';
import { todayLisbon } from '@/lib/dates';
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
import { Link } from 'react-router-dom';
import { GuestAreaHeader } from '@/components/guest-area/GuestAreaHeader';
import { GuestShell } from '@/components/guest-area/GuestShell';
import { GlobalSummary } from '@/components/guest-area/GlobalSummary';
import { EditLockBanner } from '@/components/guest-area/EditLockBanner';
import { ProfileCompletionModal } from '@/components/guest-area/ProfileCompletionModal';
import {
  fmtEur,
  fmtDate,
  NextPaymentCard,
  nextPayableGroup,
  usePayInstallment,
} from '@/components/guest-area/PaymentSections';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { isAdminEmail } from '@/lib/admin';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, LogOut, AlertCircle, ArrowUpRight, Check } from 'lucide-react';
import type { FoodDaySelection, TransportationTrip, DietConfig, ToolStatus } from '@/types/guest';
import { dietConfigTotal, EMPTY_DIET_CONFIG } from '@/types/guest';
import { usePaymentData } from '@/hooks/usePaymentData';

// Tuile Guests : état local + sauvegarde débouncée — cliquer −/+ plusieurs fois
// ou taper un nombre ne déclenche qu'UNE écriture (et un seul refresh) à la fin.
function GuestsTile({ count, disabled, onCommit }: { count: number; disabled: boolean; onCommit: (n: number) => void }) {
  const [val, setVal] = useState<string>(String(count));
  const timer = useRef<number | null>(null);
  const lastCommitted = useRef<number>(count);

  useEffect(() => {
    // Synchronise si le booking change ailleurs (switch de séjour, admin…)
    setVal(String(count));
    lastCommitted.current = count;
  }, [count]);

  const schedule = (next: number) => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (next !== lastCommitted.current) {
        lastCommitted.current = next;
        onCommit(next);
      }
    }, 900);
  };

  const clamp = (n: number) => Math.max(1, Math.min(60, n));
  const current = parseInt(val, 10);
  const currentValid = Number.isFinite(current) ? clamp(current) : count;

  const bump = (delta: number) => {
    const next = clamp(currentValid + delta);
    setVal(String(next));
    schedule(next);
  };

  return (
    <div className="rounded-2xl bg-card border border-border/70 px-5 py-4 transition-transform hover:-translate-y-0.5">
      <div className="guest-kicker mb-1.5">Guests</div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Fewer guests"
          disabled={disabled || currentValid <= 1}
          onClick={() => bump(-1)}
          className="w-7 h-7 rounded-full border border-border flex items-center justify-center text-lg leading-none text-muted-foreground hover:text-foreground hover:border-foreground/40 disabled:opacity-40 transition-colors"
        >
          −
        </button>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={60}
          disabled={disabled}
          value={val}
          onChange={(e) => {
            const raw = e.target.value;
            setVal(raw);
            const n = parseInt(raw, 10);
            if (Number.isFinite(n) && n >= 1) schedule(clamp(n));
          }}
          onBlur={() => {
            const n = parseInt(val, 10);
            const next = Number.isFinite(n) && n >= 1 ? clamp(n) : lastCommitted.current;
            setVal(String(next));
            schedule(next);
          }}
          className="w-14 text-center text-2xl md:text-3xl font-semibold tracking-tight tabular-nums text-foreground bg-transparent border-0 focus:outline-none focus:ring-0 p-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <button
          type="button"
          aria-label="More guests"
          disabled={disabled || currentValid >= 60}
          onClick={() => bump(1)}
          className="w-7 h-7 rounded-full border border-border flex items-center justify-center text-lg leading-none text-muted-foreground hover:text-foreground hover:border-foreground/40 disabled:opacity-40 transition-colors"
        >
          +
        </button>
      </div>
    </div>
  );
}

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
    isAdminAccount,
  } = useGuestProfile();

  const [roomSetupData, setRoomSetupData] = useState<any>(null);
  const [transportationTrips, setTransportationTrips] = useState<TransportationTrip[]>([]);
  const [foodData, setFoodData] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Paiements : alimente les stats du résumé + la carte "Next payment".
  const { payments: paymentList } = usePaymentData(activeBookingId);
  const { payMany, payingId } = usePayInstallment();
  const nextGroup = useMemo(() => nextPayableGroup(paymentList), [paymentList]);
  const balanceDue = useMemo(
    () => paymentList
      .filter((i) => i.status !== 'paid' && String(i.category ?? 'rental') !== 'discount')
      .reduce((s, i) => s + Number(i.amount_due || 0), 0),
    [paymentList],
  );

  // Retour de Stripe Checkout (?payment=success|cancelled)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get('payment');
    if (!outcome) return;
    if (outcome === 'success') {
      toast({
        title: 'Payment received — thank you!',
        description: 'Your payment is being confirmed. The status below will update shortly (bank debits can take a few days to settle).',
      });
    } else if (outcome === 'cancelled') {
      toast({
        title: 'Payment cancelled',
        description: 'No worries — you can pay whenever you are ready.',
      });
    }
    params.delete('payment');
    params.delete('session_id');
    const rest = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

        const costSummary = calculateFoodCostMulti(selections, dietConfig, guestsCount, bookingCheckIn);

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

  const handleLogout = async () => {
    await signOut();
  };

  // Admins land on their own dashboard: send them to /admin unless they are
  // deliberately impersonating a guest ("Open as guest").
  // isAdminAccount couvre les admins présents en base mais absents de la
  // liste front (src/lib/admin.ts) — sinon leur compte serait bloqué.
  if (user && (isAdminEmail(user.email) || isAdminAccount) && !isImpersonating) {
    return <Navigate to="/admin" replace />;
  }

  // Multi-booking: route to selector if user has >1 bookings and none is active
  if (!bookingsLoading && bookingsPersonal.length > 1 && !activeBookingId) {
    return <Navigate to="/bookings" replace />;
  }

  // Loading state
  if (isLoading || bookingsLoading) {
    return (
      <div className="guest-ui min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading your profile...</p>
      </div>
    );
  }

  // Error or timeout state
  if (error || timedOut || !profile) {
    return (
      <div className="guest-ui min-h-screen bg-background flex flex-col items-center justify-center gap-6 px-4">
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
      <div className="guest-ui min-h-screen bg-background text-foreground flex flex-col">
        <GuestAreaHeader />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="max-w-md w-full text-center space-y-4 guest-card p-8">
            <h2 className="text-xl font-medium">No stay linked to your account yet</h2>
            <p className="text-muted-foreground">
              Your Guest Area activates once your booking is connected. If you received
              an <strong>invitation link</strong> from us, open it while logged in with
              this account ({profile.email}).
            </p>
            <p className="text-muted-foreground">
              No invitation yet? Write to us at{' '}
              <a href="mailto:hello@quintamor.com" className="text-[#6D7855] underline">
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
  const stayMetaParts = [
    activeBooking?.retreat_name || null,
    bookingCheckIn && bookingCheckOut
      ? `${fmtDate(bookingCheckIn)} — ${fmtDate(bookingCheckOut)}`
      : null,
  ].filter(Boolean);

  // Catering retiré de ce booking par l'admin (comme les chambres désactivées)
  const cateringDisabled = (activeBooking as { catering_disabled?: boolean } | null)?.catering_disabled === true;

  // Lignes du tableau "Your setup" (style Substance : n° / zone / statut / lien)
  const setupRows: { title: string; detail: string; status: ToolStatus; href: string }[] = [
    {
      title: 'Bedrooms',
      detail: roomSetupData
        ? [
            roomSetupData.queenSharedCount + roomSetupData.queenEnsuiteCount > 0
              ? `${roomSetupData.queenSharedCount + roomSetupData.queenEnsuiteCount} queen`
              : null,
            roomSetupData.twinsSharedCount + roomSetupData.twinsEnsuiteCount > 0
              ? `${roomSetupData.twinsSharedCount + roomSetupData.twinsEnsuiteCount} twins`
              : null,
          ].filter(Boolean).join(' · ') || 'Choose beds for your group'
        : 'Choose beds for your group',
      status: toolStatuses.roomSetup,
      href: '/room-setup',
    },
    ...(cateringDisabled ? [] : [{
      title: 'Catering',
      detail: foodData
        ? `${foodData.fullBoardDays > 0 ? `${foodData.fullBoardDays} full-board day${foodData.fullBoardDays === 1 ? '' : 's'}` : 'Meal plan started'}`
        : 'Plan your meals',
      status: toolStatuses.food,
      href: '/food',
    }]),
    {
      title: 'Transportation',
      detail: transportationData
        ? `${transportationData.totalTrips} transfer${transportationData.totalTrips === 1 ? '' : 's'} planned`
        : 'Arrange your transfers',
      status: toolStatuses.transportation,
      href: '/transportation',
    },
  ];
  const doneCount = setupRows.filter((r) => r.status === 'submitted').length;
  const nextDueDate = nextGroup.length > 0 ? nextGroup[0].due_date : null;

  return (
    <GuestShell active="overview">
      {/* Profile Completion Modal */}
      <ProfileCompletionModal
        isOpen={needsProfileCompletion}
        onComplete={completeProfile}
      />

      <div className="max-w-4xl space-y-8 md:space-y-10 animate-fade-up">
        {/* ---- Hero (style Substance) ---- */}
        <div>
          <div className="guest-kicker mb-3">Stay summary</div>
          <h1 className="guest-display text-4xl md:text-6xl font-semibold tracking-tight text-[#6D7855]">
            {displayName ? `Hello ${displayName}` : 'Welcome'}
          </h1>
          {stayMetaParts.length > 0 && (
            <div className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {stayMetaParts.join(' · ')}
            </div>
          )}
          <p className="mt-5 max-w-2xl text-base md:text-lg leading-relaxed text-muted-foreground">
            Setup <strong className="text-foreground font-semibold">{doneCount} of {setupRows.length}</strong> complete.
            {nextGroup.length > 0 ? (
              <> Next payment <strong className="text-foreground font-semibold tabular-nums">{fmtEur(nextGroup.reduce((s, i) => s + Number(i.amount_due || 0), 0))}</strong>{nextDueDate ? <> due <strong className="text-foreground font-semibold">{fmtDate(nextDueDate)}</strong></> : null}.</>
            ) : balanceDue > 0 ? (
              <> Balance due <strong className="text-foreground font-semibold tabular-nums">{fmtEur(balanceDue)}</strong>.</>
            ) : (
              <> All payments are settled.</>
            )}
          </p>
        </div>

        {/* ---- Stats row — tuiles douces, une pointe de couleur ---- */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Guests — sélection bien visible, éditable au clavier, sauvegarde débouncée */}
          <GuestsTile count={bookingGuestsCount} disabled={isLocked} onCommit={updateGuestsCount} />
          <div className="rounded-2xl bg-gradient-to-br from-[#EEF1E4] to-[#F8FAF3] border border-[#D7DFC3]/70 px-5 py-4 transition-transform hover:-translate-y-0.5">
            <div className="guest-kicker mb-1.5">Setup</div>
            <div className="flex items-end justify-between gap-3">
              <div className="text-2xl md:text-3xl font-semibold tracking-tight tabular-nums text-[#6D7855]">
                {doneCount} <span className="text-muted-foreground font-normal text-xl">/ {setupRows.length}</span>
              </div>
              {/* Mini anneau de progression */}
              <svg width="40" height="40" viewBox="0 0 40 40" className="-mb-0.5" aria-hidden>
                <circle cx="20" cy="20" r="16" fill="none" stroke="#E5EAD5" strokeWidth="5" />
                <circle
                  cx="20" cy="20" r="16" fill="none" stroke="#8CA05F" strokeWidth="5" strokeLinecap="round"
                  strokeDasharray={`${(doneCount / setupRows.length) * 2 * Math.PI * 16} ${2 * Math.PI * 16}`}
                  transform="rotate(-90 20 20)"
                  style={{ transition: 'stroke-dasharray 600ms ease' }}
                />
              </svg>
            </div>
          </div>
          <div className="rounded-2xl bg-card border border-border/70 px-5 py-4 transition-transform hover:-translate-y-0.5">
            <div className="guest-kicker mb-1.5">Next payment</div>
            <div className="text-2xl md:text-3xl font-semibold tracking-tight tabular-nums text-foreground">
              {nextDueDate ? fmtDate(nextDueDate) : '—'}
            </div>
          </div>
          <div className="rounded-2xl bg-card border border-border/70 px-5 py-4 transition-transform hover:-translate-y-0.5">
            <div className="guest-kicker mb-1.5">Balance due</div>
            <div className="text-2xl md:text-3xl font-semibold tracking-tight tabular-nums text-foreground">
              {fmtEur(balanceDue)}
            </div>
          </div>
        </div>

        {/* Status Banner */}
        <EditLockBanner statusInfo={guestStatus} />

        {/* ---- Your setup — lignes avec pastilles de statut ---- */}
        <section>
          <div className="flex items-end justify-between mb-2">
            <h2 className="text-lg font-semibold tracking-tight">Your setup</h2>
            <span className="guest-kicker">{doneCount} of {setupRows.length} completed</span>
          </div>
          {/* Barre de progression fine */}
          <div className="h-1.5 rounded-full bg-border/60 overflow-hidden mb-1">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#E2C04C] to-[#6D7855] transition-all duration-700"
              style={{ width: `${(doneCount / setupRows.length) * 100}%` }}
            />
          </div>
          <div>
            {setupRows.map((row, idx) => {
              const statusCfg: Record<ToolStatus, { label: string; chip: string; icon?: boolean }> = {
                not_set: { label: 'To do', chip: 'bg-muted text-muted-foreground border-border' },
                draft: { label: 'In progress', chip: 'bg-[#FBF4DA] text-[#8A6C15] border-[#ECDCA1]' },
                submitted: { label: 'Completed', chip: 'bg-[#EEF1E4] text-[#6D7855] border-[#D7DFC3]', icon: true },
              };
              const cfg = statusCfg[row.status];
              return (
                <Link
                  key={row.href}
                  to={row.href}
                  className="grid grid-cols-[1.75rem_1fr_auto_auto] items-center gap-3 sm:gap-4 py-4 border-b border-border/70 group hover:bg-card/70 -mx-2 px-2 rounded-lg transition-colors"
                >
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold tabular-nums transition-colors ${
                    row.status === 'submitted' ? 'bg-[#8CA05F] text-white' : 'bg-muted text-muted-foreground'
                  }`}>
                    {row.status === 'submitted' ? <Check className="w-3.5 h-3.5" strokeWidth={3} /> : idx + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm md:text-[15px] font-medium truncate">{row.title}</div>
                    <div className="text-xs text-muted-foreground truncate">{row.detail}</div>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold uppercase tracking-[0.06em] ${cfg.chip}`}>
                    {cfg.label}
                  </span>
                  <ArrowUpRight className="w-4 h-4 text-muted-foreground group-hover:text-[#6D7855] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
                </Link>
              );
            })}
          </div>
        </section>

        {/* ---- Payments teaser : prochaine échéance + lien vers l'onglet ---- */}
        {nextGroup.length > 0 && (
          <NextPaymentCard insts={nextGroup} onPay={payMany} paying={payingId === nextGroup[0].id} />
        )}
        {paymentList.length > 0 && (
          <Link
            to="/payments"
            className="guest-card px-5 py-4 flex items-center justify-between group"
          >
            <span className="text-sm font-medium">All payments & invoices</span>
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground group-hover:text-foreground transition-colors tabular-nums">
              {balanceDue > 0 ? `${fmtEur(balanceDue)} outstanding` : 'All settled'}
              <ArrowUpRight className="w-4 h-4" />
            </span>
          </Link>
        )}

          {/* Global Summary */}
          <GlobalSummary
            profile={profile}
            toolStatuses={toolStatuses}
            roomSetupData={roomSetupData}
            transportationData={transportationData}
            foodData={foodData}
            disabledRooms={((activeBooking as unknown as { disabled_rooms?: number[] | null })?.disabled_rooms ?? []) as number[]}
            hideCatering={cateringDisabled}
          />

          {/* Diet validation banner */}
          {dietExceedsGuests && (
            <div className="rounded-2xl bg-destructive/10 border border-destructive/30 p-4 flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
              <p className="text-sm text-destructive font-medium">
                The total number of meal preferences exceeds the number of guests. Please adjust them in the Food tool before submitting.
              </p>
            </div>
          )}

      </div>
    </GuestShell>
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



export default Dashboard;
