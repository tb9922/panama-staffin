import { describe, expect, it } from 'vitest';
import { addDaysLocalISO, diffLocalISODays, endOfLocalMonthISO, startOfLocalMonthISO, todayLocalISO } from '../../lib/dateOnly.js';

describe('dateOnly helpers', () => {
  it('formats local dates as yyyy-mm-dd', () => {
    expect(todayLocalISO(new Date(2026, 3, 13))).toBe('2026-04-13');
  });

  it('adds days to a date-only string without UTC drift', () => {
    expect(addDaysLocalISO('2026-03-30', 7)).toBe('2026-04-06');
    expect(addDaysLocalISO('2026-12-29', 5)).toBe('2027-01-03');
  });

  it('adds days to a Date instance using local calendar days', () => {
    expect(addDaysLocalISO(new Date(2026, 2, 31), 2)).toBe('2026-04-02');
  });

  it('returns the start of the current local month', () => {
    expect(startOfLocalMonthISO(new Date(2026, 8, 18))).toBe('2026-09-01');
    expect(startOfLocalMonthISO(new Date(2026, 0, 18), -1)).toBe('2025-12-01');
  });

  it('returns the end of the current local month', () => {
    expect(endOfLocalMonthISO(new Date(2026, 8, 18))).toBe('2026-09-30');
    expect(endOfLocalMonthISO(new Date(2028, 1, 18))).toBe('2028-02-29');
  });

  it('compares date-only values without wall-clock drift', () => {
    expect(diffLocalISODays('2026-04-18', '2026-04-18')).toBe(0);
    expect(diffLocalISODays('2026-04-19', '2026-04-18')).toBe(1);
    expect(diffLocalISODays('2026-04-17', '2026-04-18')).toBe(-1);
  });
});
