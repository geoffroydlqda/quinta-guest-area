import { differenceInCalendarDays, parseISO } from 'date-fns';

export type GuestStatusKind =
  | 'pending'
  | 'late'
  | 'finalized_submitted'
  | 'finalized_in_progress';

export interface GuestStatusInfo {
  status: GuestStatusKind;
  /** Short label e.g. "Pending completion" */
  label: string;
  /** Full message shown to the user */
  message: string;
  /** Whether tools, autosave and submit should be blocked */
  isEditingLocked: boolean;
  /** Whether the final submission deadline has passed */
  isPastDeadline: boolean;
  /** Whether the check-in date has passed */
  isPastCheckIn: boolean;
  /** Final submission deadline (5 days before check-in) */
  finalSubmissionDate: Date | null;
}

const FINAL_SUBMISSION_DAYS_BEFORE_CHECK_IN = 5;

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

export function getFinalSubmissionDate(checkInDate: string | null): Date | null {
  const checkIn = safeParse(checkInDate);
  if (!checkIn) return null;
  const deadline = new Date(checkIn);
  deadline.setHours(0, 0, 0, 0);
  deadline.setDate(deadline.getDate() - FINAL_SUBMISSION_DAYS_BEFORE_CHECK_IN);
  return deadline;
}

export function formatFinalSubmissionDate(date: Date | null): string {
  if (!date) return '';
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function getGuestStatus(
  checkInDate: string | null,
  statusOverall: 'draft' | 'submitted' | string = 'draft',
): GuestStatusInfo {
  const today = startOfToday();
  const checkIn = safeParse(checkInDate);
  const deadline = getFinalSubmissionDate(checkInDate);

  const isPastCheckIn = !!checkIn && differenceInCalendarDays(checkIn, today) <= 0;
  const isPastDeadline = !!deadline && differenceInCalendarDays(deadline, today) <= 0;
  const submitted = statusOverall === 'submitted';

  if (isPastCheckIn) {
    return {
      status: 'finalized_in_progress',
      label: 'Finalized',
      message: 'Your stay is currently in progress.',
      isEditingLocked: true,
      isPastDeadline: true,
      isPastCheckIn: true,
      finalSubmissionDate: deadline,
    };
  }

  if (isPastDeadline) {
    if (submitted) {
      return {
        status: 'finalized_submitted',
        label: 'Finalized',
        message:
          'Your information is now finalized. Please contact hello@quintamor.com for any changes.',
        isEditingLocked: true,
        isPastDeadline: true,
        isPastCheckIn: false,
        finalSubmissionDate: deadline,
      };
    }
    return {
      status: 'late',
      label: 'Late submission',
      message:
        'Your Guest Area information is overdue. Please complete and submit your information as soon as possible.',
      isEditingLocked: false,
      isPastDeadline: true,
      isPastCheckIn: false,
      finalSubmissionDate: deadline,
    };
  }

  const deadlineLabel = formatFinalSubmissionDate(deadline);
  return {
    status: 'pending',
    label: 'Pending completion',
    message: deadlineLabel
      ? `You may still edit and submit your Guest Area information until ${deadlineLabel}.`
      : 'You may still edit and submit your Guest Area information.',
    isEditingLocked: false,
    isPastDeadline: false,
    isPastCheckIn: false,
    finalSubmissionDate: deadline,
  };
}

/**
 * Returns true when tools, autosave and submission should be blocked.
 * Late guests (past deadline, not submitted) remain editable.
 */
export function isEditingLocked(
  checkInDate: string | null,
  statusOverall: 'draft' | 'submitted' | string = 'draft',
): boolean {
  return getGuestStatus(checkInDate, statusOverall).isEditingLocked;
}
