function padDatePart(value: number) {
  return String(value).padStart(2, '0');
}

export function formatDateForDatabase(date: Date | null | undefined): string | null {
  if (!date) return null;

  return [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
  ].join('-');
}

export function parseLocalDateString(dateStr: string | null | undefined): Date | undefined {
  if (!dateStr) return undefined;

  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return undefined;

  return new Date(year, month - 1, day);
}

export function generateDatesInclusive(checkInDate: string | null, checkOutDate: string | null) {
  const start = parseLocalDateString(checkInDate);
  const end = parseLocalDateString(checkOutDate);

  if (!start || !end || start > end) {
    return [] as string[];
  }

  const dates: string[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());

  while (cursor <= end) {
    dates.push(formatDateForDatabase(cursor)!);
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}