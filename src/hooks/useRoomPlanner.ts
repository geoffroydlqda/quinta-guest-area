import { useState, useMemo, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveBooking } from '@/contexts/BookingContext';
import {
  RoomStats,
  RoomPlan,
  FLEXIBLE_ROOMS_ORDER,
  FIXED_ROOMS,
  MAX_SHARED_ROOMS,
  MAX_ENSUITE_ROOMS,
} from '@/types/room';
import { triggerSheetsSync } from '@/lib/sheetsSync';

export type FlexibleBed = 'twin' | 'king';
export type RoomBedMap = Record<number, FlexibleBed>;
export type RoomGuestsMap = Record<number, string[]>;

const ALL_ROOM_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MAX_GUESTS_PER_ROOM = 2;

function defaultRoomGuestsMap(): RoomGuestsMap {
  const map: RoomGuestsMap = {};
  ALL_ROOM_IDS.forEach((id) => { map[id] = []; });
  return map;
}

const FLEXIBLE_IDS = FLEXIBLE_ROOMS_ORDER.map((r) => r.id);
const FLEXIBLE_META: Record<number, { bathroomType: 'shared' | 'en-suite'; note?: string }> =
  FLEXIBLE_ROOMS_ORDER.reduce((acc, r) => {
    acc[r.id] = { bathroomType: r.bathroomType, note: r.note };
    return acc;
  }, {} as Record<number, { bathroomType: 'shared' | 'en-suite'; note?: string }>);

function defaultRoomBedMap(): RoomBedMap {
  const map: RoomBedMap = {};
  FLEXIBLE_IDS.forEach((id) => {
    map[id] = 'twin';
  });
  return map;
}

function reconstructFromQuantities(
  queenSharedQty: number,
  twinsSharedQty: number,
  queenEnsuiteQty: number,
  twinsEnsuiteQty: number,
): RoomBedMap {
  const map = defaultRoomBedMap();
  let qs = 0, ts = 0, qe = 0, te = 0;
  FLEXIBLE_ROOMS_ORDER.forEach((room) => {
    if (room.bathroomType === 'shared') {
      if (qs < queenSharedQty) {
        map[room.id] = 'king';
        qs++;
      } else if (ts < twinsSharedQty) {
        map[room.id] = 'twin';
        ts++;
      } else {
        map[room.id] = 'twin';
      }
    } else {
      if (qe < queenEnsuiteQty) {
        map[room.id] = 'king';
        qe++;
      } else if (te < twinsEnsuiteQty) {
        map[room.id] = 'twin';
        te++;
      } else {
        map[room.id] = 'twin';
      }
    }
  });
  return map;
}

export function useRoomPlanner() {
  const { user } = useAuth();
  const { activeBookingId, activeBooking, isImpersonating, impersonatedBooking } = useActiveBooking();
  const { toast } = useToast();

  const [roomBedMap, setRoomBedMap] = useState<RoomBedMap>(defaultRoomBedMap);
  const [roomGuestsMap, setRoomGuestsMap] = useState<RoomGuestsMap>(defaultRoomGuestsMap);
  const [remarks, setRemarks] = useState('');
  const [recordId, setRecordId] = useState<string | null>(null);
  const [isLoadingRecord, setIsLoadingRecord] = useState(true);
  const [disabledRooms, setDisabledRooms] = useState<number[]>(() => {
    const initial = (activeBooking as any)?.disabled_rooms;
    return Array.isArray(initial) ? initial.map(Number) : [];
  });

  const enabledRoomIds = useMemo(
    () => ALL_ROOM_IDS.filter((id) => !disabledRooms.includes(id)),
    [disabledRooms],
  );

  const setRoomBed = useCallback((roomId: number, bedType: FlexibleBed) => {
    if (roomId === 1 || roomId === 6) return;
    setRoomBedMap((prev) => ({ ...prev, [roomId]: bedType }));
  }, []);

  const addGuestToRoom = useCallback((roomId: number) => {
    setRoomGuestsMap((prev) => {
      const current = prev[roomId] || [];
      if (current.length >= MAX_GUESTS_PER_ROOM) return prev;
      return { ...prev, [roomId]: [...current, ''] };
    });
  }, []);

  const updateGuestName = useCallback((roomId: number, index: number, name: string) => {
    setRoomGuestsMap((prev) => {
      const current = prev[roomId] || [];
      if (index < 0 || index >= current.length) return prev;
      const next = [...current];
      next[index] = name;
      return { ...prev, [roomId]: next };
    });
  }, []);

  const removeGuestFromRoom = useCallback((roomId: number, index: number) => {
    setRoomGuestsMap((prev) => {
      const current = prev[roomId] || [];
      if (index < 0 || index >= current.length) return prev;
      return { ...prev, [roomId]: current.filter((_, i) => i !== index) };
    });
  }, []);



  // Derived quantities from the per-room map (excluding disabled rooms)
  const derived = useMemo(() => {
    let queenSharedQty = 0, twinsSharedQty = 0, queenEnsuiteQty = 0, twinsEnsuiteQty = 0;
    FLEXIBLE_IDS.forEach((id) => {
      if (disabledRooms.includes(id)) return;
      const bed = roomBedMap[id];
      const meta = FLEXIBLE_META[id];
      if (meta.bathroomType === 'shared') {
        if (bed === 'king') queenSharedQty++;
        else twinsSharedQty++;
      } else {
        if (bed === 'king') queenEnsuiteQty++;
        else twinsEnsuiteQty++;
      }
    });
    return { queenSharedQty, twinsSharedQty, queenEnsuiteQty, twinsEnsuiteQty };
  }, [roomBedMap, disabledRooms]);

  const stats: RoomStats = useMemo(() => {
    const totalShared = derived.queenSharedQty + derived.twinsSharedQty;
    const totalEnsuite = derived.queenEnsuiteQty + derived.twinsEnsuiteQty;
    const kingsFixed = FIXED_ROOMS.filter((r) => !disabledRooms.includes(r.id)).length;
    return {
      kingsFixed,
      queenSharedCount: derived.queenSharedQty,
      twinsSharedCount: derived.twinsSharedQty,
      queenEnsuiteCount: derived.queenEnsuiteQty,
      twinsEnsuiteCount: derived.twinsEnsuiteQty,
      totalShared,
      totalEnsuite,
      notSetCount: Math.max(0, (MAX_SHARED_ROOMS - totalShared) + (MAX_ENSUITE_ROOMS - totalEnsuite)),
    };
  }, [derived, disabledRooms]);

  const roomPlan: RoomPlan[] = useMemo(() => {
    const plan: RoomPlan[] = [];
    FIXED_ROOMS.forEach((r) => {
      if (disabledRooms.includes(r.id)) return;
      plan.push({
        roomId: r.id,
        bedType: 'king',
        bathroomType: r.bathroomType,
        isFixed: true,
      });
    });
    FLEXIBLE_ROOMS_ORDER.forEach((r) => {
      if (disabledRooms.includes(r.id)) return;
      plan.push({
        roomId: r.id,
        bedType: roomBedMap[r.id],
        bathroomType: r.bathroomType,
        isFixed: false,
        note: r.note,
      });
    });
    return plan.sort((a, b) => a.roomId - b.roomId);
  }, [roomBedMap, disabledRooms]);

  const isSelectionValid = true;

  const loadUserRecord = useCallback(async () => {
    if (!user) return;
    setIsLoadingRecord(true);
    try {
      const baseQuery = supabase.from('room_setups').select('*');
      const scopedQuery = activeBookingId
        ? baseQuery.eq('booking_id', activeBookingId)
        : baseQuery.eq('user_id', user.id);
      const { data, error } = await scopedQuery.maybeSingle();
      if (error) throw error;

      if (data) {
        const plan = Array.isArray(data.room_plan) ? (data.room_plan as any[]) : [];
        let map: RoomBedMap;
        const guestsMap = defaultRoomGuestsMap();
        if (plan.length > 0) {
          map = defaultRoomBedMap();
          plan.forEach((entry) => {
            const id = Number(entry?.roomId);
            if (FLEXIBLE_IDS.includes(id)) {
              map[id] = entry?.bedType === 'king' ? 'king' : 'twin';
            }
            if (ALL_ROOM_IDS.includes(id) && Array.isArray(entry?.guests)) {
              guestsMap[id] = entry.guests
                .filter((g: any) => typeof g === 'string')
                .slice(0, MAX_GUESTS_PER_ROOM);
            }
          });
        } else {
          map = reconstructFromQuantities(
            data.queen_shared_qty || 0,
            data.twins_shared_qty || 0,
            data.queen_ensuite_qty || 0,
            data.twins_ensuite_qty || 0,
          );
        }
        setRoomBedMap(map);
        setRoomGuestsMap(guestsMap);
        setRemarks(data.remarks_roomsetup || data.remarks || '');
        setRecordId(data.id);
      }
    } catch (error: any) {
      console.error('Error loading record:', error);
      toast({
        title: 'Error loading configuration',
        description: 'Something went wrong. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoadingRecord(false);
    }
  }, [user, activeBookingId, toast]);

  useEffect(() => {
    if (user) loadUserRecord();
  }, [user, activeBookingId, loadUserRecord]);

  const autoSave = useCallback(async (): Promise<boolean> => {
    if (!user) return false;
    if (isImpersonating && !activeBookingId) return false;

    const ownerUserId = isImpersonating
      ? (impersonatedBooking?.user_id ?? null)
      : user.id;

    try {
      const roomPlanJson = roomPlan.map((room) => ({
        roomId: room.roomId,
        bedType: room.bedType,
        bathroomType: room.bathroomType,
        isFixed: room.isFixed,
        note: room.note,
        guests: (roomGuestsMap[room.roomId] || [])
          .map((n) => (n || '').trim())
          .filter((n) => n.length > 0),
      }));

      const recordData = {
        user_id: ownerUserId,
        booking_id: activeBookingId,
        email: isImpersonating ? (impersonatedBooking?.email || '') : (user.email || ''),
        full_name: '',
        remarks_roomsetup: remarks.trim() || null,
        queen_shared_qty: derived.queenSharedQty,
        twins_shared_qty: derived.twinsSharedQty,
        queen_ensuite_qty: derived.queenEnsuiteQty,
        twins_ensuite_qty: derived.twinsEnsuiteQty,
        room_plan: roomPlanJson,
        status: 'draft',
        edit_token: ownerUserId ? `user-${ownerUserId}` : `booking-${activeBookingId}`,
      };

      if (recordId) {
        const { error } = await supabase
          .from('room_setups')
          .update(recordData)
          .eq('id', recordId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('room_setups')
          .insert([recordData])
          .select()
          .single();
        if (error) throw error;
        setRecordId(data.id);
      }

      triggerSheetsSync();
      return true;
    } catch (error: any) {
      console.error('Auto-save error:', error);
      return false;
    }
  }, [user, activeBookingId, recordId, roomPlan, roomGuestsMap, derived, remarks, isImpersonating, impersonatedBooking]);

  return {
    roomBedMap,
    setRoomBed,
    roomGuestsMap,
    addGuestToRoom,
    updateGuestName,
    removeGuestFromRoom,
    roomPlan,
    stats,
    remarks,
    setRemarks,
    isLoadingRecord,
    isSelectionValid,
    autoSave,
  };
}
