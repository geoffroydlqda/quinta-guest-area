import { RoomConfig, BedType } from '@/types/room';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { X, Bed, Bath, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import roomKingImage from '@/assets/room-king.jpg';
import roomFlexibleImage from '@/assets/room-flexible.jpg';

interface RoomConfigPanelProps {
  room: RoomConfig;
  onUpdate: (updates: Partial<RoomConfig>) => void;
  onClose: () => void;
  onReset: () => void;
}

export function RoomConfigPanel({ room, onUpdate, onClose, onReset }: RoomConfigPanelProps) {
  const roomImage = room.isFixed ? roomKingImage : roomFlexibleImage;

  return (
    <div className="bg-card rounded-2xl shadow-elegant overflow-hidden animate-slide-in-right">
      {/* Room image */}
      <div className="aspect-[16/9] overflow-hidden relative">
        <img
          src={roomImage}
          alt={`Room ${room.id}`}
          className="w-full h-full object-cover"
        />
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={onClose}
          className="absolute top-3 right-3 bg-background/80 backdrop-blur-sm hover:bg-background"
        >
          <X className="w-5 h-5" />
        </Button>
      </div>

      {/* Header */}
      <div className="px-6 py-4 border-b border-border">
        <div className="flex items-center justify-between">
          <h3 className="text-2xl font-medium">{room.name}</h3>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary text-sm">
            <Bath className="w-4 h-4" />
            <span>{room.bathroomType === 'en-suite' ? 'En-suite bathroom' : 'Shared bathroom'}</span>
          </div>
        </div>
        {room.specialNote && (
          <p className="text-sm text-muted-foreground mt-2 italic">{room.specialNote}</p>
        )}
      </div>

      <div className="p-6 space-y-6">
        {/* Bed selection */}
        <div className="space-y-3">
          <Label className="flex items-center gap-2 text-base">
            <Bed className="w-4 h-4 text-primary" />
            Bed Setup
          </Label>

          {room.isFixed ? (
            <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
              <div className="flex items-center gap-2">
                <div className="bed-badge bed-badge-king">
                  <Bed className="w-3 h-3 mr-1" />
                  King (fixed)
                </div>
                <span className="text-sm text-muted-foreground">This room has a fixed bed configuration</span>
              </div>
            </div>
          ) : (
            <RadioGroup
              value={room.bedType || ''}
              onValueChange={(value) => onUpdate({ bedType: value as BedType })}
              className="grid grid-cols-2 gap-3"
            >
              <div>
                <RadioGroupItem value="queen" id={`queen-${room.id}`} className="peer sr-only" />
                <Label
                  htmlFor={`queen-${room.id}`}
                  className={cn(
                    "flex flex-col items-center gap-2 p-4 rounded-lg border-2 cursor-pointer transition-all",
                    "hover:border-room-queen/50 hover:bg-room-queen/5",
                    room.bedType === 'queen'
                      ? "border-room-queen bg-room-queen/10"
                      : "border-border"
                  )}
                >
                  <Bed className="w-6 h-6" />
                  <span className="font-medium">Queen</span>
                  <span className="text-xs text-muted-foreground">1 large bed</span>
                </Label>
              </div>

              <div>
                <RadioGroupItem value="twin" id={`twin-${room.id}`} className="peer sr-only" />
                <Label
                  htmlFor={`twin-${room.id}`}
                  className={cn(
                    "flex flex-col items-center gap-2 p-4 rounded-lg border-2 cursor-pointer transition-all",
                    "hover:border-room-twin/50 hover:bg-room-twin/5",
                    room.bedType === 'twin'
                      ? "border-room-twin bg-room-twin/10"
                      : "border-border"
                  )}
                >
                  <div className="flex gap-1">
                    <Bed className="w-5 h-5" />
                    <Bed className="w-5 h-5" />
                  </div>
                  <span className="font-medium">2 Twins</span>
                  <span className="text-xs text-muted-foreground">2 single beds</span>
                </Label>
              </div>
            </RadioGroup>
          )}

          {/* Reset selection link */}
          {!room.isFixed && room.bedType && (
            <button
              onClick={onReset}
              className="text-sm text-primary hover:underline flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              Reset selection
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
