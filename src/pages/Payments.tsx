/**
 * Payments — onglet dédié aux paiements du séjour (extrait du Dashboard,
 * redesign sidebar août 2026). Logique inchangée : PaymentSections.
 */
import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { GuestShell } from '@/components/guest-area/GuestShell';
import { PaymentOverview } from '@/components/guest-area/PaymentSections';
import { useActiveBooking } from '@/contexts/BookingContext';
import { useToast } from '@/hooks/use-toast';

function PaymentsContent() {
  const { toast } = useToast();
  const { bookingsPersonal, activeBookingId, isLoading } = useActiveBooking();

  // Retour de Stripe Checkout (?payment=success|cancelled) — le success_url
  // peut pointer ici ou sur /dashboard ; les deux pages gèrent le paramètre.
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

  if (!isLoading && !activeBookingId) {
    if (bookingsPersonal.length > 1) return <Navigate to="/bookings" replace />;
    return <Navigate to="/dashboard" replace />;
  }

  if (isLoading) {
    return (
      <div className="guest-ui min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <GuestShell active="payments">
      <div className="max-w-3xl space-y-6 animate-fade-up">
        <div>
          <div className="guest-kicker mb-2">Payments</div>
          <h1 className="guest-display text-3xl md:text-4xl font-semibold tracking-tight text-[#35532A]">
            Your payments
          </h1>
          <p className="mt-2 text-sm md:text-base text-muted-foreground">
            Every installment of your stay in one place — what's paid, what's next, and your invoices.
          </p>
        </div>
        <PaymentOverview bookingId={activeBookingId} />
      </div>
    </GuestShell>
  );
}

const Payments = () => (
  <ProtectedRoute>
    <PaymentsContent />
  </ProtectedRoute>
);

export default Payments;
