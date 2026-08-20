import { useEffect, useMemo } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useGuestProfile } from '@/hooks/useGuestProfile';
import { useActiveBooking } from '@/contexts/BookingContext';
import { useFoodPlan } from '@/hooks/useFoodPlan';
import { useAutoSave } from '@/hooks/useAutoSave';
import { getGuestStatus } from '@/lib/editLock';
import { calculateFoodCostMulti, getDietTypes } from '@/lib/foodPricing';
import { dietConfigTotal, BREAKFAST_TIME_OPTIONS, LUNCH_TIME_OPTIONS, DINNER_TIME_OPTIONS } from '@/types/guest';
import { ToolPageLayout } from '@/components/guest-area/ToolPageLayout';
import { MarkCompleteCard } from '@/components/guest-area/MarkCompleteCard';
import { AutoSaveIndicator } from '@/components/guest-area/AutoSaveIndicator';
import { FoodCostSummaryCard } from '@/components/guest-area/FoodCostSummary';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, AlertCircle, Check, Minus, Plus, Clock } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';

const Food = () => {
  const { user, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();

  const { profile, hasDatesSet, isLoading: profileLoading } = useGuestProfile();
  const guestsCount = profile?.guests_count || 1;
  const {
    foodPlan,
    days,
    isLoading: foodLoading,
    updateDaySelection,
    updateDayGuests,
    updateDietConfig,
    updateMealTimes,
    updateNotes,
    autoSave,
  } = useFoodPlan(profile?.check_in_date || null, profile?.check_out_date || null, guestsCount);

  const { status: saveStatus, triggerSave } = useAutoSave({ onSave: autoSave });
  const lockCtx = useActiveBooking();
  const guestStatus = getGuestStatus(profile?.check_in_date || null, profile?.status_overall || "draft", {
    unlocked: lockCtx.isImpersonating || !!lockCtx.activeBooking?.edit_lock_override,
  });
  const isLocked = guestStatus.isEditingLocked;

  const dietConfig = foodPlan?.diet_config || { vegetarian_count: 0, meat_dinner_count: 0, meat_lunch_dinner_count: 0 };
  const mealTimes = foodPlan?.meal_times || { breakfast_time: null, lunch_time: null, dinner_time: null };
  const dietTotal = dietConfigTotal(dietConfig);
  const overLimit = dietTotal > guestsCount;

  const costSummary = useMemo(() => {
    if (!foodPlan) {
      return calculateFoodCostMulti([], dietConfig, guestsCount, profile?.check_in_date);
    }
    return calculateFoodCostMulti(foodPlan.selections, foodPlan.diet_config, guestsCount, profile?.check_in_date);
  }, [foodPlan?.selections, foodPlan?.diet_config, guestsCount]);

  // Trigger auto-save
  useEffect(() => {
    if (foodPlan && !isLocked) triggerSave();
  }, [foodPlan?.selections, foodPlan?.diet_config, foodPlan?.meal_times, foodPlan?.notes_food]);

  // Garde multi-séjours : sans booking actif, les hooks ne peuvent pas scoper
  // leurs lectures/écritures (maybeSingle multi-lignes = spinner infini,
  // écritures cross-booking) -> sélecteur de séjour, ou dashboard si aucun.
  if (!lockCtx.isLoading && !lockCtx.activeBookingId) {
    if (lockCtx.bookingsPersonal.length > 1) return <Navigate to="/bookings" replace />;
    if (lockCtx.bookings.length === 0) return <Navigate to="/dashboard" replace />;
  }

  if (authLoading || profileLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!hasDatesSet) {
    return (
      <ToolPageLayout title="Catering" description="Plan your meals during your stay">
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
    <ToolPageLayout title="Catering" description="Plan your meals during your stay" isLocked={isLocked} statusInfo={guestStatus}>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex justify-end">
          <AutoSaveIndicator status={saveStatus} />
        </div>

        {/* Meal times (global) */}
        <div className="guest-card p-6">
          <div className="flex items-center gap-2.5 mb-1">
            <span className="text-[#6D7855] flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </span>
            <Label className="text-base font-semibold tracking-tight">Meal times</Label>
          </div>
          <p className="text-sm text-muted-foreground mb-4 mt-1">
            Optional. Select your preferred times for the entire stay.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <MealTimeSelect
              label="Breakfast time"
              value={mealTimes.breakfast_time}
              options={BREAKFAST_TIME_OPTIONS}
              disabled={isLocked}
              onChange={(v) => updateMealTimes({ breakfast_time: v })}
            />
            <MealTimeSelect
              label="Lunch time"
              value={mealTimes.lunch_time}
              options={LUNCH_TIME_OPTIONS}
              disabled={isLocked}
              onChange={(v) => updateMealTimes({ lunch_time: v })}
            />
            <MealTimeSelect
              label="Dinner time"
              value={mealTimes.dinner_time}
              options={DINNER_TIME_OPTIONS}
              disabled={isLocked}
              onChange={(v) => updateMealTimes({ dinner_time: v })}
            />
          </div>
        </div>

        {/* Food Preferences (multi-diet) */}
        <div className="guest-card p-6">
          <Label className="text-base font-semibold tracking-tight mb-1 block">Food preferences</Label>
          <p className="text-sm text-muted-foreground mb-4">
            Assign the number of guests to each diet type. Some guests may have no food plan.
          </p>

          <div className="space-y-3">
            {getDietTypes(profile?.check_in_date).map((meta) => {
              const value = dietConfig[meta.countKey] || 0;
              const setValue = (next: number) =>
                updateDietConfig({ [meta.countKey]: Math.max(0, next) } as any);
              return (
                <div
                  key={meta.type}
                  className={cn(
                    "flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-xl border",
                    overLimit && value > 0 ? "border-destructive/60 bg-destructive/5" : "border-border/70"
                  )}
                >
                  <div>
                    <div className="font-medium">{meta.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                      <span>Full board <strong className="text-foreground">€{meta.pricing.fullBoard}</strong></span>
                      <span>Breakfast <strong className="text-foreground">€{meta.pricing.breakfast}</strong></span>
                      <span>Lunch <strong className="text-foreground">€{meta.pricing.lunch}</strong></span>
                      <span>Dinner <strong className="text-foreground">€{meta.pricing.dinner}</strong></span>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">per person / day</div>
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

        {/* Food Table */}
        <div className="guest-card overflow-hidden">
          <div className="overflow-x-auto">
            <div style={{ minWidth: '760px' }}>
              <div
                className="border-b border-border/70 bg-muted/40"
                style={{ display: 'grid', gridTemplateColumns: '180px 100px 1fr 1fr 1fr 1fr' }}
              >
                <div className="px-4 py-3 guest-kicker text-left">Date</div>
                <div className="px-4 py-3 guest-kicker text-center">Guests</div>
                <div className="px-4 py-3 guest-kicker text-center">Full Board</div>
                <div className="px-4 py-3 guest-kicker text-center">Breakfast</div>
                <div className="px-4 py-3 guest-kicker text-center">Lunch</div>
                <div className="px-4 py-3 guest-kicker text-center">Dinner (+ dessert)</div>
              </div>

              {days.map((day, index) => {
                const selection = foodPlan.selections.find(s => s.date === day.date) || {
                  date: day.date, fullBoard: false, breakfast: false, lunch: false, dinner: false,
                  guests_count_day: guestsCount,
                };
                const dayGuests = typeof selection.guests_count_day === 'number'
                  ? selection.guests_count_day
                  : guestsCount;
                const hasIndividualMeal = selection.breakfast || selection.lunch || selection.dinner;

                return (
                  <div
                    key={day.date}
                    className={cn("border-b border-border/60 last:border-b-0", index % 2 === 1 && "bg-muted/20")}
                    style={{ display: 'grid', gridTemplateColumns: '180px 100px 1fr 1fr 1fr 1fr' }}
                  >
                    <div className="px-4 py-3.5">
                      <p className="text-sm">
                        <span className="font-semibold">{format(parseISO(day.date), 'EEE')}</span>
                        <span className="text-muted-foreground"> {format(parseISO(day.date), 'dd MMM')}</span>
                      </p>
                      {day.isCheckIn && (
                        <span className="text-[11px] text-[#7E8F53] font-medium block mt-0.5">
                          Check-in — dinner only
                        </span>
                      )}
                      {day.isCheckOut && (
                        <span className="text-[11px] text-[#7E8F53] font-medium block mt-0.5">
                          Check-out — breakfast only
                        </span>
                      )}
                    </div>
                    <div className="px-3 py-2.5 flex items-center justify-center">
                      <Input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        disabled={isLocked}
                        value={dayGuests}
                        onChange={(e) => {
                          const v = e.target.value === '' ? 0 : parseInt(e.target.value, 10);
                          if (!Number.isNaN(v)) updateDayGuests(day.date, v);
                        }}
                        className="h-8 w-14 text-center px-1 text-sm tabular-nums"
                        aria-label={`Guests on ${day.date}`}
                      />
                    </div>
                    <div className="px-4 py-2.5 flex items-center justify-center">
                      {!day.isCheckIn && !day.isCheckOut ? (
                        <MealToggle selected={selection.fullBoard} disabled={isLocked || hasIndividualMeal}
                          onClick={() => updateDaySelection(day.date, { fullBoard: !selection.fullBoard })} />
                      ) : (
                        <span className="text-muted-foreground/50 text-sm">—</span>
                      )}
                    </div>
                    <div className="px-4 py-2.5 flex items-center justify-center">
                      {!day.isCheckIn ? (
                        <MealToggle selected={selection.breakfast} disabled={isLocked || selection.fullBoard}
                          onClick={() => updateDaySelection(day.date, { breakfast: !selection.breakfast })} />
                      ) : (
                        <span className="text-muted-foreground/50 text-sm">—</span>
                      )}
                    </div>
                    <div className="px-4 py-2.5 flex items-center justify-center">
                      {!day.isCheckIn && !day.isCheckOut ? (
                        <MealToggle selected={selection.lunch} disabled={isLocked || selection.fullBoard}
                          onClick={() => updateDaySelection(day.date, { lunch: !selection.lunch })} />
                      ) : (
                        <span className="text-muted-foreground/50 text-sm">—</span>
                      )}
                    </div>
                    <div className="px-4 py-2.5 flex items-center justify-center">
                      {!day.isCheckOut ? (
                        <MealToggle selected={selection.dinner} disabled={isLocked || selection.fullBoard}
                          onClick={() => updateDaySelection(day.date, { dinner: !selection.dinner })} />
                      ) : (
                        <span className="text-muted-foreground/50 text-sm">—</span>
                      )}
                    </div>
                  </div>
                );
              })}

            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground px-1">
          <span>Full board = all 3 meals</span>
        </div>

        <div className="guest-card p-6">
          <Label className="text-base font-semibold tracking-tight mb-3 block">Notes (optional)</Label>
          <Textarea
            placeholder="Dietary requirements, allergies, or preferences..."
            value={foodPlan.notes_food || ''}
            onChange={(e) => !isLocked && updateNotes(e.target.value)}
            disabled={isLocked}
            rows={3}
          />
        </div>

        <FoodCostSummaryCard summary={costSummary} />

        {!isLocked && <MarkCompleteCard table="food_plans" toolLabel="Catering" />}
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
        "w-9 h-9 rounded-full border transition-all flex items-center justify-center",
        selected && "bg-[#D7DFC3] border-[#8CA05F] text-[#6D7855]",
        !selected && !disabled && "border-border hover:border-[#8CA05F]/60 hover:bg-[#EEF1E4]/60",
        disabled && !selected && "opacity-30 cursor-not-allowed border-border bg-muted"
      )}
    >
      {selected && <Check className="w-[18px] h-[18px]" strokeWidth={2.5} />}
    </button>
  );
}

function MealTimeSelect({
  label, value, options, disabled, onChange,
}: {
  label: string;
  value: string | null;
  options: string[];
  disabled?: boolean;
  onChange: (v: string | null) => void;
}) {
  return (
    <div>
      <Label className="text-sm font-medium mb-1.5 block">{label}</Label>
      <Select
        value={value ?? undefined}
        onValueChange={(v) => onChange(v || null)}
        disabled={disabled}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select" />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export default Food;
