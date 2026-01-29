import { RoomConfig, RoomStats as RoomStatsType } from '@/types/room';
import { RoomCard } from './RoomCard';
import { RoomConfigPanel } from './RoomConfigPanel';
import { RoomStats } from './RoomStats';
import { FloorPlan } from './FloorPlan';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, AlertTriangle } from 'lucide-react';

interface RoomConfigurationProps {
  rooms: RoomConfig[];
  selectedRoomId: number | null;
  stats: RoomStatsType;
  duplicates: { name: string; rooms: number[] }[];
  isValid: boolean;
  getRoomErrors: (room: RoomConfig) => string[];
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
  duplicates,
  isValid,
  getRoomErrors,
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
        <h2 className="font-display text-3xl md:text-4xl mb-3">Configuration des chambres</h2>
        <p className="text-muted-foreground">
          Sélectionnez le type de lit et les occupants pour chaque chambre
        </p>
      </div>

      {/* Stats */}
      <RoomStats stats={stats} className="mb-6" />

      {/* Duplicate warning */}
      {duplicates.length > 0 && (
        <div className="mb-6 p-4 rounded-xl bg-destructive/10 border border-destructive/20 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-destructive">Noms en double détectés :</p>
            <ul className="mt-1 text-destructive/80">
              {duplicates.map(({ name, rooms: duplicateRooms }) => (
                <li key={name}>
                  "{name}" utilisé dans les chambres {duplicateRooms.join(', ')}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Main layout */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Left: Floor plan (desktop) */}
        <div className="hidden lg:block">
          <FloorPlan className="sticky top-6" />
        </div>

        {/* Right: Room list or config panel */}
        <div className="space-y-4">
          {selectedRoom ? (
            <RoomConfigPanel
              room={selectedRoom}
              errors={getRoomErrors(selectedRoom)}
              onUpdate={(updates) => onUpdateRoom(selectedRoom.id, updates)}
              onClose={() => onSelectRoom(null)}
            />
          ) : (
            <div className="space-y-3">
              {rooms.map((room) => (
                <RoomCard
                  key={room.id}
                  room={room}
                  isSelected={room.id === selectedRoomId}
                  errors={getRoomErrors(room)}
                  onSelect={() => onSelectRoom(room.id)}
                  onReset={() => onResetRoom(room.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex justify-between mt-8 pt-6 border-t border-border">
        <Button variant="outline" onClick={onPrev} className="gap-2">
          <ArrowLeft className="w-4 h-4" />
          Retour
        </Button>
        <Button onClick={onNext} disabled={!isValid} className="gap-2">
          Voir le récapitulatif
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
