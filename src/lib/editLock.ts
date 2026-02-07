import { differenceInDays, parseISO } from 'date-fns';

/**
 * Check if editing is locked (within 5 days of check-in)
 */
export function isEditingLocked(checkInDate: string | null): boolean {
  if (!checkInDate) return false;
  
  try {
    const checkIn = parseISO(checkInDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const daysUntilCheckIn = differenceInDays(checkIn, today);
    
    // Locked if check-in is within 5 days (including past dates)
    return daysUntilCheckIn <= 5;
  } catch {
    return false;
  }
}
