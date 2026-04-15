import { useEffect, useCallback, useRef } from 'react';
import { useBlocker } from 'react-router-dom';

/**
 * Warns user before navigating away from a page with unsaved changes.
 * Covers both browser close/refresh (beforeunload) and in-app navigation (React Router blocker).
 *
 * @param {boolean} isDirty - true when the form has unsaved changes
 */
export default function useDirtyGuard(isDirty) {
  const confirmOpenRef = useRef(false);

  // Browser close / refresh / external navigation
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // In-app navigation (React Router)
  const blocker = useBlocker(useCallback(({ currentLocation, nextLocation }) => {
    if (!isDirty) return false;
    return currentLocation.pathname !== nextLocation.pathname
      || currentLocation.search !== nextLocation.search
      || currentLocation.hash !== nextLocation.hash;
  }, [isDirty]));

  // Show confirmation when blocker is active
  useEffect(() => {
    if (blocker.state !== 'blocked' || confirmOpenRef.current) return;
    confirmOpenRef.current = true;
    const leave = window.confirm('You have unsaved changes. Leave this page?');
    if (leave) {
      blocker.proceed();
    } else {
      blocker.reset();
    }
    confirmOpenRef.current = false;
  }, [blocker]);
}
