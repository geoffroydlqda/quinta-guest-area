import { AlertCircle } from 'lucide-react';

interface EditLockBannerProps {
  variant?: 'dashboard' | 'tool';
}

export function EditLockBanner({ variant = 'dashboard' }: EditLockBannerProps) {
  if (variant === 'tool') {
    return (
      <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 mb-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground">
            This section is locked within 5 days of check-in. Please contact{' '}
            <a href="mailto:hello@quintamor.com" className="text-primary hover:underline">
              hello@quintamor.com
            </a>{' '}
            for any changes.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 mb-6">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-destructive">Edits are locked</p>
          <p className="text-sm text-muted-foreground mt-1">
            Edits are locked within 5 days of check-in. Only your check-in/check-out dates can still be changed. Please contact{' '}
            <a href="mailto:hello@quintamor.com" className="text-primary hover:underline">
              hello@quintamor.com
            </a>{' '}
            for any other changes.
          </p>
        </div>
      </div>
    </div>
  );
}
