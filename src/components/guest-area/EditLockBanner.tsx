import { AlertCircle, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import type { GuestStatusInfo } from '@/lib/editLock';

interface EditLockBannerProps {
  variant?: 'dashboard' | 'tool';
  /** New unified status info. If omitted, falls back to legacy "locked" banner. */
  statusInfo?: GuestStatusInfo;
}

export function EditLockBanner({ variant = 'dashboard', statusInfo }: EditLockBannerProps) {
  // Tool-page variant: only render when info is finalized/locked.
  if (variant === 'tool') {
    if (statusInfo && !statusInfo.isEditingLocked) return null;
    return (
      <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 mb-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground">
            {statusInfo?.status === 'finalized_in_progress'
              ? 'Your stay is currently in progress. This section is read-only.'
              : 'Your information is now finalized. Please contact '}
            {statusInfo?.status !== 'finalized_in_progress' && (
              <>
                <a href="mailto:hello@quintamor.com" className="text-primary hover:underline">
                  hello@quintamor.com
                </a>{' '}
                for any changes.
              </>
            )}
          </p>
        </div>
      </div>
    );
  }

  // Dashboard variant — render based on status
  if (!statusInfo) return null;

  if (statusInfo.status === 'pending') {
    return (
      <div className="rounded-xl bg-muted/40 border border-border p-4 mb-6">
        <div className="flex items-start gap-3">
          <Clock className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-foreground">Pending completion</p>
            <p className="text-sm text-muted-foreground mt-1">{statusInfo.message}</p>
          </div>
        </div>
      </div>
    );
  }

  if (statusInfo.status === 'late') {
    return (
      <div className="rounded-xl bg-destructive/10 border border-destructive/40 p-4 mb-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-destructive">Late submission</p>
            <p className="text-sm text-muted-foreground mt-1">{statusInfo.message}</p>
          </div>
        </div>
      </div>
    );
  }

  // finalized_submitted or finalized_in_progress
  return (
    <div className="rounded-xl bg-success/10 border border-success/30 p-4 mb-6">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-foreground">Finalized</p>
          <p className="text-sm text-muted-foreground mt-1">{statusInfo.message}</p>
        </div>
      </div>
    </div>
  );
}
