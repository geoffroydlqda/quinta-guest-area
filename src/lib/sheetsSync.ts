import { supabase } from "@/integrations/supabase/client";

let lastTrigger = 0;
let pending: ReturnType<typeof setTimeout> | null = null;

/**
 * Fire-and-forget Google Sheets sync. Debounced ~5s and rate-limited to
 * avoid hammering the gateway during rapid autosaves.
 */
export function triggerSheetsSync() {
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    const now = Date.now();
    if (now - lastTrigger < 3000) return;
    lastTrigger = now;
    supabase.functions.invoke("sync-google-sheets").catch((e) =>
      console.warn("Sheets sync failed:", e)
    );
  }, 5000);
}
