import type { DietPreference, FoodDaySelection, DietConfig, DietType } from '@/types/guest';
import { getDietPricing, type DietPricing } from '@/lib/pricing';

export type { DietPricing } from '@/lib/pricing';


// Prices now come from src/lib/pricing.ts (pricing_settings table).

export interface DietTypeMeta {
  type: DietType;
  label: string;
  countKey: keyof DietConfig;
  pricing: DietPricing;
}

export function getDietTypes(): DietTypeMeta[] {
  const pricing = getDietPricing();
  return [
    { type: 'vegetarian',        label: 'Vegetarian',                        countKey: 'vegetarian_count',        pricing: pricing.vegetarian },
    { type: 'meat_dinner',       label: 'Meat or fish for dinner',           countKey: 'meat_dinner_count',       pricing: pricing.meat_dinner },
    { type: 'meat_lunch_dinner', label: 'Meat or fish for lunch and dinner', countKey: 'meat_lunch_dinner_count', pricing: pricing.meat_lunch_dinner },
  ];
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

/**
 * Distribute a daily guest count across configured diets proportionally.
 * Uses largest-remainder rounding so the integer parts sum exactly to dailyGuests.
 * Returns map keyed by DietType.
 */
export function distributeDailyGuests(
  dailyGuests: number,
  diet: DietConfig
): Record<DietType, number> {
  const counts: Record<DietType, number> = {
    vegetarian: 0,
    meat_dinner: 0,
    meat_lunch_dinner: 0,
  };
  const total = (diet?.vegetarian_count || 0) + (diet?.meat_dinner_count || 0) + (diet?.meat_lunch_dinner_count || 0);
  if (dailyGuests <= 0 || total <= 0) return counts;

  const raw: { type: DietType; floor: number; rem: number }[] = getDietTypes().map((meta) => {
    const share = (diet[meta.countKey] || 0) / total * dailyGuests;
    const floor = Math.floor(share);
    return { type: meta.type, floor, rem: share - floor };
  });
  let assigned = raw.reduce((s, r) => s + r.floor, 0);
  raw.forEach((r) => { counts[r.type] = r.floor; });
  let leftover = dailyGuests - assigned;
  // Distribute leftover by largest remainder
  raw.sort((a, b) => b.rem - a.rem);
  for (let i = 0; leftover > 0 && i < raw.length; i++, leftover--) {
    counts[raw[i].type] += 1;
  }
  return counts;
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

  // Aggregate cost per diet across days using per-day guest distribution
  const dietTotals: Record<DietType, number> = { vegetarian: 0, meat_dinner: 0, meat_lunch_dinner: 0 };
  selections.forEach((sel) => {
    const dayGuests = typeof sel.guests_count_day === 'number' && sel.guests_count_day >= 0
      ? sel.guests_count_day
      : guestsCount;
    const distribution = distributeDailyGuests(dayGuests, diet);
    getDietTypes().forEach((meta) => {
      const dayPricePerPerson = dayCostPerPerson(sel, meta.pricing);
      dietTotals[meta.type] += dayPricePerPerson * distribution[meta.type];
    });
  });

  const dietBreakdown: DietBreakdownItem[] = getDietTypes().map((meta) => {
    const guests = diet?.[meta.countKey] || 0;
    const perPerson = selections.reduce((sum, sel) => sum + dayCostPerPerson(sel, meta.pricing), 0);
    return { type: meta.type, label: meta.label, guests, perPerson, total: Math.round(dietTotals[meta.type]) };
  });

  const grandTotal = Math.round(dietBreakdown.reduce((s, d) => s + d.total, 0));
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

