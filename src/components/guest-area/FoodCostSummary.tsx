import { Euro, AlertCircle } from 'lucide-react';
import type { FoodCostSummary, MealLine } from '@/lib/foodPricing';

interface FoodCostSummaryProps {
  summary: FoodCostSummary;
}

const fmt = (n: number) => `€${n.toLocaleString('en-GB')}`;

// Une ligne de repas : "Full board — 24 person-days × €70" ......... €1,680
function MealRow({ label, line, unit }: { label: string; line: MealLine; unit: string }) {
  if (!line.units) return null;
  return (
    <div className="flex justify-between items-baseline text-sm py-0.5">
      <span className="text-muted-foreground">
        {label} <span className="text-xs">— {line.units} {unit}{line.units !== 1 ? 's' : ''} × €{line.price}</span>
      </span>
      <span className="font-medium tabular-nums">{fmt(line.total)}</span>
    </div>
  );
}

export function FoodCostSummaryCard({ summary }: FoodCostSummaryProps) {
  const { grandTotal, dietBreakdown, dietTotal } = summary;
  const activeDiets = dietBreakdown.filter(d => d.guests > 0);
  const hasMeals = activeDiets.some(d =>
    d.meals.fullBoard.units + d.meals.breakfast.units + d.meals.lunch.units + d.meals.dinner.units > 0
  );

  return (
    <div className="guest-card p-6">
      <div className="flex items-center gap-2.5 mb-4">
        <span className="text-[#B25C3D] flex items-center justify-center">
          <Euro className="w-4 h-4" />
        </span>
        <h3 className="text-base font-semibold tracking-tight">Cost summary</h3>
      </div>

      {activeDiets.length === 0 ? (
        <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted/40 rounded-lg p-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>Assign your guests to a food preference above to see the cost breakdown.</span>
        </div>
      ) : !hasMeals ? (
        <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted/40 rounded-lg p-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>Select meals in the table above to see the cost breakdown.</span>
        </div>
      ) : (
        <div className="space-y-4">
          {activeDiets.map((d) => (
            <div key={d.type} className="rounded-xl border border-border/70 p-4">
              <div className="flex justify-between items-baseline mb-1.5">
                <span className="font-semibold text-sm">
                  {d.label}
                  <span className="text-muted-foreground font-normal"> · {d.guests} guest{d.guests !== 1 ? 's' : ''}</span>
                </span>
                <span className="font-semibold tabular-nums">{fmt(d.total)}</span>
              </div>
              <MealRow label="Full board" line={d.meals.fullBoard} unit="person-day" />
              <MealRow label="Breakfast" line={d.meals.breakfast} unit="breakfast" />
              <MealRow label="Lunch" line={d.meals.lunch} unit="lunch" />
              <MealRow label="Dinner (+ dessert)" line={d.meals.dinner} unit="dinner" />
            </div>
          ))}

          <div className="flex justify-between items-center text-xs text-muted-foreground px-1">
            <span>Guests with a food plan</span>
            <span className="tabular-nums">{dietTotal}</span>
          </div>

          <div className="flex justify-between items-center py-3 bg-[#FAEEE3] rounded-xl px-4">
            <span className="font-semibold text-sm">Estimated total food cost</span>
            <span className="text-lg font-bold text-[#B25C3D] tabular-nums">{fmt(grandTotal)}</span>
          </div>

          <p className="text-xs text-muted-foreground">
            Estimate based on your current selections — counts are people × meals (e.g. 3 lunches = 3 people having lunch that day). The final invoice reflects actual attendance.
          </p>
        </div>
      )}
    </div>
  );
}
