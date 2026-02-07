import { useCallback, useRef, useState, useEffect } from 'react';

export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface UseAutoSaveOptions {
  onSave: () => Promise<boolean>;
  debounceMs?: number;
}

export function useAutoSave({ onSave, debounceMs = 1000 }: UseAutoSaveOptions) {
  const [status, setStatus] = useState<AutoSaveStatus>('idle');
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const triggerSave = useCallback(() => {
    // Clear any pending save
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Set up debounced save
    timeoutRef.current = setTimeout(async () => {
      if (!isMountedRef.current) return;
      
      setStatus('saving');
      
      try {
        const success = await onSave();
        if (!isMountedRef.current) return;
        
        setStatus(success ? 'saved' : 'error');
        
        // Reset to idle after showing "saved" status
        if (success) {
          setTimeout(() => {
            if (isMountedRef.current) {
              setStatus('idle');
            }
          }, 2000);
        }
      } catch (error) {
        if (isMountedRef.current) {
          setStatus('error');
        }
      }
    }, debounceMs);
  }, [onSave, debounceMs]);

  return { status, triggerSave };
}
