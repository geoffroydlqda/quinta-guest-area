import { RoomConfig, BedType } from '@/types/room';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Button } from '@/components/ui/button';
import { X, Bed, User, FileText, Crown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RoomConfigPanelProps {
  room: RoomConfig;
  errors: string[];
  onUpdate: (updates: Partial<RoomConfig>) => void;
  onClose: () => void;
}

export function RoomConfigPanel({ room, errors, onUpdate, onClose }: RoomConfigPanelProps) {
  return (
    <div className="bg-card rounded-2xl shadow-elegant overflow-hidden animate-slide-in-right">
      {/* Header */}
      <div className="bg-secondary px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="font-display text-xl font-semibold">{room.name}</h3>
          {room.isFixed && (
            <div className="flex items-center gap-1 text-accent text-sm">
              <Crown className="w-4 h-4" />
              <span>Suite principale</span>
            </div>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="w-5 h-5" />
        </Button>
      </div>

      <div className="p-6 space-y-6">
        {/* Bed selection */}
        <div className="space-y-3">
          <Label className="flex items-center gap-2 text-base">
            <Bed className="w-4 h-4 text-accent" />
            Configuration du lit
          </Label>

          {room.isFixed ? (
            <div className="p-4 rounded-lg bg-accent/10 border border-accent/20">
              <div className="flex items-center gap-2">
                <div className="bed-badge bed-badge-king">
                  <Bed className="w-3 h-3 mr-1" />
                  King size
                </div>
                <span className="text-sm text-muted-foreground">(configuration fixe)</span>
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
                  <span className="font-medium">Queen size</span>
                  <span className="text-xs text-muted-foreground">1 grand lit</span>
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
                  <span className="font-medium">2 Twin beds</span>
                  <span className="text-xs text-muted-foreground">2 lits simples</span>
                </Label>
              </div>
            </RadioGroup>
          )}
        </div>

        {/* Occupants */}
        <div className="space-y-3">
          <Label className="flex items-center gap-2 text-base">
            <User className="w-4 h-4 text-accent" />
            Occupants
          </Label>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={`occ1-${room.id}`} className="text-sm text-muted-foreground">
                Occupant 1 {room.bedType && <span className="text-destructive">*</span>}
              </Label>
              <Input
                id={`occ1-${room.id}`}
                placeholder="Prénom Nom"
                value={room.occupant1}
                onChange={(e) => onUpdate({ occupant1: e.target.value })}
                className="h-11"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`occ2-${room.id}`} className="text-sm text-muted-foreground">
                Occupant 2 (optionnel)
              </Label>
              <Input
                id={`occ2-${room.id}`}
                placeholder="Prénom Nom"
                value={room.occupant2}
                onChange={(e) => onUpdate({ occupant2: e.target.value })}
                className="h-11"
              />
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="space-y-3">
          <Label htmlFor={`notes-${room.id}`} className="flex items-center gap-2 text-base">
            <FileText className="w-4 h-4 text-muted-foreground" />
            Notes chambre
          </Label>
          <Textarea
            id={`notes-${room.id}`}
            placeholder="Besoins particuliers, préférences..."
            value={room.notes}
            onChange={(e) => onUpdate({ notes: e.target.value })}
            rows={2}
          />
        </div>

        {/* Errors */}
        {errors.length > 0 && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
            <ul className="text-sm text-destructive space-y-1">
              {errors.map((error, i) => (
                <li key={i}>• {error}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
