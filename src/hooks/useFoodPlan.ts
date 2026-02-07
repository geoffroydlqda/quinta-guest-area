import { useState, useCallback, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import type { FoodPlan, FoodDaySelection, DietPreference } from '@/types/guest';
import { addDays, format, parseISO, differenceInDays } from 'date-fns';

export function useFoodPlan(checkInDate: string | null, checkOutDate: string | null) {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [foodPlan, setFoodPlan] = useState<FoodPlan | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Generate days array based on check-in/out dates
  const days = useMemo(() => {
    if (!checkInDate || !checkOutDate) return [];
    
    const start = parseISO(checkInDate);
    const end = parseISO(checkOutDate);
    const dayCount = differenceInDays(end, start) + 1;
    
    if (dayCount < 1) return [];
    
    const daysArray: { date: string; isCheckIn: boolean; isCheckOut: boolean }[] = [];
    
    for (let i = 0; i < dayCount; i++) {
      const currentDate = addDays(start, i);
      daysArray.push({
        date: format(currentDate, 'yyyy-MM-dd'),
        isCheckIn: i === 0,
        isCheckOut: i === dayCount - 1,
      });
    }
    
    return daysArray;
  }, [checkInDate, checkOutDate]);

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
        // Create new food plan
        const { data: newPlan, error: createError } = await supabase
          .from('food_plans')
          .insert([{
            user_id: user.id,
            selections: JSON.parse(JSON.stringify(initializeSelections())),
          }])
          .select()
          .single();
        
        if (createError) throw createError;
        data = newPlan;
      }
      
      // Ensure selections are properly typed
      const parsedSelections = Array.isArray(data.selections) 
        ? (data.selections as unknown as FoodDaySelection[]) 
        : initializeSelections();
      
      const typedPlan: FoodPlan = {
        id: data.id,
        user_id: data.user_id,
        created_at: data.created_at,
        updated_at: data.updated_at,
        notes_food: data.notes_food,
        status_food: data.status_food as 'draft' | 'submitted',
        diet_preference: data.diet_preference as DietPreference | null,
        selections: parsedSelections,
      };
      
      setFoodPlan(typedPlan);
      
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
  }, [user, toast, initializeSelections]);

  useEffect(() => {
    if (user && days.length > 0) {
      loadFoodPlan();
    }
  }, [user, days.length, loadFoodPlan]);

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
        
        if (updates.breakfast || updates.lunch || updates.dinner) {
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

  // Sync selections with current days (when dates change)
  const syncSelectionsWithDays = useCallback(() => {
    if (!foodPlan || days.length === 0) return;
    
    const existingByDate = new Map(foodPlan.selections.map(s => [s.date, s]));
    
    const syncedSelections: FoodDaySelection[] = days.map(day => {
      return existingByDate.get(day.date) || {
        date: day.date,
        fullBoard: false,
        breakfast: false,
        lunch: false,
        dinner: false,
      };
    });
    
    setFoodPlan(prev => prev ? { ...prev, selections: syncedSelections } : prev);
  }, [foodPlan, days]);

  useEffect(() => {
    if (foodPlan && days.length > 0) {
      syncSelectionsWithDays();
    }
  }, [days.length]);

  // Auto-save function (used by useAutoSave hook)
  const autoSave = useCallback(async (): Promise<boolean> => {
    if (!user || !foodPlan) return false;
    
    try {
      const { error } = await supabase
        .from('food_plans')
        .update({
          notes_food: foodPlan.notes_food || null,
          diet_preference: foodPlan.diet_preference || null,
          selections: JSON.parse(JSON.stringify(foodPlan.selections)),
        })
        .eq('user_id', user.id);
      
      if (error) throw error;
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
