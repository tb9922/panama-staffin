import { useState, useEffect } from 'react';
import { formatDate } from '../lib/rotation.js';
import { startOfNextLocalDay } from '../lib/localDates.js';

/**
 * Returns a reactive today string (YYYY-MM-DD) that updates at midnight.
 * Uses a precise midnight timer so compliance overdue flags stay correct
 * on tabs left open across midnight during shift handover.
 */
export function useLiveDate() {
  const [today, setToday] = useState(() => formatDate(new Date()));

  useEffect(() => {
    const now = new Date();
    const timer = setTimeout(() => setToday(formatDate(new Date())), startOfNextLocalDay(now).getTime() - now.getTime());
    return () => clearTimeout(timer);
  }, [today]);

  return today;
}
