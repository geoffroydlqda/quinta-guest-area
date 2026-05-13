// Guest Area Types

export interface GuestProfile {
  id: string;
  user_id: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  check_in_date: string | null;
  check_out_date: string | null;
  guests_count: number;
  submitted_at: string | null;
  status_overall: 'draft' | 'submitted';
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
  taxi_size: '4 seats' | '6 seats' | '8 seats';
  price_estimate: string;
  /** Admin-defined custom price for custom-offer trips (null until admin sets it). */
  custom_price: number | null;
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

export type DietPreference = 'Vegetarian' | 'Meat or fish for dinner' | 'Meat or fish for dinner and lunch';

export type DietType = 'vegetarian' | 'meat_dinner' | 'meat_lunch_dinner';

export interface DietConfig {
  vegetarian_count: number;
  meat_dinner_count: number;
  meat_lunch_dinner_count: number;
}

export const EMPTY_DIET_CONFIG: DietConfig = {
  vegetarian_count: 0,
  meat_dinner_count: 0,
  meat_lunch_dinner_count: 0,
};

export function dietConfigTotal(c: DietConfig | null | undefined): number {
  if (!c) return 0;
  return (c.vegetarian_count || 0) + (c.meat_dinner_count || 0) + (c.meat_lunch_dinner_count || 0);
}

export interface FoodPlan {
  id: string;
  user_id: string;
  status_food: 'draft' | 'submitted';
  notes_food: string | null;
  diet_preference: DietPreference | null;
  diet_config: DietConfig;
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
  /** Number of guests eating on this specific day. Defaults to profile.guests_count when not set. */
  guests_count_day?: number;
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
export const STANDARD_TAXI_PRICE_4_SEATS = 60;
export const STANDARD_TAXI_PRICE_6_SEATS = 80;
export const STANDARD_TAXI_PRICE_8_SEATS = 100;
export const CUSTOM_OFFER_TEXT = 'Custom offer';

export type TaxiSize = '4 seats' | '6 seats' | '8 seats';

export function calculateTripPrice(
  pickupLocation: string,
  dropoffLocation: string,
  taxiSize: TaxiSize
): string {
  const standardLocations = ['Lisbon', 'Lisbon Airport', 'Quinta do Amor'];
  const isStandardRoute =
    standardLocations.includes(pickupLocation) &&
    standardLocations.includes(dropoffLocation) &&
    pickupLocation !== dropoffLocation;

  if (isStandardRoute) {
    if (taxiSize === '4 seats') return `€${STANDARD_TAXI_PRICE_4_SEATS}`;
    if (taxiSize === '6 seats') return `€${STANDARD_TAXI_PRICE_6_SEATS}`;
    return `€${STANDARD_TAXI_PRICE_8_SEATS}`;
  }

  return CUSTOM_OFFER_TEXT;
}
