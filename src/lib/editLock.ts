import { differenceInCalendarDays } from 'date-fns';
import { parseLocalDateString } from './localDate';

export type GuestStatusKind =
  | 'pending'
  | 'late_updates'
  | 'finalized'
  | 'finalized_in_progress';

export interface GuestStatusInfo {
  status: GuestStatusKind;
  /** Short label e.g. "Pending completion" */
  label: string;
  /** Full message shown to the user */
  message: string;
  /** Whether tools, autosave and submit should be blocked */
  isEditingLocked: boolean;
  /** Whether the final lock date has passed */
  isPastFinalLock: boolean;
  /** Whether we are within the late-updates window (between 14 and 3 days) */
  isInLateUpdatesWindow: boolean;
  /** Whether the check-in date has passed */
  isPastCheckIn: boolean;
  /** Late updates start date (14 days before check-in) */
  lateUpdateDate: Date | null;
  /** Final lock date (3 days before check-in) — after this all editing is blocked */
  finalLockDate: Date | null;
}

const LATE_UPDATE_DAYS_BEFORE_CHECK_IN = 14;
const FINAL_LOCK_DAYS_BEFORE_CHECK_IN = 3;

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function safeParse(dateStr: string | null): Date | null {
  if (!dateStr) return null;
  try {
    return parseISO(dateStr);
  } catch {
    return null;
  }
}

function subtractDays(checkInDate: string | null, days: number): Date | null {
  const checkIn = safeParse(checkInDate);
  if (!checkIn) return null;
  const d = new Date(checkIn);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d;
}

export function getLateUpdateDate(checkInDate: string | null): Date | null {
  return subtractDays(checkInDate, LATE_UPDATE_DAYS_BEFORE_CHECK_IN);
}

export function getFinalLockDate(checkInDate: string | null): Date | null {
  return subtractDays(checkInDate, FINAL_LOCK_DAYS_BEFORE_CHECK_IN);
}

/** @deprecated Kept for backward compatibility — now returns the final lock date (3 days before check-in). */
export function getFinalSubmissionDate(checkInDate: string | null): Date | null {
  return getFinalLockDate(checkInDate);
}

export function formatHumanDate(date: Date | null): string {
  if (!date) return '';
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export const formatFinalSubmissionDate = formatHumanDate;

export function getGuestStatus(
  checkInDate: string | null,
  _statusOverall: 'draft' | 'submitted' | string = 'draft',
): GuestStatusInfo {
  const today = startOfToday();
  const checkIn = safeParse(checkInDate);
  const lateUpdateDate = getLateUpdateDate(checkInDate);
  const finalLockDate = getFinalLockDate(checkInDate);

  const isPastCheckIn = !!checkIn && differenceInCalendarDays(checkIn, today) <= 0;
  const isPastFinalLock = !!finalLockDate && differenceInCalendarDays(finalLockDate, today) <= 0;
  const isPastLateStart = !!lateUpdateDate && differenceInCalendarDays(lateUpdateDate, today) <= 0;
  const isInLateUpdatesWindow = isPastLateStart && !isPastFinalLock;

  if (isPastCheckIn) {
    return {
      status: 'finalized_in_progress',
      label: 'Finalized',
      message: 'Your stay is currently in progress.',
      isEditingLocked: true,
      isPastFinalLock: true,
      isInLateUpdatesWindow: false,
      isPastCheckIn: true,
      lateUpdateDate,
      finalLockDate,
    };
  }

  if (isPastFinalLock) {
    return {
      status: 'finalized',
      label: 'Finalized',
      message:
        'Your information is now locked. Please contact hello@quintamor.com for any changes.',
      isEditingLocked: true,
      isPastFinalLock: true,
      isInLateUpdatesWindow: false,
      isPastCheckIn: false,
      lateUpdateDate,
      finalLockDate,
    };
  }

  if (isInLateUpdatesWindow) {
    return {
      status: 'late_updates',
      label: 'Late updates',
      message:
        'Your stay is approaching. Please finalize your information as soon as possible. Modifications will no longer be possible 3 days before your arrival.',
      isEditingLocked: false,
      isPastFinalLock: false,
      isInLateUpdatesWindow: true,
      isPastCheckIn: false,
      lateUpdateDate,
      finalLockDate,
    };
  }

  return {
    status: 'pending',
    label: 'Pending completion',
    message: 'You may still edit and submit your Guest Area information until 3 days before your arrival.',
    isEditingLocked: false,
    isPastFinalLock: false,
    isInLateUpdatesWindow: false,
    isPastCheckIn: false,
    lateUpdateDate,
    finalLockDate,
  };
}

/**
 * Returns true when tools, autosave and submission should be blocked.
 * Editing is only locked within the final 3 days before check-in or after check-in.
 */
export function isEditingLocked(
  checkInDate: string | null,
  statusOverall: 'draft' | 'submitted' | string = 'draft',
): boolean {
  return getGuestStatus(checkInDate, statusOverall).isEditingLocked;
}
