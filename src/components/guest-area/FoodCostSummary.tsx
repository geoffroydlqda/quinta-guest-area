import { Euro, AlertCircle } from 'lucide-react';
import type { FoodCostSummary } from '@/lib/foodPricing';

interface FoodCostSummaryProps {
  summary: FoodCostSummary;
}

export function FoodCostSummaryCard({ summary }: FoodCostSummaryProps) {
  const { grandTotal, fullBoardDays, breakfastCount, lunchCount, dinnerCount, dietBreakdown, dietTotal } = summary;
  const activeDiets = dietBreakdown.filter(d => d.guests > 0);

  return (
    <div className="bg-card rounded-2xl border border-border p-6">
      <div className="flex items-center gap-2 mb-4">
        <Euro className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-semibold">Cost summary</h3>
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold mb-2">Food preferences</p>
          {activeDiets.length === 0 ? (
            <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted/40 rounded-lg p-3">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>No diets assigned yet.</span>
            </div>
          ) : (
            <div className="space-y-1.5">
              {activeDiets.map((d) => (
                <div key={d.type} className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">{d.label}</span>
                  <span className="font-medium">
                    {d.guests} guest{d.guests !== 1 ? 's' : ''} · €{d.total}
                  </span>
                </div>
              ))}
              <div className="flex justify-between items-center text-xs text-muted-foreground pt-1">
                <span>Total guests with food plan</span>
                <span>{dietTotal}</span>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-between items-center py-3 bg-primary/5 rounded-lg px-3">
          <span className="font-semibold">Estimated total food cost</span>
          <span className="text-lg font-bold text-primary">€{grandTotal}</span>
        </div>

        <div className="mt-2 pt-4 border-t border-border">
          <p className="text-sm text-muted-foreground mb-2 font-medium">Breakdown:</p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Full board days:</span>
              <span className="font-medium">{fullBoardDays}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Breakfast:</span>
              <span className="font-medium">{breakfastCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Lunch:</span>
              <span className="font-medium">{lunchCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Dinner (+ dessert):</span>
              <span className="font-medium">{dinnerCount}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
