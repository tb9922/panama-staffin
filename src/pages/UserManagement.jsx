import { useState, useEffect, useCallback } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import { ROLES, ROLE_IDS, getRoleLabel } from '../../shared/roles.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useData } from '../contexts/DataContext.jsx';
import useDirtyGuard from '../hooks/useDirtyGuard';
import useTransientNotice from '../hooks/useTransientNotice.js';
import {
  getCurrentHome, listUsersForHome, createUser, updateUser, resetUserPassword,
  setUserHomeRole, listAllHomesForAccess, getUserAllRoles, setUserRolesBulk,
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

const ROLE_GROUPS = [
  { key: 'home_manager', label: 'Home Manager', roles: ['home_manager'] },
  { key: 'deputy_manager', label: 'Deputy Manager', roles: ['deputy_manager'] },
  { key: 'officers', label: 'Officers', roles: ['training_lead', 'finance_officer', 'hr_officer'] },
  { key: 'coordinators', label: 'Shift Coordinators', roles: ['shift_coordinator'] },
  { key: 'viewers', label: 'Viewers', roles: ['viewer'] },
  { key: 'staff', label: 'Staff', roles: ['staff_member'] },
];



export default function UserManagement() {
  const { isPlatformAdmin } = useAuth();
  const { homeRole } = useData();
  const canManageUsers = isPlatformAdmin || ROLES[homeRole]?.canManageUsers === true;
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { notice, showNotice, clearNotice } = useTransientNotice();
  const homeSlug = getCurrentHome();

  // Modal state
  const [addOpen, setAddOpen] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [resetPwUser, setResetPwUser] = useState(null);
  const [rolesUser, setRolesUser] = useState(null);
  useDirtyGuard(!!(addOpen || editUser || resetPwUser || rolesUser));

  const refresh = useCallback(async () => {
    if (!homeSlug) return;
    try {
      const u = await listUsersForHome(homeSlug);
      setUsers(u);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [homeSlug]);

  useEffect(() => { refresh(); }, [refresh]);

  // Group users by role hierarchy
  const grouped = ROLE_GROUPS.map(g => ({
    ...g,
    users: users.filter(u => g.roles.includes(u.role_id)),
  })).filter(g => g.users.length > 0);

  if (loading) return <div className={PAGE.container}><LoadingState message="Loading users and access roles..." /></div>;

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <h1 className={PAGE.title}>User Management</h1>
        {canManageUsers && (
          <button className={`${BTN.primary} ${BTN.sm}`} onClick={() => setAddOpen(true)}>Add User</button>
        )}
      </div>

      {error && <ErrorState title="Unable to load users" message={error} onRetry={refresh} className="mb-4" />}
      {notice && <InlineNotice variant={notice.variant} className="mb-4" onDismiss={clearNotice}>{notice.content}</InlineNotice>}

      {users.length === 0 ? (
        <div className={CARD.padded}>
          <EmptyState
            title="No users assigned to this home"
            description={canManageUsers ? 'Create the first user for this home to get access set up.' : 'Ask a home manager or platform admin to assign users here.'}
            actionLabel={canManageUsers ? 'Add User' : undefined}
            onAction={canManageUsers ? () => setAddOpen(true) : undefined}
            compact
          />
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(group => (
            <div key={group.key} className={CARD.flush}>
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                <h2 className="text-sm font-semibold text-gray-700">
                  {group.label}
                  <span className="ml-2 text-xs font-normal text-gray-400">({group.users.length})</span>
                </h2>
              </div>
              <div className={TABLE.wrapper}>
                <table className={TABLE.table}>
                  <thead className={TABLE.thead}>
                    <tr>
                      <th scope="col" className={TABLE.th}>Username</th>
                      <th scope="col" className={TABLE.th}>Display Name</th>
                      <th scope="col" className={TABLE.th}>Role</th>
                      <th scope="col" className={TABLE.th}>Status</th>
                      <th scope="col" className={TABLE.th}>Granted By</th>
                      <th scope="col" className={TABLE.th}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.users.map(u => (
                      <tr key={u.id} className={TABLE.tr}>
                        <td className={`${TABLE.td} font-medium text-gray-900`}>
                          {u.username}
                          {u.is_platform_admin && <span className={`${BADGE.purple} ml-2`}>Platform Admin</span>}
                        </td>
                        <td className={TABLE.td}>{u.display_name || '\u2014'}</td>
                        <td className={TABLE.td}>
                          <span className={ROLE_BADGE[u.role_id] || BADGE.gray}>{getRoleLabel(u.role_id)}</span>
                          {u.staff_id && <span className="ml-1 text-xs text-gray-400">({u.staff_id})</span>}
                        </td>
                        <td className={TABLE.td}>
                          <span className={u.active ? BADGE.green : BADGE.red}>{u.active ? 'Active' : 'Inactive'}</span>
                        </td>
                        <td className={TABLE.td}>{u.granted_by || '\u2014'}</td>
                        <td className={TABLE.td}>
                          <div className="flex items-center gap-1">
                            {canManageUsers && (
                              <button className={`${BTN.ghost} ${BTN.xs}`} onClick={() => setEditUser(u)}>Edit</button>
                            )}
                            {isPlatformAdmin && (
                              <button className={`${BTN.ghost} ${BTN.xs}`} onClick={() => setResetPwUser(u)}>Reset PW</button>
                            )}
                            {canManageUsers && (
                              <button className={`${BTN.ghost} ${BTN.xs}`} onClick={() => setRolesUser(u)}>Role</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {addOpen && <AddUserModal homeSlug={homeSlug} onClose={() => setAddOpen(false)} onSuccess={(msg) => { showNotice(msg); refresh(); }} />}
      {editUser && <EditUserModal user={editUser} homeSlug={homeSlug} onClose={() => setEditUser(null)} onSuccess={(msg) => { showNotice(msg); refresh(); }} />}
      {resetPwUser && <ResetPasswordModal user={resetPwUser} homeSlug={homeSlug} onClose={() => setResetPwUser(null)} onSuccess={(msg) => { showNotice(msg); }} />}
      {rolesUser && (
        isPlatformAdmin
          ? <PlatformRolesModal user={rolesUser} onClose={() => setRolesUser(null)} onSuccess={(msg) => { showNotice(msg); refresh(); }} />
          : <HomeRoleModal user={rolesUser} homeSlug={homeSlug} onClose={() => setRolesUser(null)} onSuccess={(msg) => { showNotice(msg); refresh(); }} />
      )}
    </div>
  );
}

// ── Add User Modal ───────────────────────────────────────────────────────────

function AddUserModal({ homeSlug, onClose, onSuccess }) {
  const { isPlatformAdmin } = useAuth();
  const [form, setForm] = useState({ username: '', password: '', confirmPassword: '', displayName: '', homeRoleId: '' });
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState(null);

  function set(key, val) { setForm(prev => ({ ...prev, [key]: val })); }

  const availableRoles = isPlatformAdmin ? ROLE_IDS : ROLE_IDS.filter(r => r !== 'home_manager');

  async function handleSubmit(e) {
    e.preventDefault();
    setLocalError(null);
    if (form.password !== form.confirmPassword) { setLocalError('Passwords do not match'); return; }
    if (form.password.length < 10) { setLocalError('Password must be at least 10 characters'); return; }
    setSaving(true);
    try {
      const data = {
        username: form.username,
        password: form.password,
        role: 'viewer',
        displayName: form.displayName,
      };
      if (form.homeRoleId) data.homeRoleId = form.homeRoleId;
      await createUser(homeSlug, data);
      onSuccess(`User "${form.username}" created and assigned to this home`);
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
        {localError && <InlineNotice variant="error" className="mb-4" role="alert">{localError}</InlineNotice>}
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
            <label className={INPUT.label}>Role at This Home</label>
            <select className={INPUT.select} value={form.homeRoleId} onChange={e => set('homeRoleId', e.target.value)}>
              <option value="">Select role...</option>
              {availableRoles.map(rid => (
                <option key={rid} value={rid}>{getRoleLabel(rid)}</option>
              ))}
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

function EditUserModal({ user, homeSlug, onClose, onSuccess }) {
  const { isPlatformAdmin } = useAuth();
  const [form, setForm] = useState({ displayName: user.display_name || '', active: user.active });
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState(null);

  function set(key, val) { setForm(prev => ({ ...prev, [key]: val })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setLocalError(null);
    setSaving(true);
    try {
      const payload = { displayName: form.displayName };
      if (isPlatformAdmin) payload.active = form.active;
      await updateUser(homeSlug, user.id, payload);
      onSuccess(`User "${user.username}" updated`);
      onClose();
    } catch (err) {
      setLocalError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={true} onClose={onClose} title={`Edit User \u2014 ${user.username}`}>
      <form onSubmit={handleSubmit}>
        {localError && <InlineNotice variant="error" className="mb-4" role="alert">{localError}</InlineNotice>}
        <div className="space-y-3">
          <div>
            <label className={INPUT.label}>Display Name</label>
            <input className={INPUT.base} value={form.displayName} onChange={e => set('displayName', e.target.value)} maxLength={200} autoFocus />
          </div>
          {isPlatformAdmin ? (
            <div className="flex items-center gap-2">
              <input type="checkbox" id="user-active" checked={form.active} onChange={e => set('active', e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
              <label htmlFor="user-active" className="text-sm text-gray-700">Active</label>
            </div>
          ) : (
            <p className="text-xs text-gray-500 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200">
              Home managers can update display names here. Account status changes require a platform admin.
            </p>
          )}
          {isPlatformAdmin && !form.active && (
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

function ResetPasswordModal({ user, homeSlug, onClose, onSuccess }) {
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
      await resetUserPassword(homeSlug, user.id, password);
      onSuccess(`Password reset for "${user.username}" \u2014 all sessions revoked`);
      onClose();
    } catch (err) {
      setLocalError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={true} onClose={onClose} title={`Reset Password \u2014 ${user.username}`} size="sm">
      <form onSubmit={handleSubmit}>
        {localError && <InlineNotice variant="error" className="mb-4" role="alert">{localError}</InlineNotice>}
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

// ── Home Role Modal (per-home, for home managers) ────────────────────────────

const ASSIGNABLE_ROLES = ROLE_IDS.filter(r => r !== 'home_manager');

function HomeRoleModal({ user, homeSlug, onClose, onSuccess }) {
  const [roleId, setRoleId] = useState(user.role_id || '');
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState(null);

  async function handleSave() {
    if (!roleId) { setLocalError('Please select a role'); return; }
    setLocalError(null);
    setSaving(true);
    try {
      await setUserHomeRole(homeSlug, user.id, roleId);
      onSuccess(`Role updated for "${user.username}"`);
      onClose();
    } catch (err) {
      setLocalError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={true} onClose={onClose} title={`Role \u2014 ${user.username}`} size="sm">
      {localError && <InlineNotice variant="error" className="mb-4" role="alert">{localError}</InlineNotice>}
      <p className="text-xs text-gray-500 mb-3">Set the role for this user at the current home.</p>
      <select className={INPUT.select} value={roleId} onChange={e => setRoleId(e.target.value)}>
        <option value="">Select role...</option>
        {ASSIGNABLE_ROLES.map(rid => (
          <option key={rid} value={rid}>{getRoleLabel(rid)}</option>
        ))}
      </select>
      <div className={MODAL.footer}>
        <button type="button" className={BTN.secondary} onClick={onClose}>Cancel</button>
        <button type="button" className={BTN.primary} onClick={handleSave} disabled={saving || !roleId}>
          {saving ? 'Saving...' : 'Save Role'}
        </button>
      </div>
    </Modal>
  );
}

// ── Platform Roles Modal (multi-home, for platform admins) ───────────────────

function PlatformRolesModal({ user, onClose, onSuccess }) {
  const [roleMap, setRoleMap] = useState({});
  const [allHomes, setAllHomes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState(null);

  useEffect(() => {
    Promise.all([
      listAllHomesForAccess(),
      getUserAllRoles(user.id),
    ]).then(([homes, rolesData]) => {
      setAllHomes(homes);
      const map = {};
      for (const r of (rolesData.roles || [])) map[r.home_id] = r.role_id;
      setRoleMap(map);
    }).catch(err => {
      setLocalError(err.message);
    }).finally(() => setLoading(false));
  }, [user.id]);

  function setRole(homeId, rid) {
    setRoleMap(prev => {
      const next = { ...prev };
      if (rid) next[homeId] = rid;
      else delete next[homeId];
      return next;
    });
  }

  async function handleSave() {
    setLocalError(null);
    setSaving(true);
    try {
      const roles = Object.entries(roleMap)
        .filter(([, rid]) => rid)
        .map(([homeId, rid]) => ({ homeId: Number(homeId), roleId: rid }));
      await setUserRolesBulk(user.id, roles);
      onSuccess(`Roles updated for "${user.username}"`);
      onClose();
    } catch (err) {
      setLocalError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={true} onClose={onClose} title={`Roles \u2014 ${user.username}`} size="lg">
      {localError && <InlineNotice variant="error" className="mb-4" role="alert">{localError}</InlineNotice>}
      {loading ? (
        <LoadingState message="Loading home access roles..." compact />
      ) : allHomes.length === 0 ? (
        <EmptyState
          title="No homes configured"
          description="Create a home first, then assign access roles here."
          compact
        />
      ) : (
        <>
          <p className="text-xs text-gray-500 mb-3">
            Assign a role per home. Set to "No Access" to revoke.
          </p>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {allHomes.map(home => {
              const currentRole = roleMap[home.id] || '';
              return (
                <div key={home.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors">
                  <span className="text-sm text-gray-700 flex-1 min-w-0 truncate">{home.name}</span>
                  <select
                    className={`${INPUT.sm} w-48`}
                    value={currentRole}
                    onChange={e => setRole(home.id, e.target.value)}
                  >
                    <option value="">No Access</option>
                    {ROLE_IDS.map(rid => (
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
