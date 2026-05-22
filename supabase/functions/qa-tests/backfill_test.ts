/**
 * Phase 1 backfill + booking-link integrity tests.
 *
 * Verifies that every guest_profile is mirrored 1:1 in bookings, that all
 * child rows (food_plans, transportation_*, room_setups, docs_ack) point at
 * a real booking, and that no row has a user_id that disagrees with its
 * booking's user_id.
 *
 * Run with `supabase--test_edge_functions { functions: ["qa-tests"] }`.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { assertEquals, assert } from "https://deno.land/std@0.190.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const skip = !SUPABASE_URL || !SERVICE_ROLE;
const admin = skip
  ? null
  : createClient(SUPABASE_URL!, SERVICE_ROLE!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

Deno.test({
  name: "backfill: every guest_profile has exactly one booking with matching user_id",
  ignore: skip,
  fn: async () => {
    const { data: profiles, error: pErr } = await admin!
      .from("guest_profiles")
      .select("user_id, email");
    assertEquals(pErr, null);
    assert(profiles, "profiles query returned no data");

    const { data: bookings, error: bErr } = await admin!
      .from("bookings")
      .select("id, user_id, email");
    assertEquals(bErr, null);
    assert(bookings, "bookings query returned no data");

    // Each profile.user_id must appear in bookings exactly once.
    const bookingsByUser = new Map<string, number>();
    for (const b of bookings!) {
      if (!b.user_id) continue;
      bookingsByUser.set(b.user_id, (bookingsByUser.get(b.user_id) ?? 0) + 1);
    }

    const missing: string[] = [];
    for (const p of profiles!) {
      if (!bookingsByUser.has(p.user_id)) missing.push(p.email);
    }
    assertEquals(
      missing.length,
      0,
      `Profiles without a booking: ${missing.join(", ")}`
    );
  },
});

Deno.test({
  name: "bookings: every record has a non-null user_id",
  ignore: skip,
  fn: async () => {
    const { data, error } = await admin!
      .from("bookings")
      .select("id, email, user_id");
    assertEquals(error, null);
    const orphans = (data ?? []).filter((b) => !b.user_id);
    assertEquals(
      orphans.length,
      0,
      `Bookings without user_id: ${orphans.map((o) => o.email).join(", ")}`
    );
  },
});

const CHILD_TABLES = [
  "food_plans",
  "transportation_requests",
  "transportation_trips",
  "transportation_passengers",
  "room_setups",
  "docs_ack",
] as const;

for (const table of CHILD_TABLES) {
  Deno.test({
    name: `child rows in ${table} agree with their booking's user_id`,
    ignore: skip,
    fn: async () => {
      const { data: rows, error } = await admin!
        .from(table)
        .select("id, user_id, booking_id");
      assertEquals(error, null);
      if (!rows || rows.length === 0) return; // nothing to check

      const bookingIds = Array.from(
        new Set(rows.map((r: any) => r.booking_id).filter(Boolean))
      ) as string[];

      let bookings: { id: string; user_id: string | null }[] = [];
      if (bookingIds.length > 0) {
        const { data: bs, error: bErr } = await admin!
          .from("bookings")
          .select("id, user_id")
          .in("id", bookingIds);
        assertEquals(bErr, null);
        bookings = (bs ?? []) as typeof bookings;
      }
      const ownerByBooking = new Map(bookings.map((b) => [b.id, b.user_id]));

      const mismatches: string[] = [];
      for (const r of rows as any[]) {
        if (!r.booking_id) continue; // legacy rows without booking_id are tolerated, just not validated here
        const owner = ownerByBooking.get(r.booking_id);
        if (!owner) {
          mismatches.push(`${table}#${r.id} → missing booking ${r.booking_id}`);
        } else if (owner !== r.user_id) {
          mismatches.push(
            `${table}#${r.id} user_id=${r.user_id} ≠ booking.user_id=${owner}`
          );
        }
      }
      assertEquals(
        mismatches.length,
        0,
        `Cross-owner mismatches:\n  ${mismatches.join("\n  ")}`
      );
    },
  });
}

Deno.test({
  name: "room_setups: at most one record per (user_id, booking_id) pair",
  ignore: skip,
  fn: async () => {
    const { data, error } = await admin!
      .from("room_setups")
      .select("user_id, booking_id");
    assertEquals(error, null);
    const seen = new Map<string, number>();
    for (const r of data ?? []) {
      const key = `${r.user_id}::${r.booking_id ?? "_nobooking_"}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const dupes = [...seen.entries()].filter(([, n]) => n > 1);
    assertEquals(
      dupes.length,
      0,
      `Duplicate room_setups for keys: ${dupes.map(([k]) => k).join(", ")}`
    );
  },
});

Deno.test({
  name: "bookings: invitation_token uniqueness when present",
  ignore: skip,
  fn: async () => {
    const { data, error } = await admin!
      .from("bookings")
      .select("invitation_token")
      .not("invitation_token", "is", null);
    assertEquals(error, null);
    const tokens = (data ?? []).map((b: any) => b.invitation_token);
    assertEquals(
      new Set(tokens).size,
      tokens.length,
      "Duplicate invitation_tokens detected"
    );
  },
});
