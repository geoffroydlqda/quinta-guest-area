import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GuestAreaHeader } from './GuestAreaHeader';
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

export function ToolPageLayout({ title, description, isLocked = false, statusInfo, showOkButton = true, children }: ToolPageLayoutProps) {
  const navigate = useNavigate();
  const { isImpersonating, impersonatedBooking } = useActiveBooking();

  const dashboardHref = isImpersonating && impersonatedBooking
    ? `/dashboard?impersonate=${impersonatedBooking.id}`
    : '/dashboard';

  return (
    <div className="guest-ui min-h-screen bg-background text-foreground flex flex-col">
      {/* Sticky header with back button */}
      <div className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border/70">
        <GuestAreaHeader />
        <div className="container mx-auto px-4 py-2">
          <Button asChild variant="ghost" size="sm" className="gap-2 -ml-2 text-muted-foreground hover:text-foreground">
            <Link to={dashboardHref}>
              <ArrowLeft className="w-4 h-4" />
              Back to Dashboard
            </Link>
          </Button>
        </div>
      </div>

      <main className="container mx-auto px-4 py-8 md:py-10 flex-1">
        <div className="mb-8">
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
      </main>

      <footer className="border-t border-border/70 py-8 mt-12">
        <div className="container mx-auto px-4 text-center text-xs text-muted-foreground">
          <p>Quinta do Amor © {new Date().getFullYear()}</p>
        </div>
      </footer>
    </div>
  );
}
