import { useState, useMemo, useCallback } from 'react';
import { RoomConfig, ReservationInfo, RoomStats, initialRooms, BedType } from '@/types/room';

const initialReservation: ReservationInfo = {
  reservationName: '',
  email: '',
  phone: '',
  stayDates: '',
  numberOfPeople: '',
  generalNotes: '',
};

export function useRoomPlanner() {
  const [currentStep, setCurrentStep] = useState(1);
  const [reservationInfo, setReservationInfo] = useState<ReservationInfo>(initialReservation);
  const [rooms, setRooms] = useState<RoomConfig[]>(initialRooms);
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);

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
        }
        
        if (room.occupant1.trim()) acc.totalOccupants++;
        if (room.occupant2.trim()) acc.totalOccupants++;
        
        return acc;
      },
      { kingsFixed: 0, queensCount: 0, twinsCount: 0, totalOccupants: 0 }
    );
  }, [rooms]);

  // Get all occupant names for duplicate checking
  const allOccupants = useMemo(() => {
    const occupants: { name: string; roomId: number }[] = [];
    rooms.forEach((room) => {
      if (room.occupant1.trim()) {
        occupants.push({ name: room.occupant1.trim().toLowerCase(), roomId: room.id });
      }
      if (room.occupant2.trim()) {
        occupants.push({ name: room.occupant2.trim().toLowerCase(), roomId: room.id });
      }
    });
    return occupants;
  }, [rooms]);

  // Check for duplicate occupant names
  const getDuplicateOccupants = useCallback(() => {
    const duplicates: { name: string; rooms: number[] }[] = [];
    const nameMap = new Map<string, number[]>();
    
    allOccupants.forEach(({ name, roomId }) => {
      const existing = nameMap.get(name) || [];
      nameMap.set(name, [...existing, roomId]);
    });
    
    nameMap.forEach((roomIds, name) => {
      if (roomIds.length > 1) {
        duplicates.push({ name, rooms: [...new Set(roomIds)] });
      }
    });
    
    return duplicates;
  }, [allOccupants]);

  // Check if a room has validation errors
  const getRoomErrors = useCallback((room: RoomConfig): string[] => {
    const errors: string[] = [];
    
    // If bed type is selected (or fixed), at least occupant1 is required
    if (room.bedType && !room.occupant1.trim()) {
      errors.push('Au moins un occupant est requis');
    }
    
    // Check for duplicate names
    const duplicates = getDuplicateOccupants();
    duplicates.forEach(({ name, rooms: duplicateRooms }) => {
      if (duplicateRooms.includes(room.id)) {
        const occupant1Match = room.occupant1.trim().toLowerCase() === name;
        const occupant2Match = room.occupant2.trim().toLowerCase() === name;
        if (occupant1Match || occupant2Match) {
          errors.push(`"${name}" est déjà utilisé dans une autre chambre`);
        }
      }
    });
    
    return errors;
  }, [getDuplicateOccupants]);

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
        return {
          ...room,
          bedType: room.isFixed ? 'king' : null,
          occupant1: '',
          occupant2: '',
          notes: '',
        };
      })
    );
  }, []);

  // Update room bed type
  const setRoomBedType = useCallback((roomId: number, bedType: BedType) => {
    updateRoom(roomId, { bedType });
  }, [updateRoom]);

  // Check if reservation info is valid
  const isReservationValid = useMemo(() => {
    return reservationInfo.reservationName.trim() !== '' && 
           reservationInfo.email.trim() !== '' &&
           /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reservationInfo.email);
  }, [reservationInfo]);

  // Check if rooms configuration is valid
  const isRoomsValid = useMemo(() => {
    const duplicates = getDuplicateOccupants();
    if (duplicates.length > 0) return false;
    
    // Check that all rooms with bed types have at least one occupant
    return rooms.every((room) => {
      if (!room.bedType) return true;
      return room.occupant1.trim() !== '';
    });
  }, [rooms, getDuplicateOccupants]);

  // Get configured rooms only
  const configuredRooms = useMemo(() => {
    return rooms.filter((room) => room.bedType !== null);
  }, [rooms]);

  // Submit handler
  const handleSubmit = useCallback(() => {
    if (isReservationValid && isRoomsValid) {
      setIsSubmitted(true);
    }
  }, [isReservationValid, isRoomsValid]);

  // Reset everything
  const resetAll = useCallback(() => {
    setCurrentStep(1);
    setReservationInfo(initialReservation);
    setRooms(initialRooms);
    setSelectedRoomId(null);
    setIsSubmitted(false);
  }, []);

  return {
    // State
    currentStep,
    setCurrentStep,
    reservationInfo,
    setReservationInfo,
    rooms,
    selectedRoomId,
    setSelectedRoomId,
    isSubmitted,
    stats,
    
    // Validation
    isReservationValid,
    isRoomsValid,
    getRoomErrors,
    getDuplicateOccupants,
    configuredRooms,
    
    // Actions
    updateRoom,
    resetRoom,
    setRoomBedType,
    handleSubmit,
    resetAll,
  };
}
