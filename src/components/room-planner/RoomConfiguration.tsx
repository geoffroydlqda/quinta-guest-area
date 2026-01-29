import { RoomConfig, RoomStats as RoomStatsType } from '@/types/room';
import { RoomCard } from './RoomCard';
import { RoomStats } from './RoomStats';
import { FloorPlan } from './FloorPlan';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, Info } from 'lucide-react';

interface RoomConfigurationProps {
  rooms: RoomConfig[];
  stats: RoomStatsType;
  onUpdateRoom: (id: number, updates: Partial<RoomConfig>) => void;
  onResetRoom: (id: number) => void;
  onPrev: () => void;
  onNext: () => void;
}

export function RoomConfiguration({
  rooms,
  stats,
  onUpdateRoom,
  onResetRoom,
  onPrev,
  onNext,
}: RoomConfigurationProps) {
  return (
    <div className="animate-fade-up">
      <div className="text-center mb-6">
        <h2 className="text-3xl md:text-4xl mb-3">Room Configuration</h2>
        <p className="text-muted-foreground">
          Select Queen or 2 Twins for each room. You don't need to configure all rooms.
        </p>
      </div>

      {/* Floor plan - compact */}
      <FloorPlan className="mb-4" />

      {/* Stats */}
      <RoomStats stats={stats} className="mb-6" />

      {/* Info callout */}
      <div className="rounded-xl bg-primary/5 border border-primary/20 p-4 mb-6">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground">
            <strong>Rooms 7 & 8</strong> are upstairs, accessed through the kitchen. Their shared bathroom is slightly smaller and they are often reserved for facilitators. They offer the same comfort level and the best view.
          </p>
        </div>
      </div>

      {/* All room cards in a grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rooms.map((room) => (
          <RoomCard
            key={room.id}
            room={room}
            onUpdate={(updates) => onUpdateRoom(room.id, updates)}
            onReset={() => onResetRoom(room.id)}
          />
        ))}
      </div>

      {/* Navigation */}
      <div className="flex justify-between mt-8 pt-6 border-t border-border">
        <Button variant="outline" onClick={onPrev} className="gap-2">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        <Button onClick={onNext} className="gap-2">
          View Summary
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
