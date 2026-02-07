import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useGuestProfile } from '@/hooks/useGuestProfile';
import { useFoodPlan } from '@/hooks/useFoodPlan';
import { useAutoSave } from '@/hooks/useAutoSave';
import { isEditingLocked } from '@/lib/editLock';
import { ToolPageLayout } from '@/components/guest-area/ToolPageLayout';
import { AutoSaveIndicator } from '@/components/guest-area/AutoSaveIndicator';
import { EditLockBanner } from '@/components/guest-area/EditLockBanner';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2, AlertCircle, Check } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import type { DietPreference } from '@/types/guest';

const DIET_OPTIONS: { value: DietPreference; label: string }[] = [
  { value: 'Vegetarian', label: 'Vegetarian' },
  { value: 'Meat or fish for dinner', label: 'Meat or fish for dinner' },
  { value: 'Meat or fish for dinner and lunch', label: 'Meat or fish for dinner and lunch' },
];

const Food = () => {
  const { user, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  
  const { profile, hasDatesSet, isLoading: profileLoading } = useGuestProfile();
  const {
    foodPlan,
    days,
    isLoading: foodLoading,
    updateDaySelection,
    updateDietPreference,
    updateNotes,
    autoSave,
    summary,
  } = useFoodPlan(profile?.check_in_date || null, profile?.check_out_date || null);

  const { status: saveStatus, triggerSave } = useAutoSave({ onSave: autoSave });
  const isLocked = isEditingLocked(profile?.check_in_date || null);

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/');
    }
  }, [user, authLoading, navigate]);

  // Trigger auto-save when selections change
  useEffect(() => {
    if (foodPlan && !isLocked) {
      triggerSave();
    }
  }, [foodPlan?.selections, foodPlan?.diet_preference, foodPlan?.notes_food]);

  if (authLoading || profileLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Dates not set - show warning
  if (!hasDatesSet) {
    return (
      <ToolPageLayout title="Food" description="Plan your meals during your stay">
        <div className="max-w-2xl mx-auto">
          <div className="rounded-2xl bg-destructive/10 border border-destructive/30 p-8 text-center">
            <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-medium mb-2">Stay dates required</h2>
            <p className="text-muted-foreground mb-6">
              Please set your check-in and check-out dates on the dashboard before planning your meals.
            </p>
            <Button onClick={() => navigate('/dashboard')}>
              Go to Dashboard
            </Button>
          </div>
        </div>
      </ToolPageLayout>
    );
  }

  if (foodLoading || !foodPlan) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <ToolPageLayout title="Food" description="Plan your meals during your stay">
      <div className="max-w-4xl mx-auto space-y-6">
        {isLocked && <EditLockBanner />}

        {/* Auto-save indicator */}
        <div className="flex justify-end">
          <AutoSaveIndicator status={saveStatus} />
        </div>

        {/* Diet Preference */}
        <div className="bg-card rounded-2xl border border-border p-6">
          <Label className="text-base font-medium mb-4 block">Diet preference</Label>
          <RadioGroup
            value={foodPlan.diet_preference || ''}
            onValueChange={(value) => !isLocked && updateDietPreference(value as DietPreference)}
            disabled={isLocked}
            className="space-y-3"
          >
            {DIET_OPTIONS.map((option) => (
              <div key={option.value} className="flex items-center space-x-3">
                <RadioGroupItem value={option.value} id={option.value} disabled={isLocked} />
                <Label htmlFor={option.value} className="font-normal cursor-pointer">
                  {option.label}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-card rounded-xl border border-border p-4 text-center">
            <p className="text-2xl font-medium">{summary.fullBoardDays}</p>
            <p className="text-sm text-muted-foreground">Full board days</p>
          </div>
          <div className="bg-card rounded-xl border border-border p-4 text-center">
            <p className="text-2xl font-medium">{summary.breakfastOnlyDays}</p>
            <p className="text-sm text-muted-foreground">Breakfast only</p>
          </div>
          <div className="bg-card rounded-xl border border-border p-4 text-center">
            <p className="text-2xl font-medium">{summary.customDays}</p>
            <p className="text-sm text-muted-foreground">Custom selection</p>
          </div>
        </div>

        {/* Food Table */}
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-4 font-medium">Date</th>
                  <th className="text-center p-4 font-medium">Full Board</th>
                  <th className="text-center p-4 font-medium">Breakfast</th>
                  <th className="text-center p-4 font-medium">Lunch</th>
                  <th className="text-center p-4 font-medium">Dinner</th>
                </tr>
              </thead>
              <tbody>
                {days.map((day, index) => {
                  const selection = foodPlan.selections.find(s => s.date === day.date) || {
                    date: day.date,
                    fullBoard: false,
                    breakfast: false,
                    lunch: false,
                    dinner: false,
                  };

                  const isCheckIn = day.isCheckIn;
                  const isCheckOut = day.isCheckOut;

                  return (
                    <tr key={day.date} className={cn("border-b border-border", index % 2 === 0 && "bg-muted/30")}>
                      <td className="p-4">
                        <div>
                          <p className="font-medium">{format(parseISO(day.date), 'EEE, dd MMM')}</p>
                          {isCheckIn && <span className="text-xs text-primary">Check-in</span>}
                          {isCheckOut && <span className="text-xs text-primary">Check-out</span>}
                        </div>
                      </td>
                      <td className="text-center p-4">
                        <MealToggle
                          selected={selection.fullBoard}
                          disabled={isLocked || isCheckIn || isCheckOut || selection.breakfast || selection.lunch || selection.dinner}
                          onClick={() => updateDaySelection(day.date, { fullBoard: !selection.fullBoard })}
                        />
                      </td>
                      <td className="text-center p-4">
                        <MealToggle
                          selected={selection.breakfast}
                          disabled={isLocked || selection.fullBoard || (isCheckIn && !isCheckOut)}
                          onClick={() => updateDaySelection(day.date, { breakfast: !selection.breakfast })}
                        />
                      </td>
                      <td className="text-center p-4">
                        <MealToggle
                          selected={selection.lunch}
                          disabled={isLocked || selection.fullBoard || isCheckIn || isCheckOut}
                          onClick={() => updateDaySelection(day.date, { lunch: !selection.lunch })}
                        />
                      </td>
                      <td className="text-center p-4">
                        <MealToggle
                          selected={selection.dinner}
                          disabled={isLocked || selection.fullBoard || isCheckOut}
                          onClick={() => updateDaySelection(day.date, { dinner: !selection.dinner })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <span>• Check-in day: only dinner available</span>
          <span>• Check-out day: only breakfast available</span>
          <span>• Full board = all 3 meals</span>
        </div>

        {/* Notes */}
        <div>
          <Label>Notes (optional)</Label>
          <Textarea
            placeholder="Dietary requirements, allergies, or preferences..."
            value={foodPlan.notes_food || ''}
            onChange={(e) => !isLocked && updateNotes(e.target.value)}
            disabled={isLocked}
            rows={3}
          />
        </div>
      </div>
    </ToolPageLayout>
  );
};

// Meal Toggle Component
function MealToggle({
  selected,
  disabled,
  onClick,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-10 h-10 rounded-lg border-2 transition-all flex items-center justify-center",
        selected && "bg-primary border-primary text-primary-foreground",
        !selected && !disabled && "border-border hover:border-primary/50",
        disabled && !selected && "opacity-30 cursor-not-allowed border-border bg-muted"
      )}
    >
      {selected && <Check className="w-5 h-5" />}
    </button>
  );
}

export default Food;