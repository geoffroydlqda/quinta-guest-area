import { useState, useMemo, useCallback } from 'react';
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
  const [currentStep, setCurrentStep] = useState<'form' | 'rooms' | 'summary'>('form');
  const [userInfo, setUserInfo] = useState<UserInfo>(initialUserInfo);
  const [roomSelection, setRoomSelection] = useState<RoomSelection>(initialRoomSelection);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [editUrl, setEditUrl] = useState<string | null>(null);

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

  // Generate edit URL
  const generateEditUrl = useCallback(() => {
    const baseUrl = window.location.origin;
    const recordId = `edit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    return `${baseUrl}?edit=${recordId}`;
  }, []);

  // Handle save for later
  const handleSave = useCallback(() => {
    if (!canSubmit) return;
    
    const url = generateEditUrl();
    setEditUrl(url);
    setIsSaved(true);
    
    console.log('Saving setup for:', userInfo.fullName);
    console.log('Email:', userInfo.email);
    console.log('Edit URL:', url);
    console.log('Room selection:', roomSelection);
    console.log('Generated plan:', roomPlan);
    console.log('Admin email: hello@quintamor.com');
  }, [canSubmit, userInfo, roomSelection, roomPlan, generateEditUrl]);

  // Submit handler
  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    
    const url = editUrl || generateEditUrl();
    setEditUrl(url);
    setIsSubmitted(true);
    
    console.log('Submitting final setup for:', userInfo.fullName);
    console.log('Email:', userInfo.email);
    console.log('Remarks:', userInfo.remarks);
    console.log('Admin email: hello@quintamor.com');
    console.log('Room selection:', roomSelection);
    console.log('Generated plan:', roomPlan);
    console.log('Stats:', stats);
  }, [canSubmit, userInfo, roomSelection, roomPlan, stats, editUrl, generateEditUrl]);

  // Reset everything
  const resetAll = useCallback(() => {
    setCurrentStep('form');
    setUserInfo(initialUserInfo);
    setRoomSelection(initialRoomSelection);
    setIsSubmitted(false);
    setIsSaved(false);
    setEditUrl(null);
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
