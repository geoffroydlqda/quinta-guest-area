import { useState } from 'react';
import { RoomSelection, RoomStats as RoomStatsType, MAX_FLEXIBLE_ROOMS } from '@/types/room';
import { RoomTypeCard } from './RoomTypeCard';
import { RoomStats } from './RoomStats';
import { MapLightbox } from './MapLightbox';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, Crown, Home, Bath, ZoomIn } from 'lucide-react';
import roomsArrangement from '@/assets/rooms-arrangement.png';
import roomKingImage from '@/assets/room-king.jpg';
import roomTwinsImage from '@/assets/room-queen.jpg';
import roomQueenImage from '@/assets/room-twins.jpg';

interface RoomConfigurationProps {
  roomSelection: RoomSelection;
  stats: RoomStatsType;
  isSelectionValid: boolean;
  onSetQueenRooms: (qty: number) => void;
  onSetTwinsRooms: (qty: number) => void;
  onPrev: () => void;
  onNext: () => void;
}

export function RoomConfiguration({
  roomSelection,
  stats,
  isSelectionValid,
  onSetQueenRooms,
  onSetTwinsRooms,
  onPrev,
  onNext,
}: RoomConfigurationProps) {
  const [mapOpen, setMapOpen] = useState(false);
  
  const totalSelected = roomSelection.queenRoomsQty + roomSelection.twinsRoomsQty;
  const remainingFlexible = MAX_FLEXIBLE_ROOMS - totalSelected;

  return (
    <div className="animate-fade-up">
      <div className="text-center mb-6">
        <h2 className="text-3xl md:text-4xl mb-3">Room Configuration</h2>
        <p className="text-muted-foreground">
          Select how many rooms should be prepared with each bed type.
        </p>
      </div>

      {/* Room Map - Clickable */}
      <div 
        className="rounded-xl overflow-hidden border border-border bg-card mb-6 cursor-pointer group"
        onClick={() => setMapOpen(true)}
      >
        <div className="relative">
          <img
            src={roomsArrangement}
            alt="Rooms map (1-11)"
            className="w-full h-auto max-h-80 object-contain bg-white"
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
            <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-card/90 rounded-full px-4 py-2 flex items-center gap-2 shadow-lg">
              <ZoomIn className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">Click to enlarge</span>
            </div>
          </div>
        </div>
        <div className="p-3 text-center border-t border-border">
          <p className="text-sm font-medium mb-1">Rooms map (1–11)</p>
          <p className="text-xs text-muted-foreground">
            Rooms 1 & 6 are fixed King beds (2 rooms). Rooms 2–5 and 7–11 are flexible (9 rooms total).
          </p>
        </div>
      </div>

      <MapLightbox open={mapOpen} onOpenChange={setMapOpen} />

      {/* Info Callouts - Under the Map */}
      <div className="grid gap-3 md:grid-cols-3 mb-6">
        {/* Callout A - King rooms */}
        <div className="rounded-xl bg-primary/10 border-2 border-primary/30 p-4">
          <div className="flex items-start gap-3">
            <Crown className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm mb-1">King rooms are fixed</p>
              <p className="text-xs text-muted-foreground">
                Rooms 1 & 6 are always King beds and have en-suite bathrooms.
              </p>
            </div>
          </div>
        </div>

        {/* Callout B - Rooms 7 & 8 */}
        <div className="rounded-xl bg-primary/10 border-2 border-primary/30 p-4">
          <div className="flex items-start gap-3">
            <Home className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm mb-1">Rooms 7 & 8</p>
              <p className="text-xs text-muted-foreground">
                Upstairs, accessed through the kitchen.
              </p>
            </div>
          </div>
        </div>

        {/* Callout C - Bathroom note */}
        <div className="rounded-xl bg-primary/10 border-2 border-primary/30 p-4">
          <div className="flex items-start gap-3">
            <Bath className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm mb-1">Shared bathroom note</p>
              <p className="text-xs text-muted-foreground">
                The shared bathroom for Rooms 7 & 8 is slightly smaller. These rooms are often reserved for facilitators and have the best view.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <RoomStats stats={stats} className="mb-6" />

      {/* 3 Room Type Cards */}
      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <RoomTypeCard
          title="King rooms (fixed)"
          description="Rooms 1 & 6 are fixed as King beds (en-suite bathrooms)."
          image={roomKingImage}
          quantity={2}
          isLocked={true}
        />
        
        <RoomTypeCard
          title="Queen size bed rooms"
          description="Select how many flexible rooms should be prepared with 1 queen bed."
          image={roomQueenImage}
          quantity={roomSelection.queenRoomsQty}
          maxQuantity={remainingFlexible + roomSelection.queenRoomsQty}
          onIncrement={() => onSetQueenRooms(roomSelection.queenRoomsQty + 1)}
          onDecrement={() => onSetQueenRooms(roomSelection.queenRoomsQty - 1)}
        />
        
        <RoomTypeCard
          title="Twin beds rooms"
          description="Select how many flexible rooms should be prepared as 2 single beds."
          image={roomTwinsImage}
          quantity={roomSelection.twinsRoomsQty}
          maxQuantity={remainingFlexible + roomSelection.twinsRoomsQty}
          onIncrement={() => onSetTwinsRooms(roomSelection.twinsRoomsQty + 1)}
          onDecrement={() => onSetTwinsRooms(roomSelection.twinsRoomsQty - 1)}
        />
      </div>

      {/* Validation Error */}
      {!isSelectionValid && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 mb-6">
          <p className="text-sm text-destructive font-medium">
            The total of Queen and Twin rooms cannot exceed 9 flexible rooms.
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
