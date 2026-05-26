import { describe, expect, it } from "vitest";
import { calculateTransportationCost, getEffectiveTripPrice } from "@/lib/transportationPricing";
import type { TransportationTrip } from "@/types/guest";

const trip = (overrides: Partial<TransportationTrip>): TransportationTrip => ({
  id: "trip-1",
  user_id: "user-1",
  trip_direction: "To Quinta",
  pickup_location: "Lisbon",
  dropoff_location: "Quinta do Amor",
  trip_date: "2026-06-20",
  trip_time: "12:00",
  passengers_count: 2,
  taxi_size: "4 seats",
  price_estimate: "€60",
  custom_price: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("transportation pricing sync", () => {
  it("always prefers manual price overrides over automatic route pricing", () => {
    const result = getEffectiveTripPrice(trip({ custom_price: 90 }));
    expect(result).toBe(90);
  });

  it("recalculates subtotal from current trip records without duplicate aggregation", () => {
    const summary = calculateTransportationCost([
      trip({ id: "a", custom_price: 90, price_estimate: "€60" }),
      trip({ id: "b", custom_price: 90, price_estimate: "€60" }),
    ]);

    expect(summary.totalTrips).toBe(2);
    expect(summary.customOfferCount).toBe(0);
    expect(summary.subtotal).toBe(180);
    expect(summary.fixedPriceTotal).toBe(180);
  });

  it("counts only truly unpriced custom-offer trips as missing", () => {
    const summary = calculateTransportationCost([
      trip({ id: "fixed", custom_price: 90 }),
      trip({
        id: "custom-missing",
        pickup_location: "Porto",
        dropoff_location: "Quinta do Amor",
        taxi_size: "6 seats",
        price_estimate: "Custom offer",
        custom_price: null,
      }),
    ]);

    expect(summary.subtotal).toBe(90);
    expect(summary.customOfferCount).toBe(1);
  });
});