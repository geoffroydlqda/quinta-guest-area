import { LogOut, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveBooking } from '@/contexts/BookingContext';
import { useNavigate } from 'react-router-dom';
import qdaLogo from '@/assets/qda-logo.png';
import { StaySwitcher } from './StaySwitcher';

interface GuestAreaHeaderProps {
  showLogout?: boolean;
}

export function GuestAreaHeader({ showLogout = true }: GuestAreaHeaderProps) {
  const { user, signOut } = useAuth();
  const { isImpersonating, impersonatedBooking, exitImpersonation } = useActiveBooking();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  const impersonatedLabel = (() => {
    if (!impersonatedBooking) return '';
    const name = [impersonatedBooking.first_name, impersonatedBooking.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();
    return impersonatedBooking.retreat_name || name || impersonatedBooking.email;
  })();

  return (
    <>
      {isImpersonating && (
        <div className="w-full bg-amber-500 text-white">
          <div className="container mx-auto px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="flex items-center gap-2 min-w-0">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <span className="truncate">
                <strong>Admin mode</strong> — viewing the Guest Area of{' '}
                <strong>{impersonatedLabel}</strong>. Changes will be saved on this booking.
              </span>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={exitImpersonation}
              className="h-7 text-xs"
            >
              Exit admin mode
            </Button>
          </div>
        </div>
      )}
      <header className="bg-card/80 backdrop-blur-sm border-b border-border sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <img src={qdaLogo} alt="Quinta do Amor" className="h-12 w-auto" />
            <div className="hidden sm:block">
              <h1 className="text-lg font-medium leading-tight">Guest Area</h1>
              <p className="text-sm text-muted-foreground">Quinta do Amor</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            {!isImpersonating && <StaySwitcher />}
            {showLogout && (
              <>
                <span className="text-sm text-muted-foreground hidden lg:block">
                  {user?.email}
                </span>
                <Button variant="ghost" size="sm" onClick={handleSignOut} className="gap-2">
                  <LogOut className="h-4 w-4" />
                  <span className="hidden sm:inline">Log out</span>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>
    </>
  );
}
