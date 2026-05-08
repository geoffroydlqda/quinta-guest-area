import type { DietPreference, FoodDaySelection, DietConfig, DietType } from '@/types/guest';

// Per-diet meal prices (per person per day or per meal)
export interface DietPricing {
  fullBoard: number;
  breakfast: number;
  lunch: number;
  dinner: number;
}

export const DIET_PRICING: Record<DietType, DietPricing> = {
  vegetarian:        { fullBoard: 70, breakfast: 20, lunch: 23, dinner: 27 },
  meat_dinner:       { fullBoard: 78, breakfast: 20, lunch: 23, dinner: 35 },
  meat_lunch_dinner: { fullBoard: 85, breakfast: 20, lunch: 30, dinner: 35 },
};

export interface DietTypeMeta {
  type: DietType;
  label: string;
  countKey: keyof DietConfig;
  pricing: DietPricing;
}

export const DIET_TYPES: DietTypeMeta[] = [
  { type: 'vegetarian',        label: 'Vegetarian',                          countKey: 'vegetarian_count',         pricing: DIET_PRICING.vegetarian },
  { type: 'meat_dinner',       label: 'Meat or fish for dinner',             countKey: 'meat_dinner_count',        pricing: DIET_PRICING.meat_dinner },
  { type: 'meat_lunch_dinner', label: 'Meat or fish for lunch and dinner',   countKey: 'meat_lunch_dinner_count',  pricing: DIET_PRICING.meat_lunch_dinner },
];

// ---- Legacy single-diet helpers (kept for backwards compat with old UI/utilities) ----
export const FULL_BOARD_PRICES: Record<DietPreference, number> = {
  'Vegetarian': 70,
  'Meat or fish for dinner': 78,
  'Meat or fish for dinner and lunch': 85,
};
export const BREAKFAST_PRICE = 20;
export function getLunchPrice(diet: DietPreference | null): number {
  return diet === 'Meat or fish for dinner and lunch' ? 30 : 23;
}
export function getDinnerPrice(diet: DietPreference | null): number {
  return diet === 'Vegetarian' ? 27 : 35;
}
export function getFullBoardPrice(diet: DietPreference | null): number {
  if (!diet) return 70;
  return FULL_BOARD_PRICES[diet] || 70;
}

// ---- Multi-diet cost calculation ----
function dayCostPerPerson(sel: FoodDaySelection, p: DietPricing): number {
  if (sel.fullBoard) return p.fullBoard;
  let t = 0;
  if (sel.breakfast) t += p.breakfast;
  if (sel.lunch) t += p.lunch;
  if (sel.dinner) t += p.dinner;
  return t;
}

export interface DietBreakdownItem {
  type: DietType;
  label: string;
  guests: number;
  perPerson: number;
  total: number;
}

export interface FoodCostSummary {
  totalPerPerson: number; // legacy: weighted-avg per person across diets (for backwards-compat displays)
  grandTotal: number;
  fullBoardDays: number;
  breakfastCount: number;
  lunchCount: number;
  dinnerCount: number;
  guestsCount: number;
  dietBreakdown: DietBreakdownItem[];
  dietTotal: number; // sum of all guests assigned to a diet
}

export function calculateFoodCostMulti(
  selections: FoodDaySelection[],
  diet: DietConfig,
  guestsCount: number
): FoodCostSummary {
  let fullBoardDays = 0, breakfastCount = 0, lunchCount = 0, dinnerCount = 0;
  selections.forEach((sel) => {
    if (sel.fullBoard) fullBoardDays++;
    else {
      if (sel.breakfast) breakfastCount++;
      if (sel.lunch) lunchCount++;
      if (sel.dinner) dinnerCount++;
    }
  });

  const dietBreakdown: DietBreakdownItem[] = DIET_TYPES.map((meta) => {
    const guests = diet?.[meta.countKey] || 0;
    const perPerson = selections.reduce((sum, sel) => sum + dayCostPerPerson(sel, meta.pricing), 0);
    return { type: meta.type, label: meta.label, guests, perPerson, total: perPerson * guests };
  });

  const grandTotal = dietBreakdown.reduce((s, d) => s + d.total, 0);
  const dietTotal = dietBreakdown.reduce((s, d) => s + d.guests, 0);
  const totalPerPerson = dietTotal > 0 ? Math.round(grandTotal / dietTotal) : 0;

  return {
    totalPerPerson,
    grandTotal,
    fullBoardDays,
    breakfastCount,
    lunchCount,
    dinnerCount,
    guestsCount,
    dietBreakdown,
    dietTotal,
  };
}

// Legacy single-diet API kept for compatibility — delegates to multi when called by old code paths.
export function calculateFoodCost(
  selections: FoodDaySelection[],
  diet: DietPreference | null,
  guestsCount: number
): FoodCostSummary {
  // Map legacy single diet to a config with all guests assigned to that diet
  const config: DietConfig = {
    vegetarian_count: 0,
    meat_dinner_count: 0,
    meat_lunch_dinner_count: 0,
  };
  if (diet === 'Vegetarian') config.vegetarian_count = guestsCount;
  else if (diet === 'Meat or fish for dinner') config.meat_dinner_count = guestsCount;
  else if (diet === 'Meat or fish for dinner and lunch') config.meat_lunch_dinner_count = guestsCount;
  else config.vegetarian_count = guestsCount; // default
  return calculateFoodCostMulti(selections, config, guestsCount);
}

// Legacy diet options (still referenced by older code, kept for safety)
export const DIET_OPTIONS_WITH_PRICES: { value: DietPreference; label: string; price: number }[] = [
  { value: 'Vegetarian', label: 'Vegetarian', price: 70 },
  { value: 'Meat or fish for dinner', label: 'Meat or fish for dinner', price: 78 },
  { value: 'Meat or fish for dinner and lunch', label: 'Meat or fish for lunch and dinner', price: 85 },
];
