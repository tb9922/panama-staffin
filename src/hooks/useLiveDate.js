import { useState, useEffect } from 'react';
import { formatDate } from '../lib/rotation.js';

/**
 * Returns a reactive today string (YYYY-MM-DD) that updates at midnight.
 * Uses a precise midnight timer so compliance overdue flags stay correct
 * on tabs left open across midnight during shift handover.
 */
export function useLiveDate() {
  const [today, setToday] = useState(() => formatDate(new Date()));

  useEffect(() => {
    const now = new Date();
    const utcTomorrow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    const timer = setTimeout(() => setToday(formatDate(new Date())), utcTomorrow - now.getTime());
    return () => clearTimeout(timer);
  }, [today]);

  return today;
}
