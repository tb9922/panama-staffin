/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useMemo, useRef, useState } from 'react';
import Modal from '../components/Modal.jsx';
import { BTN, MODAL } from '../lib/design.js';

export const ConfirmContext = createContext(null);

const TONE_BUTTON = {
  danger: BTN.danger,
  ghost: BTN.ghost,
  success: BTN.success,
};

export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const resolverRef = useRef(null);

  const close = useCallback((result) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setDialog(null);
  }, []);

  const confirm = useCallback((options) => new Promise((resolve) => {
    const normalized = typeof options === 'string'
      ? { message: options }
      : (options || {});
    resolverRef.current = resolve;
    setDialog({
      title: normalized.title || 'Confirm',
      message: normalized.message || '',
      confirmLabel: normalized.confirmLabel || 'Confirm',
      tone: normalized.tone || 'danger',
    });
  }), []);

  const value = useMemo(() => ({ confirm }), [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Modal isOpen={!!dialog} onClose={() => close(false)} title={dialog?.title || 'Confirm'} size="sm">
        <p className="mt-2 text-sm text-gray-700">{dialog?.message}</p>
        <div className={MODAL.footer}>
          <button type="button" className={BTN.secondary} onClick={() => close(false)}>Cancel</button>
          <button
            type="button"
            className={TONE_BUTTON[dialog?.tone] || BTN.primary}
            onClick={() => close(true)}
          >
            {dialog?.confirmLabel || 'Confirm'}
          </button>
        </div>
      </Modal>
    </ConfirmContext.Provider>
  );
}
