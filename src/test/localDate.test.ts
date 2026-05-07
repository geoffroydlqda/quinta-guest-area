import { describe, expect, it } from 'vitest';
import { formatDateForDatabase, generateDatesInclusive, parseLocalDateString } from '@/lib/localDate';

describe('localDate helpers', () => {
  it('preserves the selected local calendar day when formatting for storage', () => {
    const selectedDate = new Date(2026, 5, 25);

    expect(formatDateForDatabase(selectedDate)).toBe('2026-06-25');
  });

  it('generates an inclusive range for food days', () => {
    expect(generateDatesInclusive('2026-06-20', '2026-06-25')).toEqual([
      '2026-06-20',
      '2026-06-21',
      '2026-06-22',
      '2026-06-23',
      '2026-06-24',
      '2026-06-25',
    ]);
  });

  it('parses stored dates back to the same local day', () => {
    const parsedDate = parseLocalDateString('2026-06-25');

    expect(parsedDate?.getFullYear()).toBe(2026);
    expect(parsedDate?.getMonth()).toBe(5);
    expect(parsedDate?.getDate()).toBe(25);
  });
});