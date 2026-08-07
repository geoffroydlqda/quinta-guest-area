import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveBooking } from '@/contexts/BookingContext';
import { useToast } from '@/hooks/use-toast';
import type { FoodPlan, FoodDaySelection, DietPreference, DietConfig, MealTimes } from '@/types/guest';
import { EMPTY_DIET_CONFIG, EMPTY_MEAL_TIMES } from '@/types/guest';
import { generateDatesInclusive } from '@/lib/localDate';

export function useFoodPlan(checkInDate: string | null, checkOutDate: string | null, defaultGuestsCount: number = 1) {
  const { user } = useAuth();
  const { activeBookingId } = useActiveBooking();
  const { toast } = useToast();
  
  const [foodPlan, setFoodPlan] = useState<FoodPlan | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  
  // Track the dates we last synced with to avoid re-syncing unnecessarily
  const lastSyncedDatesRef = useRef<string>('');
  const hasLoadedRef = useRef(false);

  // Generate days array based on check-in/out dates
  const days = useMemo(() => {
    const dates = generateDatesInclusive(checkInDate, checkOutDate);

    return dates.map((date, index) => ({
      date,
      isCheckIn: index === 0,
      isCheckOut: index === dates.length - 1,
    }));
  }, [checkInDate, checkOutDate]);

  // Build a stable key for the current date range
  const datesKey = useMemo(() => {
    return days.map(d => d.date).join(',');
  }, [days]);

  // Initialize selections for all days
  const initializeSelections = useCallback((): FoodDaySelection[] => {
    return days.map(day => ({
      date: day.date,
      fullBoard: false,
      breakfast: false,
      lunch: false,
      dinner: false,
      guests_count_day: defaultGuestsCount,
    }));
  }, [days, defaultGuestsCount]);

  // Load food plan
  const loadFoodPlan = useCallback(async () => {
    if (!user) return;
    
    setIsLoading(true);
    
    try {
      const baseQuery = supabase.from('food_plans').select('*');
      const scopedQuery = activeBookingId
        ? baseQuery.eq('booking_id', activeBookingId)
        : baseQuery.eq('user_id', user.id);
      let { data, error } = await scopedQuery.maybeSingle();

      if (error) throw error;

      if (!data) {
        const newSelections = initializeSelections();
        const { data: newPlan, error: createError } = await supabase
          .from('food_plans')
          .insert([{
            user_id: user.id,
            booking_id: activeBookingId,
            selections: JSON.parse(JSON.stringify(newSelections)),
          }])
          .select()
          .single();

        if (createError) throw createError;
        data = newPlan;
      }
      
      // Parse selections from DB
      const dbSelections = Array.isArray(data.selections) 
        ? (data.selections as unknown as FoodDaySelection[]) 
        : [];
      
      // Immediately sync with current date range
      const syncedSelections = syncSelectionsToDateRange(dbSelections, days);
      
      const dbDietConfig = (data as any).diet_config as DietConfig | null;
      const dbMealTimes = (data as any).meal_times as MealTimes | null;
      const typedPlan: FoodPlan = {
        id: data.id,
        user_id: data.user_id,
        created_at: data.created_at,
        updated_at: data.updated_at,
        notes_food: data.notes_food,
        status_food: data.status_food as 'draft' | 'submitted',
        diet_preference: data.diet_preference as DietPreference | null,
        diet_config: dbDietConfig && typeof dbDietConfig === 'object'
          ? {
              vegetarian_count: dbDietConfig.vegetarian_count || 0,
              meat_dinner_count: dbDietConfig.meat_dinner_count || 0,
              meat_lunch_dinner_count: dbDietConfig.meat_lunch_dinner_count || 0,
            }
          : { ...EMPTY_DIET_CONFIG },
        meal_times: dbMealTimes && typeof dbMealTimes === 'object'
          ? {
              breakfast_time: dbMealTimes.breakfast_time || null,
              lunch_time: dbMealTimes.lunch_time || null,
              dinner_time: dbMealTimes.dinner_time || null,
            }
          : { ...EMPTY_MEAL_TIMES },
        selections: syncedSelections,
      };
      
      setFoodPlan(typedPlan);
      lastSyncedDatesRef.current = datesKey;
      hasLoadedRef.current = true;
      
    } catch (error: any) {
      console.error('Error loading food plan:', error);
      toast({
        title: 'Error',
        description: 'Failed to load food plan.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [user, activeBookingId, toast, initializeSelections, days, datesKey]);

  // Meals that are NOT allowed on arrival/departure days.
  // - Arrival day: only Dinner allowed.
  // - Departure day: only Breakfast allowed.
  function forbiddenMealsFor(day: { isCheckIn: boolean; isCheckOut: boolean }) {
    const forbidden = { fullBoard: false, breakfast: false, lunch: false, dinner: false };
    if (day.isCheckIn) {
      forbidden.fullBoard = true;
      forbidden.breakfast = true;
      forbidden.lunch = true;
    }
    if (day.isCheckOut) {
      forbidden.fullBoard = true;
      forbidden.lunch = true;
      forbidden.dinner = true;
    }
    return forbidden;
  }

  function sanitizeSelection(
    sel: FoodDaySelection,
    day: { isCheckIn: boolean; isCheckOut: boolean }
  ): FoodDaySelection {
    const f = forbiddenMealsFor(day);
    return {
      ...sel,
      fullBoard: f.fullBoard ? false : sel.fullBoard,
      breakfast: f.breakfast ? false : sel.breakfast,
      lunch: f.lunch ? false : sel.lunch,
      dinner: f.dinner ? false : sel.dinner,
    };
  }

  // Pure function: sync selections array to match current days
  function syncSelectionsToDateRange(
    existingSelections: FoodDaySelection[],
    currentDays: { date: string; isCheckIn: boolean; isCheckOut: boolean }[]
  ): FoodDaySelection[] {
    if (currentDays.length === 0) return [];

    const existingByDate = new Map(existingSelections.map(s => [s.date, s]));

    return currentDays.map(day => {
      const found = existingByDate.get(day.date);
      const base: FoodDaySelection = found
        ? {
            ...found,
            guests_count_day: typeof found.guests_count_day === 'number' && found.guests_count_day >= 0
              ? found.guests_count_day
              : defaultGuestsCount,
          }
        : {
            date: day.date,
            fullBoard: false,
            breakfast: false,
            lunch: false,
            dinner: false,
            guests_count_day: defaultGuestsCount,
          };
      return sanitizeSelection(base, day);
    });
  }

  // Initial load
  useEffect(() => {
    if (user && days.length > 0) {
      loadFoodPlan();
    } else if (days.length === 0) {
      setIsLoading(false);
    }
  }, [user?.id, activeBookingId, datesKey]); // Only re-load when user / booking / date range changes

  // Sync selections when dates change AFTER initial load
  useEffect(() => {
    if (!foodPlan || !hasLoadedRef.current || days.length === 0) return;
    if (lastSyncedDatesRef.current === datesKey) return; // Already synced
    
    // Dates changed - re-sync selections preserving valid ones
    const synced = syncSelectionsToDateRange(foodPlan.selections, days);
    lastSyncedDatesRef.current = datesKey;
    
    setFoodPlan(prev => prev ? { ...prev, selections: synced } : prev);
  }, [datesKey, days]); // Deliberately exclude foodPlan to avoid loop

  // Update selection for a specific day
  const updateDaySelection = useCallback((date: string, updates: Partial<FoodDaySelection>) => {
    setFoodPlan(prev => {
      if (!prev) return prev;

      const day = days.find(d => d.date === date);
      const forbidden = day ? forbiddenMealsFor(day) : { fullBoard: false, breakfast: false, lunch: false, dinner: false };

      // Drop forbidden meals silently from incoming updates.
      const safeUpdates: Partial<FoodDaySelection> = { ...updates };
      if (forbidden.fullBoard && safeUpdates.fullBoard === true) delete safeUpdates.fullBoard;
      if (forbidden.breakfast && safeUpdates.breakfast === true) delete safeUpdates.breakfast;
      if (forbidden.lunch && safeUpdates.lunch === true) delete safeUpdates.lunch;
      if (forbidden.dinner && safeUpdates.dinner === true) delete safeUpdates.dinner;

      const newSelections = prev.selections.map(sel => {
        if (sel.date !== date) return sel;

        // Handle exclusive logic: fullBoard vs individual meals
        if (safeUpdates.fullBoard === true) {
          return { ...sel, fullBoard: true, breakfast: false, lunch: false, dinner: false };
        }

        if (safeUpdates.fullBoard === false) {
          return { ...sel, fullBoard: false };
        }

        if (safeUpdates.breakfast !== undefined || safeUpdates.lunch !== undefined || safeUpdates.dinner !== undefined) {
          return { ...sel, ...safeUpdates, fullBoard: false };
        }

        return { ...sel, ...safeUpdates };
      });

      return { ...prev, selections: newSelections };
    });
  }, [days]);


  // Update daily guests count for a specific day
  const updateDayGuests = useCallback((date: string, guestsCountDay: number) => {
    setFoodPlan(prev => {
      if (!prev) return prev;
      const safe = Math.max(0, Math.floor(guestsCountDay || 0));
      const newSelections = prev.selections.map(sel =>
        sel.date === date ? { ...sel, guests_count_day: safe } : sel
      );
      return { ...prev, selections: newSelections };
    });
  }, []);
  const updateDietPreference = useCallback((preference: DietPreference | null) => {
    setFoodPlan(prev => prev ? { ...prev, diet_preference: preference } : null);
  }, []);

  // Update diet config (multi-diet)
  const updateDietConfig = useCallback((updates: Partial<DietConfig>) => {
    setFoodPlan(prev => prev ? {
      ...prev,
      diet_config: {
        vegetarian_count: Math.max(0, updates.vegetarian_count ?? prev.diet_config.vegetarian_count),
        meat_dinner_count: Math.max(0, updates.meat_dinner_count ?? prev.diet_config.meat_dinner_count),
        meat_lunch_dinner_count: Math.max(0, updates.meat_lunch_dinner_count ?? prev.diet_config.meat_lunch_dinner_count),
      },
    } : null);
  }, []);

  // Update meal times (global preferences)
  const updateMealTimes = useCallback((updates: Partial<MealTimes>) => {
    setFoodPlan(prev => prev ? {
      ...prev,
      meal_times: {
        breakfast_time: updates.breakfast_time !== undefined ? updates.breakfast_time : prev.meal_times.breakfast_time,
        lunch_time: updates.lunch_time !== undefined ? updates.lunch_time : prev.meal_times.lunch_time,
        dinner_time: updates.dinner_time !== undefined ? updates.dinner_time : prev.meal_times.dinner_time,
      },
    } : null);
  }, []);

  // Auto-save function
  const autoSave = useCallback(async (): Promise<boolean> => {
    if (!user || !foodPlan) return false;
    
    try {
      const payload = {
        notes_food: foodPlan.notes_food || null,
        diet_preference: foodPlan.diet_preference || null,
        diet_config: foodPlan.diet_config as any,
        meal_times: foodPlan.meal_times as any,
        selections: JSON.parse(JSON.stringify(foodPlan.selections)),
      };

      if (import.meta.env.DEV) {
        console.debug('[FoodPlan] autoSave payload', payload);
      }

      const updateQuery = supabase.from('food_plans').update(payload);
      const { error } = await (activeBookingId
        ? updateQuery.eq('booking_id', activeBookingId)
        : updateQuery.eq('user_id', user.id).is('booking_id', null));

      if (error) throw error;
      return true;
    } catch (error: any) {
      console.error('Error auto-saving food plan:', error);
      return false;
    }
  }, [user, activeBookingId, foodPlan]);

  // Update notes
  const updateNotes = useCallback((notes: string) => {
    setFoodPlan(prev => prev ? { ...prev, notes_food: notes } : null);
  }, []);

  // Calculate summary
  const summary = useMemo(() => {
    if (!foodPlan) return { fullBoardDays: 0, breakfastOnlyDays: 0, customDays: 0 };
    
    let fullBoardDays = 0;
    let breakfastOnlyDays = 0;
    let customDays = 0;
    
    foodPlan.selections.forEach(sel => {
      if (sel.fullBoard) {
        fullBoardDays++;
      } else if (sel.breakfast && !sel.lunch && !sel.dinner) {
        breakfastOnlyDays++;
      } else if (sel.breakfast || sel.lunch || sel.dinner) {
        customDays++;
      }
    });
    
    return { fullBoardDays, breakfastOnlyDays, customDays };
  }, [foodPlan]);

  return {
    foodPlan,
    days,
    isLoading,
    isSaving,
    updateDaySelection,
    updateDayGuests,
    updateDietPreference,
    updateDietConfig,
    updateMealTimes,
    updateNotes,
    autoSave,
    summary,
    refresh: loadFoodPlan,
  };
}
