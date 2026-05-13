import type { TransportationTrip } from '@/types/guest';
import { STANDARD_TAXI_PRICE_4_SEATS, STANDARD_TAXI_PRICE_6_SEATS, CUSTOM_OFFER_TEXT } from '@/types/guest';

export interface TransportationCostSummary {
  /** Total of all confirmed prices: fixed-route trips + custom-offer trips with admin-set custom_price. */
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
  taxiSize: '4 seats' | '6 seats'
): number | null {
  if (isFixedRoute(pickupLocation, dropoffLocation)) {
    return taxiSize === '4 seats' ? STANDARD_TAXI_PRICE_4_SEATS : STANDARD_TAXI_PRICE_6_SEATS;
  }
  return null;
}

export function getTripPrice(
  pickupLocation: string,
  dropoffLocation: string,
  taxiSize: '4 seats' | '6 seats'
): string {
  const p = getFixedTripPriceNumeric(pickupLocation, dropoffLocation, taxiSize);
  return p !== null ? `€${p}` : CUSTOM_OFFER_TEXT;
}

/**
 * Returns the effective price for a trip:
 * - fixed-route price, OR
 * - admin-defined custom_price (if set), OR
 * - null when it is a custom-offer trip without a price yet.
 */
export function getEffectiveTripPrice(trip: Pick<TransportationTrip, 'pickup_location' | 'dropoff_location' | 'taxi_size' | 'custom_price'>): number | null {
  const fixed = getFixedTripPriceNumeric(trip.pickup_location, trip.dropoff_location, trip.taxi_size);
  if (fixed !== null) return fixed;
  if (trip.custom_price !== null && trip.custom_price !== undefined && !Number.isNaN(Number(trip.custom_price))) {
    return Number(trip.custom_price);
  }
  return null;
}

/** Backwards-compatible: returns fixed-route price only (does not consider custom_price). */
export function getTripPriceNumeric(
  pickupLocation: string,
  dropoffLocation: string,
  taxiSize: '4 seats' | '6 seats'
): number | null {
  return getFixedTripPriceNumeric(pickupLocation, dropoffLocation, taxiSize);
}

export function calculateTransportationCost(trips: TransportationTrip[]): TransportationCostSummary {
  let fixedPriceTotal = 0;
  let customOfferCount = 0;

  trips.forEach((trip) => {
    const price = getEffectiveTripPrice(trip);
    if (price !== null) {
      fixedPriceTotal += price;
    } else {
      customOfferCount++;
    }
  });

  return {
    fixedPriceTotal,
    customOfferCount,
    totalTrips: trips.length,
  };
}
