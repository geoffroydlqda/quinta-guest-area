import { RoomConfig, BedType } from '@/types/room';
import { cn } from '@/lib/utils';
import { Bed, Check, RotateCcw, Bath } from 'lucide-react';
import { Button } from '@/components/ui/button';
import roomKingImage from '@/assets/room-king.jpg';
import roomFlexibleImage from '@/assets/room-flexible.jpg';

interface RoomCardProps {
  room: RoomConfig;
  isSelected: boolean;
  onSelect: () => void;
  onReset: () => void;
}

export function RoomCard({ room, isSelected, onSelect, onReset }: RoomCardProps) {
  const isConfigured = room.bedType !== null;

  const getBedLabel = () => {
    switch (room.bedType) {
      case 'king':
        return 'King';
      case 'queen':
        return 'Queen';
      case 'twin':
        return '2 Twins';
      default:
        return null;
    }
  };

  const getBedBadgeClass = () => {
    switch (room.bedType) {
      case 'king':
        return 'bed-badge-king';
      case 'queen':
        return 'bed-badge-queen';
      case 'twin':
        return 'bed-badge-twin';
      default:
        return '';
    }
  };

  const getStatusLabel = () => {
    if (!room.bedType) return 'Not selected';
    if (room.bedType === 'king') return 'Selected: King';
    if (room.bedType === 'queen') return 'Selected: Queen';
    if (room.bedType === 'twin') return 'Selected: 2 Twins';
    return '';
  };

  const getStatusClass = () => {
    if (!room.bedType) return 'bg-muted text-muted-foreground';
    return 'bg-success/20 text-success';
  };

  const roomImage = room.isFixed ? roomKingImage : roomFlexibleImage;

  return (
    <div
      className={cn(
        "room-card cursor-pointer group",
        isConfigured && "room-card-configured",
        !isConfigured && "room-card-unconfigured",
        isSelected && "ring-2 ring-primary shadow-lg"
      )}
      onClick={onSelect}
    >
      {/* Room image */}
      <div className="aspect-[16/9] -mx-5 -mt-5 mb-4 overflow-hidden">
        <img
          src={roomImage}
          alt={`Room ${room.id}`}
          className="w-full h-full object-cover"
        />
      </div>

      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="text-xl font-medium">{room.name}</h3>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-secondary text-xs">
          <Bath className="w-3 h-3" />
          <span>{room.bathroomType === 'en-suite' ? 'En-suite bathroom' : 'Shared bathroom'}</span>
        </div>
      </div>

      {/* Bed setup info */}
      <div className="space-y-2">
        {room.isFixed ? (
          <div className="flex items-center gap-2">
            <span className={cn("bed-badge", "bed-badge-king")}>
              <Bed className="w-3 h-3 mr-1" />
              King (fixed)
            </span>
          </div>
        ) : room.bedType ? (
          <span className={cn("bed-badge", getBedBadgeClass())}>
            <Bed className="w-3 h-3 mr-1" />
            {getBedLabel()}
          </span>
        ) : (
          <p className="text-sm text-muted-foreground">Tap to select bed type</p>
        )}

        {room.specialNote && (
          <p className="text-xs text-muted-foreground italic">{room.specialNote}</p>
        )}
      </div>

      {/* Status and reset */}
      <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
        <span className={cn("text-xs px-2 py-1 rounded-full", getStatusClass())}>
          {getStatusLabel()}
        </span>

        <div className="flex items-center gap-2">
          {isConfigured && (
            <div className="w-6 h-6 rounded-full bg-success/20 flex items-center justify-center">
              <Check className="w-4 h-4 text-success" />
            </div>
          )}

          {room.bedType && !room.isFixed && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                onReset();
              }}
            >
              <RotateCcw className="w-3 h-3 mr-1" />
              <span className="text-xs">Reset</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
