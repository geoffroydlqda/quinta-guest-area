import { useState, useMemo, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { 
  RoomSelection, 
  RoomStats, 
  RoomPlan,
  initialRoomSelection,
  generateRoomPlan,
  MAX_SHARED_ROOMS,
  MAX_ENSUITE_ROOMS
} from '@/types/room';

export function useRoomPlanner() {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [roomSelection, setRoomSelection] = useState<RoomSelection>(initialRoomSelection);
  const [remarks, setRemarks] = useState('');
  const [recordId, setRecordId] = useState<string | null>(null);
  const [isLoadingRecord, setIsLoadingRecord] = useState(true);

  // Calculate room statistics
  const stats: RoomStats = useMemo(() => {
    const totalShared = roomSelection.queenSharedQty + roomSelection.twinsSharedQty;
    const totalEnsuite = roomSelection.queenEnsuiteQty + roomSelection.twinsEnsuiteQty;
    const notSet = (MAX_SHARED_ROOMS - totalShared) + (MAX_ENSUITE_ROOMS - totalEnsuite);
    
    return {
      kingsFixed: 2,
      queenSharedCount: roomSelection.queenSharedQty,
      twinsSharedCount: roomSelection.twinsSharedQty,
      queenEnsuiteCount: roomSelection.queenEnsuiteQty,
      twinsEnsuiteCount: roomSelection.twinsEnsuiteQty,
      totalShared,
      totalEnsuite,
      notSetCount: Math.max(0, notSet),
    };
  }, [roomSelection]);

  // Generate room plan
  const roomPlan: RoomPlan[] = useMemo(() => {
    return generateRoomPlan(roomSelection);
  }, [roomSelection]);

  // Shared bathroom constraint: max 6
  const isSharedValid = useMemo(() => {
    return roomSelection.queenSharedQty + roomSelection.twinsSharedQty <= MAX_SHARED_ROOMS;
  }, [roomSelection]);

  // En-suite constraint: max 3
  const isEnsuiteValid = useMemo(() => {
    return roomSelection.queenEnsuiteQty + roomSelection.twinsEnsuiteQty <= MAX_ENSUITE_ROOMS;
  }, [roomSelection]);

  const isSelectionValid = isSharedValid && isEnsuiteValid;

  // Update room selection - Shared rooms
  const setQueenShared = useCallback((qty: number) => {
    setRoomSelection((prev) => ({
      ...prev,
      queenSharedQty: Math.max(0, Math.min(MAX_SHARED_ROOMS, qty)),
    }));
  }, []);

  const setTwinsShared = useCallback((qty: number) => {
    setRoomSelection((prev) => ({
      ...prev,
      twinsSharedQty: Math.max(0, Math.min(MAX_SHARED_ROOMS, qty)),
    }));
  }, []);

  // Update room selection - En-suite rooms
  const setQueenEnsuite = useCallback((qty: number) => {
    setRoomSelection((prev) => ({
      ...prev,
      queenEnsuiteQty: Math.max(0, Math.min(MAX_ENSUITE_ROOMS, qty)),
    }));
  }, []);

  const setTwinsEnsuite = useCallback((qty: number) => {
    setRoomSelection((prev) => ({
      ...prev,
      twinsEnsuiteQty: Math.max(0, Math.min(MAX_ENSUITE_ROOMS, qty)),
    }));
  }, []);

  // Load existing record for logged-in user
  const loadUserRecord = useCallback(async () => {
    if (!user) return;
    
    setIsLoadingRecord(true);
    
    try {
      const { data, error } = await supabase
        .from('room_setups')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setRoomSelection({
          kingRoomsQty: 2,
          queenSharedQty: data.queen_shared_qty,
          twinsSharedQty: data.twins_shared_qty,
          queenEnsuiteQty: data.queen_ensuite_qty,
          twinsEnsuiteQty: data.twins_ensuite_qty,
        });
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
  }, [user, toast]);

  // Load user record on mount
  useEffect(() => {
    if (user) {
      loadUserRecord();
    }
  }, [user, loadUserRecord]);

  // Auto-save function (used by useAutoSave hook)
  const autoSave = useCallback(async (): Promise<boolean> => {
    if (!user || !isSelectionValid) return false;
    
    try {
      // Convert room plan to JSON-compatible format
      const roomPlanJson = roomPlan.map(room => ({
        roomId: room.roomId,
        bedType: room.bedType,
        bathroomType: room.bathroomType,
        isFixed: room.isFixed,
        note: room.note,
      }));
      
      const recordData = {
        user_id: user.id,
        email: user.email || '',
        full_name: '', // No longer collecting from room setup
        remarks_roomsetup: remarks.trim() || null,
        queen_shared_qty: roomSelection.queenSharedQty,
        twins_shared_qty: roomSelection.twinsSharedQty,
        queen_ensuite_qty: roomSelection.queenEnsuiteQty,
        twins_ensuite_qty: roomSelection.twinsEnsuiteQty,
        room_plan: roomPlanJson,
        status: 'draft',
        edit_token: `user-${user.id}`,
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

      return true;
    } catch (error: any) {
      console.error('Auto-save error:', error);
      return false;
    }
  }, [user, recordId, roomSelection, roomPlan, remarks, isSelectionValid]);

  return {
    // State
    roomSelection,
    roomPlan,
    stats,
    remarks,
    setRemarks,
    isLoadingRecord,
    
    // Validation
    isSharedValid,
    isEnsuiteValid,
    isSelectionValid,
    
    // Actions
    setQueenShared,
    setTwinsShared,
    setQueenEnsuite,
    setTwinsEnsuite,
    autoSave,
  };
}
