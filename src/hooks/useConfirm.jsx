import { useState, useCallback, useRef, useEffect, useContext } from 'react';
import Modal from '../components/Modal.jsx';
import { BTN, MODAL } from '../lib/design.js';
import { ConfirmContext } from '../contexts/ConfirmContext.jsx';

export function useConfirm() {
  const context = useContext(ConfirmContext);
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState({ title: 'Confirm', message: '', confirmLabel: 'Confirm', tone: 'danger' });
  const resolveRef = useRef(null);
  const managed = !!context;

  // Resolve pending promise on unmount to prevent leaks (finally blocks in callers run)
  useEffect(() => () => { resolveRef.current?.(false); }, []);

  const localConfirm = useCallback((options) => new Promise((resolve) => {
    const normalized = typeof options === 'string'
      ? { message: options }
      : (options || {});
    resolveRef.current = resolve;
    setDialog({
      title: normalized.title || 'Confirm',
      message: normalized.message || '',
      confirmLabel: normalized.confirmLabel || 'Confirm',
      tone: normalized.tone || 'danger',
    });
    setOpen(true);
  }), []);

  const confirm = managed ? context.confirm : localConfirm;

  const handleConfirm = useCallback(() => {
    resolveRef.current?.(true);
    setOpen(false);
  }, []);

  const handleCancel = useCallback(() => {
    resolveRef.current?.(false);
    setOpen(false);
  }, []);

  const ConfirmDialog = managed ? null : (
    <Modal isOpen={open} onClose={handleCancel} title={dialog.title} size="sm">
      <p className="mt-2 text-sm text-gray-700">{dialog.message}</p>
      <div className={MODAL.footer}>
        <button type="button" className={BTN.secondary} onClick={handleCancel}>Cancel</button>
        <button
          type="button"
          className={dialog.tone === 'ghost' ? BTN.ghost : dialog.tone === 'success' ? BTN.success : BTN.danger}
          onClick={handleConfirm}
        >
          {dialog.confirmLabel}
        </button>
      </div>
    </Modal>
  );

  return { confirm, ConfirmDialog, managed };
}
