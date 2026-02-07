import { useState, useMemo, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { 
  UserInfo, 
  RoomSelection, 
  RoomStats, 
  RoomPlan,
  initialUserInfo, 
  initialRoomSelection,
  generateRoomPlan,
  MAX_SHARED_ROOMS,
  MAX_ENSUITE_ROOMS
} from '@/types/room';

export function useRoomPlanner() {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [currentStep, setCurrentStep] = useState<'form' | 'rooms' | 'summary'>('form');
  const [userInfo, setUserInfo] = useState<UserInfo>(initialUserInfo);
  const [roomSelection, setRoomSelection] = useState<RoomSelection>(initialRoomSelection);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [recordId, setRecordId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingRecord, setIsLoadingRecord] = useState(false);

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

  // Validation
  const isEmailValid = useMemo(() => {
    // Email comes from auth, always valid if user exists
    return !!user?.email;
  }, [user]);

  const isNameValid = useMemo(() => {
    return userInfo.fullName.trim().length >= 2;
  }, [userInfo.fullName]);

  // Shared bathroom constraint: max 6
  const isSharedValid = useMemo(() => {
    return roomSelection.queenSharedQty + roomSelection.twinsSharedQty <= MAX_SHARED_ROOMS;
  }, [roomSelection]);

  // En-suite constraint: max 3
  const isEnsuiteValid = useMemo(() => {
    return roomSelection.queenEnsuiteQty + roomSelection.twinsEnsuiteQty <= MAX_ENSUITE_ROOMS;
  }, [roomSelection]);

  const isSelectionValid = isSharedValid && isEnsuiteValid;

  const canProceed = isEmailValid && isNameValid;
  const canSubmit = canProceed && isSelectionValid;

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

  // Save to database (upsert for logged-in user)
  const saveToDatabase = useCallback(async (status: 'draft' | 'submitted') => {
    if (!user) throw new Error('User not authenticated');
    
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
      full_name: userInfo.fullName.trim(),
      remarks: userInfo.remarks.trim() || null,
      queen_shared_qty: roomSelection.queenSharedQty,
      twins_shared_qty: roomSelection.twinsSharedQty,
      queen_ensuite_qty: roomSelection.queenEnsuiteQty,
      twins_ensuite_qty: roomSelection.twinsEnsuiteQty,
      room_plan: roomPlanJson,
      status,
      edit_token: `user-${user.id}`, // Legacy field, use user_id for lookup
    };

    let result;
    
    if (recordId) {
      // Update existing record
      const { data, error } = await supabase
        .from('room_setups')
        .update(recordData)
        .eq('id', recordId)
        .select()
        .single();
      
      if (error) throw error;
      result = data;
    } else {
      // Insert new record
      const { data, error } = await supabase
        .from('room_setups')
        .insert([recordData])
        .select()
        .single();
      
      if (error) throw error;
      result = data;
    }

    setRecordId(result.id);
    return { record: result };
  }, [user, recordId, userInfo, roomSelection, roomPlan]);

  // Send emails via edge function (only on submit, no edit links)
  const sendEmails = useCallback(async () => {
    if (!user) return;
    
    try {
      const payload = {
        action: 'submit',
        fullName: userInfo.fullName.trim(),
        email: user.email || '',
        remarks: userInfo.remarks.trim() || undefined,
        stats: {
          kingsFixed: stats.kingsFixed,
          queenSharedCount: stats.queenSharedCount,
          twinsSharedCount: stats.twinsSharedCount,
          queenEnsuiteCount: stats.queenEnsuiteCount,
          twinsEnsuiteCount: stats.twinsEnsuiteCount,
          notSetCount: stats.notSetCount,
        },
      };

      const response = await supabase.functions.invoke('send-room-setup-emails', {
        body: payload,
      });

      if (response.error) {
        console.error('Email sending error:', response.error);
      } else {
        console.log('Emails sent successfully:', response.data);
      }
    } catch (error) {
      console.error('Failed to send emails:', error);
    }
  }, [user, userInfo, stats]);

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
        // Populate form with saved data
        setUserInfo({
          fullName: data.full_name,
          email: data.email,
          remarks: data.remarks || '',
        });

        setRoomSelection({
          kingRoomsQty: 2,
          queenSharedQty: data.queen_shared_qty,
          twinsSharedQty: data.twins_shared_qty,
          queenEnsuiteQty: data.queen_ensuite_qty,
          twinsEnsuiteQty: data.twins_ensuite_qty,
        });

        setRecordId(data.id);
        setIsSubmitted(data.status === 'submitted');
        setIsSaved(true);

        // If already submitted, show summary; otherwise start at form
        if (data.status === 'submitted') {
          setCurrentStep('summary');
        }
      } else {
        // Pre-fill email from user
        setUserInfo(prev => ({ ...prev, email: user.email || '' }));
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

  // Handle save (draft)
  const handleSave = useCallback(async () => {
    if (!canSubmit || isLoading) return;
    
    setIsLoading(true);
    
    try {
      await saveToDatabase('draft');
      setIsSaved(true);
      
      toast({
        title: 'Saved',
        description: 'You can come back anytime by logging in.',
      });
    } catch (error: any) {
      console.error('Save error:', error);
      toast({
        title: 'Save failed',
        description: error.message || 'Something went wrong. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [canSubmit, isLoading, saveToDatabase, toast]);

  // Submit handler
  const handleSubmit = useCallback(async () => {
    if (!canSubmit || isLoading) return;
    
    setIsLoading(true);
    
    try {
      await saveToDatabase('submitted');
      await sendEmails();
      setIsSubmitted(true);
      
      toast({
        title: 'Setup submitted successfully',
        description: 'Confirmation emails have been sent.',
      });
    } catch (error: any) {
      console.error('Submit error:', error);
      toast({
        title: 'Submission failed',
        description: error.message || 'Something went wrong. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [canSubmit, isLoading, saveToDatabase, sendEmails, toast]);

  // Reset everything
  const resetAll = useCallback(() => {
    setCurrentStep('form');
    setUserInfo(prev => ({ ...prev, fullName: '', remarks: '' }));
    setRoomSelection(initialRoomSelection);
    setIsSubmitted(false);
    setIsSaved(false);
    setRecordId(null);
  }, []);

  return {
    // State
    currentStep,
    setCurrentStep,
    userInfo,
    setUserInfo,
    roomSelection,
    roomPlan,
    isSubmitted,
    isSaved,
    stats,
    isLoading,
    isLoadingRecord,
    
    // Validation
    isEmailValid,
    isNameValid,
    isSharedValid,
    isEnsuiteValid,
    isSelectionValid,
    canProceed,
    canSubmit,
    
    // Actions
    setQueenShared,
    setTwinsShared,
    setQueenEnsuite,
    setTwinsEnsuite,
    handleSave,
    handleSubmit,
    resetAll,
  };
}
