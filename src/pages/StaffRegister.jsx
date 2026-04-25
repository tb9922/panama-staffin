import { useState, useMemo, useEffect, Fragment } from 'react';
import { Link } from 'react-router-dom';
import { isCareRole, calculateStaffPeriodHours, getCycleDates } from '../lib/rotation.js';
import { CARD, TABLE, INPUT, BTN, BADGE, MODAL, PAGE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import { useConfirm } from '../hooks/useConfirm.jsx';
import { downloadXLSX } from '../lib/excel.js';
import {
  getCurrentHome,
  getSchedulingData,
  createStaff,
  updateStaffMember,
  deleteStaffMember,
  createStaffInvite,
  revokeStaffSessions,
} from '../lib/api.js';
import { DEFAULT_NLW_RATE, getConfiguredNlwRate, getMinimumWageRate } from '../../shared/nmw.js';
import { useData } from '../contexts/DataContext.jsx';
import { todayLocalISO } from '../lib/localDates.js';
import ErrorState from '../components/ErrorState.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import LoadingState from '../components/LoadingState.jsx';
import StickyTable from '../components/StickyTable.jsx';
import useTransientNotice from '../hooks/useTransientNotice.js';

const ROLES = ['Senior Carer', 'Carer', 'Team Lead', 'Night Senior', 'Night Carer', 'Float Senior', 'Float Carer'];
const TEAMS = ['Day A', 'Day B', 'Night A', 'Night B', 'Float'];
const PREFS = ['EL', 'E', 'L', 'N', 'ANY'];

function downloadCSV(filename, headers, rows) {
  const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

const EMPTY_STAFF = {
  name: '', role: 'Carer', team: 'Day A', pref: 'EL', skill: 0.5,
  hourly_rate: DEFAULT_NLW_RATE, active: true, start_date: '', leaving_date: '', notes: '', wtr_opt_out: false,
  contract_hours: null, al_entitlement: null, al_carryover: 0, date_of_birth: null,
};

const NEW_STAFF_FIELD_IDS = {
  role: 'staff-register-new-role',
  team: 'staff-register-new-team',
  pref: 'staff-register-new-pref',
  skill: 'staff-register-new-skill',
  rate: 'staff-register-new-rate',
  contractHours: 'staff-register-new-contract-hours',
  startDate: 'staff-register-new-start-date',
  dateOfBirth: 'staff-register-new-date-of-birth',
  notes: 'staff-register-new-notes',
  alEntitlement: 'staff-register-new-al-entitlement',
  alCarryover: 'staff-register-new-al-carryover',
};

export default function StaffRegister() {
  const homeSlug = getCurrentHome();
  const { canWrite } = useData();
  const canEdit = canWrite('staff');
  const { confirm, ConfirmDialog } = useConfirm();
  const [allStaff, setAllStaff] = useState([]);
  const [config, setConfig] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rowError, setRowError] = useState(null); // { id, msg }
  const [rowWarning, setRowWarning] = useState(null); // { id, msgs: string[] }

  const [filterTeam, setFilterTeam] = useState('All');
  const [filterActive, setFilterActive] = useState('active');
  const [sortCol, setSortCol] = useState('name');
  const [sortDir, setSortDir] = useState(1);
  const [editing, setEditing] = useState(null); // staffId or null
  const [editingRow, setEditingRow] = useState(null); // local copy of the row being edited
  const [showAdd, setShowAdd] = useState(false);
  const [newStaff, setNewStaff] = useState({ ...EMPTY_STAFF });
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const { notice, showNotice, clearNotice } = useTransientNotice();
  const [inviteModal, setInviteModal] = useState(null);
  const [inviteBusyId, setInviteBusyId] = useState(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [revokeBusyId, setRevokeBusyId] = useState(null);
  const [revokeMessage, setRevokeMessage] = useState(null);

  useDirtyGuard(!!editing || showAdd);

  useEffect(() => {
    let stale = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const d = await getSchedulingData(homeSlug);
        if (!stale) { setAllStaff(d.staff || []); setConfig(d.config || {}); setOverrides(d.overrides || {}); }
      } catch (e) { if (!stale) setError(e.message); }
      finally { if (!stale) setLoading(false); }
    })();
    return () => { stale = true; };
  }, [homeSlug, refreshKey]);

  const nlwRate = getConfiguredNlwRate(config);

  const staff = useMemo(() => {
    let list = [...allStaff];
    if (filterTeam !== 'All') list = list.filter(s => s.team === filterTeam);
    if (filterActive === 'active') list = list.filter(s => s.active !== false);
    else if (filterActive === 'inactive') list = list.filter(s => s.active === false);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(s => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      const av = a[sortCol] ?? '';
      const bv = b[sortCol] ?? '';
      if (typeof av === 'string') return av.localeCompare(bv) * sortDir;
      return (av - bv) * sortDir;
    });
    return list;
  }, [allStaff, filterTeam, filterActive, sortCol, sortDir, search]);

  // Calculate 28-day stats for each staff member
  const cycleDates = useMemo(() => {
    if (!config?.cycle_start_date) return [];
    return getCycleDates(config.cycle_start_date, new Date(), 28);
  }, [config?.cycle_start_date]);

  const staffStats = useMemo(() => {
    if (!config) return {};
    const map = {};
    allStaff.filter(s => s.active !== false).forEach(s => {
      map[s.id] = calculateStaffPeriodHours(s, cycleDates, overrides, config);
    });
    return map;
  }, [allStaff, cycleDates, overrides, config]);

  function toggleSort(col) {
    if (sortCol === col) setSortDir(-sortDir);
    else { setSortCol(col); setSortDir(1); }
  }

  function startEditing(s) {
    setEditing(s.id);
    setEditingRow({ ...s });
    setRowError(null);
    setRowWarning(null);
  }

  function updateEditingRow(field, value) {
    setEditingRow(prev => {
      const updated = { ...prev, [field]: value };
      // Auto-set leaving_date when deactivating
      if (field === 'active' && value === false && !prev.leaving_date) {
        updated.leaving_date = todayLocalISO();
      }
      // Clear leaving_date when reactivating
      if (field === 'active' && value === true) {
        updated.leaving_date = null;
      }
      return updated;
    });
  }

  async function commitEdit() {
    if (!editingRow) { setEditing(null); return; }
    setSaving(true);
    setRowError(null);
    setRowWarning(null);
    try {
      const cleaned = {
        ...editingRow,
        start_date: editingRow.start_date || null,
        leaving_date: editingRow.leaving_date || null,
        _version: editingRow.version,
      };
      const result = await updateStaffMember(homeSlug, editingRow.id, cleaned);
      setEditing(null);
      setEditingRow(null);
      setRefreshKey(k => k + 1);
      if (result?.warnings?.length) setRowWarning({ id: editingRow.id, msgs: result.warnings });
    } catch (e) {
      setRowError({ id: editingRow.id, msg: e.message });
    } finally {
      setSaving(false);
    }
  }

  function cancelEdit() {
    setEditing(null);
    setEditingRow(null);
    setRowError(null);
    setRowWarning(null);
  }

  async function addStaff() {
    const staffEntry = {
      ...newStaff,
      start_date: newStaff.start_date || null,
      leaving_date: newStaff.leaving_date || null,
    };
    setSaving(true);
    setRowError(null);
    setRowWarning(null);
    try {
      const result = await createStaff(homeSlug, staffEntry);
      setNewStaff({ ...EMPTY_STAFF });
      setShowAdd(false);
      setRefreshKey(k => k + 1);
      showNotice(
        <>
          Staff member added.{' '}
          {result?.id && (
            <Link to={`/onboarding?staffId=${encodeURIComponent(result.id)}`} className="underline font-medium">
              Continue in Onboarding {'->'}
            </Link>
          )}
        </>,
        { duration: 10000 },
      );
      // Use the DB-assigned staff ID so the warning banner appears under the new row in the table.
      if (result?.warnings?.length) setRowWarning({ id: result.id, msgs: result.warnings });
    } catch (e) {
      setRowError({ id: 'add', msg: e.message });
    } finally {
      setSaving(false);
    }
  }

  async function removeStaff(id) {
    const s = allStaff.find(x => x.id === id);
    if (!s || !await confirm(`Remove ${s.name} (${id})? This will also remove all their overrides.`)) return;
    setSaving(true);
    setRowError(null);
    try {
      await deleteStaffMember(homeSlug, id);
      if (editing === id) { setEditing(null); setEditingRow(null); }
      setRefreshKey(k => k + 1);
    } catch (e) {
      setRowError({ id, msg: e.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleInviteStaff(staffMember) {
    setInviteBusyId(staffMember.id);
    setRowError(null);
    try {
      const invite = await createStaffInvite(homeSlug, staffMember.id);
      const absoluteUrl = invite?.inviteUrl?.startsWith('http')
        ? invite.inviteUrl
        : `${window.location.origin}${invite?.inviteUrl || ''}`;
      setInviteModal({
        staffId: staffMember.id,
        staffName: staffMember.name,
        expiresAt: invite?.expiresAt || null,
        inviteUrl: absoluteUrl,
      });
      setInviteCopied(false);
    } catch (e) {
      setRowError({ id: staffMember.id, msg: e.message });
    } finally {
      setInviteBusyId(null);
    }
  }

  async function copyInviteLink() {
    if (!inviteModal?.inviteUrl) return;
    await navigator.clipboard.writeText(inviteModal.inviteUrl);
    setInviteCopied(true);
  }

  async function handleRevokeSessions(staffMember) {
    if (!canEdit) return;
    if (!window.confirm(`Sign out ${staffMember.name} from the staff portal everywhere? They'll need to log in again.`)) {
      return;
    }
    setRevokeBusyId(staffMember.id);
    setRevokeMessage(null);
    setRowError(null);
    try {
      await revokeStaffSessions(homeSlug, staffMember.id);
      setRevokeMessage({ id: staffMember.id, msg: `${staffMember.name} signed out — sessions revoked.` });
    } catch (e) {
      // 404 means staff has no portal credentials — surface as a friendly hint
      if (e.status === 404) {
        setRowError({ id: staffMember.id, msg: 'No active staff-portal sessions to revoke.' });
      } else {
        setRowError({ id: staffMember.id, msg: e.message });
      }
    } finally {
      setRevokeBusyId(null);
    }
  }

  const teamCounts = useMemo(() => {
    const counts = {};
    TEAMS.forEach(t => { counts[t] = allStaff.filter(s => s.team === t && s.active !== false).length; });
    counts.total = allStaff.filter(s => s.active !== false).length;
    return counts;
  }, [allStaff]);

  const SortHeader = ({ col, children, className = '' }) => (
    <th
      scope="col"
      aria-sort={sortCol === col ? (sortDir === 1 ? 'ascending' : 'descending') : 'none'}
      className={`${TABLE.th} text-xs ${className}`}
    >
      <button type="button" className="flex items-center gap-1 text-left transition-colors hover:text-blue-600" onClick={() => toggleSort(col)}>
        <span>{children}</span>
        <span aria-hidden="true">{sortCol === col ? (sortDir === 1 ? '\u25B2' : '\u25BC') : ''}</span>
      </button>
    </th>
  );

  function handlePrint() {
    window.print();
  }

  const isEd = (id) => editing === id;
  const _row = (id) => (editing === id ? editingRow : allStaff.find(s => s.id === id)) || {};

  if (loading) {
    return (
      <div className={PAGE.container}>
        <LoadingState message="Loading staff..." card />
      </div>
    );
  }

  if (error) {
    return (
      <div className={PAGE.container}>
        <ErrorState title="Unable to load staff" message={error} onRetry={() => setRefreshKey(k => k + 1)} />
      </div>
    );
  }

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Staff Database</h1>
          <p className="mt-1 text-xs text-[var(--ink-3)]">
            {TEAMS.map(t => `${t}: ${teamCounts[t]}`).join(' | ')} | Total: {teamCounts.total}
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 print:hidden lg:w-auto lg:justify-end">
          <button onClick={() => {
            const headers = canEdit
              ? ['ID', 'Name', 'Role', 'Team', 'Pref', 'Skill', 'Rate £/hr', 'Start Date', 'Leaving Date', 'WTR Opt-Out', 'Active', 'Notes', '28d Hours', '28d Pay']
              : ['ID', 'Name', 'Role', 'Team', 'Pref', 'Skill', 'Start Date', 'Leaving Date', 'WTR Opt-Out', 'Active', 'Notes', '28d Hours'];
            const rows = staff.map(s => {
              const stats = staffStats[s.id];
              return canEdit
                ? [s.id, s.name, s.role, s.team, s.pref, s.skill, s.hourly_rate?.toFixed(2),
                  s.start_date || '', s.leaving_date || '', s.wtr_opt_out ? 'Y' : 'N', s.active !== false ? 'Y' : 'N',
                  s.notes || '', stats ? stats.paidHours.toFixed(1) : '', stats ? stats.totalPay.toFixed(0) : '']
                : [s.id, s.name, s.role, s.team, s.pref, s.skill,
                  s.start_date || '', s.leaving_date || '', s.wtr_opt_out ? 'Y' : 'N', s.active !== false ? 'Y' : 'N',
                  s.notes || '', stats ? stats.paidHours.toFixed(1) : ''];
            });
            downloadCSV('staff_register.csv', headers, rows);
          }} className={`${BTN.secondary} flex-1 whitespace-nowrap sm:flex-none`}>Export CSV</button>
          <button onClick={() => {
            const headers = canEdit
              ? ['ID', 'Name', 'Role', 'Team', 'Pref', 'Skill', 'Rate £/hr', 'Start Date', 'Leaving Date', 'WTR Opt-Out', 'Active', 'Notes', '28d Hours', '28d Pay']
              : ['ID', 'Name', 'Role', 'Team', 'Pref', 'Skill', 'Start Date', 'Leaving Date', 'WTR Opt-Out', 'Active', 'Notes', '28d Hours'];
            const rows = staff.map(s => {
              const stats = staffStats[s.id];
              return canEdit
                ? [s.id, s.name, s.role, s.team, s.pref, s.skill,
                  s.hourly_rate != null ? parseFloat(s.hourly_rate.toFixed(2)) : '',
                  s.start_date || '', s.leaving_date || '', s.wtr_opt_out ? 'Y' : 'N', s.active !== false ? 'Y' : 'N',
                  s.notes || '',
                  stats ? parseFloat(stats.paidHours.toFixed(1)) : '',
                  stats ? parseFloat(stats.totalPay.toFixed(0)) : '']
                : [s.id, s.name, s.role, s.team, s.pref, s.skill,
                  s.start_date || '', s.leaving_date || '', s.wtr_opt_out ? 'Y' : 'N', s.active !== false ? 'Y' : 'N',
                  s.notes || '',
                  stats ? parseFloat(stats.paidHours.toFixed(1)) : ''];
            });
            downloadXLSX('staff_register', [{ name: 'Staff Register', headers, rows }]);
          }} className={`${BTN.secondary} flex-1 whitespace-nowrap sm:flex-none`}>Export Excel</button>
          <button onClick={handlePrint} className={`${BTN.secondary} flex-1 whitespace-nowrap sm:flex-none`}>Print</button>
          {canEdit && <button onClick={() => { setNewStaff({ ...EMPTY_STAFF, hourly_rate: nlwRate }); setShowAdd(true); }} className={`${BTN.primary} flex-1 whitespace-nowrap sm:flex-none`}>+ Add Staff</button>}
        </div>
      </div>

      {notice && (
        <InlineNotice variant={notice.variant} onDismiss={clearNotice} className="mb-4">
          {notice.content}
        </InlineNotice>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3 print:hidden">
        <input type="text" placeholder="Search name or ID..." value={search} onChange={e => setSearch(e.target.value)}
          className={`${INPUT.sm} min-w-[12rem] flex-1 sm:flex-none`} aria-label="Search staff by name or ID" />
        <select value={filterTeam} onChange={e => setFilterTeam(e.target.value)} className={`${INPUT.select} w-auto flex-1 sm:flex-none`} aria-label="Filter staff by team">
          <option value="All">All Teams</option>
          {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filterActive} onChange={e => setFilterActive(e.target.value)} className={`${INPUT.select} w-auto flex-1 sm:flex-none`} aria-label="Filter staff by active status">
          <option value="active">Active Only</option>
          <option value="inactive">Inactive Only</option>
          <option value="all">All</option>
        </select>
        <span className="self-center text-sm text-[var(--ink-3)]">{staff.length} shown</span>
      </div>

      {/* Add Staff Modal */}
      <Modal isOpen={showAdd} onClose={() => { setShowAdd(false); setRowError(null); setRowWarning(null); }} title="Add New Staff" size="md">
            {rowError?.id === 'add' && (
              <div id="add-staff-error" className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-red-700 text-sm mb-3" role="alert">
                {rowError.msg}
              </div>
            )}
            {rowWarning?.id === 'add' && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-amber-800 text-sm mb-3" role="status">
                {rowWarning.msgs.join(' | ')}
              </div>
            )}
            <div className="space-y-3">
              <div>
                <label htmlFor="staff-register-new-name" className={INPUT.label}>Name</label>
                <input id="staff-register-new-name" type="text" value={newStaff.name} onChange={e => setNewStaff({ ...newStaff, name: e.target.value })}
                  className={INPUT.base} aria-describedby={rowError?.id === 'add' ? 'add-staff-error' : undefined} aria-invalid={rowError?.id === 'add'} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor={NEW_STAFF_FIELD_IDS.role} className={INPUT.label}>Role</label>
                  <select id={NEW_STAFF_FIELD_IDS.role} value={newStaff.role} onChange={e => setNewStaff({ ...newStaff, role: e.target.value })}
                    className={INPUT.select}>
                    {ROLES.map(r => <option key={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor={NEW_STAFF_FIELD_IDS.team} className={INPUT.label}>Team</label>
                  <select id={NEW_STAFF_FIELD_IDS.team} value={newStaff.team} onChange={e => setNewStaff({ ...newStaff, team: e.target.value })}
                    className={INPUT.select}>
                    {TEAMS.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label htmlFor={NEW_STAFF_FIELD_IDS.pref} className={INPUT.label}>Pref</label>
                  <select id={NEW_STAFF_FIELD_IDS.pref} value={newStaff.pref} onChange={e => setNewStaff({ ...newStaff, pref: e.target.value })}
                    className={INPUT.select}>
                    {PREFS.map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor={NEW_STAFF_FIELD_IDS.skill} className={INPUT.label}>Skill</label>
                  <input id={NEW_STAFF_FIELD_IDS.skill} type="number" step="0.5" value={newStaff.skill}
                    onChange={e => setNewStaff({ ...newStaff, skill: parseFloat(e.target.value) || 0 })}
                    className={INPUT.base} />
                </div>
                <div>
                  <label htmlFor={NEW_STAFF_FIELD_IDS.rate} className={INPUT.label}>Rate £/hr</label>
                  <input id={NEW_STAFF_FIELD_IDS.rate} type="number" step="0.5" value={newStaff.hourly_rate}
                    onChange={e => setNewStaff({ ...newStaff, hourly_rate: parseFloat(e.target.value) || 0 })}
                    className={INPUT.base} />
                  {(() => { const mw = getMinimumWageRate(newStaff.date_of_birth, config); return newStaff.hourly_rate < mw.rate ? <p className="text-xs text-red-600 mt-1">Below {mw.label} (£{mw.rate.toFixed(2)})</p> : null; })()}
                </div>
              </div>
              <div>
                <label htmlFor={NEW_STAFF_FIELD_IDS.contractHours} className={INPUT.label}>Contract hrs/wk</label>
                <input id={NEW_STAFF_FIELD_IDS.contractHours} type="number" min="0" max="60" step="0.5" value={newStaff.contract_hours ?? ''}
                  placeholder="e.g. 36"
                  onChange={e => setNewStaff({ ...newStaff, contract_hours: e.target.value ? parseFloat(e.target.value) : null })}
                  className={INPUT.base} />
                <p className="text-xs text-gray-600 mt-0.5">Required for AL calculation (5.6 x weekly hrs)</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor={NEW_STAFF_FIELD_IDS.startDate} className={INPUT.label}>Start Date</label>
                  <input id={NEW_STAFF_FIELD_IDS.startDate} type="date" value={newStaff.start_date}
                    onChange={e => setNewStaff({ ...newStaff, start_date: e.target.value })}
                    className={INPUT.base} />
                </div>
                <div>
                  <label htmlFor={NEW_STAFF_FIELD_IDS.dateOfBirth} className={INPUT.label}>Date of Birth</label>
                  <input id={NEW_STAFF_FIELD_IDS.dateOfBirth} type="date" value={newStaff.date_of_birth || ''}
                    onChange={e => setNewStaff({ ...newStaff, date_of_birth: e.target.value || null })}
                    className={INPUT.base} />
                  <p className="text-xs text-gray-600 mt-0.5">For NMW age bracket</p>
                </div>
              </div>
              <div className="flex items-center">
                <label className="flex items-center text-sm">
                  <input type="checkbox" checked={newStaff.wtr_opt_out}
                    onChange={e => setNewStaff({ ...newStaff, wtr_opt_out: e.target.checked })} className="mr-2" />
                  WTR Opt-Out
                </label>
              </div>
              <div>
                <label htmlFor={NEW_STAFF_FIELD_IDS.notes} className={INPUT.label}>Notes</label>
                <input id={NEW_STAFF_FIELD_IDS.notes} type="text" value={newStaff.notes} onChange={e => setNewStaff({ ...newStaff, notes: e.target.value })}
                  className={INPUT.base} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor={NEW_STAFF_FIELD_IDS.alEntitlement} className={INPUT.label}>AL Entitlement Override (hours)</label>
                  <input id={NEW_STAFF_FIELD_IDS.alEntitlement} type="number" min="0" max="2000" step="0.5" value={newStaff.al_entitlement ?? ''}
                    placeholder="Auto (5.6 x weekly hrs)"
                    onChange={e => setNewStaff({ ...newStaff, al_entitlement: e.target.value ? parseFloat(e.target.value) : null })}
                    className={INPUT.base} />
                  <p className="text-xs text-gray-600 mt-0.5">Blank = auto (5.6 x contract hours)</p>
                </div>
                <div>
                  <label htmlFor={NEW_STAFF_FIELD_IDS.alCarryover} className={INPUT.label}>Carryover (hours)</label>
                  <input id={NEW_STAFF_FIELD_IDS.alCarryover} type="number" min="0" max="500" step="0.5" value={newStaff.al_carryover || 0}
                    onChange={e => setNewStaff({ ...newStaff, al_carryover: parseFloat(e.target.value) || 0 })}
                    className={INPUT.base} />
                  <p className="text-xs text-gray-600 mt-0.5">From previous year</p>
                </div>
              </div>
            </div>
            <div className={MODAL.footer}>
              <button onClick={() => { setShowAdd(false); setRowError(null); }} className={BTN.ghost}>Cancel</button>
              <button onClick={addStaff} disabled={!newStaff.name || saving}
                className={`${BTN.primary} disabled:opacity-50`}>{saving ? 'Saving...' : 'Add'}</button>
            </div>
      </Modal>

      <Modal
        isOpen={!!inviteModal}
        onClose={() => {
          setInviteModal(null);
          setInviteCopied(false);
        }}
        title={inviteModal ? `Portal Invite for ${inviteModal.staffName}` : 'Portal Invite'}
        size="md"
      >
        {inviteModal && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Share this link with {inviteModal.staffName} so they can set up their staff portal sign-in.
            </p>
            <div>
              <label htmlFor="staff-invite-url" className={INPUT.label}>Invite link</label>
              <textarea
                id="staff-invite-url"
                className={INPUT.base}
                rows={4}
                value={inviteModal.inviteUrl}
                readOnly
              />
            </div>
            <p className="text-xs text-gray-500">
              Expires {inviteModal.expiresAt ? new Date(inviteModal.expiresAt).toLocaleString('en-GB') : 'soon'}.
            </p>
            <div className={MODAL.footer}>
              <button type="button" className={BTN.ghost} onClick={() => setInviteModal(null)}>Close</button>
              <button type="button" className={BTN.primary} onClick={() => { void copyInviteLink(); }}>
                {inviteCopied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Table */}
      <StickyTable className={CARD.flush}>
        <table className={TABLE.table + ' min-w-[1100px]'}>
          <thead className={TABLE.thead}>
            <tr>
              <th scope="col" className={TABLE.th}>ID</th>
              <SortHeader col="name">Name</SortHeader>
              <SortHeader col="role">Role</SortHeader>
              <SortHeader col="team">Team</SortHeader>
              <SortHeader col="pref">Pref</SortHeader>
              <SortHeader col="skill">Skill</SortHeader>
              {canEdit && <SortHeader col="hourly_rate">Rate</SortHeader>}
              <th scope="col" className={TABLE.th}>Hrs/wk</th>
              <th scope="col" className={TABLE.th}>Start</th>
              <th scope="col" className={TABLE.th}>WTR</th>
              <th scope="col" className={TABLE.th}>Notes</th>
              <th scope="col" className={TABLE.th}>AL</th>
              <th scope="col" className={`${TABLE.th} text-center`}>Active</th>
              <th scope="col" className={`${TABLE.th} text-right print:hidden`}>28d Hrs</th>
              {canEdit && <th scope="col" className={`${TABLE.th} text-right print:hidden`}>28d Pay</th>}
              <th scope="col" className={`${TABLE.th} print:hidden`}></th>
            </tr>
          </thead>
          <tbody>
            {staff.map(s => {
              const r = isEd(s.id) ? editingRow : s;
              if (!r) return null;
              const stats = staffStats[s.id];
              const rErr = rowError?.id === s.id ? rowError.msg : null;
              const rWarn = rowWarning?.id === s.id ? rowWarning.msgs : null;
              return (
                <Fragment key={s.id}>
                  <tr className={`${TABLE.tr} ${s.active === false ? 'opacity-50' : ''}`}>
                    <td className={`${TABLE.td} font-mono text-xs text-gray-600`}>{s.id}</td>

                    {/* Name — editable */}
                    <td className={TABLE.td}>
                      {isEd(s.id) ? (
                        <input type="text" value={r.name} onChange={e => updateEditingRow('name', e.target.value)}
                          className={INPUT.inline + ' w-32 font-medium'} autoFocus />
                      ) : canEdit ? (
                        <button type="button" className="font-medium transition-colors hover:text-blue-600" onClick={() => startEditing(s)}>{s.name}</button>
                      ) : (
                        <span className="font-medium">{s.name}</span>
                      )}
                    </td>

                    {/* Role — editable */}
                    <td className={TABLE.td}>
                      {isEd(s.id) ? (
                        <select value={r.role} onChange={e => updateEditingRow('role', e.target.value)} className={INPUT.inlineSelect + ' w-28'}>
                          {ROLES.map(ro => <option key={ro}>{ro}</option>)}
                        </select>
                      ) : canEdit ? <button type="button" className="transition-colors hover:text-blue-600" onClick={() => startEditing(s)}>{s.role}</button> : <span>{s.role}</span>}
                    </td>

                    {/* Team — editable */}
                    <td className={TABLE.td}>
                      {isEd(s.id) ? (
                        <select value={r.team} onChange={e => updateEditingRow('team', e.target.value)} className={INPUT.inlineSelect + ' w-20'}>
                          {TEAMS.map(t => <option key={t}>{t}</option>)}
                        </select>
                      ) : canEdit ? <button type="button" className="transition-colors hover:text-blue-600" onClick={() => startEditing(s)}>{s.team}</button> : <span>{s.team}</span>}
                    </td>

                    {/* Pref — editable */}
                    <td className={TABLE.td}>
                      {isEd(s.id) ? (
                        <select value={r.pref} onChange={e => updateEditingRow('pref', e.target.value)} className={INPUT.inlineSelect + ' w-16'}>
                          {PREFS.map(p => <option key={p}>{p}</option>)}
                        </select>
                      ) : canEdit ? <button type="button" className="font-mono text-xs transition-colors hover:text-blue-600" onClick={() => startEditing(s)}>{s.pref}</button> : <span className="font-mono text-xs">{s.pref}</span>}
                    </td>

                    {/* Skill — editable */}
                    <td className={TABLE.td}>
                      {isEd(s.id) ? (
                        <input type="number" step="0.5" min="0" max="2" value={r.skill}
                          onChange={e => updateEditingRow('skill', parseFloat(e.target.value) || 0)}
                          className={INPUT.inline + ' w-14'} />
                      ) : canEdit ? <button type="button" className="transition-colors hover:text-blue-600" onClick={() => startEditing(s)}>{s.skill}</button> : <span>{s.skill}</span>}
                    </td>

                    {/* Rate — editable (admin only) */}
                    {canEdit && (
                    <td className={TABLE.td}>
                      {isEd(s.id) ? (
                        <div>
                          <div className="flex items-center gap-0.5">
                            <span className="text-xs text-gray-400">£</span>
                            <input type="number" step="0.25" min={getMinimumWageRate(r.date_of_birth, config).rate} value={r.hourly_rate}
                              onChange={e => updateEditingRow('hourly_rate', parseFloat(e.target.value) || 0)}
                              className={INPUT.inline + ' w-16'} />
                          </div>
                          {(() => { const mw = getMinimumWageRate(r.date_of_birth, config); return r.hourly_rate < mw.rate ? <p className="text-[10px] text-red-600 mt-0.5">Below {mw.label}</p> : null; })()}
                        </div>
                      ) : canEdit ? (
                        <button
                          type="button"
                          className="flex items-center gap-1.5 text-left"
                          onClick={() => startEditing(s)}
                        >
                          <span className="hover:text-blue-600 transition-colors">{`\u00A3${s.hourly_rate?.toFixed(2)}`}</span>
                          {(() => { const mw = getMinimumWageRate(s.date_of_birth, config); return isCareRole(s.role) && s.hourly_rate < mw.rate ? <span className={BADGE.red}>Below {mw.label}</span> : null; })()}
                        </button>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span>{`\u00A3${s.hourly_rate?.toFixed(2)}`}</span>
                          {(() => { const mw = getMinimumWageRate(s.date_of_birth, config); return isCareRole(s.role) && s.hourly_rate < mw.rate ? <span className={BADGE.red}>Below {mw.label}</span> : null; })()}
                        </div>
                      )}
                    </td>
                    )}

                    {/* Contract hrs/wk — editable */}
                    <td className={TABLE.td}>
                      {isEd(s.id) ? (
                        <input type="number" min="0" max="60" step="0.5" value={r.contract_hours ?? ''}
                          placeholder="—"
                          onChange={e => updateEditingRow('contract_hours', e.target.value ? parseFloat(e.target.value) : null)}
                          className={INPUT.inline + ' w-14'} />
                      ) : canEdit ? (
                        <button type="button" className="text-xs transition-colors hover:text-blue-600" onClick={() => startEditing(s)}>
                          {s.contract_hours != null ? s.contract_hours : <span className="text-gray-300">—</span>}
                        </button>
                      ) : (
                        <span className="text-xs">{s.contract_hours != null ? s.contract_hours : <span className="text-gray-300">—</span>}</span>
                      )}
                    </td>

                    {/* Start Date — editable */}
                    <td className={TABLE.td}>
                      {isEd(s.id) ? (
                        <input type="date" value={r.start_date || ''} onChange={e => updateEditingRow('start_date', e.target.value)}
                          className={INPUT.inline} />
                      ) : canEdit ? <button type="button" className="text-xs text-gray-500 transition-colors hover:text-blue-600" onClick={() => startEditing(s)}>{s.start_date || '-'}</button> : <span className="text-xs text-gray-500">{s.start_date || '-'}</span>}
                    </td>

                    {/* WTR Opt-Out — editable */}
                    <td className={TABLE.td}>
                      {isEd(s.id) ? (
                        <input type="checkbox" checked={!!r.wtr_opt_out}
                          onChange={e => updateEditingRow('wtr_opt_out', e.target.checked)} />
                      ) : canEdit ? (
                        <button type="button" className={`text-xs transition-colors ${s.wtr_opt_out ? 'text-emerald-700' : 'text-red-700'} hover:text-blue-700`} onClick={() => startEditing(s)}>{s.wtr_opt_out ? 'Y' : 'N'}</button>
                      ) : (
                        <span className={`text-xs ${s.wtr_opt_out ? 'text-emerald-700' : 'text-red-700'}`}>{s.wtr_opt_out ? 'Y' : 'N'}</span>
                      )}
                    </td>

                    {/* Notes — editable */}
                    <td className={TABLE.td}>
                      {isEd(s.id) ? (
                        <input type="text" value={r.notes || ''} onChange={e => updateEditingRow('notes', e.target.value)}
                          className={INPUT.inline + ' w-40'} placeholder="Notes..." />
                      ) : canEdit ? <button type="button" className="block max-w-[150px] truncate text-xs text-gray-500 transition-colors hover:text-blue-600" title={s.notes} onClick={() => startEditing(s)}>{s.notes || '-'}</button> : <span className="block max-w-[150px] truncate text-xs text-gray-500" title={s.notes}>{s.notes || '-'}</span>}
                    </td>

                    {/* AL entitlement / carryover — editable */}
                    <td className={TABLE.td}>
                      {isEd(s.id) ? (
                        <div className="flex flex-col gap-1">
                          <input type="number" min="0" max="2000" step="0.5" value={r.al_entitlement ?? ''}
                            placeholder="Auto"
                            title="Entitlement override in hours (blank = auto)"
                            onChange={e => updateEditingRow('al_entitlement', e.target.value ? parseFloat(e.target.value) : null)}
                            className={INPUT.inline + ' w-16'} />
                          <input type="number" min="0" max="500" step="0.5" value={r.al_carryover || 0}
                            title="Carryover from previous year (hours)"
                            onChange={e => updateEditingRow('al_carryover', parseFloat(e.target.value) || 0)}
                            className={INPUT.inline + ' w-16'} />
                        </div>
                      ) : canEdit ? (
                        <button type="button" className="text-xs transition-colors hover:text-blue-600" onClick={() => startEditing(s)}>
                          {s.al_entitlement != null ? (
                            <span className="font-medium text-blue-700">{s.al_entitlement}h</span>
                          ) : (
                            <span className="text-gray-600">Auto</span>
                          )}
                          {(s.al_carryover > 0) && <span className="ml-1 text-amber-700">+{s.al_carryover}h</span>}
                        </button>
                      ) : (
                        <span className="text-xs">
                          {s.al_entitlement != null ? (
                            <span className="font-medium text-blue-700">{s.al_entitlement}h</span>
                          ) : (
                            <span className="text-gray-600">Auto</span>
                          )}
                          {(s.al_carryover > 0) && <span className="ml-1 text-amber-700">+{s.al_carryover}h</span>}
                        </span>
                      )}
                    </td>

                    {/* Active — editable */}
                    <td className={`${TABLE.td} text-center`}>
                      {isEd(s.id) ? (
                        <div className="flex flex-col items-center gap-1">
                          <select value={r.active === false ? 'N' : 'Y'} onChange={e => updateEditingRow('active', e.target.value === 'Y')}
                            className="border border-gray-300 rounded-lg px-1 py-0.5 text-xs">
                            <option value="Y">Y</option>
                            <option value="N">N</option>
                          </select>
                          {r.active === false && (
                            <input type="date" value={r.leaving_date || ''} onChange={e => updateEditingRow('leaving_date', e.target.value)}
                              title="Leaving date" className="border border-gray-300 rounded-lg px-1 py-0.5 text-[10px] w-28" />
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-0.5">
                          <span className={s.active !== false ? BADGE.green : BADGE.gray}
                            onClick={() => canEdit && startEditing(s)} style={canEdit ? { cursor: 'pointer' } : undefined}>{s.active !== false ? 'Y' : 'N'}</span>
                          {s.active === false && s.leaving_date && (
                            <span className="text-[10px] text-gray-500">{s.leaving_date}</span>
                          )}
                        </div>
                      )}
                    </td>

                    {/* 28d Hours & Pay (read-only, computed) */}
                    <td className={`${TABLE.td} text-right font-mono text-xs text-gray-600 print:hidden`}
                      title={stats?.alHours > 0 ? `${stats.totalHours.toFixed(1)}h worked + ${stats.alHours.toFixed(1)}h AL` : undefined}>
                      {stats ? stats.paidHours.toFixed(1) : '-'}
                    </td>
                    {canEdit && (
                    <td className={`${TABLE.td} text-right font-mono text-xs text-gray-600 print:hidden`}>
                      {stats ? `£${stats.totalPay.toFixed(0)}` : '-'}
                    </td>
                    )}

                    {/* Actions (admin only) */}
                    <td className={`${TABLE.td} print:hidden`}>
                      {canEdit && (
                      <div className="flex gap-2 justify-end">
                        {isEd(s.id) ? (
                          <>
                            <button onClick={commitEdit} disabled={saving}
                              className="text-blue-500 hover:text-blue-700 text-xs font-medium transition-colors disabled:opacity-50">
                              {saving ? '...' : 'Save'}
                            </button>
                            <button onClick={cancelEdit} className="text-gray-600 hover:text-gray-800 text-xs transition-colors">Cancel</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => startEditing(s)} className="text-gray-600 hover:text-blue-700 text-xs transition-colors">Edit</button>
                            {s.active !== false && (
                              <button
                                onClick={() => { void handleInviteStaff(s); }}
                                disabled={inviteBusyId === s.id}
                                className="text-emerald-600 hover:text-emerald-700 text-xs transition-colors disabled:opacity-50"
                              >
                                {inviteBusyId === s.id ? 'Inviting...' : 'Invite'}
                              </button>
                            )}
                            <button
                              onClick={() => { void handleRevokeSessions(s); }}
                              disabled={revokeBusyId === s.id}
                              title="Sign this staff member out of the staff portal everywhere"
                              className="text-amber-600 hover:text-amber-700 text-xs transition-colors disabled:opacity-50"
                            >
                              {revokeBusyId === s.id ? 'Revoking...' : 'Revoke'}
                            </button>
                          </>
                        )}
                        <button onClick={() => removeStaff(s.id)} className="text-red-600 hover:text-red-700 text-xs transition-colors">Remove</button>
                      </div>
                      )}
                    </td>
                  </tr>
                  {rErr && (
                    <tr key={`${s.id}-err`}>
                      <td colSpan={canEdit ? 15 : 13} className="px-3 py-1 bg-red-50 text-red-600 text-xs border-b border-red-100">
                        {rErr}
                      </td>
                    </tr>
                  )}
                  {revokeMessage?.id === s.id && (
                    <tr key={`${s.id}-revoke`}>
                      <td colSpan={canEdit ? 15 : 13} className="px-3 py-1 bg-emerald-50 text-emerald-700 text-xs border-b border-emerald-100">
                        {revokeMessage.msg}
                      </td>
                    </tr>
                  )}
                  {rWarn && (
                    <tr key={`${s.id}-warn`}>
                      <td colSpan={canEdit ? 15 : 13} className="px-3 py-1 bg-amber-50 text-amber-700 text-xs border-b border-amber-100">
                        {rWarn.join(' | ')}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </StickyTable>

      {/* Financial impact note */}
      <div className="mt-3 text-xs text-gray-600 print:hidden">
        Click any field to edit inline, then click Save to persist. Changes to pay rates and skills affect all cost and coverage calculations across the app.
      </div>
      {ConfirmDialog}
    </div>
  );
}
