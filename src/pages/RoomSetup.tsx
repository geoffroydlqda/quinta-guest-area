import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useGuestProfile } from '@/hooks/useGuestProfile';
import { useRoomPlanner } from '@/hooks/useRoomPlanner';
import { useAutoSave } from '@/hooks/useAutoSave';
import { getGuestStatus } from '@/lib/editLock';
import { ToolPageLayout } from '@/components/guest-area/ToolPageLayout';
import { AutoSaveIndicator } from '@/components/guest-area/AutoSaveIndicator';

import { RoomConfigWarning } from '@/components/guest-area/RoomConfigWarning';
import { RoomTypeCard } from '@/components/room-planner/RoomTypeCard';
import { RoomStats } from '@/components/room-planner/RoomStats';
import { MapLightbox } from '@/components/room-planner/MapLightbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Crown, Info, ZoomIn } from 'lucide-react';
import { MAX_SHARED_ROOMS, MAX_ENSUITE_ROOMS } from '@/types/room';
import roomsArrangement from '@/assets/rooms-arrangement_floor-plan.jpg';
import roomKingImage from '@/assets/room-king.jpg';
import roomTwinsImage from '@/assets/room-queen.jpg';
import roomQueenImage from '@/assets/room-twins.jpg';

const TOTAL_ROOMS = 11; // 2 King (fixed) + 6 shared + 3 ensuite

const RoomSetup = () => {
  const { user, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { profile } = useGuestProfile();
  const [mapOpen, setMapOpen] = useState(false);
  
  const {
    roomSelection,
    stats,
    isSharedValid,
    isEnsuiteValid,
    isSelectionValid,
    setQueenShared,
    setTwinsShared,
    setQueenEnsuite,
    setTwinsEnsuite,
    remarks,
    setRemarks,
    autoSave,
    isLoadingRecord,
  } = useRoomPlanner();

  const { status: saveStatus, triggerSave } = useAutoSave({ onSave: autoSave });
  const guestStatus = getGuestStatus(profile?.check_in_date || null, profile?.status_overall || "draft");
  const isLocked = guestStatus.isEditingLocked;

  // Calculate remaining capacity
  const totalShared = roomSelection.queenSharedQty + roomSelection.twinsSharedQty;
  const totalEnsuite = roomSelection.queenEnsuiteQty + roomSelection.twinsEnsuiteQty;
  const remainingShared = MAX_SHARED_ROOMS - totalShared;
  const remainingEnsuite = MAX_ENSUITE_ROOMS - totalEnsuite;

  // Total configured rooms (2 King fixed + shared + ensuite)
  const totalConfigured = 2 + totalShared + totalEnsuite;

  // Note: Auth redirect is handled by ProtectedRoute in App.tsx

  // Trigger auto-save when selection changes
  useEffect(() => {
    if (!isLocked && !isLoadingRecord) {
      triggerSave();
    }
  }, [roomSelection, remarks]);

  if (authLoading || isLoadingRecord) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <ToolPageLayout
      title="Room Setup"
      description="Configure the bed types for your group's stay"
      isLocked={isLocked}
      statusInfo={guestStatus}
    >
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Room Configuration Warning Banner */}
        <RoomConfigWarning totalConfigured={totalConfigured} targetTotal={TOTAL_ROOMS} />

        {/* Auto-save indicator */}
        <div className="flex justify-end">
          <AutoSaveIndicator status={saveStatus} />
        </div>

        {/* Room Map - Clickable */}
        <div 
          className="rounded-xl overflow-hidden border border-border bg-card cursor-pointer group" 
          onClick={() => setMapOpen(true)}
        >
          <div className="relative">
            <img 
              src={roomsArrangement} 
              alt="Rooms map" 
              className="w-full h-auto max-h-80 object-contain bg-white" 
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
              <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-card/90 rounded-full px-4 py-2 flex items-center gap-2 shadow-lg">
                <ZoomIn className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium">Click to enlarge</span>
              </div>
            </div>
          </div>
        </div>

        <MapLightbox open={mapOpen} onOpenChange={setMapOpen} />

        {/* Info Callouts - compact */}
        <div className="grid gap-2 md:grid-cols-2">
          <div className="rounded-lg bg-muted/50 border border-border px-3 py-2 flex items-start gap-2">
            <Crown className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-snug">
              <span className="font-medium text-foreground">Rooms 1 & 6:</span> fixed King beds, en-suite.
            </p>
          </div>
          <div className="rounded-lg bg-muted/50 border border-border px-3 py-2 flex items-start gap-2">
            <Info className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-snug">
              <span className="font-medium text-foreground">Rooms 7 & 8:</span> upstairs via kitchen, smaller shared bath, best view — often for facilitators.
            </p>
          </div>
        </div>

        {/* Room Stats Summary */}
        <RoomStats stats={stats} />

        {/* 5 Room Type Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 items-stretch">
          <RoomTypeCard 
            title="King (en-suite bathroom)" 
            bedLabel="King size bed"
            bathroomLabel="En-suite bathroom"
            roomsLabel="Rooms: 1 & 6"
            image={roomKingImage} 
            quantity={2} 
            isLocked={true} 
          />
          
          <RoomTypeCard 
            title="King size (shared bathroom)" 
            bedLabel="King size bed"
            bathroomLabel="Shared bathroom"
            roomsLabel="Rooms: 2, 3, 4, 5, 7 & 8"
            image={roomQueenImage} 
            quantity={roomSelection.queenSharedQty} 
            maxQuantity={remainingShared + roomSelection.queenSharedQty} 
            onIncrement={() => !isLocked && setQueenShared(roomSelection.queenSharedQty + 1)} 
            onDecrement={() => !isLocked && setQueenShared(roomSelection.queenSharedQty - 1)} 
            isLocked={isLocked}
          />
          
          <RoomTypeCard 
            title="Twins (shared bathroom)" 
            bedLabel="Twin beds"
            bathroomLabel="Shared bathroom"
            roomsLabel="Rooms: 2, 3, 4, 5, 7 & 8"
            image={roomTwinsImage} 
            quantity={roomSelection.twinsSharedQty} 
            maxQuantity={remainingShared + roomSelection.twinsSharedQty} 
            onIncrement={() => !isLocked && setTwinsShared(roomSelection.twinsSharedQty + 1)} 
            onDecrement={() => !isLocked && setTwinsShared(roomSelection.twinsSharedQty - 1)} 
            isLocked={isLocked}
          />

          <RoomTypeCard 
            title="King size (en-suite bathroom)" 
            bedLabel="King size bed"
            bathroomLabel="En-suite bathroom"
            roomsLabel="Rooms: 9, 10 & 11"
            image={roomQueenImage} 
            quantity={roomSelection.queenEnsuiteQty} 
            maxQuantity={remainingEnsuite + roomSelection.queenEnsuiteQty} 
            onIncrement={() => !isLocked && setQueenEnsuite(roomSelection.queenEnsuiteQty + 1)} 
            onDecrement={() => !isLocked && setQueenEnsuite(roomSelection.queenEnsuiteQty - 1)} 
            isLocked={isLocked}
          />

          <RoomTypeCard 
            title="Twins (en-suite bathroom)" 
            bedLabel="Twin beds"
            bathroomLabel="En-suite bathroom"
            roomsLabel="Rooms: 9, 10 & 11"
            image={roomTwinsImage} 
            quantity={roomSelection.twinsEnsuiteQty} 
            maxQuantity={remainingEnsuite + roomSelection.twinsEnsuiteQty} 
            onIncrement={() => !isLocked && setTwinsEnsuite(roomSelection.twinsEnsuiteQty + 1)} 
            onDecrement={() => !isLocked && setTwinsEnsuite(roomSelection.twinsEnsuiteQty - 1)} 
            isLocked={isLocked}
          />
        </div>

        {/* Validation Errors */}
        {!isSharedValid && (
          <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4">
            <p className="text-sm text-destructive font-medium">
              Only 6 rooms with shared bathrooms are available.
            </p>
          </div>
        )}
        
        {!isEnsuiteValid && (
          <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4">
            <p className="text-sm text-destructive font-medium">
              Only 3 rooms with en-suite bathrooms are available.
            </p>
          </div>
        )}

        {/* Remarks */}
        <div className="bg-card rounded-2xl border border-border p-6">
          <Label htmlFor="remarks" className="text-base font-medium mb-3 block">
            Room setup remarks (optional)
          </Label>
          <Textarea
            id="remarks"
            placeholder="Any special requests or notes for the housekeeping team..."
            value={remarks}
            onChange={(e) => !isLocked && setRemarks(e.target.value)}
            disabled={isLocked}
            rows={3}
          />
        </div>
      </div>
    </ToolPageLayout>
  );
};

export default RoomSetup;
