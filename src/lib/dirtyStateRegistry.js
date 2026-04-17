const dirtyTokens = new Set();
const listeners = new Set();

function emit() {
  const hasDirty = dirtyTokens.size > 0;
  listeners.forEach(listener => listener(hasDirty));
}

export function setDirtyState(token, isDirty) {
  if (!token) return;
  if (isDirty) dirtyTokens.add(token);
  else dirtyTokens.delete(token);
  emit();
}

export function clearDirtyState(token) {
  if (!token) return;
  dirtyTokens.delete(token);
  emit();
}

export function hasDirtyState() {
  return dirtyTokens.size > 0;
}

export function subscribeDirtyState(listener) {
  listeners.add(listener);
  listener(hasDirtyState());
  return () => listeners.delete(listener);
}
