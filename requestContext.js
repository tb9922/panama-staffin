import { AsyncLocalStorage } from 'node:async_hooks';

const requestContextStorage = new AsyncLocalStorage();

export function runWithRequestContext(initialContext, fn) {
  return requestContextStorage.run({ ...initialContext }, fn);
}

export function getRequestContext() {
  return requestContextStorage.getStore() || {};
}

export function setRequestContext(patch) {
  const store = requestContextStorage.getStore();
  if (!store || !patch || typeof patch !== 'object') return;
  Object.assign(store, patch);
}
