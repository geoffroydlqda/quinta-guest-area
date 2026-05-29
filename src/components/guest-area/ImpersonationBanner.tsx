import { AlertTriangle } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useActiveBooking } from '@/contexts/BookingContext';

export function ImpersonationBanner() {
  const { isImpersonating, impersonatedBooking } = useActiveBooking();
  const navigate = useNavigate();
  const location = useLocation();

  if (!isImpersonating) return null;

  const label =
    impersonatedBooking?.retreat_name ||
    [impersonatedBooking?.first_name, impersonatedBooking?.last_name].filter(Boolean).join(' ') ||
    impersonatedBooking?.email ||
    'this booking';

  const exit = () => {
    // Strip ?impersonate from the URL and go back to admin
    const params = new URLSearchParams(location.search);
    params.delete('impersonate');
    navigate('/admin');
  };

  return (
    <div className="sticky top-0 z-[60] w-full bg-amber-500 text-white shadow-sm">
      <div className="container mx-auto px-4 py-2 flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="flex items-start gap-2 min-w-0">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="leading-snug">
            <strong className="font-semibold">Admin mode</strong> — you are viewing the Guest Area
            of <span className="font-medium">{label}</span> on behalf of the guest. Changes you make
            are saved on this booking.
          </div>
        </div>
        <button
          type="button"
          onClick={exit}
          className="underline underline-offset-2 hover:no-underline font-medium whitespace-nowrap"
        >
          Exit admin mode
        </button>
      </div>
    </div>
  );
}
