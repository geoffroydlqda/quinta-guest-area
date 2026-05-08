import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useGuestProfile } from '@/hooks/useGuestProfile';
import { useFoodPlan } from '@/hooks/useFoodPlan';
import { useAutoSave } from '@/hooks/useAutoSave';
import { isEditingLocked } from '@/lib/editLock';
import { calculateFoodCostMulti, DIET_TYPES } from '@/lib/foodPricing';
import { dietConfigTotal } from '@/types/guest';
import { ToolPageLayout } from '@/components/guest-area/ToolPageLayout';
import { AutoSaveIndicator } from '@/components/guest-area/AutoSaveIndicator';
import { FoodCostSummaryCard } from '@/components/guest-area/FoodCostSummary';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Loader2, AlertCircle, Check, Info, Minus, Plus } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';

const Food = () => {
  const { user, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();

  const { profile, hasDatesSet, isLoading: profileLoading } = useGuestProfile();
  const {
    foodPlan,
    days,
    isLoading: foodLoading,
    updateDaySelection,
    updateDietConfig,
    updateNotes,
    autoSave,
  } = useFoodPlan(profile?.check_in_date || null, profile?.check_out_date || null);

  const { status: saveStatus, triggerSave } = useAutoSave({ onSave: autoSave });
  const isLocked = isEditingLocked(profile?.check_in_date || null);
  const guestsCount = profile?.guests_count || 1;

  const dietConfig = foodPlan?.diet_config || { vegetarian_count: 0, meat_dinner_count: 0, meat_lunch_dinner_count: 0 };
  const dietTotal = dietConfigTotal(dietConfig);
  const overLimit = dietTotal > guestsCount;

  const costSummary = useMemo(() => {
    if (!foodPlan) {
      return calculateFoodCostMulti([], dietConfig, guestsCount);
    }
    return calculateFoodCostMulti(foodPlan.selections, foodPlan.diet_config, guestsCount);
  }, [foodPlan?.selections, foodPlan?.diet_config, guestsCount]);

  // Trigger auto-save
  useEffect(() => {
    if (foodPlan && !isLocked) triggerSave();
  }, [foodPlan?.selections, foodPlan?.diet_config, foodPlan?.notes_food]);

  if (authLoading || profileLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!hasDatesSet) {
    return (
      <ToolPageLayout title="Food" description="Plan your meals during your stay">
        <div className="max-w-2xl mx-auto">
          <div className="rounded-2xl bg-destructive/10 border border-destructive/30 p-8 text-center">
            <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Stay dates required</h2>
            <p className="text-muted-foreground mb-6">
              Please set your check-in and check-out dates on the dashboard before planning your meals.
            </p>
            <Button onClick={() => navigate('/dashboard')}>Go to Dashboard</Button>
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
    <ToolPageLayout title="Food" description="Plan your meals during your stay" isLocked={isLocked}>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex justify-end">
          <AutoSaveIndicator status={saveStatus} />
        </div>

        {/* Food Preferences (multi-diet) */}
        <div className="bg-card rounded-2xl border border-border p-6">
          <Label className="text-base font-semibold mb-1 block">Food preferences</Label>
          <p className="text-sm text-muted-foreground mb-4">
            Assign the number of guests to each diet type. Some guests may have no food plan.
          </p>

          <div className="space-y-3">
            {DIET_TYPES.map((meta) => {
              const value = dietConfig[meta.countKey] || 0;
              const setValue = (next: number) =>
                updateDietConfig({ [meta.countKey]: Math.max(0, next) } as any);
              return (
                <div
                  key={meta.type}
                  className={cn(
                    "flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 rounded-lg border",
                    overLimit && value > 0 ? "border-destructive/60 bg-destructive/5" : "border-border"
                  )}
                >
                  <div>
                    <div className="font-medium">{meta.label}</div>
                    <div className="text-xs text-muted-foreground">
                      €{meta.pricing.fullBoard} / full board / person / day
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      disabled={isLocked || value <= 0}
                      onClick={() => setValue(value - 1)}
                      aria-label={`Decrease ${meta.label}`}
                    >
                      <Minus className="w-4 h-4" />
                    </Button>
                    <span className="w-8 text-center font-semibold tabular-nums">{value}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      disabled={isLocked}
                      onClick={() => setValue(value + 1)}
                      aria-label={`Increase ${meta.label}`}
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Assigned: <strong className="text-foreground">{dietTotal}</strong> / {guestsCount} guest{guestsCount !== 1 ? 's' : ''}
            </span>
          </div>

          {overLimit && (
            <div className="mt-3 rounded-lg bg-destructive/10 border border-destructive/30 p-3 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
              <p className="text-sm text-destructive font-medium">
                The total number of meal preferences exceeds the number of guests.
              </p>
            </div>
          )}
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-card rounded-xl border border-border p-4 text-center">
            <p className="text-2xl font-semibold">{costSummary.fullBoardDays}</p>
            <p className="text-sm text-muted-foreground font-medium">Full board days</p>
          </div>
          <div className="bg-card rounded-xl border border-border p-4 text-center">
            <p className="text-2xl font-semibold">{costSummary.breakfastCount}</p>
            <p className="text-sm text-muted-foreground font-medium">Breakfast only</p>
          </div>
          <div className="bg-card rounded-xl border border-border p-4 text-center">
            <p className="text-2xl font-semibold">{costSummary.lunchCount + costSummary.dinnerCount}</p>
            <p className="text-sm text-muted-foreground font-medium">Other meals</p>
          </div>
        </div>

        {/* Food Table */}
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <div style={{ minWidth: '640px' }}>
              <div
                className="border-b border-border"
                style={{ display: 'grid', gridTemplateColumns: '160px 1fr 1fr 1fr 1fr' }}
              >
                <div className="p-4 font-semibold text-left">Date</div>
                <div className="p-4 font-semibold text-center border-l border-border">Full Board</div>
                <div className="p-4 font-semibold text-center border-l border-border">Breakfast</div>
                <div className="p-4 font-semibold text-center border-l border-border">Lunch</div>
                <div className="p-4 font-semibold text-center border-l border-border">Dinner (+ dessert)</div>
              </div>

              {days.map((day, index) => {
                const selection = foodPlan.selections.find(s => s.date === day.date) || {
                  date: day.date, fullBoard: false, breakfast: false, lunch: false, dinner: false,
                };
                const hasIndividualMeal = selection.breakfast || selection.lunch || selection.dinner;

                return (
                  <div
                    key={day.date}
                    className={cn("border-b border-border", index % 2 === 0 && "bg-muted/30")}
                    style={{ display: 'grid', gridTemplateColumns: '160px 1fr 1fr 1fr 1fr' }}
                  >
                    <div className="p-4">
                      <p className="font-semibold">{format(parseISO(day.date), 'EEE, dd MMM')}</p>
                      {day.isCheckIn && <span className="text-xs text-primary font-medium">Check-in</span>}
                      {day.isCheckOut && <span className="text-xs text-primary font-medium">Check-out</span>}
                    </div>
                    <div className="p-4 flex items-center justify-center border-l border-border">
                      <MealToggle selected={selection.fullBoard} disabled={isLocked || hasIndividualMeal}
                        onClick={() => updateDaySelection(day.date, { fullBoard: !selection.fullBoard })} />
                    </div>
                    <div className="p-4 flex items-center justify-center border-l border-border">
                      <MealToggle selected={selection.breakfast} disabled={isLocked || selection.fullBoard}
                        onClick={() => updateDaySelection(day.date, { breakfast: !selection.breakfast })} />
                    </div>
                    <div className="p-4 flex items-center justify-center border-l border-border">
                      <MealToggle selected={selection.lunch} disabled={isLocked || selection.fullBoard}
                        onClick={() => updateDaySelection(day.date, { lunch: !selection.lunch })} />
                    </div>
                    <div className="p-4 flex items-center justify-center border-l border-border">
                      <MealToggle selected={selection.dinner} disabled={isLocked || selection.fullBoard}
                        onClick={() => updateDaySelection(day.date, { dinner: !selection.dinner })} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <span>• Full board = all 3 meals</span>
          <span>• Selecting Full board disables individual meal toggles</span>
        </div>

        <div className="rounded-xl bg-primary/10 border border-primary/30 p-4">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <p className="text-sm font-medium">A sweet treat is always served after dinner.</p>
          </div>
        </div>

        <div>
          <Label className="font-semibold">Notes (optional)</Label>
          <Textarea
            placeholder="Dietary requirements, allergies, or preferences..."
            value={foodPlan.notes_food || ''}
            onChange={(e) => !isLocked && updateNotes(e.target.value)}
            disabled={isLocked}
            rows={3}
          />
        </div>

        <FoodCostSummaryCard summary={costSummary} />
      </div>
    </ToolPageLayout>
  );
};

function MealToggle({ selected, disabled, onClick }: { selected: boolean; disabled?: boolean; onClick: () => void; }) {
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
