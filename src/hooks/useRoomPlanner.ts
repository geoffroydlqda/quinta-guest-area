import { useState, useMemo, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
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
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  
  const [currentStep, setCurrentStep] = useState<'form' | 'rooms' | 'summary'>('form');
  const [userInfo, setUserInfo] = useState<UserInfo>(initialUserInfo);
  const [roomSelection, setRoomSelection] = useState<RoomSelection>(initialRoomSelection);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [editUrl, setEditUrl] = useState<string | null>(null);
  const [editToken, setEditToken] = useState<string | null>(null);
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
    const email = userInfo.email.trim();
    return email !== '' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }, [userInfo.email]);

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

  // Generate edit token
  const generateEditToken = useCallback(() => {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  // Generate edit URL from token
  const generateEditUrl = useCallback((token: string) => {
    const baseUrl = window.location.origin;
    return `${baseUrl}?edit=${token}`;
  }, []);

  // Save to database
  const saveToDatabase = useCallback(async (status: 'draft' | 'submitted') => {
    const token = editToken || generateEditToken();
    const url = generateEditUrl(token);
    
    // Convert room plan to JSON-compatible format
    const roomPlanJson = roomPlan.map(room => ({
      roomId: room.roomId,
      bedType: room.bedType,
      bathroomType: room.bathroomType,
      isFixed: room.isFixed,
      note: room.note,
    }));
    
    const recordData = {
      edit_token: token,
      email: userInfo.email.trim(),
      full_name: userInfo.fullName.trim(),
      remarks: userInfo.remarks.trim() || null,
      queen_shared_qty: roomSelection.queenSharedQty,
      twins_shared_qty: roomSelection.twinsSharedQty,
      queen_ensuite_qty: roomSelection.queenEnsuiteQty,
      twins_ensuite_qty: roomSelection.twinsEnsuiteQty,
      room_plan: roomPlanJson,
      status,
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

    // Update local state
    setEditToken(token);
    setEditUrl(url);
    setRecordId(result.id);

    return { token, url, record: result };
  }, [editToken, recordId, userInfo, roomSelection, roomPlan, generateEditToken, generateEditUrl]);

  // Send emails via edge function
  const sendEmails = useCallback(async (action: 'save' | 'submit', url: string) => {
    try {
      const payload = {
        action,
        fullName: userInfo.fullName.trim(),
        email: userInfo.email.trim(),
        editUrl: url,
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
        // Don't throw - email failure shouldn't block submission
      } else {
        console.log('Emails sent successfully:', response.data);
      }
    } catch (error) {
      console.error('Failed to send emails:', error);
      // Don't throw - email failure shouldn't block submission
    }
  }, [userInfo, stats]);

  // Load existing record from edit token
  const loadFromEditToken = useCallback(async (token: string) => {
    setIsLoadingRecord(true);
    
    try {
      const { data, error } = await supabase
        .from('room_setups')
        .select('*')
        .eq('edit_token', token)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          toast({
            title: 'Record not found',
            description: 'The edit link is invalid or has expired.',
            variant: 'destructive',
          });
        } else {
          throw error;
        }
        return;
      }

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

      setEditToken(token);
      setEditUrl(generateEditUrl(token));
      setRecordId(data.id);
      setIsSubmitted(data.status === 'submitted');
      setIsSaved(true);

      // If already submitted, show summary; otherwise start at form
      if (data.status === 'submitted') {
        setCurrentStep('summary');
      }

      toast({
        title: 'Configuration loaded',
        description: 'Your saved room setup has been restored.',
      });
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
  }, [toast, generateEditUrl]);

  // Check for edit token on mount
  useEffect(() => {
    const editParam = searchParams.get('edit');
    if (editParam) {
      loadFromEditToken(editParam);
    }
  }, [searchParams, loadFromEditToken]);

  // Handle save for later
  const handleSave = useCallback(async () => {
    if (!canSubmit || isLoading) return;
    
    setIsLoading(true);
    
    try {
      const { url } = await saveToDatabase('draft');
      await sendEmails('save', url);
      setIsSaved(true);
      
      toast({
        title: 'Configuration saved',
        description: 'An edit link has been sent to your email.',
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
  }, [canSubmit, isLoading, saveToDatabase, sendEmails, toast]);

  // Submit handler
  const handleSubmit = useCallback(async () => {
    if (!canSubmit || isLoading) return;
    
    setIsLoading(true);
    
    try {
      const { url } = await saveToDatabase('submitted');
      await sendEmails('submit', url);
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
    setUserInfo(initialUserInfo);
    setRoomSelection(initialRoomSelection);
    setIsSubmitted(false);
    setIsSaved(false);
    setEditUrl(null);
    setEditToken(null);
    setRecordId(null);
    
    // Clear URL parameter
    window.history.replaceState({}, '', window.location.pathname);
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
    editUrl,
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
