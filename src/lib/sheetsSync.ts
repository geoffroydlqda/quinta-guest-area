/**
 * Google Sheets sync is currently disabled (target sheet no longer exists,
 * edge function returns 404). This is a no-op to avoid surfacing false
 * "Error saving" messages to users. Signature preserved for all callers.
 */
export function triggerSheetsSync(): Promise<void> {
  console.debug("Sheets sync disabled");
  return Promise.resolve();
}
