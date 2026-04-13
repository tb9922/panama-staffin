/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const ToastContext = createContext({
  toasts: [],
  showToast: () => null,
  dismissToast: () => {},
  clearToasts: () => {},
});

let nextToastId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());

  const dismissToast = useCallback((toastId) => {
    const timer = timersRef.current.get(toastId);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(toastId);
    }
    setToasts(current => current.filter(toast => toast.id !== toastId));
  }, []);

  const clearToasts = useCallback(() => {
    timersRef.current.forEach(timer => clearTimeout(timer));
    timersRef.current.clear();
    setToasts([]);
  }, []);

  const showToast = useCallback((toast) => {
    const id = `toast-${nextToastId++}`;
    const duration = Number.isFinite(toast?.duration) ? toast.duration : 4000;
    const nextToast = {
      id,
      title: toast?.title || 'Saved',
      message: toast?.message || '',
      tone: toast?.tone || 'success',
      actionLabel: toast?.actionLabel || null,
      onAction: typeof toast?.onAction === 'function' ? toast.onAction : null,
    };
    setToasts(current => [...current, nextToast]);

    if (duration > 0) {
      const timer = setTimeout(() => {
        timersRef.current.delete(id);
        setToasts(current => current.filter(toastItem => toastItem.id !== id));
      }, duration);
      timersRef.current.set(id, timer);
    }

    return id;
  }, []);

  useEffect(() => () => {
    timersRef.current.forEach(timer => clearTimeout(timer));
    timersRef.current.clear();
  }, []);

  const value = useMemo(() => ({
    toasts,
    showToast,
    dismissToast,
    clearToasts,
  }), [clearToasts, dismissToast, showToast, toasts]);

  return (
    <ToastContext.Provider value={value}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
