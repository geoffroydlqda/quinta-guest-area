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
          <h1 className="guest-display text-3xl md:text-4xl font-semibold tracking-tight text-[#6D7855] mb-2">{title}</h1>
          {description && (
            <p className="text-sm md:text-base text-muted-foreground">{description}</p>
          )}
        </div>

        {statusInfo
          ? <EditLockBanner variant="tool" statusInfo={statusInfo} />
          : (isLocked && <EditLockBanner variant="tool" />)}

        {children}

        {/* L'ancien bouton OK (simple retour au dashboard) a été remplacé par
            la carte "Mark as complete" de chaque outil, qui ramène au Stay
            summary après complétion. */}
        <div className="mt-10 flex justify-center">
          <Button
            variant="ghost"
            onClick={() => navigate(dashboardHref)}
            className="text-muted-foreground hover:text-foreground"
          >
            ← Back to stay summary
          </Button>
        </div>
      </div>
    </GuestShell>
  );
}
