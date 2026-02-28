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
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const timer = setTimeout(() => setToday(formatDate(new Date())), tomorrow - now);
    return () => clearTimeout(timer);
  }, [today]);

  return today;
}
