import { RoomConfig, BedType } from '@/types/room';
import { cn } from '@/lib/utils';
import { Bed, Check, RotateCcw, Bath } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import roomKingImage from '@/assets/room-king.jpg';
import roomFlexibleImage from '@/assets/room-flexible.jpg';

interface RoomCardProps {
  room: RoomConfig;
  onUpdate: (updates: Partial<RoomConfig>) => void;
  onReset: () => void;
}

export function RoomCard({ room, onUpdate, onReset }: RoomCardProps) {
  const isConfigured = room.bedType !== null;
  const roomImage = room.isFixed ? roomKingImage : roomFlexibleImage;

  const getStatusLabel = () => {
    if (!room.bedType) return 'Not selected';
    if (room.bedType === 'king') return 'King';
    if (room.bedType === 'queen') return 'Queen';
    if (room.bedType === 'twin') return '2 Twins';
    return '';
  };

  const getStatusClass = () => {
    if (!room.bedType) return 'bg-muted text-muted-foreground';
    return 'bg-success/20 text-success';
  };

  return (
    <div
      className={cn(
        "room-card",
        isConfigured && "room-card-configured",
        !isConfigured && "room-card-unconfigured"
      )}
    >
      {/* Compact header with image thumbnail */}
      <div className="flex gap-3">
        {/* Small room image */}
        <div className="w-20 h-20 flex-shrink-0 rounded-lg overflow-hidden">
          <img
            src={roomImage}
            alt={`Room ${room.id}`}
            className="w-full h-full object-cover"
          />
        </div>

        {/* Room info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3 className="text-lg font-medium">{room.name}</h3>
            {isConfigured && (
              <div className="w-5 h-5 rounded-full bg-success/20 flex items-center justify-center flex-shrink-0">
                <Check className="w-3 h-3 text-success" />
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
            <Bath className="w-3 h-3" />
            <span>{room.bathroomType === 'en-suite' ? 'En-suite' : 'Shared'}</span>
          </div>

          {room.specialNote && (
            <p className="text-xs text-muted-foreground italic">{room.specialNote}</p>
          )}
        </div>
      </div>

      {/* Bed selection */}
      <div className="mt-3 pt-3 border-t border-border">
        {room.isFixed ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="bed-badge bed-badge-king">
                <Bed className="w-3 h-3 mr-1" />
                King (fixed)
              </span>
            </div>
            <span className={cn("text-xs px-2 py-1 rounded-full", getStatusClass())}>
              {getStatusLabel()}
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <RadioGroup
              value={room.bedType || ''}
              onValueChange={(value) => onUpdate({ bedType: value as BedType })}
              className="flex gap-2"
            >
              <div className="flex items-center">
                <RadioGroupItem value="queen" id={`queen-${room.id}`} className="peer sr-only" />
                <Label
                  htmlFor={`queen-${room.id}`}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs cursor-pointer transition-all border",
                    room.bedType === 'queen'
                      ? "bg-room-queen/20 border-room-queen text-room-queen"
                      : "bg-muted border-border text-muted-foreground hover:border-room-queen/50"
                  )}
                >
                  <Bed className="w-3 h-3" />
                  Queen
                </Label>
              </div>

              <div className="flex items-center">
                <RadioGroupItem value="twin" id={`twin-${room.id}`} className="peer sr-only" />
                <Label
                  htmlFor={`twin-${room.id}`}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs cursor-pointer transition-all border",
                    room.bedType === 'twin'
                      ? "bg-room-twin/20 border-room-twin text-room-twin"
                      : "bg-muted border-border text-muted-foreground hover:border-room-twin/50"
                  )}
                >
                  <Bed className="w-3 h-3" />
                  <Bed className="w-3 h-3 -ml-1" />
                  2 Twins
                </Label>
              </div>
            </RadioGroup>

            <div className="flex items-center gap-2">
              {room.bedType && (
                <button
                  onClick={onReset}
                  className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset
                </button>
              )}
              <span className={cn("text-xs px-2 py-1 rounded-full whitespace-nowrap", getStatusClass())}>
                {getStatusLabel()}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
