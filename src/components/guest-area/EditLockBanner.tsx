import { AlertCircle, AlertTriangle, Clock } from 'lucide-react';
import type { GuestStatusInfo } from '@/lib/editLock';

interface EditLockBannerProps {
  variant?: 'dashboard' | 'tool';
  /** Status info. If omitted on tool variant, falls back to legacy locked banner. */
  statusInfo?: GuestStatusInfo;
}

function PendingBanner({ message }: { message: string }) {
  return (
    <div className="rounded-2xl bg-card border border-border/70 p-4 mb-6">
      <div className="flex items-start gap-3">
        <Clock className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-foreground">Pending completion</p>
          <p className="text-sm text-muted-foreground mt-0.5">{message}</p>
        </div>
      </div>
    </div>
  );
}

function LateUpdatesBanner({ message }: { message: string }) {
  // Yellow / beige warning — visible but friendly
  return (
    <div className="rounded-2xl p-4 mb-6 border bg-amber-50 border-amber-200">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-600" />
        <div>
          <p className="text-sm font-semibold text-amber-900">Late updates</p>
          <p className="text-sm mt-0.5 text-amber-800">{message}</p>
        </div>
      </div>
    </div>
  );
}

function FinalizedBanner({ message }: { message: string }) {
  return (
    <div className="rounded-2xl bg-destructive/10 border border-destructive/30 p-4 mb-6">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-destructive">Finalized</p>
          <p className="text-sm text-muted-foreground mt-0.5">{message}</p>
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
