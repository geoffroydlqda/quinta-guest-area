import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Minus, Plus, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RoomTypeCardProps {
  title: string;
  description: string;
  image: string;
  quantity: number;
  isLocked?: boolean;
  maxQuantity?: number;
  onIncrement?: () => void;
  onDecrement?: () => void;
}

export function RoomTypeCard({
  title,
  description,
  image,
  quantity,
  isLocked = false,
  maxQuantity = 9,
  onIncrement,
  onDecrement,
}: RoomTypeCardProps) {
  const canDecrement = !isLocked && quantity > 0;
  const canIncrement = !isLocked && quantity < maxQuantity;

  return (
    <div className="bg-card rounded-2xl shadow-elegant overflow-hidden border border-border">
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
      <div className="p-4 space-y-4">
        <div>
          <h3 className="text-lg font-medium mb-1">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>

        {/* Quantity Selector */}
        <div className="flex items-center justify-between">
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
