import { useState } from 'react';
import { RoomSelection, RoomStats as RoomStatsType, MAX_SHARED_ROOMS, MAX_ENSUITE_ROOMS } from '@/types/room';
import { RoomTypeCard } from './RoomTypeCard';
import { RoomStats } from './RoomStats';
import { MapLightbox } from './MapLightbox';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, Crown, ZoomIn, Info } from 'lucide-react';
import roomsArrangement from '@/assets/rooms-arrangement_floor-plan.jpg';
import roomKingImage from '@/assets/room-king.jpg';
import roomTwinsImage from '@/assets/room-queen.jpg';
import roomQueenImage from '@/assets/room-twins.jpg';

interface RoomConfigurationProps {
  roomSelection: RoomSelection;
  stats: RoomStatsType;
  isSharedValid: boolean;
  isEnsuiteValid: boolean;
  isSelectionValid: boolean;
  onSetQueenShared: (qty: number) => void;
  onSetTwinsShared: (qty: number) => void;
  onSetQueenEnsuite: (qty: number) => void;
  onSetTwinsEnsuite: (qty: number) => void;
  onPrev: () => void;
  onNext: () => void;
}

export function RoomConfiguration({
  roomSelection,
  stats,
  isSharedValid,
  isEnsuiteValid,
  isSelectionValid,
  onSetQueenShared,
  onSetTwinsShared,
  onSetQueenEnsuite,
  onSetTwinsEnsuite,
  onPrev,
  onNext
}: RoomConfigurationProps) {
  const [mapOpen, setMapOpen] = useState(false);
  
  // Calculate remaining capacity for each category
  const totalShared = roomSelection.queenSharedQty + roomSelection.twinsSharedQty;
  const totalEnsuite = roomSelection.queenEnsuiteQty + roomSelection.twinsEnsuiteQty;
  const remainingShared = MAX_SHARED_ROOMS - totalShared;
  const remainingEnsuite = MAX_ENSUITE_ROOMS - totalEnsuite;

  return (
    <div className="animate-fade-up">
      <div className="text-center mb-6">
        <h2 className="text-3xl md:text-4xl mb-3">Room Configuration</h2>
        <p className="text-muted-foreground">
          Select how many rooms should be prepared with each bed type.
        </p>
      </div>

      {/* Room Map - Clickable (no caption) */}
      <div 
        className="rounded-xl overflow-hidden border border-border bg-card mb-6 cursor-pointer group" 
        onClick={() => setMapOpen(true)}
      >
        <div className="relative">
          <img 
            src={roomsArrangement} 
            alt="Rooms map" 
            className="w-full h-auto max-h-80 object-contain bg-white" 
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center text-transparent">
            <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-card/90 rounded-full px-4 py-2 flex items-center gap-2 shadow-lg">
              <ZoomIn className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">Click to enlarge</span>
            </div>
          </div>
        </div>
      </div>

      <MapLightbox open={mapOpen} onOpenChange={setMapOpen} />

      {/* Info Callouts - Under the Map (2 callouts) */}
      <div className="grid gap-4 md:grid-cols-2 mb-6">
        {/* Callout A - King rooms */}
        <div className="rounded-xl bg-primary/10 border-2 border-primary/30 p-5">
          <div className="flex items-start gap-3">
            <Crown className="w-6 h-6 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-base mb-1">King rooms</p>
              <p className="text-sm text-muted-foreground">
                Rooms 1 & 6 are fixed King beds with en-suite bathrooms.
              </p>
            </div>
          </div>
        </div>

        {/* Callout B - Rooms 7 & 8 (merged with bathroom note) */}
        <div className="rounded-xl bg-primary/10 border-2 border-primary/30 p-5">
          <div className="flex items-start gap-3">
            <Info className="w-6 h-6 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-base mb-1">Rooms 7 & 8</p>
              <p className="text-sm text-muted-foreground">
                Upstairs, accessed through the kitchen. Their shared bathroom is slightly smaller. 
                These rooms are often reserved for facilitators and offer the best view.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <RoomStats stats={stats} className="mb-6" />

      {/* 5 Room Type Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-6">
        {/* Card 1: King rooms (fixed) */}
        <RoomTypeCard 
          title="King (en-suite bathroom)" 
          description="Rooms 1 & 6 are fixed King beds with en-suite bathrooms." 
          image={roomKingImage} 
          quantity={2} 
          isLocked={true} 
        />
        
        {/* Card 2: Queen size bed rooms (shared bathroom) */}
        <RoomTypeCard 
          title="Queen size bed rooms" 
          description="Queen size bed in a room with shared bathroom." 
          image={roomQueenImage} 
          quantity={roomSelection.queenSharedQty} 
          maxQuantity={remainingShared + roomSelection.queenSharedQty} 
          onIncrement={() => onSetQueenShared(roomSelection.queenSharedQty + 1)} 
          onDecrement={() => onSetQueenShared(roomSelection.queenSharedQty - 1)} 
        />
        
        {/* Card 3: Twin beds rooms (shared bathroom) */}
        <RoomTypeCard 
          title="Twins (shared bathroom)" 
          description="Two single beds in a room with shared bathroom." 
          image={roomTwinsImage} 
          quantity={roomSelection.twinsSharedQty} 
          maxQuantity={remainingShared + roomSelection.twinsSharedQty} 
          onIncrement={() => onSetTwinsShared(roomSelection.twinsSharedQty + 1)} 
          onDecrement={() => onSetTwinsShared(roomSelection.twinsSharedQty - 1)} 
        />

        {/* Card 4: Queen size with en-suite bathroom (NEW) */}
        <RoomTypeCard 
          title="Queen size (en-suite bathroom)" 
          description="Queen size bed in a room with private en-suite bathroom." 
          image={roomQueenImage} 
          quantity={roomSelection.queenEnsuiteQty} 
          maxQuantity={remainingEnsuite + roomSelection.queenEnsuiteQty} 
          onIncrement={() => onSetQueenEnsuite(roomSelection.queenEnsuiteQty + 1)} 
          onDecrement={() => onSetQueenEnsuite(roomSelection.queenEnsuiteQty - 1)} 
        />

        {/* Card 5: Twin size with en-suite bathroom (NEW) */}
        <RoomTypeCard 
          title="Twins (en-suite bathroom)" 
          description="Two single beds in a room with private en-suite bathroom." 
          image={roomTwinsImage} 
          quantity={roomSelection.twinsEnsuiteQty} 
          maxQuantity={remainingEnsuite + roomSelection.twinsEnsuiteQty} 
          onIncrement={() => onSetTwinsEnsuite(roomSelection.twinsEnsuiteQty + 1)} 
          onDecrement={() => onSetTwinsEnsuite(roomSelection.twinsEnsuiteQty - 1)} 
        />
      </div>

      {/* Validation Errors */}
      {!isSharedValid && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 mb-4">
          <p className="text-sm text-destructive font-medium">
            Only 6 rooms with shared bathrooms are available.
          </p>
        </div>
      )}
      
      {!isEnsuiteValid && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 mb-4">
          <p className="text-sm text-destructive font-medium">
            Only 3 rooms with en-suite bathrooms are available.
          </p>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-6 border-t border-border">
        <Button variant="outline" onClick={onPrev} className="gap-2">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        <Button onClick={onNext} disabled={!isSelectionValid} className="gap-2">
          View Summary
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
