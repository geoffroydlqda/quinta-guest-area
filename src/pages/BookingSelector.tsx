import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useActiveBooking } from '@/contexts/BookingContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { GuestAreaHeader } from '@/components/guest-area/GuestAreaHeader';
import { Button } from '@/components/ui/button';
import { Loader2, CalendarDays, ArrowRight, ChevronDown, ChevronRight } from 'lucide-react';
import { ProtectedRoute } from '@/components/ProtectedRoute';

/**
 * Choix de la retraite (multi-retraites, 3 août 2026 — cas Isabel Muir) :
 * un organisateur récurrent voit toutes ses retraites à venir avec un statut
 * ("Room setup to do" / "Food plan to do" / "Up to date"), les passées
 * repliées. Une seule retraite -> redirection directe vers le dashboard.
 */

function formatRange(checkIn: string | null, checkOut: string | null) {
  if (!checkIn || !checkOut) return 'Dates to be confirmed';
  const fmt = (s: string) =>
    new Date(s + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${fmt(checkIn)} → ${fmt(checkOut)}`;
}

type Chip = { label: string; cls: string } | null;

function BookingSelectorContent() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { bookingsPersonal, isLoading, setActiveBookingId, activeBookingId } = useActiveBooking();
  const [pastOpen, setPastOpen] = useState(false);
  const [setupState, setSetupState] = useState<Map<string, { room: boolean; food: boolean }>>(new Map());

  const todayIso = new Date().toISOString().slice(0, 10);
  const upcoming = useMemo(
    () => bookingsPersonal.filter((b) => (b.check_out_date ?? '9999') >= todayIso),
    [bookingsPersonal, todayIso]
  );
  const past = useMemo(
    () => bookingsPersonal.filter((b) => (b.check_out_date ?? '9999') < todayIso)
      .sort((a, b) => (b.check_in_date ?? '').localeCompare(a.check_in_date ?? '')),
    [bookingsPersonal, todayIso]
  );

  // Statut Room setup / Food plan par retraite (chips de l'écran de choix)
  useEffect(() => {
    if (!user || bookingsPersonal.length === 0) return;
    (async () => {
      const ids = bookingsPersonal.map((b) => b.id);
      const [rooms, food] = await Promise.all([
        supabase.from('room_setups').select('booking_id,room_plan').in('booking_id', ids),
        supabase.from('food_plans').select('booking_id,selections').in('booking_id', ids),
      ]);
      const m = new Map<string, { room: boolean; food: boolean }>();
      for (const b of bookingsPersonal) {
        const r = (rooms.data ?? []).find((x) => x.booking_id === b.id);
        const f = (food.data ?? []).find((x) => x.booking_id === b.id);
        m.set(b.id, {
          room: Array.isArray(r?.room_plan) && (r!.room_plan as unknown[]).length > 0,
          food: Array.isArray(f?.selections) &&
            (f!.selections as { fullBoard?: boolean; breakfast?: boolean; lunch?: boolean; dinner?: boolean }[])
              .some((s) => s.fullBoard || s.breakfast || s.lunch || s.dinner),
        });
      }
      setSetupState(m);
    })();
  }, [user, bookingsPersonal]);

  const chipFor = (id: string, isUpcoming: boolean): Chip => {
    if (!isUpcoming) return null;
    const s = setupState.get(id);
    if (!s) return null;
    if (!s.room) return { label: 'Room setup to do', cls: 'bg-amber-50 text-[#8A6C15] border border-amber-200' };
    if (!s.food) return { label: 'Food plan to do', cls: 'bg-amber-50 text-[#8A6C15] border border-amber-200' };
    return { label: 'Up to date', cls: 'bg-primary/10 text-primary border border-primary/20' };
  };

  // Une seule retraite (ou aucune) -> pas d'écran de choix
  useEffect(() => {
    if (!isLoading && bookingsPersonal.length === 1) {
      setActiveBookingId(bookingsPersonal[0].id);
      navigate('/dashboard', { replace: true });
    }
    if (!isLoading && bookingsPersonal.length === 0) {
      navigate('/dashboard', { replace: true });
    }
  }, [isLoading, bookingsPersonal, navigate, setActiveBookingId]);

  const openBooking = (id: string) => {
    setActiveBookingId(id);
    navigate('/dashboard');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const renderCard = (b: (typeof bookingsPersonal)[number], isUpcoming: boolean) => {
    const chip = chipFor(b.id, isUpcoming);
    return (
      <div
        key={b.id}
        className="bg-card border border-border rounded-2xl p-5 flex items-center justify-between gap-4"
      >
        <div className="flex items-start gap-3 min-w-0">
          <div className="rounded-xl bg-accent/20 p-2.5">
            <CalendarDays className="h-5 w-5 text-accent-foreground" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium truncate">{b.retreat_name || 'Quinta do Amor stay'}</p>
              {chip && (
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${chip.cls}`}>
                  {chip.label}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{formatRange(b.check_in_date, b.check_out_date)}</p>
            {b.guest_count != null && (
              <p className="text-xs text-muted-foreground mt-1">
                {b.guest_count} {b.guest_count === 1 ? 'guest' : 'guests'}
              </p>
            )}
          </div>
        </div>
        <Button onClick={() => openBooking(b.id)} className="gap-2 shrink-0">
          {activeBookingId === b.id ? 'Continue' : 'Open'}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <GuestAreaHeader />
      <main className="container mx-auto px-4 py-10 flex-1">
        <div className="max-w-2xl mx-auto space-y-6 animate-fade-up">
          <div className="text-center space-y-2">
            <h1 className="text-3xl md:text-4xl">Your retreats</h1>
            <p className="text-muted-foreground">Pick the one you want to work on.</p>
          </div>

          <div className="space-y-3">
            {upcoming.map((b) => renderCard(b, true))}
            {upcoming.length === 0 && (
              <p className="text-sm text-muted-foreground text-center italic">No upcoming retreat.</p>
            )}
          </div>

          {past.length > 0 && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setPastOpen((v) => !v)}
                className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground mx-auto"
              >
                {pastOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                Past retreats ({past.length})
              </button>
              {pastOpen && past.map((b) => renderCard(b, false))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function BookingSelector() {
  return (
    <ProtectedRoute>
      <BookingSelectorContent />
    </ProtectedRoute>
  );
}
