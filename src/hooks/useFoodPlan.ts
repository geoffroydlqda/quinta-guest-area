import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import type { FoodPlan, FoodDaySelection, DietPreference, DietConfig } from '@/types/guest';
import { EMPTY_DIET_CONFIG } from '@/types/guest';
import { generateDatesInclusive } from '@/lib/localDate';
import { triggerSheetsSync } from '@/lib/sheetsSync';

export function useFoodPlan(checkInDate: string | null, checkOutDate: string | null) {
  const { user } = useAuth();
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
    }));
  }, [days]);

  // Load food plan
  const loadFoodPlan = useCallback(async () => {
    if (!user) return;
    
    setIsLoading(true);
    
    try {
      let { data, error } = await supabase
        .from('food_plans')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      
      if (error) throw error;
      
      if (!data) {
        const newSelections = initializeSelections();
        const { data: newPlan, error: createError } = await supabase
          .from('food_plans')
          .insert([{
            user_id: user.id,
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
      
      const typedPlan: FoodPlan = {
        id: data.id,
        user_id: data.user_id,
        created_at: data.created_at,
        updated_at: data.updated_at,
        notes_food: data.notes_food,
        status_food: data.status_food as 'draft' | 'submitted',
        diet_preference: data.diet_preference as DietPreference | null,
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
  }, [user, toast, initializeSelections, days, datesKey]);

  // Pure function: sync selections array to match current days
  function syncSelectionsToDateRange(
    existingSelections: FoodDaySelection[],
    currentDays: { date: string }[]
  ): FoodDaySelection[] {
    if (currentDays.length === 0) return [];
    
    const existingByDate = new Map(existingSelections.map(s => [s.date, s]));
    
    return currentDays.map(day => {
      return existingByDate.get(day.date) || {
        date: day.date,
        fullBoard: false,
        breakfast: false,
        lunch: false,
        dinner: false,
      };
    });
  }

  // Initial load
  useEffect(() => {
    if (user && days.length > 0) {
      loadFoodPlan();
    } else if (days.length === 0) {
      setIsLoading(false);
    }
  }, [user?.id, datesKey]); // Only re-load when user or date range changes

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
      
      const newSelections = prev.selections.map(sel => {
        if (sel.date !== date) return sel;
        
        // Handle exclusive logic: fullBoard vs individual meals
        if (updates.fullBoard === true) {
          return { ...sel, fullBoard: true, breakfast: false, lunch: false, dinner: false };
        }
        
        if (updates.fullBoard === false) {
          return { ...sel, fullBoard: false };
        }
        
        if (updates.breakfast !== undefined || updates.lunch !== undefined || updates.dinner !== undefined) {
          return { ...sel, ...updates, fullBoard: false };
        }
        
        return { ...sel, ...updates };
      });
      
      return { ...prev, selections: newSelections };
    });
  }, []);

  // Update diet preference
  const updateDietPreference = useCallback((preference: DietPreference | null) => {
    setFoodPlan(prev => prev ? { ...prev, diet_preference: preference } : null);
  }, []);

  // Auto-save function
  const autoSave = useCallback(async (): Promise<boolean> => {
    if (!user || !foodPlan) return false;
    
    try {
      const payload = {
        notes_food: foodPlan.notes_food || null,
        diet_preference: foodPlan.diet_preference || null,
        selections: JSON.parse(JSON.stringify(foodPlan.selections)),
      };

      if (import.meta.env.DEV) {
        console.debug('[FoodPlan] autoSave payload', payload);
      }

      const { error } = await supabase
        .from('food_plans')
        .update(payload)
        .eq('user_id', user.id);
      
      if (error) throw error;
      triggerSheetsSync();
      return true;
    } catch (error: any) {
      console.error('Error auto-saving food plan:', error);
      return false;
    }
  }, [user, foodPlan]);

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
    updateDietPreference,
    updateNotes,
    autoSave,
    summary,
    refresh: loadFoodPlan,
  };
}
