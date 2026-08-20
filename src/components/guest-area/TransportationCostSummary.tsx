import { Euro, Car } from 'lucide-react';
import type { TransportationCostSummary } from '@/lib/transportationPricing';

interface TransportationCostSummaryProps {
  summary: TransportationCostSummary;
}

export function TransportationCostSummaryCard({ summary }: TransportationCostSummaryProps) {
  const { subtotal, customOfferCount, totalTrips } = summary;

  if (totalTrips === 0) {
    return null;
  }

  return (
    <div className="guest-card p-6">
      <div className="flex items-center gap-2.5 mb-4">
        <span className="text-[#B25C3D] flex items-center justify-center">
          <Euro className="w-4 h-4" />
        </span>
        <h3 className="text-base font-semibold tracking-tight">Cost summary</h3>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between items-baseline py-1.5 text-sm">
          <span className="text-muted-foreground">Total trips</span>
          <span className="font-semibold tabular-nums">{totalTrips}</span>
        </div>

        {customOfferCount > 0 && (
          <div className="flex justify-between items-baseline py-1.5 text-sm">
            <span className="text-muted-foreground">Custom offer trips</span>
            <span className="font-semibold tabular-nums">{customOfferCount}</span>
          </div>
        )}

        {subtotal > 0 && (
          <div className="flex justify-between items-center py-3 px-4 mt-2 bg-[#FAEEE3] rounded-xl">
            <span className="font-semibold text-sm">Transportation subtotal</span>
            <span className="text-lg font-bold text-[#B25C3D] tabular-nums">€{subtotal}</span>
          </div>
        )}
      </div>
    </div>
  );
}
