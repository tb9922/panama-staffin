import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '../contexts/useToast.js';

const TOAST_TITLES = {
  success: 'Saved',
  warning: 'Check this',
  error: 'Something needs attention',
  info: 'Updated',
};

export default function useTransientNotice() {
  const [notice, setNotice] = useState(null);
  const timeoutRef = useRef(null);
  const { showToast } = useToast();

  const clearNotice = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setNotice(null);
  }, []);

  const showNotice = useCallback((content, {
    variant = 'success',
    duration = 5000,
    toast = true,
    toastTitle,
    toastMessage,
  } = {}) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setNotice({ content, variant });
    if (toast) {
      showToast({
        title: toastTitle || TOAST_TITLES[variant] || TOAST_TITLES.info,
        message: toastMessage ?? (typeof content === 'string' ? content : ''),
        tone: variant === 'error' ? 'error' : variant === 'warning' ? 'warning' : variant === 'info' ? 'info' : 'success',
      });
    }
    if (duration > 0) {
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        setNotice(null);
      }, duration);
    }
  }, [showToast]);

  useEffect(() => () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
  }, []);

  return { notice, showNotice, clearNotice };
}
