import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLiveDate } from '../useLiveDate.js';

describe('useLiveDate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is a named export and a function', () => {
    expect(typeof useLiveDate).toBe('function');
  });

  it('returns a YYYY-MM-DD formatted string', () => {
    vi.setSystemTime(new Date('2025-06-15T10:00:00Z'));
    const { result } = renderHook(() => useLiveDate());
    expect(result.current).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns today\'s date', () => {
    vi.setSystemTime(new Date('2025-06-15T10:00:00Z'));
    const { result } = renderHook(() => useLiveDate());
    expect(result.current).toBe('2025-06-15');
  });

  it('updates to the next day after midnight', async () => {
    // Use a January date (GMT, UTC+0) so that setHours(0,0,0,0) in the hook
    // lands exactly on UTC midnight — making the test timezone-independent.
    // Delay = 2025-01-16T00:00:00Z - 2025-01-15T23:59:58Z = 2000ms.
    vi.setSystemTime(new Date('2025-01-15T23:59:58Z'));
    const { result } = renderHook(() => useLiveDate());
    expect(result.current).toBe('2025-01-15');

    // Move system time past midnight so new Date() in the callback returns Jan 16.
    vi.setSystemTime(new Date('2025-01-16T00:00:01Z'));

    // Fire the pending timer (2000ms delay) and flush React state updates.
    await act(async () => {
      vi.advanceTimersByTime(2500);
    });

    expect(result.current).toBe('2025-01-16');
  });

  it('schedules a single timer (does not fire early)', () => {
    // Use a January date so local midnight == UTC midnight (GMT, UTC+0).
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));
    const { result } = renderHook(() => useLiveDate());
    expect(result.current).toBe('2025-01-15');

    // Advance 11 hours — still the same day, timer has not fired yet.
    act(() => {
      vi.advanceTimersByTime(11 * 60 * 60 * 1000);
    });

    expect(result.current).toBe('2025-01-15');
  });

  it('clears the timer on unmount', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    vi.setSystemTime(new Date('2025-06-15T10:00:00Z'));
    const { unmount } = renderHook(() => useLiveDate());
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });
});
