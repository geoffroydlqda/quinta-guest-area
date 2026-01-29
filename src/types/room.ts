export type BedType = 'king' | 'queen' | 'twin' | null;

export interface RoomConfig {
  id: number;
  name: string;
  bedType: BedType;
  isFixed: boolean;
  occupant1: string;
  occupant2: string;
  notes: string;
}

export interface ReservationInfo {
  reservationName: string;
  email: string;
  phone: string;
  stayDates: string;
  numberOfPeople: string;
  generalNotes: string;
}

export interface RoomStats {
  kingsFixed: number;
  queensCount: number;
  twinsCount: number;
  totalOccupants: number;
}

export const FIXED_KING_ROOMS = [1, 6];

export const initialRooms: RoomConfig[] = Array.from({ length: 11 }, (_, i) => {
  const roomNumber = i + 1;
  const isFixed = FIXED_KING_ROOMS.includes(roomNumber);
  return {
    id: roomNumber,
    name: `Chambre ${roomNumber}`,
    bedType: isFixed ? 'king' : null,
    isFixed,
    occupant1: '',
    occupant2: '',
    notes: '',
  };
});
