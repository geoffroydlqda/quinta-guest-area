import { useEffect, useMemo, useState } from 'react';
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
import { StayDatesPicker } from '@/components/guest-area/StayDatesPicker';
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
import { Loader2, Send, RefreshCw, LogOut, AlertCircle, ArrowUpRight, MessageCircle, Sun, Cloud, CloudSun, CloudRain, CloudSnow, CloudLightning, CloudFog } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { FoodDaySelection, TransportationTrip, DietConfig, ToolStatus } from '@/types/guest';
import { dietConfigTotal, EMPTY_DIET_CONFIG } from '@/types/guest';
import { usePaymentData } from '@/hooks/usePaymentData';

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
          // tripCount/totalPrice : noms exigés par le schéma de send-guest-summary
          transportation: transportationData ? {
            tripCount: transportationData.totalTrips,
            totalPrice: transportationData.subtotal,
            customOfferCount: transportationData.customOfferCount,
            trips: transportationTrips,
          } : null,
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
              <a href="mailto:hello@quintamor.com" className="text-[#35532A] underline">
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
    {
      title: 'Catering',
      detail: foodData
        ? `${foodData.fullBoardDays > 0 ? `${foodData.fullBoardDays} full-board day${foodData.fullBoardDays === 1 ? '' : 's'}` : 'Meal plan started'}`
        : 'Plan your meals',
      status: toolStatuses.food,
      href: '/food',
    },
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
          <h1 className="guest-display text-4xl md:text-6xl font-semibold tracking-tight text-[#35532A]">
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

        {/* ---- Stats row ---- */}
        <div className="grid grid-cols-3 gap-4 border-y border-border/70 py-5">
          <div>
            <div className="guest-kicker mb-1.5">Setup</div>
            <div className="text-2xl md:text-3xl font-semibold tracking-tight tabular-nums text-foreground">
              {doneCount} <span className="text-muted-foreground font-normal">/ {setupRows.length}</span>
            </div>
          </div>
          <div>
            <div className="guest-kicker mb-1.5">Next payment</div>
            <div className="text-2xl md:text-3xl font-semibold tracking-tight tabular-nums text-foreground">
              {nextDueDate ? fmtDate(nextDueDate) : '—'}
            </div>
          </div>
          <div>
            <div className="guest-kicker mb-1.5">Balance due</div>
            <div className="text-2xl md:text-3xl font-semibold tracking-tight tabular-nums text-foreground">
              {fmtEur(balanceDue)}
            </div>
          </div>
        </div>

        {/* Status Banner */}
        <EditLockBanner statusInfo={guestStatus} />

        {/* ---- Your setup — tableau façon "En cours" ---- */}
        <section>
          <div className="flex items-end justify-between mb-2">
            <h2 className="text-lg font-semibold tracking-tight">Your setup</h2>
            <span className="guest-kicker">{doneCount} of {setupRows.length} done</span>
          </div>
          <div className="border-t border-border/70">
            {setupRows.map((row, idx) => {
              const statusCfg: Record<ToolStatus, { label: string; dot: string; text: string }> = {
                not_set: { label: 'To do', dot: 'bg-card border-2 border-border', text: 'text-muted-foreground' },
                draft: { label: 'In progress', dot: 'bg-amber-400', text: 'text-amber-700' },
                submitted: { label: 'Done', dot: 'bg-[#79B84B]', text: 'text-[#35532A]' },
              };
              const cfg = statusCfg[row.status];
              return (
                <Link
                  key={row.href}
                  to={row.href}
                  className="grid grid-cols-[1.75rem_1fr_auto_auto] items-center gap-3 sm:gap-4 py-4 border-b border-border/70 group hover:bg-card/60 -mx-2 px-2 rounded-lg transition-colors"
                >
                  <span className="text-xs text-muted-foreground tabular-nums">{idx + 1}</span>
                  <div className="min-w-0">
                    <div className="text-sm md:text-[15px] font-medium truncate">{row.title}</div>
                    <div className="text-xs text-muted-foreground truncate">{row.detail}</div>
                  </div>
                  <span className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] ${cfg.text}`}>
                    <span aria-hidden className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                    <span className="hidden sm:inline">{cfg.label}</span>
                  </span>
                  <ArrowUpRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
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

        {/* Stay dates & guests — admin-fixed info, kept discreet */}
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

          {/* Weather block (Arrábida) */}
          <WeatherCard
            checkIn={bookingCheckIn}
            checkOut={bookingCheckOut}
            bookingId={activeBookingId ?? null}
          />

          {/* Global Summary */}
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
            <div className="rounded-2xl bg-destructive/10 border border-destructive/30 p-4 flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
              <p className="text-sm text-destructive font-medium">
                The total number of meal preferences exceeds the number of guests. Please adjust them in the Food tool before submitting.
              </p>
            </div>
          )}

          {/* Submit Button */}
          <div className="guest-card p-6">
            <Button
              onClick={handleSubmitInformation}
              disabled={isSubmitting || !hasDatesSet || isLocked || dietExceedsGuests}
              size="lg"
              className="w-full sm:w-auto gap-2 rounded-full bg-[#35532A] text-white hover:bg-[#2A4221]"
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



// ---------- WhatsApp group card ----------
function WhatsAppGroupCard({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <section className="guest-card p-6">
      <div className="flex flex-wrap items-center gap-4">
        <div className="rounded-xl bg-[#EAF6DF] p-2.5 text-[#35532A] shrink-0">
          <MessageCircle className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold tracking-tight">Group chat</h2>
          <p className="text-sm text-muted-foreground">Communicate with the Quinta team before, during and after your stay</p>
        </div>
        <a href={url} target="_blank" rel="noopener noreferrer">
          <Button size="sm" className="rounded-full bg-[#35532A] text-white hover:bg-[#2A4221]">Open WhatsApp group</Button>
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
      <section className="guest-card p-6">
        <h2 className="text-base font-semibold tracking-tight mb-3">Weather forecast</h2>
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
    <section className="guest-card p-6">
      <div className="flex items-start justify-between mb-4 gap-2">
        <h2 className="text-base font-semibold tracking-tight">Weather forecast</h2>
        {showBadge && (
          <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-[11px] font-medium">
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
              className="shrink-0 w-24 rounded-xl border border-border/70 bg-background p-3 flex flex-col items-center gap-1"
            >
              <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
              <Icon className="w-6 h-6 text-[#679E3F]" />
              <div className="text-sm tabular-nums">
                <span className="font-semibold">{d.temp_max}°</span>
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
