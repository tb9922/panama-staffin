import { useState, useMemo, useEffect, Fragment } from 'react';
import { isCareRole, calculateStaffPeriodHours, getCycleDates, formatDate } from '../lib/rotation.js';
import { CARD, TABLE, INPUT, BTN, BADGE, MODAL } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import { useConfirm } from '../hooks/useConfirm.jsx';
import { downloadXLSX } from '../lib/excel.js';
import { getCurrentHome, getSchedulingData, createStaff, updateStaffMember, deleteStaffMember } from '../lib/api.js';
import { getMinimumWageRate } from '../../shared/nmw.js';
import { useData } from '../contexts/DataContext.jsx';

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
  hourly_rate: 12.21, active: true, start_date: '', leaving_date: '', notes: '', wtr_opt_out: false,
  contract_hours: null, al_entitlement: null, al_carryover: 0, date_of_birth: null,
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

  const nlwRate = config?.nlw_rate || 12.21;

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
  }

  function updateEditingRow(field, value) {
    setEditingRow(prev => {
      const updated = { ...prev, [field]: value };
      // Auto-set leaving_date when deactivating
      if (field === 'active' && value === false && !prev.leaving_date) {
        updated.leaving_date = formatDate(new Date());
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
      if (result?.warnings?.length) setRowWarning({ id: 'add', msgs: result.warnings });
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

  const teamCounts = useMemo(() => {
    const counts = {};
    TEAMS.forEach(t => { counts[t] = allStaff.filter(s => s.team === t && s.active !== false).length; });
    counts.total = allStaff.filter(s => s.active !== false).length;
    return counts;
  }, [allStaff]);

  const SortHeader = ({ col, children, className = '' }) => (
    <th scope="col" className={`${TABLE.th} cursor-pointer select-none hover:text-blue-600 text-xs ${className}`} onClick={() => toggleSort(col)}>
      {children} {sortCol === col ? (sortDir === 1 ? '\u25B2' : '\u25BC') : ''}
    </th>
  );

  function handlePrint() {
    window.print();
  }

  const isEd = (id) => editing === id;
  const _row = (id) => (editing === id ? editingRow : allStaff.find(s => s.id === id)) || {};

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <p className="text-gray-500 text-sm">Loading staff...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm">
          {error}
          <button onClick={() => setRefreshKey(k => k + 1)} className={`${BTN.secondary} ${BTN.xs} ml-3`}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Staff Database</h1>
          <p className="text-xs text-gray-500 mt-1">
            {TEAMS.map(t => `${t}: ${teamCounts[t]}`).join(' | ')} | Total: {teamCounts.total}
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <button onClick={() => {
            const headers = canEdit
              ? ['ID', 'Name', 'Role', 'Team', 'Pref', 'Skill', 'Rate £/hr', 'Start Date', 'Leaving Date', 'WTR Opt-Out', 'Active', 'Notes', '28d Hours', '28d Pay']
              : ['ID', 'Name', 'Role', 'Team', 'Pref', 'Skill', 'Start Date', 'Leaving Date', 'WTR Opt-Out', 'Active', 'Notes', '28d Hours'];
            const rows = staff.map(s => {
              const stats = staffStats[s.id];
              return canEdit
                ? [s.id, s.name, s.role, s.team, s.pref, s.skill, s.hourly_rate?.toFixed(2),
                  s.start_date || '', s.leaving_date || '', s.wtr_opt_out ? 'Y' : 'N', s.active !== false ? 'Y' : 'N',
                  s.notes || '', stats ? stats.totalHours.toFixed(1) : '', stats ? stats.totalPay.toFixed(0) : '']
                : [s.id, s.name, s.role, s.team, s.pref, s.skill,
                  s.start_date || '', s.leaving_date || '', s.wtr_opt_out ? 'Y' : 'N', s.active !== false ? 'Y' : 'N',
                  s.notes || '', stats ? stats.totalHours.toFixed(1) : ''];
            });
            downloadCSV('staff_register.csv', headers, rows);
          }} className={BTN.secondary}>Export CSV</button>
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
                  stats ? parseFloat(stats.totalHours.toFixed(1)) : '',
                  stats ? parseFloat(stats.totalPay.toFixed(0)) : '']
                : [s.id, s.name, s.role, s.team, s.pref, s.skill,
                  s.start_date || '', s.leaving_date || '', s.wtr_opt_out ? 'Y' : 'N', s.active !== false ? 'Y' : 'N',
                  s.notes || '',
                  stats ? parseFloat(stats.totalHours.toFixed(1)) : ''];
            });
            downloadXLSX('staff_register', [{ name: 'Staff Register', headers, rows }]);
          }} className={BTN.secondary}>Export Excel</button>
          <button onClick={handlePrint} className={BTN.secondary}>Print</button>
          {canEdit && <button onClick={() => { setNewStaff({ ...EMPTY_STAFF, hourly_rate: nlwRate }); setShowAdd(true); }} className={BTN.primary}>+ Add Staff</button>}
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap print:hidden">
        <input type="text" placeholder="Search name or ID..." value={search} onChange={e => setSearch(e.target.value)}
          className={`${INPUT.sm} w-48`} />
        <select value={filterTeam} onChange={e => setFilterTeam(e.target.value)} className={`${INPUT.select} w-auto`}>
          <option value="All">All Teams</option>
          {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filterActive} onChange={e => setFilterActive(e.target.value)} className={`${INPUT.select} w-auto`}>
          <option value="active">Active Only</option>
          <option value="inactive">Inactive Only</option>
          <option value="all">All</option>
        </select>
        <span className="text-sm text-gray-500 self-center">{staff.length} shown</span>
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
                <label className={INPUT.label}>Name</label>
                <input type="text" value={newStaff.name} onChange={e => setNewStaff({ ...newStaff, name: e.target.value })}
                  className={INPUT.base} aria-describedby={rowError?.id === 'add' ? 'add-staff-error' : undefined} aria-invalid={rowError?.id === 'add'} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={INPUT.label}>Role</label>
                  <select value={newStaff.role} onChange={e => setNewStaff({ ...newStaff, role: e.target.value })}
                    className={INPUT.select}>
                    {ROLES.map(r => <option key={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className={INPUT.label}>Team</label>
                  <select value={newStaff.team} onChange={e => setNewStaff({ ...newStaff, team: e.target.value })}
                    className={INPUT.select}>
                    {TEAMS.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={INPUT.label}>Pref</label>
                  <select value={newStaff.pref} onChange={e => setNewStaff({ ...newStaff, pref: e.target.value })}
                    className={INPUT.select}>
                    {PREFS.map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className={INPUT.label}>Skill</label>
                  <input type="number" step="0.5" value={newStaff.skill}
                    onChange={e => setNewStaff({ ...newStaff, skill: parseFloat(e.target.value) || 0 })}
                    className={INPUT.base} />
                </div>
                <div>
                  <label className={INPUT.label}>Rate £/hr</label>
                  <input type="number" step="0.5" value={newStaff.hourly_rate}
                    onChange={e => setNewStaff({ ...newStaff, hourly_rate: parseFloat(e.target.value) || 0 })}
                    className={INPUT.base} />
                  {(() => { const mw = getMinimumWageRate(newStaff.date_of_birth, config); return newStaff.hourly_rate < mw.rate ? <p className="text-xs text-red-600 mt-1">Below {mw.label} (£{mw.rate.toFixed(2)})</p> : null; })()}
                </div>
              </div>
              <div>
                <label className={INPUT.label}>Contract hrs/wk</label>
                <input type="number" min="0" max="60" step="0.5" value={newStaff.contract_hours ?? ''}
                  placeholder="e.g. 36"
                  onChange={e => setNewStaff({ ...newStaff, contract_hours: e.target.value ? parseFloat(e.target.value) : null })}
                  className={INPUT.base} />
                <p className="text-xs text-gray-400 mt-0.5">Required for AL calculation (5.6 x weekly hrs)</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={INPUT.label}>Start Date</label>
                  <input type="date" value={newStaff.start_date}
                    onChange={e => setNewStaff({ ...newStaff, start_date: e.target.value })}
                    className={INPUT.base} />
                </div>
                <div>
                  <label className={INPUT.label}>Date of Birth</label>
                  <input type="date" value={newStaff.date_of_birth || ''}
                    onChange={e => setNewStaff({ ...newStaff, date_of_birth: e.target.value || null })}
                    className={INPUT.base} />
                  <p className="text-xs text-gray-400 mt-0.5">For NMW age bracket</p>
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
                <label className={INPUT.label}>Notes</label>
                <input type="text" value={newStaff.notes} onChange={e => setNewStaff({ ...newStaff, notes: e.target.value })}
                  className={INPUT.base} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={INPUT.label}>AL Entitlement Override (hours)</label>
                  <input type="number" min="0" max="2000" step="0.5" value={newStaff.al_entitlement ?? ''}
                    placeholder="Auto (5.6 x weekly hrs)"
                    onChange={e => setNewStaff({ ...newStaff, al_entitlement: e.target.value ? parseFloat(e.target.value) : null })}
                    className={INPUT.base} />
                  <p className="text-xs text-gray-400 mt-0.5">Blank = auto (5.6 x contract hours)</p>
                </div>
                <div>
                  <label className={INPUT.label}>Carryover (hours)</label>
                  <input type="number" min="0" max="500" step="0.5" value={newStaff.al_carryover || 0}
                    onChange={e => setNewStaff({ ...newStaff, al_carryover: parseFloat(e.target.value) || 0 })}
                    className={INPUT.base} />
                  <p className="text-xs text-gray-400 mt-0.5">From previous year</p>
                </div>
              </div>
            </div>
            <div className={MODAL.footer}>
              <button onClick={() => { setShowAdd(false); setRowError(null); }} className={BTN.ghost}>Cancel</button>
              <button onClick={addStaff} disabled={!newStaff.name || saving}
                className={`${BTN.primary} disabled:opacity-50`}>{saving ? 'Saving...' : 'Add'}</button>
            </div>
      </Modal>

      {/* Table */}
      <div className={CARD.flush + ' overflow-x-auto'}>
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
                    <td className={`${TABLE.td} font-mono text-xs text-gray-400`}>{s.id}</td>

                    {/* Name — editable */}
                    <td className={TABLE.td}>
                      {isEd(s.id) ? (
                        <input type="text" value={r.name} onChange={e => updateEditingRow('name', e.target.value)}
                          className={INPUT.inline + ' w-32 font-medium'} autoFocus />
                      ) : (
                        <span className={`font-medium transition-colors ${canEdit ? 'cursor-pointer hover:text-blue-600' : ''}`} onClick={() => canEdit && startEditing(s)}>{s.name}</span>
                      )}
                    </td>

                    {/* Role — editable */}
                    <td className={TABLE.td}>
                      {isEd(s.id) ? (
                        <select value={r.role} onChange={e => updateEditingRow('role', e.target.value)} className={INPUT.inlineSelect + ' w-28'}>
                          {ROLES.map(ro => <option key={ro}>{ro}</option>)}
                        </select>
                      ) : <span className={`transition-colors ${canEdit ? 'cursor-pointer hover:text-blue-600' : ''}`} onClick={() => canEdit && startEditing(s)}>{s.role}</span>}
                    </td>

                    {/* Team — editable */}
                    <td className={TABLE.td}>
                      {isEd(s.id) ? (
                        <select value={r.team} onChange={e => updateEditingRow('team', e.target.value)} className={INPUT.inlineSelect + ' w-20'}>
                          {TEAMS.map(t => <option key={t}>{t}</option>)}
                        </select>
                      ) : <span className={`transition-colors ${canEdit ? 'cursor-pointer hover:text-blue-600' : ''}`} onClick={() => canEdit && startEditing(s)}>{s.team}</span>}
                    </td>

                    {/* Pref — editable */}
                    <td className={TABLE.td}>
                      {isEd(s.id) ? (
                        <select value={r.pref} onChange={e => updateEditingRow('pref', e.target.value)} className={INPUT.inlineSelect + ' w-16'}>
                          {PREFS.map(p => <option key={p}>{p}</option>)}
                        </select>
                      ) : <span className={`font-mono text-xs transition-colors ${canEdit ? 'cursor-pointer hover:text-blue-600' : ''}`} onClick={() => canEdit && startEditing(s)}>{s.pref}</span>}
                    </td>

                    {/* Skill — editable */}
                    <td className={TABLE.td}>
                      {isEd(s.id) ? (
                        <input type="number" step="0.5" min="0" max="2" value={r.skill}
                          onChange={e => updateEditingRow('skill', parseFloat(e.target.value) || 0)}
                          className={INPUT.inline + ' w-14'} />
                      ) : <span className={`transition-colors ${canEdit ? 'cursor-pointer hover:text-blue-600' : ''}`} onClick={() => canEdit && startEditing(s)}>{s.skill}</span>}
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
                      ) : (
                        <div className="flex items-center gap-1.5 cursor-pointer" onClick={() => startEditing(s)}>
                          <span className="hover:text-blue-600 transition-colors">£{s.hourly_rate?.toFixed(2)}</span>
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
                      ) : (
                        <span className={`text-xs transition-colors ${canEdit ? 'cursor-pointer hover:text-blue-600' : ''}`} onClick={() => canEdit && startEditing(s)}>
                          {s.contract_hours != null ? s.contract_hours : <span className="text-gray-300">—</span>}
                        </span>
                      )}
                    </td>

                    {/* Start Date — editable */}
                    <td className={TABLE.td}>
                      {isEd(s.id) ? (
                        <input type="date" value={r.start_date || ''} onChange={e => updateEditingRow('start_date', e.target.value)}
                          className={INPUT.inline} />
                      ) : <span className={`text-xs text-gray-500 transition-colors ${canEdit ? 'cursor-pointer hover:text-blue-600' : ''}`} onClick={() => canEdit && startEditing(s)}>{s.start_date || '-'}</span>}
                    </td>

                    {/* WTR Opt-Out — editable */}
                    <td className={TABLE.td}>
                      {isEd(s.id) ? (
                        <input type="checkbox" checked={!!r.wtr_opt_out}
                          onChange={e => updateEditingRow('wtr_opt_out', e.target.checked)} />
                      ) : (
                        <span className={`text-xs transition-colors ${s.wtr_opt_out ? 'text-green-600' : 'text-red-600'} ${canEdit ? 'cursor-pointer hover:text-blue-600' : ''}`}
                          onClick={() => canEdit && startEditing(s)}>{s.wtr_opt_out ? 'Y' : 'N'}</span>
                      )}
                    </td>

                    {/* Notes — editable */}
                    <td className={TABLE.td}>
                      {isEd(s.id) ? (
                        <input type="text" value={r.notes || ''} onChange={e => updateEditingRow('notes', e.target.value)}
                          className={INPUT.inline + ' w-40'} placeholder="Notes..." />
                      ) : <span className={`text-xs text-gray-500 max-w-[150px] truncate block transition-colors ${canEdit ? 'cursor-pointer hover:text-blue-600' : ''}`}
                        title={s.notes} onClick={() => canEdit && startEditing(s)}>{s.notes || '-'}</span>}
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
                      ) : (
                        <span className={`text-xs transition-colors ${canEdit ? 'cursor-pointer hover:text-blue-600' : ''}`} onClick={() => canEdit && startEditing(s)}>
                          {s.al_entitlement != null ? (
                            <span className="font-medium text-blue-700">{s.al_entitlement}h</span>
                          ) : (
                            <span className="text-gray-400">Auto</span>
                          )}
                          {(s.al_carryover > 0) && <span className="ml-1 text-amber-600">+{s.al_carryover}h</span>}
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
                            <span className="text-[10px] text-gray-400">{s.leaving_date}</span>
                          )}
                        </div>
                      )}
                    </td>

                    {/* 28d Hours & Pay (read-only, computed) */}
                    <td className={`${TABLE.td} text-right font-mono text-xs text-gray-600 print:hidden`}>
                      {stats ? stats.totalHours.toFixed(1) : '-'}
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
                            <button onClick={cancelEdit} className="text-gray-400 hover:text-gray-600 text-xs transition-colors">Cancel</button>
                          </>
                        ) : (
                          <button onClick={() => startEditing(s)} className="text-gray-400 hover:text-blue-600 text-xs transition-colors">Edit</button>
                        )}
                        <button onClick={() => removeStaff(s.id)} className="text-red-400 hover:text-red-600 text-xs transition-colors">Remove</button>
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
      </div>

      {/* Financial impact note */}
      <div className="mt-3 text-xs text-gray-400 print:hidden">
        Click any field to edit inline, then click Save to persist. Changes to pay rates and skills affect all cost and coverage calculations across the app.
      </div>
      {ConfirmDialog}
    </div>
  );
}
