import { useId, useState } from 'react';
import Modal from './Modal.jsx';
import { changeOwnPassword } from '../lib/api.js';
import { BTN, INPUT, MODAL } from '../lib/design.js';

export default function ChangePasswordModal({ onClose }) {
  const [current, setCurrent] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const currentPasswordId = useId();
  const nextPasswordId = useId();
  const confirmPasswordId = useId();

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    if (nextPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (nextPassword.length < 10) {
      setError('Password must be at least 10 characters');
      return;
    }
    setSaving(true);
    try {
      await changeOwnPassword(current, nextPassword);
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="Change Password" size="sm">
      <form onSubmit={handleSubmit}>
        {error && <div id="pw-error" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</div>}
        {done ? (
          <div className="py-4 text-center">
            <p className="mb-3 text-sm font-medium text-emerald-600">Password changed successfully</p>
            <button type="button" className={BTN.primary} onClick={onClose}>Close</button>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div>
                <label htmlFor={currentPasswordId} className={INPUT.label}>Current Password</label>
                <input id={currentPasswordId} className={INPUT.base} type="password" value={current} onChange={e => setCurrent(e.target.value)} required autoFocus aria-describedby={error ? 'pw-error' : undefined} aria-invalid={!!error} />
              </div>
              <div>
                <label htmlFor={nextPasswordId} className={INPUT.label}>New Password</label>
                <input id={nextPasswordId} className={INPUT.base} type="password" value={nextPassword} onChange={e => setNextPassword(e.target.value)} required minLength={10} maxLength={200} aria-describedby={error ? 'pw-error' : undefined} aria-invalid={!!error} />
                <p className="mt-1 text-xs text-gray-500">Minimum 10 characters</p>
              </div>
              <div>
                <label htmlFor={confirmPasswordId} className={INPUT.label}>Confirm New Password</label>
                <input id={confirmPasswordId} className={INPUT.base} type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required aria-describedby={error ? 'pw-error' : undefined} aria-invalid={!!error} />
              </div>
            </div>
            <div className={MODAL.footer}>
              <button type="button" className={BTN.secondary} onClick={onClose}>Cancel</button>
              <button type="submit" className={BTN.primary} disabled={saving}>{saving ? 'Changing…' : 'Change Password'}</button>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}
