export function loadSchedulingUnlockedDates(homeSlug) {
  try {
    const stored = sessionStorage.getItem(getUnlockedDatesKey(homeSlug));
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch {
    return new Set();
  }
}

export function saveSchedulingUnlockedDates(homeSlug, unlockedDates) {
  try {
    sessionStorage.setItem(getUnlockedDatesKey(homeSlug), JSON.stringify([...unlockedDates]));
  } catch {
    // Ignore storage failures; in-memory unlock state still works for this session.
  }
}

export function loadSchedulingEditLockPin(homeSlug) {
  try {
    return sessionStorage.getItem(getEditLockPinKey(homeSlug)) || '';
  } catch {
    return '';
  }
}

export function saveSchedulingEditLockPin(homeSlug, pin) {
  try {
    if (pin) {
      sessionStorage.setItem(getEditLockPinKey(homeSlug), pin);
    } else {
      sessionStorage.removeItem(getEditLockPinKey(homeSlug));
    }
  } catch {
    // Ignore storage failures; the current render can still keep using the in-memory pin.
  }
}

function getUnlockedDatesKey(homeSlug) {
  return `sched_unlock_dates_${homeSlug || 'default'}`;
}

function getEditLockPinKey(homeSlug) {
  return `sched_unlock_pin_${homeSlug || 'default'}`;
}
