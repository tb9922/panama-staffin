/**
 * Unit tests for HR service — Bradford Factor and working days calculations.
 *
 * These are pure function tests with no database or external dependencies.
 * We mock db.js / config.js to avoid requiring environment variables.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';

// Mock the database module to prevent config.js env var validation
vi.mock('../../db.js', () => ({ pool: {} }));

let addWorkingDays, workingDaysBetween;
beforeAll(async () => {
  ({ addWorkingDays, workingDaysBetween } = await import('../../services/hrService.js'));
});

// ── Bradford Factor helpers ──────────────────────────────────────────────────
// groupSpells and getTriggerLevel are not exported, so we test them indirectly
// through calculateBradfordScores (which hits DB). The unit-testable logic is
// in the working days functions and trigger thresholds documented here.

// ── addWorkingDays ───────────────────────────────────────────────────────────

describe('addWorkingDays', () => {
  it('adds days skipping weekends', () => {
    // 2026-02-23 is Monday → +5 working days = Monday 2026-03-02
    expect(addWorkingDays('2026-02-23', 5)).toBe('2026-03-02');
  });

  it('skips weekend correctly from Friday', () => {
    // 2026-02-27 is Friday → +1 working day = Monday 2026-03-02
    expect(addWorkingDays('2026-02-27', 1)).toBe('2026-03-02');
  });

  it('skips multiple weekends', () => {
    // 2026-02-23 Mon → +10 working days = 2 full weeks = Monday 2026-03-09
    expect(addWorkingDays('2026-02-23', 10)).toBe('2026-03-09');
  });

  it('handles zero days — returns from date (next working day check not triggered)', () => {
    // 0 working days means don't advance at all
    expect(addWorkingDays('2026-02-23', 0)).toBe('2026-02-23');
  });

  it('skips bank holidays', () => {
    // 2026-02-27 is Friday → +1 normally = Mon Mar 2
    // But if Mar 2 is a bank holiday, skip to Tue Mar 3
    const bh = [{ date: '2026-03-02' }];
    expect(addWorkingDays('2026-02-27', 1, bh)).toBe('2026-03-03');
  });

  it('accepts bank holidays as plain strings', () => {
    const bh = ['2026-03-02'];
    expect(addWorkingDays('2026-02-27', 1, bh)).toBe('2026-03-03');
  });

  it('skips consecutive bank holidays', () => {
    // Mon and Tue are bank holidays → next working day is Wed
    const bh = ['2026-03-02', '2026-03-03'];
    expect(addWorkingDays('2026-02-27', 1, bh)).toBe('2026-03-04');
  });

  it('handles start on Saturday', () => {
    // 2026-02-28 is Saturday → +1 working day = Monday Mar 2
    expect(addWorkingDays('2026-02-28', 1)).toBe('2026-03-02');
  });

  it('handles start on Sunday', () => {
    // 2026-03-01 is Sunday → +1 working day = Monday Mar 2
    expect(addWorkingDays('2026-03-01', 1)).toBe('2026-03-02');
  });

  it('handles large number of working days', () => {
    // 20 working days from 2026-02-23 (Mon) = 4 weeks = Mon 2026-03-23
    expect(addWorkingDays('2026-02-23', 20)).toBe('2026-03-23');
  });
});

// ── workingDaysBetween ───────────────────────────────────────────────────────

describe('workingDaysBetween', () => {
  it('counts working days in a full week (Mon to Mon)', () => {
    // 2026-02-23 Mon to 2026-03-02 Mon = 5 working days (exclusive of from, inclusive of to)
    expect(workingDaysBetween('2026-02-23', '2026-03-02')).toBe(5);
  });

  it('counts zero for same day', () => {
    expect(workingDaysBetween('2026-02-23', '2026-02-23')).toBe(0);
  });

  it('counts across a weekend', () => {
    // Fri to Mon = 1 working day (Mon only; exclusive of Fri)
    expect(workingDaysBetween('2026-02-27', '2026-03-02')).toBe(1);
  });

  it('returns zero for from > to', () => {
    expect(workingDaysBetween('2026-03-02', '2026-02-23')).toBe(0);
  });

  it('skips bank holidays', () => {
    // Mon to Mon = normally 5, but Mon bank holiday = 4
    const bh = ['2026-03-02'];
    expect(workingDaysBetween('2026-02-23', '2026-03-02', bh)).toBe(4);
  });

  it('handles weekend-only span', () => {
    // Sat to Sun = 0 working days
    expect(workingDaysBetween('2026-02-28', '2026-03-01')).toBe(0);
  });

  it('counts 2 full weeks correctly', () => {
    // Mon 23 Feb to Mon 9 Mar = 10 working days
    expect(workingDaysBetween('2026-02-23', '2026-03-09')).toBe(10);
  });

  it('accepts bank holidays as plain strings', () => {
    const bh = ['2026-02-24']; // Tue bank holiday
    // Mon 23 to Fri 27 = normally 4 working days, minus 1 BH = 3
    expect(workingDaysBetween('2026-02-23', '2026-02-27', bh)).toBe(3);
  });
});
