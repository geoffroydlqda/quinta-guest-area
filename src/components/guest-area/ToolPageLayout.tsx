import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { GuestShell, type GuestTab } from './GuestShell';
import { EditLockBanner } from './EditLockBanner';
import { useActiveBooking } from '@/contexts/BookingContext';
import type { GuestStatusInfo } from '@/lib/editLock';

interface ToolPageLayoutProps {
  title: string;
  description?: string;
  /** @deprecated Prefer passing statusInfo. Still honored as a fallback when statusInfo is omitted. */
  isLocked?: boolean;
  statusInfo?: GuestStatusInfo;
  showOkButton?: boolean;
  children: React.ReactNode;
}

/** Onglet sidebar actif d'après la route de l'outil. */
const TAB_BY_PATH: Record<string, GuestTab> = {
  '/room-setup': 'rooms',
  '/food': 'catering',
  '/transportation': 'transportation',
};

/** Kicker au-dessus du titre : catégorie de la page (les titres portent déjà
 *  le nom de l'onglet, on évite le doublon kicker == titre). */
const KICKER_BY_TAB: Record<GuestTab, string> = {
  overview: 'Stay summary',
  rooms: 'Your setup',
  catering: 'Your setup',
  transportation: 'Your setup',
  payments: 'Payments',
};

export function ToolPageLayout({ title, description, isLocked = false, statusInfo, showOkButton = true, children }: ToolPageLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { isImpersonating, impersonatedBooking } = useActiveBooking();

  const active = TAB_BY_PATH[location.pathname] ?? 'overview';

  const dashboardHref = isImpersonating && impersonatedBooking
    ? `/dashboard?impersonate=${impersonatedBooking.id}`
    : '/dashboard';

  return (
    <GuestShell active={active}>
      <div className="max-w-4xl animate-fade-up">
        <div className="mb-8">
          <div className="guest-kicker mb-2">{KICKER_BY_TAB[active]}</div>
          <h1 className="guest-display text-3xl md:text-4xl font-semibold tracking-tight text-[#35532A] mb-2">{title}</h1>
          {description && (
            <p className="text-sm md:text-base text-muted-foreground">{description}</p>
          )}
        </div>

        {statusInfo
          ? <EditLockBanner variant="tool" statusInfo={statusInfo} />
          : (isLocked && <EditLockBanner variant="tool" />)}

        {children}

        {/* OK Button at bottom of page */}
        {showOkButton && (
          <div className="mt-10 flex justify-center">
            <Button
              onClick={() => navigate(dashboardHref)}
              size="lg"
              className="min-w-32 rounded-full bg-[#35532A] text-white hover:bg-[#2A4221]"
            >
              OK
            </Button>
          </div>
        )}
      </div>
    </GuestShell>
  );
}
