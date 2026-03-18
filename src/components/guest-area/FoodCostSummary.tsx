import { Euro } from 'lucide-react';
import type { FoodCostSummary } from '@/lib/foodPricing';

interface FoodCostSummaryProps {
  summary: FoodCostSummary;
}

export function FoodCostSummaryCard({ summary }: FoodCostSummaryProps) {
  const { grandTotal, totalPerPerson, fullBoardDays, breakfastCount, lunchCount, dinnerCount, guestsCount } = summary;

  return (
    <div className="bg-card rounded-2xl border border-border p-6">
      <div className="flex items-center gap-2 mb-4">
        <Euro className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-semibold">Cost summary</h3>
      </div>

      <div className="space-y-3">
        <div className="flex justify-between items-center py-2 border-b border-border">
          <span className="text-muted-foreground font-medium">Guests</span>
          <span className="font-semibold">{guestsCount}</span>
        </div>

        <div className="flex justify-between items-center py-2 border-b border-border">
          <span className="text-muted-foreground font-medium">Per person total</span>
          <span className="font-semibold">€{totalPerPerson}</span>
        </div>

        <div className="flex justify-between items-center py-2 bg-primary/5 rounded-lg px-3 -mx-3">
          <span className="font-semibold">Estimated total food cost</span>
          <span className="text-lg font-bold text-primary">€{grandTotal}</span>
        </div>

        <div className="mt-4 pt-4 border-t border-border">
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
