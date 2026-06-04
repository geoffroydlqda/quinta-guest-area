import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useGuestProfile } from '@/hooks/useGuestProfile';
import { useRoomPlanner, FlexibleBed } from '@/hooks/useRoomPlanner';
import { useAutoSave } from '@/hooks/useAutoSave';
import { getGuestStatus } from '@/lib/editLock';
import { ToolPageLayout } from '@/components/guest-area/ToolPageLayout';
import { AutoSaveIndicator } from '@/components/guest-area/AutoSaveIndicator';
import { RoomConfigWarning } from '@/components/guest-area/RoomConfigWarning';
import { RoomStats } from '@/components/room-planner/RoomStats';
import { MapLightbox } from '@/components/room-planner/MapLightbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Crown, Info, ZoomIn, ShowerHead, Lock, Plus, X, User } from 'lucide-react';
import { FIXED_ROOMS, FLEXIBLE_ROOMS_ORDER } from '@/types/room';
import { cn } from '@/lib/utils';
import roomsArrangement from '@/assets/rooms-arrangement_floor-plan.jpg';
import roomKingImage from '@/assets/room-king.jpg';
import roomQueenImage from '@/assets/room-queen.jpg';
import roomTwinsImage from '@/assets/room-twins.jpg';

const TOTAL_ROOMS = 11;

const MAX_GUESTS_PER_ROOM = 2;

interface RoomCardProps {
  roomId: number;
  bathroomType: 'en-suite' | 'shared';
  note?: string;
  bedType: FlexibleBed;
  isFixed?: boolean;
  isLocked: boolean;
  onChange?: (bed: FlexibleBed) => void;
  guests: string[];
  onAddGuest: () => void;
  onUpdateGuest: (index: number, name: string) => void;
  onRemoveGuest: (index: number) => void;
}

function RoomCard({ roomId, bathroomType, note, bedType, isFixed = false, isLocked, onChange, guests, onAddGuest, onUpdateGuest, onRemoveGuest }: RoomCardProps) {
  const image =
    roomId === 1 || roomId === 6
      ? roomKingImage
      : bedType === 'king'
        ? roomTwinsImage
        : roomQueenImage;
  const disabled = isLocked || isFixed;

  return (
    <div className="bg-card rounded-2xl shadow-elegant overflow-hidden border border-border flex flex-col h-full">
      <div className="relative aspect-square w-full overflow-hidden">
        <img src={image} alt={`Room ${roomId}`} className="w-full h-full object-cover transition-opacity" />
        {isFixed && (
          <Badge className="absolute top-3 right-3 bg-primary text-primary-foreground gap-1">
            <Lock className="w-3 h-3" />
            Locked
          </Badge>
        )}
      </div>
      <div className="p-4 flex flex-col flex-1">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-medium">
            Room {roomId}
            {note && <span className="text-sm text-muted-foreground font-normal"> · {note}</span>}
          </h3>
        </div>
        <ul className="space-y-1.5 text-sm text-muted-foreground mb-4">
          <li className="flex items-center gap-2">
            <ShowerHead className="w-4 h-4 flex-shrink-0" />
            <span>{bathroomType === 'en-suite' ? 'En-suite bathroom' : 'Shared bathroom'}</span>
          </li>
        </ul>
        <div className="mt-auto pt-4 border-t border-border">
          {isFixed ? (
            <div className="flex items-center justify-center gap-2 text-sm font-medium">
              <Crown className="w-4 h-4 text-primary" />
              King · en-suite
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={bedType === 'twin' ? 'default' : 'outline'}
                size="sm"
                disabled={disabled}
                onClick={() => onChange?.('twin')}
                className={cn(bedType === 'twin' && 'pointer-events-none')}
              >
                Twin
              </Button>
              <Button
                type="button"
                variant={bedType === 'king' ? 'default' : 'outline'}
                size="sm"
                disabled={disabled}
                onClick={() => onChange?.('king')}
                className={cn(bedType === 'king' && 'pointer-events-none')}
              >
                King
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const RoomSetup = () => {
  const { isLoading: authLoading } = useAuth();
  const { profile } = useGuestProfile();
  const [mapOpen, setMapOpen] = useState(false);

  const {
    roomBedMap,
    setRoomBed,
    stats,
    remarks,
    setRemarks,
    autoSave,
    isLoadingRecord,
  } = useRoomPlanner();

  const { status: saveStatus, triggerSave } = useAutoSave({ onSave: autoSave });
  const guestStatus = getGuestStatus(profile?.check_in_date || null, profile?.status_overall || 'draft');
  const isLocked = guestStatus.isEditingLocked;

  useEffect(() => {
    if (!isLocked && !isLoadingRecord) {
      triggerSave();
    }
  }, [roomBedMap, remarks]);

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
      description="Choose the bed type for each room"
      isLocked={isLocked}
      statusInfo={guestStatus}
    >
      <div className="max-w-5xl mx-auto space-y-6">
        <RoomConfigWarning totalConfigured={TOTAL_ROOMS} targetTotal={TOTAL_ROOMS} />

        <div className="flex justify-end">
          <AutoSaveIndicator status={saveStatus} />
        </div>

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

        <RoomStats stats={stats} />

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 items-stretch">
          {/* All 11 rooms in numeric order */}
          {[...FIXED_ROOMS.map((r) => ({ ...r, isFixed: true as const, note: undefined as string | undefined })),
            ...FLEXIBLE_ROOMS_ORDER.map((r) => ({ ...r, isFixed: false as const }))]
            .sort((a, b) => a.id - b.id)
            .map((r) =>
              r.isFixed ? (
                <RoomCard
                  key={r.id}
                  roomId={r.id}
                  bathroomType={r.bathroomType}
                  bedType="king"
                  isFixed
                  isLocked={isLocked}
                />
              ) : (
                <RoomCard
                  key={r.id}
                  roomId={r.id}
                  bathroomType={r.bathroomType}
                  note={r.note}
                  bedType={roomBedMap[r.id] || 'twin'}
                  isLocked={isLocked}
                  onChange={(bed) => setRoomBed(r.id, bed)}
                />
              ),
            )}
        </div>

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
