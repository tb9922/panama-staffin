import { useState, useEffect, useCallback } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import { ROLES, ROLE_IDS, getRoleLabel } from '../../shared/roles.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import {
  listUsers, createUser, updateUser, resetUserPassword,
  getUserRoles, setUserRoles, listAllHomesForAccess,
} from '../lib/api.js';

const ROLE_BADGE = {
  home_manager: BADGE.purple,
  deputy_manager: BADGE.blue,
  training_lead: BADGE.green,
  finance_officer: BADGE.amber,
  hr_officer: BADGE.pink,
  shift_coordinator: BADGE.orange,
  viewer: BADGE.gray,
  staff_member: BADGE.gray,
};

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export default function UserManagement() {
  const { isPlatformAdmin } = useAuth();
  const [users, setUsers] = useState([]);
  const [allHomes, setAllHomes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Modal state
  const [addOpen, setAddOpen] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [resetPwUser, setResetPwUser] = useState(null);
  const [rolesUser, setRolesUser] = useState(null);

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
                <th scope="col" className={TABLE.th}>Status</th>
                <th scope="col" className={TABLE.th}>Last Login</th>
                <th scope="col" className={TABLE.th}>Created</th>
                <th scope="col" className={TABLE.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr><td colSpan={6} className={TABLE.empty}>No users found</td></tr>
              ) : users.map(u => (
                <tr key={u.id} className={TABLE.tr}>
                  <td className={`${TABLE.td} font-medium text-gray-900`}>
                    {u.username}
                    {u.is_platform_admin && <span className={`${BADGE.purple} ml-2`}>Platform Admin</span>}
                  </td>
                  <td className={TABLE.td}>{u.display_name || '—'}</td>
                  <td className={TABLE.td}>
                    <span className={u.active ? BADGE.green : BADGE.red}>{u.active ? 'Active' : 'Inactive'}</span>
                  </td>
                  <td className={TABLE.td}>{formatDate(u.last_login_at)}</td>
                  <td className={TABLE.td}>{formatDate(u.created_at)}</td>
                  <td className={TABLE.td}>
                    <div className="flex items-center gap-1">
                      <button className={`${BTN.ghost} ${BTN.xs}`} onClick={() => setEditUser(u)}>Edit</button>
                      <button className={`${BTN.ghost} ${BTN.xs}`} onClick={() => setResetPwUser(u)}>Reset PW</button>
                      <button className={`${BTN.ghost} ${BTN.xs}`} onClick={() => setRolesUser(u)}>Roles</button>
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
      {rolesUser && <HomeRolesModal user={rolesUser} allHomes={allHomes} isPlatformAdmin={isPlatformAdmin} onClose={() => setRolesUser(null)} onSuccess={(msg) => { setSuccess(msg); }} />}
    </div>
  );
}

// ── Add User Modal ───────────────────────────────────────────────────────────

function AddUserModal({ onClose, onSuccess }) {
  const [form, setForm] = useState({ username: '', password: '', confirmPassword: '', displayName: '' });
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
      await createUser({ username: form.username, password: form.password, role: 'viewer', displayName: form.displayName });
      onSuccess(`User "${form.username}" created — assign roles via the Roles button`);
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
            <input className={INPUT.base} value={form.username} onChange={e => set('username', e.target.value)} required minLength={3} maxLength={100} pattern="[a-zA-Z0-9._\-]+" title="Letters, numbers, dots, underscores, hyphens" autoFocus />
          </div>
          <div>
            <label className={INPUT.label}>Display Name</label>
            <input className={INPUT.base} value={form.displayName} onChange={e => set('displayName', e.target.value)} maxLength={200} placeholder="Optional" />
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
        <p className="text-xs text-gray-500 mt-3">After creating, use the Roles button to assign per-home roles.</p>
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
  const [form, setForm] = useState({ displayName: user.display_name || '', active: user.active });
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState(null);

  function set(key, val) { setForm(prev => ({ ...prev, [key]: val })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setLocalError(null);
    setSaving(true);
    try {
      await updateUser(user.id, { displayName: form.displayName, active: form.active });
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

// ── Home Roles Modal ─────────────────────────────────────────────────────────

// Roles that non-platform-admins (home managers) can assign
const ASSIGNABLE_ROLES = ROLE_IDS.filter(r => r !== 'home_manager');

function HomeRolesModal({ user, allHomes, isPlatformAdmin, onClose, onSuccess }) {
  // Map of homeId → roleId (empty string = no access)
  const [roleMap, setRoleMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState(null);

  useEffect(() => {
    getUserRoles(user.id).then(res => {
      const map = {};
      for (const r of res.roles) map[r.home_id] = r.role_id;
      setRoleMap(map);
    }).catch(err => {
      setLocalError(err.message);
    }).finally(() => setLoading(false));
  }, [user.id]);

  function setRole(homeId, roleId) {
    setRoleMap(prev => {
      const next = { ...prev };
      if (roleId) next[homeId] = roleId;
      else delete next[homeId];
      return next;
    });
  }

  async function handleSave() {
    setLocalError(null);
    setSaving(true);
    try {
      const roles = Object.entries(roleMap)
        .filter(([, roleId]) => roleId)
        .map(([homeId, roleId]) => ({ homeId: Number(homeId), roleId }));
      await setUserRoles(user.id, roles);
      onSuccess(`Roles updated for "${user.username}"`);
      onClose();
    } catch (err) {
      setLocalError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const availableRoles = isPlatformAdmin ? ROLE_IDS : ASSIGNABLE_ROLES;

  return (
    <Modal isOpen={true} onClose={onClose} title={`Roles — ${user.username}`} size="lg">
      {localError && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg border border-red-200 mb-4">{localError}</div>}
      {loading ? (
        <p className="text-gray-400 text-sm py-4 text-center">Loading...</p>
      ) : allHomes.length === 0 ? (
        <p className="text-gray-400 text-sm py-4 text-center">No homes configured</p>
      ) : (
        <>
          <p className="text-xs text-gray-500 mb-3">
            Assign a role per home. Set to "No Access" to revoke.
            {!isPlatformAdmin && ' Only platform admins can assign the Home Manager role.'}
          </p>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {allHomes.map(h => {
              const currentRole = roleMap[h.id] || '';
              return (
                <div key={h.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors">
                  <span className="text-sm text-gray-700 flex-1 min-w-0 truncate">{h.name}</span>
                  <select
                    className={`${INPUT.sm} w-48`}
                    value={currentRole}
                    onChange={e => setRole(h.id, e.target.value)}
                  >
                    <option value="">No Access</option>
                    {availableRoles.map(rid => (
                      <option key={rid} value={rid}>{getRoleLabel(rid)}</option>
                    ))}
                  </select>
                  {currentRole && (
                    <span className={`${ROLE_BADGE[currentRole] || BADGE.gray} text-xs whitespace-nowrap`}>
                      {getRoleLabel(currentRole)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
      <div className={MODAL.footer}>
        <button type="button" className={BTN.secondary} onClick={onClose}>Cancel</button>
        <button type="button" className={BTN.primary} onClick={handleSave} disabled={saving || loading}>
          {saving ? 'Saving...' : 'Save Roles'}
        </button>
      </div>
    </Modal>
  );
}
