import { useState, useEffect, useCallback, useId } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import { ROLES, USER_MANAGEMENT_ROLE_IDS, getRoleLabel } from '../../shared/roles.js';
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

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]+$/;

function serializeRoleMap(roleMap) {
  return JSON.stringify(Object.entries(roleMap).sort(([a], [b]) => Number(a) - Number(b)));
}


export default function UserManagement() {
  const { isPlatformAdmin } = useAuth();
  const { homeRole, activeHome } = useData();
  const canManageUsers = isPlatformAdmin || ROLES[homeRole]?.canManageUsers === true;
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { notice, showNotice, clearNotice } = useTransientNotice();
  const homeSlug = activeHome || getCurrentHome();

  // Modal state
  const [addOpen, setAddOpen] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [resetPwUser, setResetPwUser] = useState(null);
  const [rolesUser, setRolesUser] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!homeSlug) {
      setUsers([]);
      setLoading(false);
      return;
    }
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

  const filteredUsers = users.filter((user) => {
    if (statusFilter === 'active' && !user.active) return false;
    if (statusFilter === 'inactive' && user.active) return false;
    if (!search.trim()) return true;
    const haystack = [
      user.username,
      user.display_name,
      user.staff_id,
      user.granted_by,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  });

  // Group users by role hierarchy
  const grouped = ROLE_GROUPS.map(g => ({
    ...g,
    users: filteredUsers.filter(u => g.roles.includes(u.role_id)),
  })).filter(g => g.users.length > 0);

  if (loading) return <div className={PAGE.container}><LoadingState message="Loading users and access roles..." /></div>;

  if (!homeSlug) {
    return (
      <div className={PAGE.container}>
        <div className={CARD.padded}>
          <EmptyState
            title="Select a home to manage users"
            description="User access is assigned per home, so choose a home before adding or editing users."
            compact
          />
        </div>
      </div>
    );
  }

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

      {users.length > 0 && (
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className={INPUT.label} htmlFor="user-search">Search</label>
            <input
              id="user-search"
              className={INPUT.base}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Username, display name, staff ID, or granted by"
            />
          </div>
          <div className="sm:w-48">
            <label className={INPUT.label} htmlFor="user-status-filter">Status</label>
            <select
              id="user-status-filter"
              className={INPUT.select}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All users</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>
      )}

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
          {grouped.length === 0 ? (
            <div className={CARD.padded}>
              <EmptyState
                compact
                title="No users match the current filters"
                description="Try a different search or status filter."
              />
            </div>
          ) : grouped.map(group => (
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
  const usernameId = useId();
  const displayNameId = useId();
  const roleId = useId();
  const passwordId = useId();
  const confirmPasswordId = useId();

  function set(key, val) { setForm(prev => ({ ...prev, [key]: val })); }

  const availableRoles = isPlatformAdmin ? USER_MANAGEMENT_ROLE_IDS : USER_MANAGEMENT_ROLE_IDS.filter(r => r !== 'home_manager');
  const username = form.username.trim();
  const displayName = form.displayName.trim();
  const usernameValid = username.length >= 3 && username.length <= 100 && USERNAME_PATTERN.test(username);
  const isDirty = Object.values(form).some((value) => String(value || '').length > 0);
  const isInvalid = !usernameValid || form.password.length < 10 || form.password !== form.confirmPassword;
  useDirtyGuard(isDirty);

  async function handleSubmit(e) {
    e.preventDefault();
    setLocalError(null);
    if (!usernameValid) { setLocalError('Username must be 3-100 letters, numbers, dots, underscores, or hyphens'); return; }
    if (form.password !== form.confirmPassword) { setLocalError('Passwords do not match'); return; }
    if (form.password.length < 10) { setLocalError('Password must be at least 10 characters'); return; }
    setSaving(true);
    try {
      const data = {
        username,
        password: form.password,
        role: 'viewer',
        displayName,
      };
      if (form.homeRoleId) data.homeRoleId = form.homeRoleId;
      await createUser(homeSlug, data);
      onSuccess(`User "${username}" created and assigned to this home`);
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
            <label className={INPUT.label} htmlFor={usernameId}>Username</label>
            <input id={usernameId} className={INPUT.base} value={form.username} onChange={e => set('username', e.target.value)} required minLength={3} maxLength={100} title="Letters, numbers, dots, underscores, hyphens" autoFocus autoComplete="username" />
          </div>
          <div>
            <label className={INPUT.label} htmlFor={displayNameId}>Display Name</label>
            <input id={displayNameId} className={INPUT.base} value={form.displayName} onChange={e => set('displayName', e.target.value)} maxLength={200} placeholder="Optional" autoComplete="name" />
          </div>
          <div>
            <label className={INPUT.label} htmlFor={roleId}>Role at This Home</label>
            <select id={roleId} className={INPUT.select} value={form.homeRoleId} onChange={e => set('homeRoleId', e.target.value)}>
              <option value="">Select role...</option>
              {availableRoles.map(rid => (
                <option key={rid} value={rid}>{getRoleLabel(rid)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={INPUT.label} htmlFor={passwordId}>Password</label>
            <input id={passwordId} className={INPUT.base} type="password" value={form.password} onChange={e => set('password', e.target.value)} required minLength={10} maxLength={200} autoComplete="new-password" />
            <p className="text-xs text-gray-400 mt-1">Minimum 10 characters</p>
          </div>
          <div>
            <label className={INPUT.label} htmlFor={confirmPasswordId}>Confirm Password</label>
            <input id={confirmPasswordId} className={INPUT.base} type="password" value={form.confirmPassword} onChange={e => set('confirmPassword', e.target.value)} required minLength={10} maxLength={200} autoComplete="new-password" />
          </div>
        </div>
        <div className={MODAL.footer}>
          <button type="button" className={BTN.secondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={BTN.primary} disabled={saving || isInvalid}>{saving ? 'Creating...' : 'Create User'}</button>
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
  const displayNameId = useId();
  const activeId = useId();

  function set(key, val) { setForm(prev => ({ ...prev, [key]: val })); }
  const baselineDisplayName = user.display_name || '';
  const baselineActive = Boolean(user.active);
  const isDirty = form.displayName !== baselineDisplayName || Boolean(form.active) !== baselineActive;
  useDirtyGuard(isDirty);

  async function handleSubmit(e) {
    e.preventDefault();
    setLocalError(null);
    setSaving(true);
    try {
      const payload = { displayName: form.displayName.trim() };
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
            <label className={INPUT.label} htmlFor={displayNameId}>Display Name</label>
            <input id={displayNameId} className={INPUT.base} value={form.displayName} onChange={e => set('displayName', e.target.value)} maxLength={200} autoFocus autoComplete="name" />
          </div>
          {isPlatformAdmin ? (
            <div className="flex items-center gap-2">
              <input type="checkbox" id={activeId} checked={form.active} onChange={e => set('active', e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
              <label htmlFor={activeId} className="text-sm text-gray-700">Active</label>
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
          <button type="submit" className={BTN.primary} disabled={saving || !isDirty}>{saving ? 'Saving...' : 'Save Changes'}</button>
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
  const passwordId = useId();
  const confirmId = useId();
  const isDirty = password.length > 0 || confirm.length > 0;
  const isInvalid = password.length < 10 || password !== confirm;
  useDirtyGuard(isDirty);

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
            <label className={INPUT.label} htmlFor={passwordId}>New Password</label>
            <input id={passwordId} className={INPUT.base} type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={10} maxLength={200} autoFocus autoComplete="new-password" />
            <p className="text-xs text-gray-400 mt-1">Minimum 10 characters</p>
          </div>
          <div>
            <label className={INPUT.label} htmlFor={confirmId}>Confirm Password</label>
            <input id={confirmId} className={INPUT.base} type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required minLength={10} maxLength={200} autoComplete="new-password" />
          </div>
        </div>
        <div className={MODAL.footer}>
          <button type="button" className={BTN.secondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={BTN.danger} disabled={saving || isInvalid}>{saving ? 'Resetting...' : 'Reset Password'}</button>
        </div>
      </form>
    </Modal>
  );
}

// ── Home Role Modal (per-home, for home managers) ────────────────────────────

const ASSIGNABLE_ROLES = USER_MANAGEMENT_ROLE_IDS.filter(r => r !== 'home_manager');

function HomeRoleModal({ user, homeSlug, onClose, onSuccess }) {
  const [roleId, setRoleId] = useState(user.role_id || '');
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState(null);
  const roleSelectId = useId();
  const isDirty = roleId !== (user.role_id || '');
  useDirtyGuard(isDirty);

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
      <label className={INPUT.label} htmlFor={roleSelectId}>Role at This Home</label>
      <select id={roleSelectId} className={INPUT.select} value={roleId} onChange={e => setRoleId(e.target.value)}>
        <option value="">Select role...</option>
        {ASSIGNABLE_ROLES.map(rid => (
          <option key={rid} value={rid}>{getRoleLabel(rid)}</option>
        ))}
      </select>
      <div className={MODAL.footer}>
        <button type="button" className={BTN.secondary} onClick={onClose}>Cancel</button>
        <button type="button" className={BTN.primary} onClick={handleSave} disabled={saving || !roleId || !isDirty}>
          {saving ? 'Saving...' : 'Save Role'}
        </button>
      </div>
    </Modal>
  );
}

// ── Platform Roles Modal (multi-home, for platform admins) ───────────────────

function PlatformRolesModal({ user, onClose, onSuccess }) {
  const [roleMap, setRoleMap] = useState({});
  const [baselineRoleMap, setBaselineRoleMap] = useState({});
  const [allHomes, setAllHomes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState(null);
  const isDirty = serializeRoleMap(roleMap) !== serializeRoleMap(baselineRoleMap);
  useDirtyGuard(isDirty);

  useEffect(() => {
    Promise.all([
      listAllHomesForAccess(),
      getUserAllRoles(user.id),
    ]).then(([homes, rolesData]) => {
      setAllHomes(homes);
      const map = {};
      for (const r of (rolesData.roles || [])) map[r.home_id] = r.role_id;
      setRoleMap(map);
      setBaselineRoleMap(map);
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
              const selectId = `platform-role-${user.id}-${home.id}`;
              return (
                <div key={home.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors">
                  <label htmlFor={selectId} className="text-sm text-gray-700 flex-1 min-w-0 truncate">{home.name}</label>
                  <select
                    id={selectId}
                    className={`${INPUT.sm} w-48`}
                    value={currentRole}
                    onChange={e => setRole(home.id, e.target.value)}
                  >
                    <option value="">No Access</option>
                    {USER_MANAGEMENT_ROLE_IDS.map(rid => (
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
        <button type="button" className={BTN.primary} onClick={handleSave} disabled={saving || loading || !isDirty}>
          {saving ? 'Saving...' : 'Save Roles'}
        </button>
      </div>
    </Modal>
  );
}
