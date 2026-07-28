import { supabase } from '@/integrations/supabase/client';
import type { DietType } from '@/types/guest';

/**
 * Centralized pricing (Phase 0).
 *
 * Single source of truth = the `public.pricing_settings` table (keys: 'taxi', 'food').
 * The values below are only fallback defaults, kept in sync with the seed migration.
 * `loadPricing()` is called once at app startup (see App.tsx) and refreshes the
 * in-memory store; all getters are synchronous so existing call sites stay simple.
 */

export interface TaxiPrices {
  seats4: number;
  seats6: number;
  seats8: number;
}

export interface DietPricing {
  fullBoard: number;
  breakfast: number;
  lunch: number;
  dinner: number;
}

const DEFAULT_TAXI_PRICES: TaxiPrices = { seats4: 70, seats6: 90, seats8: 110 };

const DEFAULT_DIET_PRICING: Record<DietType, DietPricing> = {
  vegetarian: { fullBoard: 70, breakfast: 20, lunch: 25, dinner: 27 },
  meat_dinner: { fullBoard: 78, breakfast: 20, lunch: 25, dinner: 35 },
  meat_lunch_dinner: { fullBoard: 85, breakfast: 20, lunch: 30, dinner: 35 },
};

let taxiPrices: TaxiPrices = { ...DEFAULT_TAXI_PRICES };
let dietPricing: Record<DietType, DietPricing> = structuredClone(DEFAULT_DIET_PRICING);
let loadPromise: Promise<void> | null = null;

export function getTaxiPrices(): TaxiPrices {
  return taxiPrices;
}

export function getDietPricing(): Record<DietType, DietPricing> {
  return dietPricing;
}

/** Fetches pricing from the DB once; safe to call multiple times. */
export function loadPricing(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const { data, error } = await supabase
          .from('pricing_settings')
          .select('key, value');
        if (error || !data) return;
        for (const row of data) {
          if (row.key === 'taxi' && row.value && typeof row.value === 'object') {
            const v = row.value as Partial<TaxiPrices>;
            taxiPrices = {
              seats4: v.seats4 ?? DEFAULT_TAXI_PRICES.seats4,
              seats6: v.seats6 ?? DEFAULT_TAXI_PRICES.seats6,
              seats8: v.seats8 ?? DEFAULT_TAXI_PRICES.seats8,
            };
          }
          if (row.key === 'food' && row.value && typeof row.value === 'object') {
            const v = row.value as Partial<Record<DietType, Partial<DietPricing>>>;
            (Object.keys(DEFAULT_DIET_PRICING) as DietType[]).forEach((diet) => {
              dietPricing[diet] = { ...DEFAULT_DIET_PRICING[diet], ...(v[diet] ?? {}) };
            });
          }
        }
      } catch {
        // Network failure → keep defaults; pricing must never break the app.
      }
    })();
  }
  return loadPromise;
}
