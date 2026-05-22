/**
 * Regression guard: every write/read path in the booking-aware hooks must
 * remain scoped to the active booking. If someone removes `booking_id` from
 * an insert/update payload or drops a `.eq('booking_id', ...)` filter, these
 * tests fail and surface the regression before it ships.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(p), "utf8");

const ROOM = read("src/hooks/useRoomPlanner.ts");
const FOOD = read("src/hooks/useFoodPlan.ts");
const TRANSPORT = read("src/hooks/useTransportation.ts");

/** Count occurrences of a literal substring. */
const count = (haystack: string, needle: string) =>
  haystack.split(needle).length - 1;

describe("Booking scope invariants — useRoomPlanner", () => {
  it("imports the active booking context", () => {
    expect(ROOM).toMatch(/useActiveBooking\(\)/);
    expect(ROOM).toMatch(/activeBookingId/);
  });

  it("scopes the load query to booking_id when present, with user_id fallback", () => {
    expect(ROOM).toMatch(/activeBookingId\s*\?\s*[^?]*\.eq\(['"]booking_id['"],\s*activeBookingId\)/);
    expect(ROOM).toMatch(/\.eq\(['"]user_id['"],\s*user\.id\)/);
  });

  it("write payload (recordData) carries booking_id: activeBookingId", () => {
    expect(ROOM).toMatch(/booking_id:\s*activeBookingId/);
  });

  it("re-loads when activeBookingId changes", () => {
    expect(ROOM).toMatch(/\[user,\s*activeBookingId,\s*loadUserRecord\]/);
  });
});

describe("Booking scope invariants — useFoodPlan", () => {
  it("scopes the load query to booking_id with user_id fallback", () => {
    expect(FOOD).toMatch(/activeBookingId\s*\?\s*[^?]*\.eq\(['"]booking_id['"],\s*activeBookingId\)/);
    expect(FOOD).toMatch(/\.eq\(['"]user_id['"],\s*user\.id\)/);
  });

  it("insert payload includes booking_id: activeBookingId", () => {
    expect(FOOD).toMatch(/booking_id:\s*activeBookingId/);
  });

  it("update path filters by booking_id when active, else by user_id", () => {
    expect(FOOD).toMatch(/activeBookingId[\s\S]{0,80}\.eq\(['"]booking_id['"],\s*activeBookingId\)/);
    expect(FOOD).toMatch(/\.eq\(['"]user_id['"],\s*user\.id\)/);
  });

  it("re-runs when active booking changes", () => {
    expect(FOOD).toMatch(/activeBookingId/);
    // Effect deps should mention activeBookingId
    expect(count(FOOD, "activeBookingId")).toBeGreaterThanOrEqual(4);
  });
});

describe("Booking scope invariants — useTransportation", () => {
  it("scopes request + trips reads by booking_id with user_id fallback", () => {
    // request query
    expect(TRANSPORT).toMatch(/activeBookingId\s*\?[\s\S]{0,80}\.eq\(['"]booking_id['"],\s*activeBookingId\)/);
    // trips query also scoped
    expect(count(TRANSPORT, ".eq('booking_id', activeBookingId)")).toBeGreaterThanOrEqual(2);
    expect(TRANSPORT).toMatch(/\.eq\(['"]user_id['"],\s*user\.id\)/);
  });

  it("auto-creates request rows with booking_id stamped", () => {
    expect(TRANSPORT).toMatch(/\.insert\(\s*\{\s*user_id:\s*user\.id,\s*booking_id:\s*activeBookingId\s*\}\s*\)/);
  });

  it("trip + passenger write payloads include booking_id: activeBookingId", () => {
    // Should appear in at least two distinct write payloads (trip + passenger / request)
    expect(count(TRANSPORT, "booking_id: activeBookingId")).toBeGreaterThanOrEqual(2);
  });

  it("update path filters by booking_id when active, else by user_id", () => {
    expect(TRANSPORT).toMatch(/activeBookingId[\s\S]{0,120}\.eq\(['"]booking_id['"],\s*activeBookingId\)/);
  });
});

describe("Booking scope invariants — App wiring", () => {
  const APP = read("src/App.tsx");
  const CTX = read("src/contexts/BookingContext.tsx");

  it("BookingProvider wraps the route tree", () => {
    expect(APP).toMatch(/<BookingProvider>/);
    expect(APP).toMatch(/<\/BookingProvider>/);
  });

  it("BookingContext exposes activeBookingId + refresh", () => {
    expect(CTX).toMatch(/activeBookingId/);
    expect(CTX).toMatch(/refresh/);
    expect(CTX).toMatch(/setActiveBookingId/);
  });

  it("invite route is registered", () => {
    expect(APP).toMatch(/path="\/invite\/:token"/);
  });
});
