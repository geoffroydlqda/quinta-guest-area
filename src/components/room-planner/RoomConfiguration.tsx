import { RoomConfig, RoomStats as RoomStatsType } from '@/types/room';
import { RoomCard } from './RoomCard';
import { RoomConfigPanel } from './RoomConfigPanel';
import { RoomStats } from './RoomStats';
import { FloorPlan } from './FloorPlan';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, Info } from 'lucide-react';

interface RoomConfigurationProps {
  rooms: RoomConfig[];
  selectedRoomId: number | null;
  stats: RoomStatsType;
  onSelectRoom: (id: number | null) => void;
  onUpdateRoom: (id: number, updates: Partial<RoomConfig>) => void;
  onResetRoom: (id: number) => void;
  onPrev: () => void;
  onNext: () => void;
}

export function RoomConfiguration({
  rooms,
  selectedRoomId,
  stats,
  onSelectRoom,
  onUpdateRoom,
  onResetRoom,
  onPrev,
  onNext,
}: RoomConfigurationProps) {
  const selectedRoom = rooms.find((r) => r.id === selectedRoomId);

  return (
    <div className="animate-fade-up">
      <div className="text-center mb-6">
        <h2 className="text-3xl md:text-4xl mb-3">Room Configuration</h2>
        <p className="text-muted-foreground">
          Select the bed type for each room. You don't need to configure all rooms.
        </p>
      </div>

      {/* Floor plan */}
      <FloorPlan className="mb-6" />

      {/* Stats */}
      <RoomStats stats={stats} className="mb-6" />

      {/* Main layout */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Left: Room list */}
        <div className="space-y-4">
          {selectedRoom ? (
            <RoomConfigPanel
              room={selectedRoom}
              onUpdate={(updates) => onUpdateRoom(selectedRoom.id, updates)}
              onClose={() => onSelectRoom(null)}
              onReset={() => onResetRoom(selectedRoom.id)}
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              {rooms.map((room) => (
                <RoomCard
                  key={room.id}
                  room={room}
                  isSelected={room.id === selectedRoomId}
                  onSelect={() => onSelectRoom(room.id)}
                  onReset={() => onResetRoom(room.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Right: Info callout (desktop) */}
        <div className="hidden lg:block">
          <div className="sticky top-24 space-y-4">
            <div className="rounded-2xl bg-primary/5 border border-primary/20 p-6">
              <div className="flex items-start gap-3">
                <Info className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-medium mb-2">About Rooms 7 & 8</h4>
                  <p className="text-sm text-muted-foreground">
                    Rooms 7 & 8 are upstairs and accessed through the kitchen. Their shared bathroom is slightly smaller and they are often reserved for facilitators. They offer the same comfort level and the best view.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile info callout */}
      <div className="lg:hidden mt-6">
        <div className="rounded-2xl bg-primary/5 border border-primary/20 p-4">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <p className="text-sm text-muted-foreground">
              Rooms 7 & 8 are upstairs and accessed through the kitchen. Their shared bathroom is slightly smaller and they are often reserved for facilitators. They offer the same comfort level and the best view.
            </p>
          </div>
        </div>
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
