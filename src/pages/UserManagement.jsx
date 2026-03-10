import { useState, useEffect, useCallback } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import {
  listUsers, createUser, updateUser, resetUserPassword,
  getUserHomes, setUserHomes, listAllHomesForAccess,
} from '../lib/api.js';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [allHomes, setAllHomes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Modal state
  const [addOpen, setAddOpen] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [resetPwUser, setResetPwUser] = useState(null);
  const [homesUser, setHomesUser] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const [u, h] = await Promise.all([listUsers(), listAllHomesForAccess()]);
      setUsers(u);
      setAllHomes(h);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Clear success message after 4s
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(null), 4000);
    return () => clearTimeout(t);
  }, [success]);

  if (loading) return <div className={PAGE.container} role="status"><p className="text-gray-400 text-sm py-12 text-center">Loading users...</p></div>;

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <h1 className={PAGE.title}>User Management</h1>
        <button className={`${BTN.primary} ${BTN.sm}`} onClick={() => setAddOpen(true)}>Add User</button>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 text-sm px-4 py-2.5 rounded-lg border border-red-200 mb-4 flex justify-between items-center">
          {error}
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 text-xs font-medium ml-4">Dismiss</button>
        </div>
      )}
      {success && (
        <div className="bg-emerald-50 text-emerald-700 text-sm px-4 py-2.5 rounded-lg border border-emerald-200 mb-4">
          {success}
        </div>
      )}

      <div className={CARD.flush}>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th scope="col" className={TABLE.th}>Username</th>
                <th scope="col" className={TABLE.th}>Display Name</th>
                <th scope="col" className={TABLE.th}>Role</th>
                <th scope="col" className={TABLE.th}>Status</th>
                <th scope="col" className={TABLE.th}>Last Login</th>
                <th scope="col" className={TABLE.th}>Created</th>
                <th scope="col" className={TABLE.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr><td colSpan={7} className={TABLE.empty}>No users found</td></tr>
              ) : users.map(u => (
                <tr key={u.id} className={TABLE.tr}>
                  <td className={`${TABLE.td} font-medium text-gray-900`}>{u.username}</td>
                  <td className={TABLE.td}>{u.display_name || '—'}</td>
                  <td className={TABLE.td}>
                    <span className={u.role === 'admin' ? BADGE.purple : BADGE.blue}>{u.role}</span>
                  </td>
                  <td className={TABLE.td}>
                    <span className={u.active ? BADGE.green : BADGE.red}>{u.active ? 'Active' : 'Inactive'}</span>
                  </td>
                  <td className={TABLE.td}>{formatDate(u.last_login_at)}</td>
                  <td className={TABLE.td}>{formatDate(u.created_at)}</td>
                  <td className={TABLE.td}>
                    <div className="flex items-center gap-1">
                      <button className={`${BTN.ghost} ${BTN.xs}`} onClick={() => setEditUser(u)}>Edit</button>
                      <button className={`${BTN.ghost} ${BTN.xs}`} onClick={() => setResetPwUser(u)}>Reset PW</button>
                      <button className={`${BTN.ghost} ${BTN.xs}`} onClick={() => setHomesUser(u)}>Homes</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {addOpen && <AddUserModal onClose={() => setAddOpen(false)} onSuccess={(msg) => { setSuccess(msg); refresh(); }} />}
      {editUser && <EditUserModal user={editUser} onClose={() => setEditUser(null)} onSuccess={(msg) => { setSuccess(msg); refresh(); }} />}
      {resetPwUser && <ResetPasswordModal user={resetPwUser} onClose={() => setResetPwUser(null)} onSuccess={(msg) => { setSuccess(msg); }} />}
      {homesUser && <HomeAccessModal user={homesUser} allHomes={allHomes} onClose={() => setHomesUser(null)} onSuccess={(msg) => { setSuccess(msg); }} />}
    </div>
  );
}

// ── Add User Modal ───────────────────────────────────────────────────────────

function AddUserModal({ onClose, onSuccess }) {
  const [form, setForm] = useState({ username: '', password: '', confirmPassword: '', displayName: '', role: 'viewer' });
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState(null);

  function set(key, val) { setForm(prev => ({ ...prev, [key]: val })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setLocalError(null);
    if (form.password !== form.confirmPassword) { setLocalError('Passwords do not match'); return; }
    if (form.password.length < 10) { setLocalError('Password must be at least 10 characters'); return; }
    setSaving(true);
    try {
      await createUser({ username: form.username, password: form.password, role: form.role, displayName: form.displayName });
      onSuccess(`User "${form.username}" created`);
      onClose();
    } catch (err) {
      setLocalError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={true} onClose={onClose} title="Add User">
      <form onSubmit={handleSubmit}>
        {localError && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg border border-red-200 mb-4">{localError}</div>}
        <div className="space-y-3">
          <div>
            <label className={INPUT.label}>Username</label>
            <input className={INPUT.base} value={form.username} onChange={e => set('username', e.target.value)} required minLength={3} maxLength={100} pattern="[a-zA-Z0-9._-]+" title="Letters, numbers, dots, underscores, hyphens" autoFocus />
          </div>
          <div>
            <label className={INPUT.label}>Display Name</label>
            <input className={INPUT.base} value={form.displayName} onChange={e => set('displayName', e.target.value)} maxLength={200} placeholder="Optional" />
          </div>
          <div>
            <label className={INPUT.label}>Role</label>
            <select className={INPUT.select} value={form.role} onChange={e => set('role', e.target.value)}>
              <option value="viewer">Viewer</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div>
            <label className={INPUT.label}>Password</label>
            <input className={INPUT.base} type="password" value={form.password} onChange={e => set('password', e.target.value)} required minLength={10} maxLength={200} />
            <p className="text-xs text-gray-400 mt-1">Minimum 10 characters</p>
          </div>
          <div>
            <label className={INPUT.label}>Confirm Password</label>
            <input className={INPUT.base} type="password" value={form.confirmPassword} onChange={e => set('confirmPassword', e.target.value)} required />
          </div>
        </div>
        <div className={MODAL.footer}>
          <button type="button" className={BTN.secondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={BTN.primary} disabled={saving}>{saving ? 'Creating...' : 'Create User'}</button>
        </div>
      </form>
    </Modal>
  );
}

// ── Edit User Modal ──────────────────────────────────────────────────────────

function EditUserModal({ user, onClose, onSuccess }) {
  const [form, setForm] = useState({ displayName: user.display_name || '', role: user.role, active: user.active });
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState(null);

  function set(key, val) { setForm(prev => ({ ...prev, [key]: val })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setLocalError(null);
    setSaving(true);
    try {
      await updateUser(user.id, { displayName: form.displayName, role: form.role, active: form.active });
      onSuccess(`User "${user.username}" updated`);
      onClose();
    } catch (err) {
      setLocalError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={true} onClose={onClose} title={`Edit User — ${user.username}`}>
      <form onSubmit={handleSubmit}>
        {localError && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg border border-red-200 mb-4">{localError}</div>}
        <div className="space-y-3">
          <div>
            <label className={INPUT.label}>Display Name</label>
            <input className={INPUT.base} value={form.displayName} onChange={e => set('displayName', e.target.value)} maxLength={200} autoFocus />
          </div>
          <div>
            <label className={INPUT.label}>Role</label>
            <select className={INPUT.select} value={form.role} onChange={e => set('role', e.target.value)}>
              <option value="viewer">Viewer</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="user-active" checked={form.active} onChange={e => set('active', e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            <label htmlFor="user-active" className="text-sm text-gray-700">Active</label>
          </div>
          {!form.active && (
            <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg border border-amber-200">
              Deactivating a user will immediately revoke all their sessions.
            </p>
          )}
        </div>
        <div className={MODAL.footer}>
          <button type="button" className={BTN.secondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={BTN.primary} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
        </div>
      </form>
    </Modal>
  );
}

// ── Reset Password Modal ─────────────────────────────────────────────────────

function ResetPasswordModal({ user, onClose, onSuccess }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setLocalError(null);
    if (password !== confirm) { setLocalError('Passwords do not match'); return; }
    if (password.length < 10) { setLocalError('Password must be at least 10 characters'); return; }
    setSaving(true);
    try {
      await resetUserPassword(user.id, password);
      onSuccess(`Password reset for "${user.username}" — all sessions revoked`);
      onClose();
    } catch (err) {
      setLocalError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={true} onClose={onClose} title={`Reset Password — ${user.username}`} size="sm">
      <form onSubmit={handleSubmit}>
        {localError && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg border border-red-200 mb-4">{localError}</div>}
        <p className="text-xs text-gray-500 mb-3">This will revoke all active sessions for this user.</p>
        <div className="space-y-3">
          <div>
            <label className={INPUT.label}>New Password</label>
            <input className={INPUT.base} type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={10} maxLength={200} autoFocus />
            <p className="text-xs text-gray-400 mt-1">Minimum 10 characters</p>
          </div>
          <div>
            <label className={INPUT.label}>Confirm Password</label>
            <input className={INPUT.base} type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required />
          </div>
        </div>
        <div className={MODAL.footer}>
          <button type="button" className={BTN.secondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={BTN.danger} disabled={saving}>{saving ? 'Resetting...' : 'Reset Password'}</button>
        </div>
      </form>
    </Modal>
  );
}

// ── Home Access Modal ────────────────────────────────────────────────────────

function HomeAccessModal({ user, allHomes, onClose, onSuccess }) {
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState(null);

  useEffect(() => {
    getUserHomes(user.id).then(res => {
      setSelected(new Set(res.homeIds));
    }).catch(err => {
      setLocalError(err.message);
    }).finally(() => setLoading(false));
  }, [user.id]);

  function toggle(homeId) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(homeId)) next.delete(homeId);
      else next.add(homeId);
      return next;
    });
  }

  async function handleSave() {
    setLocalError(null);
    setSaving(true);
    try {
      await setUserHomes(user.id, [...selected]);
      onSuccess(`Home access updated for "${user.username}"`);
      onClose();
    } catch (err) {
      setLocalError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={true} onClose={onClose} title={`Home Access — ${user.username}`}>
      {localError && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg border border-red-200 mb-4">{localError}</div>}
      {loading ? (
        <p className="text-gray-400 text-sm py-4 text-center">Loading...</p>
      ) : allHomes.length === 0 ? (
        <p className="text-gray-400 text-sm py-4 text-center">No homes configured</p>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {allHomes.map(h => (
            <label key={h.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
              <input type="checkbox" checked={selected.has(h.id)} onChange={() => toggle(h.id)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
              <span className="text-sm text-gray-700">{h.name}</span>
            </label>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
        <button type="button" className={`${BTN.ghost} ${BTN.xs}`}
          onClick={() => setSelected(new Set(allHomes.map(h => h.id)))}>Select All</button>
        <div className="flex gap-3">
          <button type="button" className={BTN.secondary} onClick={onClose}>Cancel</button>
          <button type="button" className={BTN.primary} onClick={handleSave} disabled={saving || loading}>
            {saving ? 'Saving...' : 'Save Access'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
