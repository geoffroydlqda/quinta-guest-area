import { RoomConfig } from '@/types/room';
import { cn } from '@/lib/utils';
import { Bed, Check, AlertCircle, Crown, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface RoomCardProps {
  room: RoomConfig;
  isSelected: boolean;
  errors: string[];
  onSelect: () => void;
  onReset: () => void;
}

export function RoomCard({ room, isSelected, errors, onSelect, onReset }: RoomCardProps) {
  const isConfigured = room.bedType !== null && room.occupant1.trim() !== '';
  const hasErrors = errors.length > 0;

  const getBedLabel = () => {
    switch (room.bedType) {
      case 'king':
        return 'King size';
      case 'queen':
        return 'Queen size';
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

  return (
    <div
      className={cn(
        "room-card cursor-pointer group",
        isConfigured && !hasErrors && "room-card-configured",
        !isConfigured && "room-card-unconfigured",
        hasErrors && "border-l-4 border-l-destructive",
        isSelected && "ring-2 ring-accent shadow-lg"
      )}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="font-display text-lg font-semibold">{room.name}</h3>
            {room.isFixed && (
              <span title="Suite principale">
                <Crown className="w-4 h-4 text-accent" />
              </span>
            )}
          </div>

          {room.bedType ? (
            <div className="space-y-2">
              <span className={cn("bed-badge", getBedBadgeClass())}>
                <Bed className="w-3 h-3 mr-1" />
                {getBedLabel()}
              </span>
              
              {(room.occupant1 || room.occupant2) && (
                <div className="text-sm text-muted-foreground">
                  {room.occupant1 && <p className="truncate">{room.occupant1}</p>}
                  {room.occupant2 && <p className="truncate">{room.occupant2}</p>}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Non configurée</p>
          )}

          {hasErrors && (
            <div className="mt-2 flex items-center gap-1 text-xs text-destructive">
              <AlertCircle className="w-3 h-3" />
              <span>{errors[0]}</span>
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-2">
          {isConfigured && !hasErrors ? (
            <div className="w-6 h-6 rounded-full bg-success/20 flex items-center justify-center">
              <Check className="w-4 h-4 text-success" />
            </div>
          ) : hasErrors ? (
            <div className="w-6 h-6 rounded-full bg-destructive/20 flex items-center justify-center">
              <AlertCircle className="w-4 h-4 text-destructive" />
            </div>
          ) : null}

          {(room.bedType || room.occupant1 || room.occupant2) && !room.isFixed && (
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
