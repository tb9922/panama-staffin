import { useEffect, useCallback, useId, useRef } from 'react';
import { useBlocker } from 'react-router-dom';
import { useConfirm } from './useConfirm.jsx';
import { clearDirtyState, setDirtyState } from '../lib/dirtyStateRegistry.js';

/**
 * Warns user before navigating away from a page with unsaved changes.
 * Covers both browser close/refresh (beforeunload) and in-app navigation (React Router blocker).
 *
 * @param {boolean} isDirty - true when the form has unsaved changes
 */
export default function useDirtyGuard(isDirty) {
  const token = useId();
  const promptInFlightRef = useRef(false);
  const { confirm, managed } = useConfirm();

  useEffect(() => {
    setDirtyState(token, isDirty);
    return () => clearDirtyState(token);
  }, [isDirty, token]);

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
    return currentLocation.pathname !== nextLocation.pathname;
  }, [isDirty]));

  // Show confirmation when blocker is active
  useEffect(() => {
    if (blocker.state !== 'blocked' || promptInFlightRef.current) return;
    let cancelled = false;
    promptInFlightRef.current = true;

    const decide = async () => {
      const leave = managed
        ? await confirm({
            title: 'Unsaved changes',
            message: 'You have unsaved changes. Leave this page?',
            confirmLabel: 'Leave page',
            tone: 'ghost',
          })
        : window.confirm('You have unsaved changes. Leave this page?');
      if (cancelled) return;
      if (leave) {
        setTimeout(() => blocker.proceed(), 0);
      } else {
        blocker.reset();
      }
      promptInFlightRef.current = false;
    };

    void decide();
    return () => {
      cancelled = true;
      promptInFlightRef.current = false;
    };
  }, [blocker, confirm, managed]);
}
