import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useActiveBooking } from '@/contexts/BookingContext';
import { GuestAreaHeader } from '@/components/guest-area/GuestAreaHeader';
import { Button } from '@/components/ui/button';
import { Loader2, CalendarDays, ArrowRight } from 'lucide-react';
import { ProtectedRoute } from '@/components/ProtectedRoute';

function formatRange(checkIn: string | null, checkOut: string | null) {
  if (!checkIn || !checkOut) return 'Dates to be confirmed';
  const fmt = (s: string) =>
    new Date(s + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${fmt(checkIn)} → ${fmt(checkOut)}`;
}

function BookingSelectorContent() {
  const navigate = useNavigate();
  const { bookings, isLoading, setActiveBookingId, activeBookingId } = useActiveBooking();

  // If only one booking, auto-select and go
  useEffect(() => {
    if (!isLoading && bookings.length === 1) {
      setActiveBookingId(bookings[0].id);
      navigate('/dashboard', { replace: true });
    }
    if (!isLoading && bookings.length === 0) {
      // No bookings yet — just send to dashboard (trigger will create one on profile)
      navigate('/dashboard', { replace: true });
    }
  }, [isLoading, bookings, navigate, setActiveBookingId]);

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

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <GuestAreaHeader />
      <main className="container mx-auto px-4 py-10 flex-1">
        <div className="max-w-2xl mx-auto space-y-6 animate-fade-up">
          <div className="text-center space-y-2">
            <h1 className="text-3xl md:text-4xl">Your stays</h1>
            <p className="text-muted-foreground">Choose a booking to manage.</p>
          </div>

          <div className="space-y-3">
            {bookings.map((b) => (
              <div
                key={b.id}
                className="bg-card border border-border rounded-2xl p-5 flex items-center justify-between gap-4"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="rounded-xl bg-accent/20 p-2.5">
                    <CalendarDays className="h-5 w-5 text-accent-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium truncate">{b.retreat_name || 'Quinta do Amor stay'}</p>
                    <p className="text-sm text-muted-foreground">{formatRange(b.check_in_date, b.check_out_date)}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {b.guest_count} {b.guest_count === 1 ? 'guest' : 'guests'}
                    </p>
                  </div>
                </div>
                <Button onClick={() => openBooking(b.id)} className="gap-2 shrink-0">
                  {activeBookingId === b.id ? 'Continue' : 'Open'}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
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
