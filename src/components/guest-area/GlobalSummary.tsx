import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ChevronRight, BedDouble, Car, Utensils, Users, Euro } from 'lucide-react';
import type { ToolStatuses, GuestProfile } from '@/types/guest';
import type { TransportationCostSummary } from '@/lib/transportationPricing';

interface GlobalSummaryProps {
  profile: GuestProfile;
  toolStatuses: ToolStatuses;
  roomSetupData?: {
    queenSharedCount: number;
    twinsSharedCount: number;
    queenEnsuiteCount: number;
    twinsEnsuiteCount: number;
  };
  transportationData?: TransportationCostSummary;
  foodData?: {
    fullBoardDays: number;
    breakfastOnlyDays: number;
    customDays: number;
    dietPreference?: string | null;
    totalCost?: number;
    dietBreakdown?: { type: string; label: string; guests: number; total: number }[];
    dietTotal?: number;
    mealTimes?: { breakfast_time: string | null; lunch_time: string | null; dinner_time: string | null };
    selections?: { date: string; fullBoard: boolean; breakfast: boolean; lunch: boolean; dinner: boolean; guests_count_day?: number }[];
  };
}

function parseLocalDateLong(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

// Parse YYYY-MM-DD as local date to avoid timezone shifts
function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatDateLocal(dateStr: string, options: Intl.DateTimeFormatOptions): string {
  const date = parseLocalDate(dateStr);
  return date.toLocaleDateString('en-GB', options);
}

export function GlobalSummary({
  profile,
  toolStatuses,
  roomSetupData,
  transportationData,
  foodData,
}: GlobalSummaryProps) {
  const hasDates = !!(profile.check_in_date && profile.check_out_date);
  const hasRoomSetup = toolStatuses.roomSetup !== 'not_set' && roomSetupData;
  const hasTransportation = toolStatuses.transportation !== 'not_set' && transportationData;
  const activeDiets = (foodData?.dietBreakdown || []).filter(d => d.guests > 0);
  const mealTimes = foodData?.mealTimes;
  const hasMealTimes = !!(mealTimes && (mealTimes.breakfast_time || mealTimes.lunch_time || mealTimes.dinner_time));
  const hasFood = toolStatuses.food !== 'not_set' && foodData &&
    (activeDiets.length > 0 || foodData.fullBoardDays > 0 || foodData.breakfastOnlyDays > 0 || foodData.customDays > 0 || hasMealTimes);

  return (
    <div className="bg-card rounded-2xl border border-border p-6">
      <h2 className="text-xl font-semibold mb-6">Summary</h2>

      <div className="space-y-4">
        {/* Stay Dates & Guests */}
        <div className="flex items-center justify-between py-3 border-b border-border">
          <span className="text-muted-foreground font-medium">Stay dates</span>
          {hasDates ? (
            <span className="font-semibold">
              {formatDateLocal(profile.check_in_date!, { day: 'numeric', month: 'short' })} — {formatDateLocal(profile.check_out_date!, { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          ) : (
            <span className="text-muted-foreground italic">Not set</span>
          )}
        </div>

        {/* Guests Count */}
        <div className="flex items-center justify-between py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" />
            <span className="text-muted-foreground font-medium">Guests</span>
          </div>
          <span className="font-semibold">{profile.guests_count}</span>
        </div>

        {/* Room Setup */}
        <div className="py-3 border-b border-border">
          <div className="flex items-center gap-2 mb-2">
            <BedDouble className="w-4 h-4 text-primary" />
            <span className="font-semibold">Room Setup</span>
          </div>
          {hasRoomSetup ? (
            <div className="text-sm text-muted-foreground space-y-1 pl-6">
              <div className="flex justify-between">
                <span>King (en-suite bathroom) — fixed</span>
                <span className="font-semibold text-foreground">2</span>
              </div>
              <div className="flex justify-between">
                <span>King size bed (shared bathroom)</span>
                <span className="font-semibold text-foreground">{roomSetupData!.queenSharedCount}</span>
              </div>
              <div className="flex justify-between">
                <span>Twins (shared bathroom)</span>
                <span className="font-semibold text-foreground">{roomSetupData!.twinsSharedCount}</span>
              </div>
              <div className="flex justify-between">
                <span>King size bed (en-suite bathroom)</span>
                <span className="font-semibold text-foreground">{roomSetupData!.queenEnsuiteCount}</span>
              </div>
              <div className="flex justify-between">
                <span>Twins (en-suite bathroom)</span>
                <span className="font-semibold text-foreground">{roomSetupData!.twinsEnsuiteCount}</span>
              </div>
            </div>
          ) : (
            <Button asChild variant="outline" size="sm" className="ml-6">
              <Link to="/room-setup">
                Not set <ChevronRight className="w-4 h-4 ml-1" />
              </Link>
            </Button>
          )}
        </div>

        {/* Transportation */}
        <div className="py-3 border-b border-border">
          <div className="flex items-center gap-2 mb-2">
            <Car className="w-4 h-4 text-primary" />
            <span className="font-semibold">Transportation</span>
          </div>
          {hasTransportation ? (
            <div className="text-sm text-muted-foreground pl-6 space-y-1">
              <div className="flex justify-between">
                <span>{transportationData!.totalTrips} trip{transportationData!.totalTrips !== 1 ? 's' : ''} scheduled</span>
              </div>
              {transportationData!.subtotal > 0 && (
                <div className="flex justify-between items-center">
                  <span className="flex items-center gap-1">
                    <Euro className="w-3 h-3" />
                    Transportation subtotal
                  </span>
                  <span className="font-semibold text-foreground">€{transportationData!.subtotal}</span>
                </div>
              )}
              {transportationData!.customOfferCount > 0 && (
                <div className="flex justify-between">
                  <span>Custom offer trips</span>
                  <span className="font-semibold text-foreground">{transportationData!.customOfferCount}</span>
                </div>
              )}
            </div>
          ) : (
            <Button asChild variant="outline" size="sm" className="ml-6">
              <Link to="/transportation">
                Not set <ChevronRight className="w-4 h-4 ml-1" />
              </Link>
            </Button>
          )}
        </div>

        {/* Food */}
        <div className="py-3">
          <div className="flex items-center gap-2 mb-2">
            <Utensils className="w-4 h-4 text-primary" />
            <span className="font-semibold">Food</span>
          </div>
          {hasFood ? (
            <div className="text-sm text-muted-foreground space-y-1 pl-6">
              {hasMealTimes && (
                <div className="space-y-1 mb-2">
                  <div className="font-medium text-foreground">Meal times</div>
                  {mealTimes!.breakfast_time && (
                    <div className="flex justify-between">
                      <span>Breakfast</span>
                      <span className="font-semibold text-foreground">{mealTimes!.breakfast_time}</span>
                    </div>
                  )}
                  {mealTimes!.lunch_time && (
                    <div className="flex justify-between">
                      <span>Lunch</span>
                      <span className="font-semibold text-foreground">{mealTimes!.lunch_time}</span>
                    </div>
                  )}
                  {mealTimes!.dinner_time && (
                    <div className="flex justify-between">
                      <span>Dinner</span>
                      <span className="font-semibold text-foreground">{mealTimes!.dinner_time}</span>
                    </div>
                  )}
                </div>
              )}
              {activeDiets.length > 0 && (
                <div className="space-y-1">
                  {activeDiets.map((d) => (
                    <div key={d.type} className="flex justify-between">
                      <span>{d.label}</span>
                      <span className="font-semibold text-foreground">
                        {d.guests} guest{d.guests !== 1 ? 's' : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {(() => {
                const activeDays = (foodData!.selections || [])
                  .filter(s => s.fullBoard || s.breakfast || s.lunch || s.dinner)
                  .sort((a, b) => a.date.localeCompare(b.date));
                if (activeDays.length === 0) {
                  return (
                    <>
                      {foodData!.fullBoardDays > 0 && (
                        <div>Full board: {foodData!.fullBoardDays} day{foodData!.fullBoardDays !== 1 ? 's' : ''}</div>
                      )}
                      {foodData!.breakfastOnlyDays > 0 && (
                        <div>Breakfast only: {foodData!.breakfastOnlyDays} day{foodData!.breakfastOnlyDays !== 1 ? 's' : ''}</div>
                      )}
                      {foodData!.customDays > 0 && (
                        <div>Custom selection: {foodData!.customDays} day{foodData!.customDays !== 1 ? 's' : ''}</div>
                      )}
                    </>
                  );
                }
                return (
                  <div className="mt-2 space-y-1">
                    {activeDays.map((s) => {
                      const meals: string[] = [];
                      if (s.fullBoard) meals.push('Full board');
                      else {
                        if (s.breakfast) meals.push('Breakfast');
                        if (s.lunch) meals.push('Lunch');
                        if (s.dinner) meals.push('Dinner (+ dessert)');
                      }
                      const guestsLabel = typeof s.guests_count_day === 'number'
                        ? ` — ${s.guests_count_day} guest${s.guests_count_day !== 1 ? 's' : ''}`
                        : '';
                      return (
                        <div key={s.date} className="text-xs">
                          <span className="font-medium text-foreground">{parseLocalDateLong(s.date)}{guestsLabel}</span>: {meals.join(' + ')}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
              {foodData!.totalCost !== undefined && foodData!.totalCost > 0 && (
                <div className="flex justify-between items-center mt-2 pt-2 border-t border-border">
                  <span className="flex items-center gap-1">
                    <Euro className="w-3 h-3" />
                    Estimated total
                  </span>
                  <span className="font-semibold text-foreground">€{foodData!.totalCost}</span>
                </div>
              )}
            </div>
          ) : (
            <Button asChild variant="outline" size="sm" className="ml-6" disabled={!hasDates}>
              <Link to={hasDates ? "/food" : "#"}>
                Not set <ChevronRight className="w-4 h-4 ml-1" />
              </Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
