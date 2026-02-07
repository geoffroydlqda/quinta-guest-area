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

// Updated room selection with 5-card structure
export interface RoomSelection {
  kingRoomsQty: number; // Always 2, locked
  queenSharedQty: number; // Queen with shared bathroom (max 6)
  twinsSharedQty: number; // Twins with shared bathroom (max 6)
  queenEnsuiteQty: number; // Queen with en-suite (max 3)
  twinsEnsuiteQty: number; // Twins with en-suite (max 3)
}

// Updated stats for the new structure
export interface RoomStats {
  kingsFixed: number;
  queenSharedCount: number;
  twinsSharedCount: number;
  queenEnsuiteCount: number;
  twinsEnsuiteCount: number;
  totalShared: number;
  totalEnsuite: number;
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

export const MAX_SHARED_ROOMS = 6;
export const MAX_ENSUITE_ROOMS = 3;
export const MAX_FLEXIBLE_ROOMS = 9;

export const initialUserInfo: UserInfo = {
  fullName: '',
  email: '',
  remarks: '',
};

export const initialRoomSelection: RoomSelection = {
  kingRoomsQty: 2,
  queenSharedQty: 0,
  twinsSharedQty: 0,
  queenEnsuiteQty: 0,
  twinsEnsuiteQty: 0,
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
  let queensSharedAssigned = 0;
  let twinsSharedAssigned = 0;
  let queensEnsuiteAssigned = 0;
  let twinsEnsuiteAssigned = 0;
  
  FLEXIBLE_ROOMS_ORDER.forEach((room) => {
    let bedType: BedType = null;
    
    if (room.bathroomType === 'shared') {
      if (queensSharedAssigned < selection.queenSharedQty) {
        bedType = 'queen';
        queensSharedAssigned++;
      } else if (twinsSharedAssigned < selection.twinsSharedQty) {
        bedType = 'twin';
        twinsSharedAssigned++;
      }
    } else {
      // en-suite
      if (queensEnsuiteAssigned < selection.queenEnsuiteQty) {
        bedType = 'queen';
        queensEnsuiteAssigned++;
      } else if (twinsEnsuiteAssigned < selection.twinsEnsuiteQty) {
        bedType = 'twin';
        twinsEnsuiteAssigned++;
      }
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
