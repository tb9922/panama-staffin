import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadSchedulingUnlockedDates,
  saveSchedulingUnlockedDates,
  loadSchedulingEditLockPin,
  saveSchedulingEditLockPin,
} from '../lib/schedulingEditLock.js';

function normalizeDates(dates) {
  return [...new Set((Array.isArray(dates) ? dates : [dates]).filter(Boolean))];
}

export default function useSchedulingEditLock({ homeSlug, hasEditLock, today }) {
  const storageKey = homeSlug || 'default';
  const unlockedDatesRef = useRef(loadSchedulingUnlockedDates(storageKey));
  const storedLockPinRef = useRef(loadSchedulingEditLockPin(storageKey));

  const [unlockedDates, setUnlockedDates] = useState(() => unlockedDatesRef.current);
  const [showLockPrompt, setShowLockPrompt] = useState(false);
  const [lockPin, setLockPin] = useState('');
  const [lockError, setLockError] = useState('');
  const [pendingAction, setPendingAction] = useState(null);

  useEffect(() => {
    unlockedDatesRef.current = loadSchedulingUnlockedDates(storageKey);
    storedLockPinRef.current = loadSchedulingEditLockPin(storageKey);
    setUnlockedDates(unlockedDatesRef.current);
    setShowLockPrompt(false);
    setLockPin('');
    setLockError('');
    setPendingAction(null);
  }, [storageKey]);

  const persistUnlockedDates = useCallback((nextUnlockedDates) => {
    unlockedDatesRef.current = nextUnlockedDates;
    setUnlockedDates(nextUnlockedDates);
    saveSchedulingUnlockedDates(storageKey, nextUnlockedDates);
  }, [storageKey]);

  const persistLockPin = useCallback((pin) => {
    storedLockPinRef.current = pin;
    saveSchedulingEditLockPin(storageKey, pin);
  }, [storageKey]);

  const dismissLockPrompt = useCallback(() => {
    setShowLockPrompt(false);
    setLockPin('');
    setLockError('');
    setPendingAction(null);
  }, []);

  const updateLockPin = useCallback((value) => {
    setLockPin(value);
    setLockError('');
  }, []);

  const isDateLocked = useCallback((dateStr) => {
    return Boolean(hasEditLock && dateStr && dateStr < today && !unlockedDatesRef.current.has(dateStr));
  }, [hasEditLock, today]);

  const getEditLockOptions = useCallback((dates) => {
    const targetDates = normalizeDates(dates).filter((dateStr) => dateStr < today);
    if (!hasEditLock || !storedLockPinRef.current) return {};
    if (targetDates.some((dateStr) => isDateLocked(dateStr))) return {};
    return { editLockPin: storedLockPinRef.current };
  }, [hasEditLock, isDateLocked, today]);

  const relockDates = useCallback((dates, clearPin = false) => {
    const targetDates = normalizeDates(dates);
    const nextUnlockedDates = new Set(unlockedDatesRef.current);
    targetDates.forEach((dateStr) => nextUnlockedDates.delete(dateStr));
    persistUnlockedDates(nextUnlockedDates);
    if (clearPin) persistLockPin('');
  }, [persistLockPin, persistUnlockedDates]);

  const requestUnlock = useCallback((dates, action) => {
    const targetDates = normalizeDates(dates).filter((dateStr) => dateStr < today);
    if (!hasEditLock || !targetDates.some((dateStr) => isDateLocked(dateStr))) {
      action();
      return true;
    }
    setPendingAction({ dates: targetDates, fn: action });
    setLockPin('');
    setLockError('');
    setShowLockPrompt(true);
    return false;
  }, [hasEditLock, isDateLocked, today]);

  const handleLockedError = useCallback((dates, retryFn) => {
    const targetDates = normalizeDates(dates);
    relockDates(targetDates, true);
    setPendingAction({ dates: targetDates, fn: retryFn });
    setLockPin('');
    setLockError('');
    setShowLockPrompt(true);
  }, [relockDates]);

  const unlockPendingDates = useCallback((pinValue = '') => {
    if (!pendingAction) return false;
    const nextUnlockedDates = new Set(unlockedDatesRef.current);
    pendingAction.dates.forEach((dateStr) => nextUnlockedDates.add(dateStr));
    persistUnlockedDates(nextUnlockedDates);
    persistLockPin(String(pinValue || ''));
    const action = pendingAction.fn;
    setPendingAction(null);
    setShowLockPrompt(false);
    setLockPin('');
    setLockError('');
    action();
    return true;
  }, [pendingAction, persistLockPin, persistUnlockedDates]);

  const attemptUnlock = useCallback(() => {
    if (!hasEditLock) return unlockPendingDates('');
    if (!String(lockPin || '').trim()) {
      setLockError('Enter the edit PIN');
      return false;
    }
    return unlockPendingDates(lockPin);
  }, [hasEditLock, lockPin, unlockPendingDates]);

  return {
    unlockedDates,
    showLockPrompt,
    lockPin,
    lockError,
    updateLockPin,
    dismissLockPrompt,
    attemptUnlock,
    isDateLocked,
    getEditLockOptions,
    requestUnlock,
    handleLockedError,
  };
}
