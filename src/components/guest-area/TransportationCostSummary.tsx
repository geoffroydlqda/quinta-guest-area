import { Euro, Car } from 'lucide-react';
import type { TransportationCostSummary } from '@/lib/transportationPricing';

interface TransportationCostSummaryProps {
  summary: TransportationCostSummary;
}

export function TransportationCostSummaryCard({ summary }: TransportationCostSummaryProps) {
  const { fixedPriceTotal, customOfferCount, totalTrips } = summary;

  if (totalTrips === 0) {
    return null;
  }

  return (
    <div className="bg-card rounded-2xl border border-border p-6">
      <div className="flex items-center gap-2 mb-4">
        <Euro className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-medium">Cost summary</h3>
      </div>

      <div className="space-y-3">
        <div className="flex justify-between items-center py-2 border-b border-border">
          <span className="text-muted-foreground">Total trips</span>
          <span className="font-medium">{totalTrips}</span>
        </div>

        {fixedPriceTotal > 0 && (
          <div className="flex justify-between items-center py-2 bg-primary/5 rounded-lg px-3 -mx-3">
            <span className="font-medium">Estimated total (fixed-price trips)</span>
            <span className="text-lg font-bold text-primary">€{fixedPriceTotal}</span>
          </div>
        )}

        {customOfferCount > 0 && (
          <div className="flex justify-between items-center py-2">
            <span className="text-muted-foreground">Custom offer trips</span>
            <span className="font-medium">{customOfferCount}</span>
          </div>
        )}
      </div>
    </div>
  );
}
