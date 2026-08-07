import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import qdaLogo from '@/assets/qda-logo.png';
import { StaySwitcher } from './StaySwitcher';
import { useActiveBooking } from '@/contexts/BookingContext';

interface GuestAreaHeaderProps {
  showLogout?: boolean;
}

export function GuestAreaHeader({ showLogout = true }: GuestAreaHeaderProps) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { isImpersonating, impersonatedBooking, exitImpersonation } = useActiveBooking();

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  const impersonatedLabel = impersonatedBooking
    ? ([impersonatedBooking.first_name, impersonatedBooking.last_name].filter(Boolean).join(' ')
        || impersonatedBooking.email
        || 'guest')
    : 'guest';

  const handleExit = () => {
    exitImpersonation();
    navigate('/admin');
  };

  return (
    <>
      {isImpersonating && (
        <div className="sticky top-0 z-[60] w-full bg-amber-500 text-white px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            Admin mode — viewing <strong>{impersonatedLabel}</strong>. Changes are saved on this booking.
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={handleExit}
            className="h-7 border-white bg-transparent text-white hover:bg-white hover:text-amber-700"
          >
            Exit admin mode
          </Button>
        </div>
      )}
      <header className="bg-card/85 backdrop-blur-md border-b border-border/70 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <img src={qdaLogo} alt="Quinta do Amor" className="h-10 w-auto" />
            <div className="hidden sm:block min-w-0">
              <h1 className="guest-display text-base font-semibold leading-tight tracking-tight text-[#35532A] truncate">
                Quinta do Amor
              </h1>
              <p className="guest-kicker">Guest Area</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <StaySwitcher />
            {showLogout && (
              <>
                <span className="text-xs text-muted-foreground hidden lg:block max-w-[220px] truncate">
                  {user?.email}
                </span>
                <Button variant="ghost" size="sm" onClick={handleSignOut} className="gap-2 text-muted-foreground hover:text-foreground">
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
