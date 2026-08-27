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
// Tarifs catering par millésime : pricing_settings key 'food_2027', 'food_2028'…
// Un séjour utilise le barème de la plus grande année configurée <= année du
// check-in ; sans correspondance, le barème de base 'food' (tarifs 2026).
let dietPricingByYear: Record<string, Record<DietType, DietPricing>> = {};
let loadPromise: Promise<void> | null = null;

export function getTaxiPrices(): TaxiPrices {
  return taxiPrices;
}

export function getDietPricing(stayYear?: number | string | null): Record<DietType, DietPricing> {
  const y = Number(String(stayYear ?? '').slice(0, 4));
  if (Number.isFinite(y) && y > 2000) {
    const years = Object.keys(dietPricingByYear).map(Number).filter((k) => k <= y).sort((a, b) => b - a);
    if (years.length > 0) return dietPricingByYear[String(years[0])];
  }
  return dietPricing;
}

/**
 * Fetches pricing from the DB once; safe to call multiple times.
 * ⚠️ pricing_settings est en RLS `authenticated` : un chargement fait AVANT le
 * login renvoie 0 ligne sans erreur. Dans ce cas on ne met PAS le résultat en
 * cache, pour que l'appel suivant (après connexion — AuthContext relance
 * loadPricing au SIGNED_IN) recharge les vrais tarifs (bug tarifs 2027 restés
 * aux défauts, 25 août 2026).
 */
export function loadPricing(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const { data, error } = await supabase
          .from('pricing_settings')
          .select('key, value');
        if (error || !data) return;
        if (data.length === 0) {
          // Probablement non authentifié : réessayable au prochain appel.
          loadPromise = null;
          return;
        }
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
          const yearMatch = /^food_(\d{4})$/.exec(row.key);
          if (yearMatch && row.value && typeof row.value === 'object') {
            const v = row.value as Partial<Record<DietType, Partial<DietPricing>>>;
            const table = {} as Record<DietType, DietPricing>;
            (Object.keys(DEFAULT_DIET_PRICING) as DietType[]).forEach((diet) => {
              table[diet] = { ...DEFAULT_DIET_PRICING[diet], ...(v[diet] ?? {}) };
            });
            dietPricingByYear[yearMatch[1]] = table;
          }
        }
      } catch {
        // Network failure → keep defaults; pricing must never break the app.
      }
    })();
  }
  return loadPromise;
}
