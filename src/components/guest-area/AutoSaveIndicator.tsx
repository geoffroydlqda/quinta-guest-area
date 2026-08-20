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
    <div className={cn("inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1",
      status === 'saving' && "bg-muted text-muted-foreground",
      status === 'saved' && "bg-[#FAEEE3] text-[#B25C3D]",
      status === 'error' && "bg-destructive/10 text-destructive",
      className)}>
      {status === 'saving' && (
        <>
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Saving…</span>
        </>
      )}
      {status === 'saved' && (
        <>
          <Check className="w-3 h-3" />
          <span>Saved</span>
        </>
      )}
      {status === 'error' && (
        <>
          <AlertCircle className="w-3 h-3" />
          <span>Error saving</span>
        </>
      )}
    </div>
  );
}
