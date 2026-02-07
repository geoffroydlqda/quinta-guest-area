import type { TransportationTrip } from '@/types/guest';
import { STANDARD_TAXI_PRICE_4_SEATS, STANDARD_TAXI_PRICE_6_SEATS, CUSTOM_OFFER_TEXT } from '@/types/guest';

export interface TransportationCostSummary {
  fixedPriceTotal: number;
  customOfferCount: number;
  totalTrips: number;
}

export function isFixedRoute(pickupLocation: string, dropoffLocation: string): boolean {
  const standardLocations = ['Lisbon', 'Lisbon Airport', 'Quinta do Amor'];
  const isStandard = standardLocations.includes(pickupLocation) && 
    standardLocations.includes(dropoffLocation) &&
    pickupLocation !== dropoffLocation;
  
  if (!isStandard) return false;
  
  // Check if it's a route between Lisbon/Airport and Quinta
  const isFromLisbonToQuinta = 
    (pickupLocation === 'Lisbon' || pickupLocation === 'Lisbon Airport') && 
    dropoffLocation === 'Quinta do Amor';
  
  const isFromQuintaToLisbon = 
    pickupLocation === 'Quinta do Amor' && 
    (dropoffLocation === 'Lisbon' || dropoffLocation === 'Lisbon Airport');
  
  return isFromLisbonToQuinta || isFromQuintaToLisbon;
}

export function getTripPrice(
  pickupLocation: string,
  dropoffLocation: string,
  taxiSize: '4 seats' | '6 seats'
): string {
  if (isFixedRoute(pickupLocation, dropoffLocation)) {
    if (taxiSize === '4 seats') {
      return `€${STANDARD_TAXI_PRICE_4_SEATS}`;
    } else {
      return `€${STANDARD_TAXI_PRICE_6_SEATS}`;
    }
  }
  return CUSTOM_OFFER_TEXT;
}

export function getTripPriceNumeric(
  pickupLocation: string,
  dropoffLocation: string,
  taxiSize: '4 seats' | '6 seats'
): number | null {
  if (isFixedRoute(pickupLocation, dropoffLocation)) {
    return taxiSize === '4 seats' ? STANDARD_TAXI_PRICE_4_SEATS : STANDARD_TAXI_PRICE_6_SEATS;
  }
  return null;
}

export function calculateTransportationCost(trips: TransportationTrip[]): TransportationCostSummary {
  let fixedPriceTotal = 0;
  let customOfferCount = 0;

  trips.forEach((trip) => {
    const price = getTripPriceNumeric(trip.pickup_location, trip.dropoff_location, trip.taxi_size);
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
