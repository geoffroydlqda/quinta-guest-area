export type BedType = 'king' | 'queen' | 'twin' | null;
export type BathroomType = 'en-suite' | 'shared';

export interface RoomPlan {
  roomId: number;
  bedType: BedType;
  bathroomType: BathroomType;
  isFixed: boolean;
  note?: string;
}

export interface UserInfo {
  fullName: string;
  email: string;
  remarks: string;
}

export interface RoomSelection {
  kingRoomsQty: number; // Always 2, locked
  queenRoomsQty: number;
  twinsRoomsQty: number;
}

export interface RoomStats {
  kingsFixed: number;
  queensCount: number;
  twinsCount: number;
  notSetCount: number;
}

export const FLEXIBLE_ROOMS_ORDER: Array<{
  id: number;
  bathroomType: BathroomType;
  note?: string;
}> = [
  { id: 2, bathroomType: 'shared' },
  { id: 3, bathroomType: 'shared' },
  { id: 4, bathroomType: 'shared' },
  { id: 5, bathroomType: 'shared' },
  { id: 7, bathroomType: 'shared', note: 'Upstairs' },
  { id: 8, bathroomType: 'shared', note: 'Upstairs' },
  { id: 9, bathroomType: 'en-suite' },
  { id: 10, bathroomType: 'en-suite' },
  { id: 11, bathroomType: 'en-suite' },
];

export const FIXED_ROOMS: Array<{
  id: number;
  bathroomType: BathroomType;
}> = [
  { id: 1, bathroomType: 'en-suite' },
  { id: 6, bathroomType: 'en-suite' },
];

export const MAX_FLEXIBLE_ROOMS = 9;

export const initialUserInfo: UserInfo = {
  fullName: '',
  email: '',
  remarks: '',
};

export const initialRoomSelection: RoomSelection = {
  kingRoomsQty: 2,
  queenRoomsQty: 0,
  twinsRoomsQty: 0,
};

export function generateRoomPlan(selection: RoomSelection): RoomPlan[] {
  const plan: RoomPlan[] = [];
  
  // Add fixed King rooms
  FIXED_ROOMS.forEach((room) => {
    plan.push({
      roomId: room.id,
      bedType: 'king',
      bathroomType: room.bathroomType,
      isFixed: true,
    });
  });
  
  // Assign flexible rooms in order
  let queensAssigned = 0;
  let twinsAssigned = 0;
  
  FLEXIBLE_ROOMS_ORDER.forEach((room) => {
    let bedType: BedType = null;
    
    if (queensAssigned < selection.queenRoomsQty) {
      bedType = 'queen';
      queensAssigned++;
    } else if (twinsAssigned < selection.twinsRoomsQty) {
      bedType = 'twin';
      twinsAssigned++;
    }
    
    plan.push({
      roomId: room.id,
      bedType,
      bathroomType: room.bathroomType,
      isFixed: false,
      note: room.note,
    });
  });
  
  // Sort by room ID
  return plan.sort((a, b) => a.roomId - b.roomId);
}
