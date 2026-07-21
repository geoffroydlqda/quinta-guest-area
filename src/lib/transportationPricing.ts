import type { TransportationTrip } from '@/types/guest';
import { CUSTOM_OFFER_TEXT, type TaxiSize } from '@/types/guest';
import { getTaxiPrices } from '@/lib/pricing';

export interface TransportationCostSummary {
  /** Total of all confirmed prices from live trip records using manual override precedence. */
  subtotal: number;
  /** Backwards-compatible alias for subtotal. */
  fixedPriceTotal: number;
  /** Number of custom-offer trips that still have NO admin-defined price. */
  customOfferCount: number;
  totalTrips: number;
}

export function isFixedRoute(pickupLocation: string, dropoffLocation: string): boolean {
  const standardLocations = ['Lisbon', 'Lisbon Airport', 'Quinta do Amor'];
  const isStandard = standardLocations.includes(pickupLocation) &&
    standardLocations.includes(dropoffLocation) &&
    pickupLocation !== dropoffLocation;

  if (!isStandard) return false;

  const isFromLisbonToQuinta =
    (pickupLocation === 'Lisbon' || pickupLocation === 'Lisbon Airport') &&
    dropoffLocation === 'Quinta do Amor';

  const isFromQuintaToLisbon =
    pickupLocation === 'Quinta do Amor' &&
    (dropoffLocation === 'Lisbon' || dropoffLocation === 'Lisbon Airport');

  return isFromLisbonToQuinta || isFromQuintaToLisbon;
}

export function getFixedTripPriceNumeric(
  pickupLocation: string,
  dropoffLocation: string,
  taxiSize: TaxiSize
): number | null {
  if (isFixedRoute(pickupLocation, dropoffLocation)) {
    const prices = getTaxiPrices();
    if (taxiSize === '4 seats') return prices.seats4;
    if (taxiSize === '6 seats') return prices.seats6;
    if (taxiSize === '8 seats') return prices.seats8;
  }
  return null;
}

export function getTripPrice(
  pickupLocation: string,
  dropoffLocation: string,
  taxiSize: TaxiSize
): string {
  const p = getFixedTripPriceNumeric(pickupLocation, dropoffLocation, taxiSize);
  return p !== null ? `€${p}` : CUSTOM_OFFER_TEXT;
}

/**
 * Returns the effective price for a trip. Manual override ALWAYS wins:
 * - admin-defined custom_price (if set) — manual override, OR
 * - fixed-route price (automatic rule), OR
 * - null when it is a custom-offer trip without a price yet.
 */
export function getEffectiveTripPrice(trip: Pick<TransportationTrip, 'pickup_location' | 'dropoff_location' | 'taxi_size' | 'custom_price'>): number | null {
  if (trip.custom_price !== null && trip.custom_price !== undefined && !Number.isNaN(Number(trip.custom_price))) {
    return Number(trip.custom_price);
  }
  const fixed = getFixedTripPriceNumeric(trip.pickup_location, trip.dropoff_location, trip.taxi_size);
  if (fixed !== null) return fixed;
  return null;
}

/** Backwards-compatible: returns fixed-route price only (does not consider custom_price). */
export function getTripPriceNumeric(
  pickupLocation: string,
  dropoffLocation: string,
  taxiSize: TaxiSize
): number | null {
  return getFixedTripPriceNumeric(pickupLocation, dropoffLocation, taxiSize);
}

export function calculateTransportationCost(trips: TransportationTrip[]): TransportationCostSummary {
  let subtotal = 0;
  let customOfferCount = 0;

  trips.forEach((trip) => {
    const price = getEffectiveTripPrice(trip);
    if (price !== null) {
      subtotal += price;
    } else {
      customOfferCount++;
    }
  });

  return {
    subtotal,
    fixedPriceTotal: subtotal,
    customOfferCount,
    totalTrips: trips.length,
  };
}
