import { useState, useMemo, useCallback } from 'react';
import { 
  UserInfo, 
  RoomSelection, 
  RoomStats, 
  RoomPlan,
  initialUserInfo, 
  initialRoomSelection,
  generateRoomPlan,
  MAX_FLEXIBLE_ROOMS 
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
    const notSet = MAX_FLEXIBLE_ROOMS - roomSelection.queenRoomsQty - roomSelection.twinsRoomsQty;
    return {
      kingsFixed: 2,
      queensCount: roomSelection.queenRoomsQty,
      twinsCount: roomSelection.twinsRoomsQty,
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

  const isSelectionValid = useMemo(() => {
    return roomSelection.queenRoomsQty + roomSelection.twinsRoomsQty <= MAX_FLEXIBLE_ROOMS;
  }, [roomSelection]);

  const canProceed = isEmailValid && isNameValid;
  const canSubmit = canProceed && isSelectionValid;

  // Update room selection
  const setQueenRooms = useCallback((qty: number) => {
    setRoomSelection((prev) => ({
      ...prev,
      queenRoomsQty: Math.max(0, Math.min(MAX_FLEXIBLE_ROOMS, qty)),
    }));
  }, []);

  const setTwinsRooms = useCallback((qty: number) => {
    setRoomSelection((prev) => ({
      ...prev,
      twinsRoomsQty: Math.max(0, Math.min(MAX_FLEXIBLE_ROOMS, qty)),
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
    isSelectionValid,
    canProceed,
    canSubmit,
    
    // Actions
    setQueenRooms,
    setTwinsRooms,
    handleSave,
    handleSubmit,
    resetAll,
  };
}
