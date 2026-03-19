import { useState, useCallback, useRef } from 'react';
import Modal from '../components/Modal.jsx';
import { BTN, MODAL } from '../lib/design.js';

export function useConfirm() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const resolveRef = useRef(null);

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

  const ConfirmDialog = open ? (
    <Modal onClose={handleCancel}>
      <div className={MODAL.panelSm}>
        <h3 className={MODAL.title}>Confirm</h3>
        <p className="mt-2 text-sm text-gray-700">{message}</p>
        <div className={MODAL.footer}>
          <button className={BTN.secondary} onClick={handleCancel}>Cancel</button>
          <button className={BTN.danger} onClick={handleConfirm}>Confirm</button>
        </div>
      </div>
    </Modal>
  ) : null;

  return { confirm, ConfirmDialog };
}
