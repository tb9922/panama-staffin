import { useCallback, useEffect, useRef, useState } from 'react';

export default function useTransientNotice() {
  const [notice, setNotice] = useState(null);
  const timeoutRef = useRef(null);

  const clearNotice = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setNotice(null);
  }, []);

  const showNotice = useCallback((content, { variant = 'success', duration = 5000 } = {}) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setNotice({ content, variant });
    if (duration > 0) {
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        setNotice(null);
      }, duration);
    }
  }, []);

  useEffect(() => () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
  }, []);

  return { notice, showNotice, clearNotice };
}
