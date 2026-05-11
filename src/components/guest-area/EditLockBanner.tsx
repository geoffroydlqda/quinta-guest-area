import { AlertCircle, AlertTriangle, Clock } from 'lucide-react';
import type { GuestStatusInfo } from '@/lib/editLock';

interface EditLockBannerProps {
  variant?: 'dashboard' | 'tool';
  /** Status info. If omitted on tool variant, falls back to legacy locked banner. */
  statusInfo?: GuestStatusInfo;
}

function PendingBanner({ message }: { message: string }) {
  return (
    <div className="rounded-xl bg-muted/40 border border-border p-4 mb-6">
      <div className="flex items-start gap-3">
        <Clock className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-foreground">Pending completion</p>
          <p className="text-sm text-muted-foreground mt-1">{message}</p>
        </div>
      </div>
    </div>
  );
}

function LateUpdatesBanner({ message }: { message: string }) {
  // Yellow / beige warning — visible but friendly
  return (
    <div
      className="rounded-xl p-4 mb-6 border"
      style={{
        backgroundColor: 'hsl(48 96% 89%)',
        borderColor: 'hsl(43 96% 56%)',
      }}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: 'hsl(32 95% 35%)' }} />
        <div>
          <p className="font-semibold" style={{ color: 'hsl(26 95% 22%)' }}>Late updates</p>
          <p className="text-sm mt-1" style={{ color: 'hsl(26 60% 22%)' }}>{message}</p>
        </div>
      </div>
    </div>
  );
}

function FinalizedBanner({ message }: { message: string }) {
  return (
    <div className="rounded-xl bg-destructive/10 border border-destructive/40 p-4 mb-6">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-destructive">Finalized</p>
          <p className="text-sm text-muted-foreground mt-1">{message}</p>
        </div>
      </div>
    </div>
  );
}

export function EditLockBanner({ variant = 'dashboard', statusInfo }: EditLockBannerProps) {
  // Tool-page variant: only render late_updates or finalized banners.
  if (variant === 'tool') {
    if (!statusInfo) {
      // Legacy fallback — assume locked.
      return (
        <FinalizedBanner message="Your information is now locked. Please contact hello@quintamor.com for any changes." />
      );
    }
    if (statusInfo.status === 'late_updates') return <LateUpdatesBanner message={statusInfo.message} />;
    if (statusInfo.status === 'finalized' || statusInfo.status === 'finalized_in_progress') {
      return <FinalizedBanner message={statusInfo.message} />;
    }
    return null;
  }

  if (!statusInfo) return null;

  if (statusInfo.status === 'pending') return <PendingBanner message={statusInfo.message} />;
  if (statusInfo.status === 'late_updates') return <LateUpdatesBanner message={statusInfo.message} />;
  return <FinalizedBanner message={statusInfo.message} />;
}
