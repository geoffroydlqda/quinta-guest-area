/**
 * GuestShell — coquille de navigation de la guest area (août 2026).
 * Sidebar fixe à gauche (desktop) inspirée du portail Substance, transposée
 * dans l'identité Quinta do Amor : sidebar vert profond, contenu olive clair.
 * Mobile : header sticky + barre d'onglets horizontale scrollable.
 */
import { Link, useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveBooking } from '@/contexts/BookingContext';
import { usePaymentData } from '@/hooks/usePaymentData';
import { isPayableOnline } from '@/components/guest-area/PaymentSections';
import { StaySwitcher } from './StaySwitcher';
import qdaLogo from '@/assets/qda-logo.png';

export type GuestTab = 'overview' | 'rooms' | 'catering' | 'transportation' | 'payments';

const NAV: { key: GuestTab; label: string; href: string }[] = [
  { key: 'overview', label: 'Stay summary', href: '/dashboard' },
  { key: 'rooms', label: 'Bedrooms', href: '/room-setup' },
  { key: 'catering', label: 'Catering', href: '/food' },
  { key: 'transportation', label: 'Transportation', href: '/transportation' },
  { key: 'payments', label: 'Payments', href: '/payments' },
];

function shortDate(s: string | null | undefined) {
  if (!s) return null;
  const d = new Date(s + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
}

export function GuestShell({ active, children }: { active: GuestTab; children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { activeBooking, activeBookingId, isImpersonating, impersonatedBooking, exitImpersonation } = useActiveBooking();

  // Badge "à payer" sur l'onglet Payments (comme le compteur Actions de Substance).
  const { payments } = usePaymentData(activeBookingId);
  const dueCount = payments.filter(isPayableOnline).length;

  const withImpersonation = (href: string) =>
    isImpersonating && impersonatedBooking ? `${href}?impersonate=${impersonatedBooking.id}` : href;

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  const handleExitImpersonation = () => {
    exitImpersonation();
    navigate('/admin');
  };

  const impersonatedLabel = impersonatedBooking
    ? ([impersonatedBooking.first_name, impersonatedBooking.last_name].filter(Boolean).join(' ')
        || impersonatedBooking.email
        || 'guest')
    : 'guest';

  const stayLabel = activeBooking?.retreat_name || 'Your stay';
  const checkIn = shortDate(activeBooking?.check_in_date);
  const checkOut = shortDate(activeBooking?.check_out_date);

  const NavLinks = ({ variant }: { variant: 'sidebar' | 'mobile' }) => (
    <>
      {NAV.map((item) => {
        const isActive = item.key === active;
        if (variant === 'sidebar') {
          return (
            <Link
              key={item.key}
              to={withImpersonation(item.href)}
              aria-current={isActive ? 'page' : undefined}
              className={`group flex items-center gap-2.5 py-[7px] text-[15px] leading-snug transition-colors ${
                isActive ? 'text-white font-medium' : 'text-[#E7C9B8] hover:text-white'
              }`}
            >
              <span
                aria-hidden
                className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors ${
                  isActive ? 'bg-[#F2A65A]' : 'bg-transparent group-hover:bg-[#F2A65A]/40'
                }`}
              />
              <span className="truncate">{item.label}</span>
              {item.key === 'payments' && dueCount > 0 && (
                <span className="ml-auto rounded-[4px] bg-[#F2A65A] px-1.5 py-px text-[11px] font-semibold text-[#7C351F] tabular-nums">
                  {dueCount}
                </span>
              )}
            </Link>
          );
        }
        return (
          <Link
            key={item.key}
            to={withImpersonation(item.href)}
            aria-current={isActive ? 'page' : undefined}
            className={`relative shrink-0 whitespace-nowrap px-1 pb-2.5 pt-1 text-sm transition-colors ${
              isActive ? 'font-semibold text-[#B25C3D]' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {item.label}
            {item.key === 'payments' && dueCount > 0 && (
              <span className="ml-1.5 rounded-[4px] bg-[#B25C3D] px-1.5 py-px text-[10px] font-semibold text-white tabular-nums align-middle">
                {dueCount}
              </span>
            )}
            {isActive && (
              <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-[#E98E3C]" />
            )}
          </Link>
        );
      })}
    </>
  );

  return (
    <div className="guest-ui min-h-screen bg-background text-foreground">
      {isImpersonating && (
        <div className="sticky top-0 z-[60] w-full bg-amber-500 text-white px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            Admin mode — viewing <strong>{impersonatedLabel}</strong>. Changes are saved on this booking.
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={handleExitImpersonation}
            className="h-7 border-white bg-transparent text-white hover:bg-white hover:text-amber-700"
          >
            Exit admin mode
          </Button>
        </div>
      )}

      {/* ---- Sidebar (desktop) ---- */}
      <aside className="hidden lg:flex flex-col fixed inset-y-0 left-0 w-60 bg-[#7C351F] text-[#F6F7F2] px-6 py-7 z-40">
        <Link to={withImpersonation('/dashboard')} className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-full bg-[#F6F7F2] flex items-center justify-center shrink-0 overflow-hidden">
            <img src={qdaLogo} alt="" className="w-7 h-7 object-contain" />
          </span>
          <span className="guest-display text-lg font-semibold leading-tight tracking-tight text-white">
            Quinta do Amor
          </span>
        </Link>

        <nav className="mt-14 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#C79E8B] mb-3">
            Your stay
          </div>
          <div className="flex flex-col">
            <NavLinks variant="sidebar" />
          </div>
        </nav>

        <div className="mt-8 space-y-3">
          <div className="text-[11px] leading-relaxed text-[#C79E8B]">
            <div className="truncate">{stayLabel}</div>
            {checkIn && checkOut && (
              <div className="tabular-nums">{checkIn} → {checkOut}</div>
            )}
            <div className="truncate mt-1 opacity-80">{user?.email}</div>
          </div>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-1.5 text-[12px] text-[#E7C9B8] hover:text-white transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Log out
          </button>
        </div>
      </aside>

      {/* ---- Main column ---- */}
      <div className="lg:pl-60 flex flex-col min-h-screen">
        {/* Top bar desktop */}
        <div className="hidden lg:flex items-center justify-between gap-4 h-12 px-8 border-b border-border/70 bg-background/95 sticky top-0 z-30">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground truncate">
            {stayLabel}
          </div>
          <div className="flex items-center gap-4 shrink-0">
            {checkIn && checkOut && (
              <span className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground tabular-nums">
                {checkIn} → {checkOut}
              </span>
            )}
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#B25C3D]">
              <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-[#E98E3C]" />
              Guest area
            </span>
            <StaySwitcher />
          </div>
        </div>

        {/* Header + nav mobile */}
        <div className="lg:hidden sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b border-border/70">
          <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-1">
            <Link to={withImpersonation('/dashboard')} className="flex items-center gap-2 min-w-0">
              <img src={qdaLogo} alt="Quinta do Amor" className="h-8 w-auto" />
              <span className="guest-display text-base font-semibold tracking-tight text-[#B25C3D] truncate">
                Quinta do Amor
              </span>
            </Link>
            <div className="flex items-center gap-1.5 shrink-0">
              <StaySwitcher />
              <Button variant="ghost" size="sm" onClick={handleSignOut} className="text-muted-foreground hover:text-foreground px-2">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <nav className="flex gap-4 px-4 overflow-x-auto scrollbar-none">
            <NavLinks variant="mobile" />
          </nav>
        </div>

        <main className="flex-1 px-4 sm:px-6 lg:px-10 py-8 lg:py-10">
          {children}
        </main>

        <footer className="border-t border-border/70 py-6">
          <div className="px-4 sm:px-6 lg:px-10 text-xs text-muted-foreground flex flex-wrap justify-between gap-2">
            <span>Quinta do Amor © {new Date().getFullYear()}</span>
            <a href="mailto:hello@quintamor.com" className="hover:text-foreground">hello@quintamor.com</a>
          </div>
        </footer>
      </div>
    </div>
  );
}
