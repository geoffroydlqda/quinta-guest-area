import { supabase } from "@/integrations/supabase/client";

let lastTrigger = 0;
let pending: ReturnType<typeof setTimeout> | null = null;

/**
 * Fire-and-forget Google Sheets sync. Debounced ~5s and rate-limited.
 * NEVER throws or rejects — any failure is logged as a warning so that
 * callers' save flows are never affected by sync failures.
 */
export function triggerSheetsSync(): Promise<void> {
  try {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      try {
        const now = Date.now();
        if (now - lastTrigger < 3000) return;
        lastTrigger = now;
        Promise.resolve()
          .then(() => supabase.functions.invoke("sync-google-sheets"))
          .then((res) => {
            if (res && (res as any).error) {
              console.warn("Sheets sync failed (non-blocking):", (res as any).error);
            }
          })
          .catch((error) => {
            console.warn("Sheets sync failed (non-blocking):", error);
          });
      } catch (error) {
        console.warn("Sheets sync failed (non-blocking):", error);
      }
    }, 5000);
  } catch (error) {
    console.warn("Sheets sync failed (non-blocking):", error);
  }
  return Promise.resolve();
}
