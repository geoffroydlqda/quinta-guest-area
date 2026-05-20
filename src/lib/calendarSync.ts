import { supabase } from "@/integrations/supabase/client";

/** Fire-and-forget: upsert a trip's Google Calendar event. Never throws. */
export async function syncTripCalendar(tripId: string): Promise<void> {
  try {
    await supabase.functions.invoke("sync-transportation-calendar", {
      body: { action: "upsert", tripId },
    });
  } catch (e) {
    console.warn("[calendarSync] upsert failed", e);
  }
}

/** Fire-and-forget: delete a calendar event by id. Never throws. */
export async function deleteTripCalendarEvent(eventId: string): Promise<void> {
  if (!eventId) return;
  try {
    await supabase.functions.invoke("sync-transportation-calendar", {
      body: { action: "delete", eventId },
    });
  } catch (e) {
    console.warn("[calendarSync] delete failed", e);
  }
}

/** Admin: backfill all missing/failed trips. Returns { synced, failed, total } or null on error. */
export async function backfillTripCalendars(): Promise<
  { synced: number; failed: number; total: number } | null
> {
  try {
    const { data, error } = await supabase.functions.invoke(
      "sync-transportation-calendar",
      { body: { action: "backfill" } },
    );
    if (error) {
      console.warn("[calendarSync] backfill error", error);
      return null;
    }
    return data as { synced: number; failed: number; total: number };
  } catch (e) {
    console.warn("[calendarSync] backfill failed", e);
    return null;
  }
}
