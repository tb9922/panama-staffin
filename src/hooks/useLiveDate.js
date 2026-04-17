import { useState, useEffect } from 'react';
import { todayLocalISO, startOfNextLocalDay } from '../lib/localDates.js';

/**
 * Returns a reactive today string (YYYY-MM-DD) that updates at midnight.
 * Uses a precise midnight timer so compliance overdue flags stay correct
 * on tabs left open across midnight during shift handover.
 */
export function useLiveDate() {
  const [today, setToday] = useState(() => todayLocalISO());

  useEffect(() => {
    const now = new Date();
    const nextMidnight = startOfNextLocalDay(now);
    const timer = setTimeout(() => setToday(todayLocalISO()), nextMidnight.getTime() - now.getTime());
    return () => clearTimeout(timer);
  }, [today]);

  return today;
}
