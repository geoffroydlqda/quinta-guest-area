import { useState, useMemo, useCallback } from 'react';
import { RoomConfig, EventInfo, RoomStats, initialRooms, initialEventInfo, BedType } from '@/types/room';

export function useRoomPlanner() {
  const [currentStep, setCurrentStep] = useState<'events' | 'form' | 'rooms' | 'summary'>('events');
  const [eventInfo, setEventInfo] = useState<EventInfo>(initialEventInfo);
  const [rooms, setRooms] = useState<RoomConfig[]>(initialRooms);
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [editUrl, setEditUrl] = useState<string | null>(null);

  // Calculate room statistics
  const stats: RoomStats = useMemo(() => {
    return rooms.reduce(
      (acc, room) => {
        if (room.bedType === 'king' && room.isFixed) {
          acc.kingsFixed++;
        } else if (room.bedType === 'queen') {
          acc.queensCount++;
        } else if (room.bedType === 'twin') {
          acc.twinsCount++;
        } else if (!room.isFixed && !room.bedType) {
          acc.unselectedCount++;
        }
        return acc;
      },
      { kingsFixed: 0, queensCount: 0, twinsCount: 0, unselectedCount: 0 }
    );
  }, [rooms]);

  // Update a room configuration
  const updateRoom = useCallback((roomId: number, updates: Partial<RoomConfig>) => {
    setRooms((prev) =>
      prev.map((room) => (room.id === roomId ? { ...room, ...updates } : room))
    );
  }, []);

  // Reset a room to unconfigured state
  const resetRoom = useCallback((roomId: number) => {
    setRooms((prev) =>
      prev.map((room) => {
        if (room.id !== roomId) return room;
        if (room.isFixed) return room;
        return {
          ...room,
          bedType: null,
        };
      })
    );
  }, []);

  // Update room bed type
  const setRoomBedType = useCallback((roomId: number, bedType: BedType) => {
    updateRoom(roomId, { bedType });
  }, [updateRoom]);

  // Check if event info is valid (email required)
  const isEmailValid = useMemo(() => {
    const email = eventInfo.organizerEmail.trim();
    return email !== '' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }, [eventInfo.organizerEmail]);

  // Select an event
  const selectEvent = useCallback((eventName: string) => {
    setEventInfo((prev) => ({ ...prev, eventName }));
    setCurrentStep('form');
  }, []);

  // Go back to event selection
  const goBackToEvents = useCallback(() => {
    setCurrentStep('events');
    setEventInfo(initialEventInfo);
    setRooms(initialRooms);
    setIsSubmitted(false);
    setIsSaved(false);
    setEditUrl(null);
  }, []);

  // Generate edit URL
  const generateEditUrl = useCallback(() => {
    const baseUrl = window.location.origin;
    const recordId = `edit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    return `${baseUrl}?edit=${recordId}`;
  }, []);

  // Handle save for later
  const handleSave = useCallback(() => {
    if (!isEmailValid) return;
    
    const url = generateEditUrl();
    setEditUrl(url);
    setIsSaved(true);
    
    // Here you would send the email with the edit link
    console.log('Saving setup for:', eventInfo.eventName);
    console.log('Organizer email:', eventInfo.organizerEmail);
    console.log('Edit URL:', url);
    console.log('Admin email: hello@quintamor.com');
  }, [isEmailValid, eventInfo, generateEditUrl]);

  // Submit handler
  const handleSubmit = useCallback(() => {
    if (!isEmailValid) return;
    
    const url = editUrl || generateEditUrl();
    setEditUrl(url);
    setIsSubmitted(true);
    
    // Here you would send the housekeeping summary email
    console.log('Submitting final setup for:', eventInfo.eventName);
    console.log('Organizer email:', eventInfo.organizerEmail);
    console.log('Admin email: hello@quintamor.com');
    console.log('Rooms:', rooms);
    console.log('Stats:', stats);
  }, [isEmailValid, eventInfo, rooms, stats, editUrl, generateEditUrl]);

  // Reset everything
  const resetAll = useCallback(() => {
    setCurrentStep('events');
    setEventInfo(initialEventInfo);
    setRooms(initialRooms);
    setSelectedRoomId(null);
    setIsSubmitted(false);
    setIsSaved(false);
    setEditUrl(null);
  }, []);

  return {
    // State
    currentStep,
    setCurrentStep,
    eventInfo,
    setEventInfo,
    rooms,
    selectedRoomId,
    setSelectedRoomId,
    isSubmitted,
    isSaved,
    editUrl,
    stats,
    
    // Validation
    isEmailValid,
    
    // Actions
    selectEvent,
    goBackToEvents,
    updateRoom,
    resetRoom,
    setRoomBedType,
    handleSave,
    handleSubmit,
    resetAll,
  };
}
