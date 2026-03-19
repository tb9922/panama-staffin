import { useState, useCallback, useRef, useEffect } from 'react';
import Modal from '../components/Modal.jsx';
import { BTN, MODAL } from '../lib/design.js';

export function useConfirm() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const resolveRef = useRef(null);

  // Resolve pending promise on unmount to prevent leaks (finally blocks in callers run)
  useEffect(() => () => { resolveRef.current?.(false); }, []);

  const confirm = useCallback((msg) => new Promise((resolve) => {
    resolveRef.current = resolve;
    setMessage(msg);
    setOpen(true);
  }), []);

  const handleConfirm = useCallback(() => {
    resolveRef.current?.(true);
    setOpen(false);
  }, []);

  const handleCancel = useCallback(() => {
    resolveRef.current?.(false);
    setOpen(false);
  }, []);

  const ConfirmDialog = (
    <Modal isOpen={open} onClose={handleCancel} title="Confirm" size="sm">
      <p className="mt-2 text-sm text-gray-700">{message}</p>
      <div className={MODAL.footer}>
        <button className={BTN.secondary} onClick={handleCancel}>Cancel</button>
        <button className={BTN.danger} onClick={handleConfirm}>Confirm</button>
      </div>
    </Modal>
  );

  return { confirm, ConfirmDialog };
}
