import type { DietPreference, FoodDaySelection } from '@/types/guest';

// Full board prices per day per person
export const FULL_BOARD_PRICES: Record<DietPreference, number> = {
  'Vegetarian': 70,
  'Meat or fish for dinner': 78,
  'Meat or fish for dinner and lunch': 85,
};

// Individual meal prices
export const BREAKFAST_PRICE = 20;

export function getLunchPrice(diet: DietPreference | null): number {
  if (diet === 'Meat or fish for dinner and lunch') {
    return 30;
  }
  return 23;
}

export function getDinnerPrice(diet: DietPreference | null): number {
  if (diet === 'Vegetarian') {
    return 27;
  }
  return 35;
}

export function getFullBoardPrice(diet: DietPreference | null): number {
  if (!diet) return 70; // Default to vegetarian price
  return FULL_BOARD_PRICES[diet] || 70;
}

export function getDayCostPerPerson(
  selection: FoodDaySelection,
  diet: DietPreference | null
): number {
  if (selection.fullBoard) {
    return getFullBoardPrice(diet);
  }

  let total = 0;
  if (selection.breakfast) total += BREAKFAST_PRICE;
  if (selection.lunch) total += getLunchPrice(diet);
  if (selection.dinner) total += getDinnerPrice(diet);
  return total;
}

export interface FoodCostSummary {
  totalPerPerson: number;
  grandTotal: number;
  fullBoardDays: number;
  breakfastCount: number;
  lunchCount: number;
  dinnerCount: number;
  guestsCount: number;
}

export function calculateFoodCost(
  selections: FoodDaySelection[],
  diet: DietPreference | null,
  guestsCount: number
): FoodCostSummary {
  let totalPerPerson = 0;
  let fullBoardDays = 0;
  let breakfastCount = 0;
  let lunchCount = 0;
  let dinnerCount = 0;

  selections.forEach((sel) => {
    if (sel.fullBoard) {
      fullBoardDays++;
    } else {
      if (sel.breakfast) breakfastCount++;
      if (sel.lunch) lunchCount++;
      if (sel.dinner) dinnerCount++;
    }
    totalPerPerson += getDayCostPerPerson(sel, diet);
  });

  const grandTotal = totalPerPerson * guestsCount;

  return {
    totalPerPerson,
    grandTotal,
    fullBoardDays,
    breakfastCount,
    lunchCount,
    dinnerCount,
    guestsCount,
  };
}

// Diet option labels with prices
export const DIET_OPTIONS_WITH_PRICES: { value: DietPreference; label: string; price: number }[] = [
  { value: 'Vegetarian', label: 'Vegetarian', price: 70 },
  { value: 'Meat or fish for dinner', label: 'Meat or fish for dinner', price: 78 },
  { value: 'Meat or fish for dinner and lunch', label: 'Meat or fish for lunch and dinner', price: 85 },
];
