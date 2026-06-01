import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Minus, Plus, Lock, Bed, ShowerHead, DoorOpen } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RoomTypeCardProps {
  title: string;
  image: string;
  quantity: number;
  isLocked?: boolean;
  maxQuantity?: number;
  onIncrement?: () => void;
  onDecrement?: () => void;
  bedLabel: string;
  bathroomLabel: string;
  roomsLabel: string;
}

export function RoomTypeCard({
  title,
  image,
  quantity,
  isLocked = false,
  maxQuantity = 9,
  onIncrement,
  onDecrement,
  bedLabel,
  bathroomLabel,
  roomsLabel,
}: RoomTypeCardProps) {
  const canDecrement = !isLocked && quantity > 0;
  const canIncrement = !isLocked && quantity < maxQuantity;

  return (
    <div className="bg-card rounded-2xl shadow-elegant overflow-hidden border border-border flex flex-col h-full">
      {/* Image - Square format */}
      <div className="relative aspect-square w-full overflow-hidden">
        <img
          src={image}
          alt={title}
          className="w-full h-full object-cover"
        />
        {isLocked && (
          <Badge 
            className="absolute top-3 right-3 bg-primary text-primary-foreground gap-1"
          >
            <Lock className="w-3 h-3" />
            Locked
          </Badge>
        )}
      </div>

      {/* Content */}
      <div className="p-4 flex flex-col flex-1">
        <div className="flex-1">
          <h3 className="text-lg font-medium mb-3">{title}</h3>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            <li className="flex items-center gap-2">
              <Bed className="w-4 h-4 flex-shrink-0" />
              <span>{bedLabel}</span>
            </li>
            <li className="flex items-center gap-2">
              <ShowerHead className="w-4 h-4 flex-shrink-0" />
              <span>{bathroomLabel}</span>
            </li>
            <li className="flex items-center gap-2">
              <DoorOpen className="w-4 h-4 flex-shrink-0" />
              <span>{roomsLabel}</span>
            </li>
          </ul>
        </div>

        {/* Quantity Selector - pinned to bottom */}
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
          <span className="text-sm text-muted-foreground">Rooms:</span>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              className={cn(
                "h-9 w-9 rounded-full",
                isLocked && "opacity-50 cursor-not-allowed"
              )}
              onClick={onDecrement}
              disabled={!canDecrement}
            >
              <Minus className="w-4 h-4" />
            </Button>
            
            <span className={cn(
              "w-8 text-center text-xl font-medium",
              isLocked && "text-muted-foreground"
            )}>
              {quantity}
            </span>
            
            <Button
              variant="outline"
              size="icon"
              className={cn(
                "h-9 w-9 rounded-full",
                isLocked && "opacity-50 cursor-not-allowed"
              )}
              onClick={onIncrement}
              disabled={!canIncrement}
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
