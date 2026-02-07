import { Loader2, Check, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AutoSaveStatus } from '@/hooks/useAutoSave';

interface AutoSaveIndicatorProps {
  status: AutoSaveStatus;
  className?: string;
}

export function AutoSaveIndicator({ status, className }: AutoSaveIndicatorProps) {
  if (status === 'idle') return null;

  return (
    <div className={cn("flex items-center gap-1.5 text-sm", className)}>
      {status === 'saving' && (
        <>
          <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">Saving…</span>
        </>
      )}
      {status === 'saved' && (
        <>
          <Check className="w-3.5 h-3.5 text-success" />
          <span className="text-success">Saved</span>
        </>
      )}
      {status === 'error' && (
        <>
          <AlertCircle className="w-3.5 h-3.5 text-destructive" />
          <span className="text-destructive">Error saving</span>
        </>
      )}
    </div>
  );
}
