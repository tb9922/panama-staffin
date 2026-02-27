import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';

/**
 * Warns user before navigating away from a page with unsaved changes.
 * Covers both browser close/refresh (beforeunload) and in-app navigation (React Router blocker).
 *
 * @param {boolean} isDirty - true when the form has unsaved changes
 */
export default function useDirtyGuard(isDirty) {
  // Browser close / refresh / external navigation
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // In-app navigation (React Router)
  useBlocker(({ currentLocation, nextLocation }) => {
    if (!isDirty) return false;
    return currentLocation.pathname !== nextLocation.pathname;
  });
}
