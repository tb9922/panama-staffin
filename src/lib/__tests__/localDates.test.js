import { describe, it, expect } from 'vitest';
import {
  todayLocalISO,
  parseLocalDate,
  addDaysLocalISO,
  startOfLocalMonthISO,
  endOfLocalMonthISO,
  startOfNextLocalDay,
} from '../localDates.js';

describe('localDates', () => {
  describe('todayLocalISO', () => {
    it('formats a known date correctly', () => {
      expect(todayLocalISO(new Date(2026, 0, 5))).toBe('2026-01-05');
    });

    it('pads single-digit month and day', () => {
      expect(todayLocalISO(new Date(2026, 2, 9))).toBe('2026-03-09');
    });

    it('handles December correctly', () => {
      expect(todayLocalISO(new Date(2026, 11, 31))).toBe('2026-12-31');
    });

    it('accepts a date input', () => {
      const result = todayLocalISO(new Date(2025, 5, 15));
      expect(result).toBe('2025-06-15');
    });

    it('returns a valid date for default (no args)', () => {
      const result = todayLocalISO();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('parseLocalDate', () => {
    it('parses a YYYY-MM-DD string to a local Date', () => {
      const d = parseLocalDate('2026-04-10');
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(3);
      expect(d.getDate()).toBe(10);
    });

    it('returns null for falsy input', () => {
      expect(parseLocalDate(null)).toBeNull();
      expect(parseLocalDate('')).toBeNull();
      expect(parseLocalDate(undefined)).toBeNull();
    });

    it('handles year-only gracefully', () => {
      const d = parseLocalDate('2026');
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(0);
      expect(d.getDate()).toBe(1);
    });
  });

  describe('addDaysLocalISO', () => {
    it('adds days within a month', () => {
      expect(addDaysLocalISO('2026-04-10', 5)).toBe('2026-04-15');
    });

    it('crosses month boundary', () => {
      expect(addDaysLocalISO('2026-01-30', 3)).toBe('2026-02-02');
    });

    it('crosses year boundary', () => {
      expect(addDaysLocalISO('2026-12-30', 5)).toBe('2027-01-04');
    });

    it('handles negative days', () => {
      expect(addDaysLocalISO('2026-03-03', -5)).toBe('2026-02-26');
    });

    it('handles leap year Feb 29', () => {
      expect(addDaysLocalISO('2028-02-28', 1)).toBe('2028-02-29');
      expect(addDaysLocalISO('2028-02-28', 2)).toBe('2028-03-01');
    });

    it('handles non-leap year Feb 28', () => {
      expect(addDaysLocalISO('2026-02-28', 1)).toBe('2026-03-01');
    });
  });

  describe('startOfLocalMonthISO', () => {
    it('returns first of current month', () => {
      expect(startOfLocalMonthISO(new Date(2026, 3, 15))).toBe('2026-04-01');
    });

    it('returns first of next month with offset +1', () => {
      expect(startOfLocalMonthISO(new Date(2026, 3, 15), 1)).toBe('2026-05-01');
    });

    it('returns first of previous month with offset -1', () => {
      expect(startOfLocalMonthISO(new Date(2026, 3, 15), -1)).toBe('2026-03-01');
    });

    it('wraps year boundary with negative offset', () => {
      expect(startOfLocalMonthISO(new Date(2026, 0, 15), -1)).toBe('2025-12-01');
    });
  });

  describe('endOfLocalMonthISO', () => {
    it('returns last day of current month', () => {
      expect(endOfLocalMonthISO(new Date(2026, 3, 15))).toBe('2026-04-30');
    });

    it('returns last day of month with 31 days', () => {
      expect(endOfLocalMonthISO(new Date(2026, 0, 10))).toBe('2026-01-31');
    });

    it('returns Feb 28 for non-leap year', () => {
      expect(endOfLocalMonthISO(new Date(2026, 1, 10))).toBe('2026-02-28');
    });

    it('returns Feb 29 for leap year', () => {
      expect(endOfLocalMonthISO(new Date(2028, 1, 10))).toBe('2028-02-29');
    });

    it('handles offset to next month', () => {
      expect(endOfLocalMonthISO(new Date(2026, 3, 15), 1)).toBe('2026-05-31');
    });
  });

  describe('startOfNextLocalDay', () => {
    it('returns midnight of the next day', () => {
      const input = new Date(2026, 3, 10, 14, 30);
      const result = startOfNextLocalDay(input);
      expect(result.getFullYear()).toBe(2026);
      expect(result.getMonth()).toBe(3);
      expect(result.getDate()).toBe(11);
      expect(result.getHours()).toBe(0);
      expect(result.getMinutes()).toBe(0);
    });

    it('crosses month boundary', () => {
      const input = new Date(2026, 3, 30, 23, 59);
      const result = startOfNextLocalDay(input);
      expect(result.getMonth()).toBe(4);
      expect(result.getDate()).toBe(1);
    });
  });

});
