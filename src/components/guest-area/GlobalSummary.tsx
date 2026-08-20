import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ChevronRight, BedDouble, Car, Utensils, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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
    roomPlan?: Array<{
      roomId: number;
      bedType: 'king' | 'queen' | 'twin' | null;
      bathroomType: 'en-suite' | 'shared';
      isFixed?: boolean;
      note?: string;
    }> | null;
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
  disabledRooms?: number[];
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

// ---- Purely presentational building blocks ----

function SummarySection({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: React.ReactNode }) {
  return (
    <section className="py-5 first:pt-0 last:pb-0">
      <div className="flex items-center gap-2.5 mb-3">
        <span className="text-[#B25C3D] flex items-center justify-center flex-shrink-0">
          <Icon className="w-4 h-4" />
        </span>
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      </div>
      <div className="pl-[42px]">{children}</div>
    </section>
  );
}

function SummaryRow({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-baseline gap-3 py-1 text-sm">
      <span className="text-muted-foreground min-w-0">{label}</span>
      <span className="font-semibold text-foreground tabular-nums text-right shrink-0">{value}</span>
    </div>
  );
}

function SectionTotal({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-baseline gap-3 mt-2.5 pt-2.5 border-t border-border/70 text-sm">
      <span className="font-medium">{label}</span>
      <span className="font-bold text-[#B25C3D] tabular-nums">{value}</span>
    </div>
  );
}

function NotSetLink({ to, disabled }: { to: string; disabled?: boolean }) {
  return (
    <Button asChild variant="outline" size="sm" className="rounded-full text-muted-foreground" disabled={disabled}>
      <Link to={to}>
        Not set <ChevronRight className="w-4 h-4 ml-1" />
      </Link>
    </Button>
  );
}

export function GlobalSummary({
  profile,
  toolStatuses,
  roomSetupData,
  transportationData,
  foodData,
  disabledRooms,
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
    <div className="guest-card p-6 sm:p-8">
      {/* Header — stay meta kept small and muted (fixed by the admin) */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold tracking-tight">Summary</h2>
        <p className="text-xs text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span>
            {hasDates ? (
              <>
                {formatDateLocal(profile.check_in_date!, { day: 'numeric', month: 'short' })} — {formatDateLocal(profile.check_out_date!, { day: 'numeric', month: 'short', year: 'numeric' })}
              </>
            ) : (
              <span className="italic">Stay dates to be confirmed</span>
            )}
          </span>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1">
            <Users className="w-3 h-3" />
            {profile.guests_count} guest{profile.guests_count !== 1 ? 's' : ''}
          </span>
        </p>
      </div>

      <div className="divide-y divide-border/70">
        {/* Rooms */}
        <SummarySection icon={BedDouble} title="Rooms">
          {hasRoomSetup ? (
            (() => {
              const BATHROOM_PARTNER: Record<number, number> = { 2: 3, 3: 2, 4: 5, 5: 4, 7: 8, 8: 7 };
              const plan = roomSetupData!.roomPlan;
              if (plan && plan.length > 0) {
                const sorted = plan
                  .filter((r) => !(disabledRooms || []).includes(r.roomId))
                  .sort((a, b) => a.roomId - b.roomId);
                const bedLabel = (b: 'king' | 'queen' | 'twin' | null) =>
                  b === 'twin' ? 'Twin beds' : b === 'king' || b === 'queen' ? 'King size bed' : '—';
                return (
                  <div className="space-y-0.5">
                    {sorted.map((r) => {
                      const isFixed = r.isFixed || r.roomId === 1 || r.roomId === 6;
                      const suffixParts: string[] = [];
                      if (r.bathroomType === 'en-suite') suffixParts.push('en-suite');
                      else suffixParts.push(`shared with Room ${BATHROOM_PARTNER[r.roomId] ?? '?'}`);
                      if (r.note === 'Upstairs') suffixParts.push('Upstairs');
                      return (
                        <SummaryRow
                          key={r.roomId}
                          label={<>Room {r.roomId} <span className="text-muted-foreground/80">· {suffixParts.join(' · ')}</span></>}
                          value={<>{bedLabel(r.bedType)}{isFixed ? <span className="text-muted-foreground font-normal"> · fixed</span> : ''}</>}
                        />
                      );
                    })}
                  </div>
                );
              }
              return (
                <div className="space-y-0.5">
                  <SummaryRow label="King (en-suite bathroom) — fixed" value={2} />
                  <SummaryRow label="King size bed (shared bathroom)" value={roomSetupData!.queenSharedCount} />
                  <SummaryRow label="Twins (shared bathroom)" value={roomSetupData!.twinsSharedCount} />
                  <SummaryRow label="King size bed (en-suite bathroom)" value={roomSetupData!.queenEnsuiteCount} />
                  <SummaryRow label="Twins (en-suite bathroom)" value={roomSetupData!.twinsEnsuiteCount} />
                </div>
              );
            })()
          ) : (
            <NotSetLink to="/room-setup" />
          )}
        </SummarySection>

        {/* Meals */}
        <SummarySection icon={Utensils} title="Meals">
          {hasFood ? (
            <div className="space-y-0.5">
              {hasMealTimes && (
                <div className="mb-2.5">
                  <div className="guest-kicker mb-1">Meal times</div>
                  {mealTimes!.breakfast_time && <SummaryRow label="Breakfast" value={mealTimes!.breakfast_time} />}
                  {mealTimes!.lunch_time && <SummaryRow label="Lunch" value={mealTimes!.lunch_time} />}
                  {mealTimes!.dinner_time && <SummaryRow label="Dinner" value={mealTimes!.dinner_time} />}
                </div>
              )}
              {activeDiets.length > 0 && (
                <div className="space-y-0.5">
                  {activeDiets.map((d) => (
                    <SummaryRow
                      key={d.type}
                      label={d.label}
                      value={`${d.guests} guest${d.guests !== 1 ? 's' : ''}`}
                    />
                  ))}
                </div>
              )}
              {(() => {
                const activeDays = (foodData!.selections || [])
                  .filter(s => s.fullBoard || s.breakfast || s.lunch || s.dinner)
                  .sort((a, b) => a.date.localeCompare(b.date));
                if (activeDays.length === 0) {
                  return (
                    <div className="space-y-0.5 text-sm text-muted-foreground">
                      {foodData!.fullBoardDays > 0 && (
                        <div>Full board: {foodData!.fullBoardDays} day{foodData!.fullBoardDays !== 1 ? 's' : ''}</div>
                      )}
                      {foodData!.breakfastOnlyDays > 0 && (
                        <div>Breakfast only: {foodData!.breakfastOnlyDays} day{foodData!.breakfastOnlyDays !== 1 ? 's' : ''}</div>
                      )}
                      {foodData!.customDays > 0 && (
                        <div>Custom selection: {foodData!.customDays} day{foodData!.customDays !== 1 ? 's' : ''}</div>
                      )}
                    </div>
                  );
                }
                return (
                  <div className="mt-2.5 space-y-1">
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
                        <div key={s.date} className="text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">{parseLocalDateLong(s.date)}{guestsLabel}</span>: {meals.join(' + ')}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
              {foodData!.totalCost !== undefined && foodData!.totalCost > 0 && (
                <SectionTotal label="Estimated total" value={`€${foodData!.totalCost}`} />
              )}
            </div>
          ) : (
            <NotSetLink to={hasDates ? "/food" : "#"} disabled={!hasDates} />
          )}
        </SummarySection>

        {/* Transfers */}
        <SummarySection icon={Car} title="Transfers">
          {hasTransportation ? (
            <div className="space-y-0.5">
              <SummaryRow
                label="Trips scheduled"
                value={transportationData!.totalTrips}
              />
              {transportationData!.customOfferCount > 0 && (
                <SummaryRow label="Custom offer trips" value={transportationData!.customOfferCount} />
              )}
              {transportationData!.subtotal > 0 && (
                <SectionTotal label="Transfers subtotal" value={`€${transportationData!.subtotal}`} />
              )}
            </div>
          ) : (
            <NotSetLink to="/transportation" />
          )}
        </SummarySection>
      </div>
    </div>
  );
}
