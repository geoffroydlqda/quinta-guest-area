// Guest Area Types

export interface GuestProfile {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  check_in_date: string | null;
  check_out_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface TransportationRequest {
  id: string;
  user_id: string;
  status_transportation: 'draft' | 'submitted';
  notes_transportation: string | null;
  created_at: string;
  updated_at: string;
}

export interface TransportationTrip {
  id: string;
  user_id: string;
  trip_direction: 'To Quinta' | 'From Quinta';
  pickup_location: string;
  dropoff_location: string;
  trip_date: string;
  trip_time: string;
  passengers_count: number;
  taxi_size: '4 seats' | '6 seats';
  price_estimate: string;
  created_at: string;
  updated_at: string;
  passengers?: TransportationPassenger[];
}

export interface TransportationPassenger {
  id: string;
  user_id: string;
  trip_id: string;
  first_name: string;
  phone: string;
  flight_number: string | null;
  created_at: string;
}

export interface FoodPlan {
  id: string;
  user_id: string;
  status_food: 'draft' | 'submitted';
  notes_food: string | null;
  selections: FoodDaySelection[];
  created_at: string;
  updated_at: string;
}

export interface FoodDaySelection {
  date: string;
  fullBoard: boolean;
  breakfast: boolean;
  lunch: boolean;
  dinner: boolean;
}

export interface DocsAck {
  id: string;
  user_id: string;
  last_viewed_at: string;
}

// Tool Status Types
export type ToolStatus = 'not_set' | 'draft' | 'submitted';

export interface ToolStatuses {
  roomSetup: ToolStatus;
  transportation: ToolStatus;
  food: ToolStatus;
  documentation: boolean; // viewed or not
}

// Price calculation helpers
export const STANDARD_TAXI_PRICE = 60;
export const CUSTOM_OFFER_TEXT = 'Custom offer';

export function calculateTripPrice(
  pickupLocation: string,
  dropoffLocation: string,
  taxiSize: '4 seats' | '6 seats'
): string {
  const standardLocations = ['Lisbon', 'Lisbon Airport', 'Quinta do Amor'];
  const isStandardRoute = 
    standardLocations.includes(pickupLocation) && 
    standardLocations.includes(dropoffLocation) &&
    pickupLocation !== dropoffLocation;
  
  if (taxiSize === '4 seats' && isStandardRoute) {
    return `€${STANDARD_TAXI_PRICE}`;
  }
  
  return CUSTOM_OFFER_TEXT;
}
