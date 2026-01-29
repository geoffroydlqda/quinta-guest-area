import roomsArrangement from '@/assets/rooms-arrangement.png';
import { cn } from '@/lib/utils';

interface FloorPlanProps {
  className?: string;
}

export function FloorPlan({ className }: FloorPlanProps) {
  return (
    <div className={cn("rounded-2xl overflow-hidden border border-border bg-card", className)}>
      <div className="p-4">
        <img
          src={roomsArrangement}
          alt="Rooms map (1-11)"
          className="w-full h-auto rounded-lg"
        />
        <div className="mt-4 text-center">
          <p className="text-sm font-medium mb-1">Rooms map (1–11)</p>
          <p className="text-xs text-muted-foreground">
            Rooms 1 & 6 are fixed King beds. Other rooms can be set as Queen or 2 Twins.
          </p>
        </div>
      </div>
    </div>
  );
}
