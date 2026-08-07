import { Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useGuestProfile } from '@/hooks/useGuestProfile';
import { useActiveBooking } from '@/contexts/BookingContext';
import { useRoomPlanner, FlexibleBed } from '@/hooks/useRoomPlanner';
import { useAutoSave } from '@/hooks/useAutoSave';
import { getGuestStatus } from '@/lib/editLock';
import { ToolPageLayout } from '@/components/guest-area/ToolPageLayout';
import { AutoSaveIndicator } from '@/components/guest-area/AutoSaveIndicator';
import { RoomStats } from '@/components/room-planner/RoomStats';
import { MapLightbox } from '@/components/room-planner/MapLightbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Loader2, Crown, Info, ZoomIn, ShowerHead, Lock, Plus, X, Check, User, Users, BedDouble, BedSingle, AlertTriangle, ChevronDown, ChevronUp, Download } from 'lucide-react';
import { FIXED_ROOMS, FLEXIBLE_ROOMS_ORDER } from '@/types/room';
import { cn } from '@/lib/utils';
import roomsArrangement from '@/assets/rooms-arrangement_floor-plan.jpg';
import { downloadRoomMapPdf, renderRoomMapCanvas, type RoomMapEntry } from '@/lib/roomMapPdf';
import roomKingImage from '@/assets/room-king.jpg';
import roomQueenImage from '@/assets/room-queen.jpg';
import roomTwinsImage from '@/assets/room-twins.jpg';

const TOTAL_ROOMS = 11;

const MAX_GUESTS_PER_ROOM = 2;

const BATHROOM_PARTNER: Record<number, number> = {
  2: 3, 3: 2, 4: 5, 5: 4, 7: 8, 8: 7,
};

// Couleur par paire de salle de bain partagée (repère visuel entre cartes jumelles)
const BATHROOM_PAIR_COLOR: Record<number, string> = {
  2: 'bg-sky-500', 3: 'bg-sky-500',
  4: 'bg-rose-400', 5: 'bg-rose-400',
  7: 'bg-amber-500', 8: 'bg-amber-500',
};

// Position des pastilles sur le plan (pourcentages de l'image)
const MAP_PINS: Record<number, { x: number; y: number }> = {
  1: { x: 18.4, y: 39.6 },
  2: { x: 18.4, y: 54.5 },
  3: { x: 18.4, y: 67.9 },
  4: { x: 18.4, y: 83.6 },
  5: { x: 29.2, y: 83.6 },
  6: { x: 46.1, y: 83.6 },
  7: { x: 24.4, y: 5.0 },
  8: { x: 24.4, y: 24.3 },
  9: { x: 60.4, y: 9.3 },
  10: { x: 71.5, y: 9.3 },
  11: { x: 83.5, y: 9.3 },
};

interface RoomCardProps {
  roomId: number;
  bathroomType: 'en-suite' | 'shared';
  note?: string;
  bedType: FlexibleBed;
  isExpanded: boolean;
  onToggle: () => void;
  isFixed?: boolean;
  isLocked: boolean;
  onChange?: (bed: FlexibleBed) => void;
  guests: string[];
  onAddGuest: () => void;
  onUpdateGuest: (index: number, name: string) => void;
  onRemoveGuest: (index: number) => void;
}

function RoomCard({ roomId, bathroomType, note, bedType, isExpanded, onToggle, isFixed = false, isLocked, onChange, guests, onAddGuest, onUpdateGuest, onRemoveGuest }: RoomCardProps) {
  const image =
    roomId === 1 || roomId === 6
      ? roomKingImage
      : bedType === 'king'
        ? roomTwinsImage
        : roomQueenImage;
  const disabled = isLocked || isFixed;
  const namedGuests = guests.filter((n) => n && n.trim().length > 0);
  const [editingGuestIdx, setEditingGuestIdx] = useState<number | null>(null);
  const commitGuest = (idx: number, name: string) => {
    if (name.trim().length === 0) {
      onRemoveGuest(idx);
    } else {
      onUpdateGuest(idx, name.trim());
    }
    setEditingGuestIdx(null);
  };

  // ---- Vue compacte (par défaut) : une ligne dense, clic pour déplier ----
  if (!isExpanded) {
    return (
      <button
        type="button"
        id={`room-card-${roomId}`}
        onClick={onToggle}
        className="w-full bg-card rounded-xl border border-border shadow-sm hover:shadow-md hover:border-primary/40 transition-all scroll-mt-24 text-left"
      >
        <div className="flex items-center gap-3 p-2.5">
          <img src={image} alt="" className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">Room {roomId}</span>
              {isFixed ? (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Crown className="w-3 h-3 text-primary" />King</span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  {bedType === 'twin'
                    ? (<><span className="flex -space-x-0.5"><BedSingle className="w-3 h-3" /><BedSingle className="w-3 h-3" /></span>Twin</>)
                    : (<><BedDouble className="w-3 h-3" />King</>)}
                </span>
              )}
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <ShowerHead className="w-3 h-3" />
                {bathroomType === 'en-suite' ? 'En-suite' : `Shared`}
                {BATHROOM_PAIR_COLOR[roomId] && (
                  <span className={cn('inline-block w-2 h-2 rounded-full', BATHROOM_PAIR_COLOR[roomId])} />
                )}
              </span>
            </div>
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {namedGuests.length > 0
                ? namedGuests.join(', ')
                : 'No guests yet'}
            </p>
          </div>
          {namedGuests.length > 0 && (
            <Badge variant="secondary" className="flex-shrink-0 gap-1"><User className="w-3 h-3" />{namedGuests.length}</Badge>
          )}
          <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        </div>
      </button>
    );
  }

  return (
    <div id={`room-card-${roomId}`} className="bg-card rounded-2xl shadow-elegant overflow-hidden border-2 border-primary/40 flex flex-col sm:flex-row scroll-mt-24">
      <div className="relative w-full sm:w-64 h-48 sm:h-auto sm:self-stretch flex-shrink-0 overflow-hidden">
        <img src={image} alt={`Room ${roomId}`} className="w-full h-full object-cover transition-opacity" />
        {isFixed && (
          <Badge
            className="absolute top-3 right-3 bg-primary text-primary-foreground gap-1 cursor-help"
            title="This room always has a fixed King bed — the bed type cannot be changed."
          >
            <Lock className="w-3 h-3" />
            Fixed King
          </Badge>
        )}
      </div>
      <div className="p-4 flex flex-col flex-1">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-medium">
            Room {roomId}
            {note && <span className="text-sm text-muted-foreground font-normal"> · {note}</span>}
          </h3>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onToggle} aria-label="Collapse">
            <ChevronUp className="w-4 h-4" />
          </Button>
        </div>
        <ul className="space-y-1.5 text-sm text-muted-foreground mb-4">
          <li className="flex items-center gap-2">
            <ShowerHead className="w-4 h-4 flex-shrink-0" />
            <span className="flex items-center gap-1.5">
              {bathroomType === 'en-suite'
                ? 'En-suite bathroom'
                : BATHROOM_PARTNER[roomId]
                  ? `Shared bathroom · with Room ${BATHROOM_PARTNER[roomId]}`
                  : 'Shared bathroom'}
              {BATHROOM_PAIR_COLOR[roomId] && (
                <span
                  className={cn('inline-block w-2.5 h-2.5 rounded-full flex-shrink-0', BATHROOM_PAIR_COLOR[roomId])}
                  title={`Same bathroom as Room ${BATHROOM_PARTNER[roomId]}`}
                />
              )}
            </span>
          </li>
          <li className="flex items-center gap-2">
            <Users className="w-4 h-4 flex-shrink-0" />
            <span>Sleeps up to {MAX_GUESTS_PER_ROOM}</span>
          </li>
        </ul>
        <div className="mt-auto pt-4 border-t border-border space-y-3">
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
                className={cn('gap-1.5', bedType === 'twin' && 'pointer-events-none')}
              >
                <span className="flex -space-x-1"><BedSingle className="w-3.5 h-3.5" /><BedSingle className="w-3.5 h-3.5" /></span>
                Twin
              </Button>
              <Button
                type="button"
                variant={bedType === 'king' ? 'default' : 'outline'}
                size="sm"
                disabled={disabled}
                onClick={() => onChange?.('king')}
                className={cn('gap-1.5', bedType === 'king' && 'pointer-events-none')}
              >
                <BedDouble className="w-3.5 h-3.5" />
                King
              </Button>
            </div>
          )}

          {/* Guests assignment : Enter ou "Assign" valide, le nom devient un badge */}
          <div className="space-y-2">
            {guests.length > 0 && (
              <div className="space-y-1.5">
                {guests.map((name, idx) => {
                  const isEditing = editingGuestIdx === idx || name.trim().length === 0;
                  return isEditing && !isLocked ? (
                    <div key={idx} className="flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <Input
                        type="text"
                        value={name}
                        placeholder="Guest name"
                        autoFocus
                        onChange={(e) => onUpdateGuest(idx, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            commitGuest(idx, name);
                          }
                        }}
                        className="h-8 text-sm"
                      />
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 px-2.5 text-xs gap-1 flex-shrink-0"
                        disabled={name.trim().length === 0}
                        onClick={() => commitGuest(idx, name)}
                      >
                        <Check className="w-3.5 h-3.5" />
                        Assign
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive flex-shrink-0"
                        onClick={() => { setEditingGuestIdx(null); onRemoveGuest(idx); }}
                        aria-label="Remove guest"
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <div key={idx} className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isLocked}
                        onClick={() => !isLocked && setEditingGuestIdx(idx)}
                        title={isLocked ? undefined : 'Click to edit'}
                        className="flex-1 flex items-center gap-2 h-8 px-2.5 rounded-md bg-primary/10 border border-primary/25 text-sm text-left"
                      >
                        <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                        <span className="truncate font-medium">{name}</span>
                        <span className="ml-auto text-[10px] uppercase tracking-wide text-primary/80">Assigned</span>
                      </button>
                      {!isLocked && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive flex-shrink-0"
                          onClick={() => onRemoveGuest(idx)}
                          aria-label="Remove guest"
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {!isLocked && guests.length < MAX_GUESTS_PER_ROOM && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => { setEditingGuestIdx(guests.length); onAddGuest(); }}
                className="w-full h-8 text-xs text-muted-foreground hover:text-foreground gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                Add guest
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const RoomSetup = () => {
  const { isLoading: authLoading } = useAuth();
  const { profile } = useGuestProfile();
  const [mapOpen, setMapOpen] = useState(false);
  const [downloadingMap, setDownloadingMap] = useState(false);
  const [liveMapUrl, setLiveMapUrl] = useState<string | null>(null);

  const {
    roomBedMap,
    setRoomBed,
    roomGuestsMap,
    addGuestToRoom,
    updateGuestName,
    removeGuestFromRoom,
    stats,
    remarks,
    setRemarks,
    autoSave,
    isLoadingRecord,
    disabledRooms,
    enabledRoomIds,
  } = useRoomPlanner();

  const buildMapEntries = (): RoomMapEntry[] =>
    enabledRoomIds.map((id) => ({
      roomId: id,
      guests: (roomGuestsMap[id] || []).map((n) => (n || '').trim()).filter(Boolean),
      bedType: id === 1 || id === 6 ? 'king' : ((roomBedMap[id] || 'twin') as 'king' | 'twin'),
    }));

  const { status: saveStatus, triggerSave } = useAutoSave({ onSave: autoSave });
  // Vue compacte par défaut ; chaque chambre se déplie individuellement
  const [expandedRooms, setExpandedRooms] = useState<Set<number>>(new Set());
  const toggleRoom = (id: number) =>
    setExpandedRooms((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const expandRoom = (id: number) =>
    setExpandedRooms((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));

  // Progression : guests placés vs nombre de guests du séjour
  const guestsPlaced = Object.values(roomGuestsMap)
    .flat()
    .filter((n) => typeof n === 'string' && n.trim().length > 0).length;
  const roomsWithGuests = enabledRoomIds.filter(
    (id) => (roomGuestsMap[id] || []).some((n) => typeof n === 'string' && n.trim().length > 0)
  ).length;
  const targetGuests = profile?.guests_count ?? null;
  const overAssigned = targetGuests !== null && guestsPlaced > targetGuests;
  const remainingGuests = targetGuests !== null ? Math.max(0, targetGuests - guestsPlaced) : 0;
  const lockCtx = useActiveBooking();
  const guestStatus = getGuestStatus(profile?.check_in_date || null, profile?.status_overall || 'draft', {
    unlocked: lockCtx.isImpersonating || !!lockCtx.activeBooking?.edit_lock_override,
  });
  const isLocked = guestStatus.isEditingLocked;

  useEffect(() => {
    if (!isLocked && !isLoadingRecord) {
      triggerSave();
    }
  }, [roomBedMap, roomGuestsMap, remarks]);

  // Plan annoté en direct : même rendu que le PDF (noms + type de lit)
  useEffect(() => {
    if (isLoadingRecord) return;
    const t = setTimeout(async () => {
      try {
        const canvas = await renderRoomMapCanvas(roomsArrangement, buildMapEntries());
        setLiveMapUrl(canvas.toDataURL('image/jpeg', 0.85));
      } catch {
        /* le plan brut reste affiché */
      }
    }, 350);
    return () => clearTimeout(t);
  }, [roomBedMap, roomGuestsMap, disabledRooms, isLoadingRecord]);

  // Garde multi-séjours : sans booking actif, les hooks ne peuvent pas scoper
  // leurs lectures/écritures (maybeSingle multi-lignes = spinner infini,
  // écritures cross-booking) -> sélecteur de séjour, ou dashboard si aucun.
  if (!lockCtx.isLoading && !lockCtx.activeBookingId) {
    if (lockCtx.bookingsPersonal.length > 1) return <Navigate to="/bookings" replace />;
    if (lockCtx.bookings.length === 0) return <Navigate to="/dashboard" replace />;
  }

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
        {targetGuests !== null && (
          <div className="guest-card p-5 space-y-2.5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm font-semibold tabular-nums">
                {guestsPlaced} of {targetGuests} guest{targetGuests !== 1 ? 's' : ''} placed
                <span className="text-muted-foreground font-normal"> · {roomsWithGuests} room{roomsWithGuests !== 1 ? 's' : ''} with guests</span>
              </p>
              <AutoSaveIndicator status={saveStatus} />
            </div>
            <Progress className="h-1.5" value={Math.min(100, targetGuests > 0 ? (guestsPlaced / targetGuests) * 100 : 0)} />
            {overAssigned && (
              <p className="text-sm text-destructive flex items-start gap-1.5">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                You've placed more guests than the {targetGuests} declared for your stay — please review the assignments.
              </p>
            )}
            {!overAssigned && remainingGuests > 0 && (
              <p className="text-sm text-muted-foreground flex items-start gap-1.5">
                <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                {remainingGuests} guest{remainingGuests !== 1 ? 's' : ''} still to place — anyone left unassigned will be arranged by our team.
              </p>
            )}
          </div>
        )}
        {targetGuests === null && (
          <div className="flex justify-end">
            <AutoSaveIndicator status={saveStatus} />
          </div>
        )}

        <div className="guest-card overflow-hidden bg-white group">
          <div className="relative w-fit mx-auto cursor-pointer" onClick={() => setMapOpen(true)}>
            <img
              src={liveMapUrl ?? roomsArrangement}
              alt="Rooms map"
              className="block h-auto max-h-[520px] w-auto"
            />
            {/* Pastilles interactives : vert plein = guests placés, contour = à faire */}
            {Object.entries(MAP_PINS)
              .filter(([id]) => !disabledRooms.includes(Number(id)))
              .map(([id, pos]) => {
                const roomId = Number(id);
                const hasGuests = (roomGuestsMap[roomId] || []).some((n) => n && n.trim().length > 0);
                return (
                  <button
                    key={roomId}
                    type="button"
                    title={`Room ${roomId}${hasGuests ? ' — guests assigned' : ' — no guests yet'}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      expandRoom(roomId);
                      setTimeout(() => {
                        document.getElementById(`room-card-${roomId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }, 60);
                    }}
                    className={cn(
                      'absolute -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-full text-xs font-semibold shadow-md transition-transform hover:scale-125 focus:outline-none focus:ring-2 focus:ring-primary',
                      hasGuests
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-white text-primary border-2 border-primary'
                    )}
                    style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                  >
                    {roomId}
                  </button>
                );
              })}
            <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-card/90 rounded-full px-3 py-1.5 flex items-center gap-1.5 shadow-lg pointer-events-none">
              <ZoomIn className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-medium">Click to enlarge</span>
            </div>
          </div>
          <div className="flex items-center justify-center gap-3 pb-2 flex-wrap">
            <p className="text-center text-xs text-muted-foreground">
              Tap a room number to jump to it · <span className="inline-block w-2.5 h-2.5 rounded-full bg-primary align-middle" /> guests assigned · <span className="inline-block w-2.5 h-2.5 rounded-full border-2 border-primary bg-white align-middle" /> still empty
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              disabled={downloadingMap}
              onClick={async (e) => {
                e.stopPropagation();
                setDownloadingMap(true);
                try {
                  await downloadRoomMapPdf(
                    roomsArrangement,
                    buildMapEntries(),
                    { subtitle: 'Who sleeps where — bring this along for an easy check-in.' },
                  );
                } finally {
                  setDownloadingMap(false);
                }
              }}
            >
              {downloadingMap ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Download map (PDF)
            </Button>
          </div>
        </div>

        <MapLightbox open={mapOpen} onOpenChange={setMapOpen} imageSrc={liveMapUrl} />

        <div className="grid gap-2 md:grid-cols-2">
          <div className="rounded-xl bg-muted/50 border border-border/70 px-3.5 py-2.5 flex items-start gap-2">
            <Crown className="w-4 h-4 text-[#679E3F] flex-shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-snug">
              <span className="font-medium text-foreground">Rooms 1 & 6:</span> fixed King beds, en-suite.
            </p>
          </div>
          <div className="rounded-xl bg-muted/50 border border-border/70 px-3.5 py-2.5 flex items-start gap-2">
            <Info className="w-4 h-4 text-[#679E3F] flex-shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-snug">
              <span className="font-medium text-foreground">Rooms 7 & 8:</span> upstairs via kitchen, smaller shared bath, best view — often for facilitators.
            </p>
          </div>
        </div>

        <RoomStats stats={stats} />

        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Tap a room to open it</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={() =>
              setExpandedRooms((prev) =>
                prev.size > 0 ? new Set() : new Set(enabledRoomIds)
              )
            }
          >
            {expandedRooms.size > 0 ? 'Collapse all' : 'Expand all'}
          </Button>
        </div>
        <div className="space-y-2">
          {/* All 11 rooms in numeric order */}
          {[...FIXED_ROOMS.map((r) => ({ ...r, isFixed: true as const, note: undefined as string | undefined })),
            ...FLEXIBLE_ROOMS_ORDER.map((r) => ({ ...r, isFixed: false as const }))]
            .filter((r) => !disabledRooms.includes(r.id))
            .sort((a, b) => a.id - b.id)
            .map((r) =>
              r.isFixed ? (
                <RoomCard
                  key={r.id}
                  roomId={r.id}
                  bathroomType={r.bathroomType}
                  bedType="king"
                  isExpanded={expandedRooms.has(r.id)}
                  onToggle={() => toggleRoom(r.id)}
                  isFixed
                  isLocked={isLocked}
                  guests={roomGuestsMap[r.id] || []}
                  onAddGuest={() => addGuestToRoom(r.id)}
                  onUpdateGuest={(idx, name) => updateGuestName(r.id, idx, name)}
                  onRemoveGuest={(idx) => removeGuestFromRoom(r.id, idx)}
                />
              ) : (
                <RoomCard
                  key={r.id}
                  roomId={r.id}
                  bathroomType={r.bathroomType}
                  note={r.note}
                  bedType={roomBedMap[r.id] || 'twin'}
                  isExpanded={expandedRooms.has(r.id)}
                  onToggle={() => toggleRoom(r.id)}
                  isLocked={isLocked}
                  onChange={(bed) => setRoomBed(r.id, bed)}
                  guests={roomGuestsMap[r.id] || []}
                  onAddGuest={() => addGuestToRoom(r.id)}
                  onUpdateGuest={(idx, name) => updateGuestName(r.id, idx, name)}
                  onRemoveGuest={(idx) => removeGuestFromRoom(r.id, idx)}
                />
              ),
            )}
        </div>

        <div className="guest-card p-6">
          <Label htmlFor="remarks" className="text-base font-semibold tracking-tight mb-3 block">
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
