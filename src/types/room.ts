export type BedType = 'king' | 'queen' | 'twin' | null;
export type BathroomType = 'en-suite' | 'shared';

export interface RoomConfig {
  id: number;
  name: string;
  bedType: BedType;
  isFixed: boolean;
  bathroomType: BathroomType;
  specialNote?: string;
}

export interface EventInfo {
  eventName: string;
  organizerEmail: string;
  stayDates: string;
  notes: string;
}

export interface RoomStats {
  kingsFixed: number;
  queensCount: number;
  twinsCount: number;
  unselectedCount: number;
}

export const FIXED_KING_ROOMS = [1, 6];
export const EN_SUITE_ROOMS = [1, 6, 9, 10, 11];

export const EVENTS = [
  "Edgar & Helena",
  "Our Suite Life",
  "Mindful Movement",
  "Retreat do amor",
  "Deep Dive Retreat",
  "Ilo Retreat",
  "Ilo Retreat (client)",
  "Hanne Claes & Max Staples",
  "Michael Burge & Grace Bourne",
  "Kate Langlands Pearse and Nick Cox",
  "Tania Brown",
  "Mark & Philine",
  "Awake in the dream",
  "The Belle Method & Simone Muller",
  "Oli, Stefie & friends",
  "Istas sisters",
  "Maximilian Gotzler"
];

const ROOM_DEFINITIONS: Array<{
  id: number;
  isFixed: boolean;
  bathroomType: BathroomType;
  specialNote?: string;
}> = [
  { id: 1, isFixed: true, bathroomType: 'en-suite' },
  { id: 2, isFixed: false, bathroomType: 'shared' },
  { id: 3, isFixed: false, bathroomType: 'shared' },
  { id: 4, isFixed: false, bathroomType: 'shared' },
  { id: 5, isFixed: false, bathroomType: 'shared' },
  { id: 6, isFixed: true, bathroomType: 'en-suite' },
  { id: 7, isFixed: false, bathroomType: 'shared', specialNote: 'Upstairs (accessed through the kitchen)' },
  { id: 8, isFixed: false, bathroomType: 'shared', specialNote: 'Upstairs (accessed through the kitchen)' },
  { id: 9, isFixed: false, bathroomType: 'en-suite' },
  { id: 10, isFixed: false, bathroomType: 'en-suite' },
  { id: 11, isFixed: false, bathroomType: 'en-suite' },
];

export const initialRooms: RoomConfig[] = ROOM_DEFINITIONS.map((def) => ({
  id: def.id,
  name: `Room ${def.id}`,
  bedType: def.isFixed ? 'king' : null,
  isFixed: def.isFixed,
  bathroomType: def.bathroomType,
  specialNote: def.specialNote,
}));

export const initialEventInfo: EventInfo = {
  eventName: '',
  organizerEmail: '',
  stayDates: '',
  notes: '',
};
