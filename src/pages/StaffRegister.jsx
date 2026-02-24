import { useState, useMemo } from 'react';
import { isCareRole, calculateStaffPeriodHours, getCycleDates } from '../lib/rotation.js';
import { CARD, TABLE, INPUT, BTN, BADGE, MODAL } from '../lib/design.js';
import { downloadXLSX } from '../lib/excel.js';

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
  hourly_rate: 11.00, active: true, start_date: '', notes: '', wtr_opt_out: false,
  al_entitlement: null, al_carryover: 0,
};

export default function StaffRegister({ data, updateData }) {
  const [filterTeam, setFilterTeam] = useState('All');
  const [filterActive, setFilterActive] = useState('active');
  const [sortCol, setSortCol] = useState('name');
  const [sortDir, setSortDir] = useState(1);
  const [editing, setEditing] = useState(null); // staffId or null
  const [showAdd, setShowAdd] = useState(false);
  const [newStaff, setNewStaff] = useState({ ...EMPTY_STAFF });
  const [search, setSearch] = useState('');

  const staff = useMemo(() => {
    let list = [...data.staff];
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
  }, [data.staff, filterTeam, filterActive, sortCol, sortDir, search]);

  // Calculate 28-day stats for each staff member
  const cycleDates = useMemo(() => getCycleDates(data.config.cycle_start_date, new Date(), 28), [data.config.cycle_start_date]);
  const staffStats = useMemo(() => {
    const map = {};
    data.staff.filter(s => s.active !== false).forEach(s => {
      map[s.id] = calculateStaffPeriodHours(s, cycleDates, data.overrides, data.config);
    });
    return map;
  }, [data.staff, cycleDates, data.overrides, data.config]);

  function toggleSort(col) {
    if (sortCol === col) setSortDir(-sortDir);
    else { setSortCol(col); setSortDir(1); }
  }

  function updateStaff(id, field, value) {
    updateData({ ...data, staff: data.staff.map(s => s.id === id ? { ...s, [field]: value } : s) });
  }

  function addStaff() {
    const maxId = data.staff.reduce((max, s) => {
      const num = parseInt(s.id.replace('S', ''));
      return num > max ? num : max;
    }, 0);
    const id = 'S' + String(maxId + 1).padStart(3, '0');
    const staffEntry = { ...newStaff, id };
    updateData({ ...data, staff: [...data.staff, staffEntry] });
    setNewStaff({ ...EMPTY_STAFF });
    setShowAdd(false);
  }

  function removeStaff(id) {
    const s = data.staff.find(x => x.id === id);
    if (!s || !confirm(`Remove ${s.name} (${id})? This will also remove all their overrides.`)) return;
    const newOverrides = JSON.parse(JSON.stringify(data.overrides));
    for (const dateKey of Object.keys(newOverrides)) {
      delete newOverrides[dateKey][id];
      if (Object.keys(newOverrides[dateKey]).length === 0) delete newOverrides[dateKey];
    }
    updateData({ ...data, staff: data.staff.filter(x => x.id !== id), overrides: newOverrides });
    if (editing === id) setEditing(null);
  }

  const teamCounts = useMemo(() => {
    const counts = {};
    TEAMS.forEach(t => { counts[t] = data.staff.filter(s => s.team === t && s.active !== false).length; });
    counts.total = data.staff.filter(s => s.active !== false).length;
    return counts;
  }, [data.staff]);

  const SortHeader = ({ col, children, className = '' }) => (
    <th className={`${TABLE.th} cursor-pointer select-none hover:text-blue-600 text-xs ${className}`} onClick={() => toggleSort(col)}>
      {children} {sortCol === col ? (sortDir === 1 ? '\u25B2' : '\u25BC') : ''}
    </th>
  );

  function handlePrint() {
    window.print();
  }

  const nlwRate = data.config.nlw_rate || 12.21;
  const isEd = (id) => editing === id;

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
            const headers = ['ID', 'Name', 'Role', 'Team', 'Pref', 'Skill', 'Rate £/hr', 'Start Date', 'WTR Opt-Out', 'Active', 'Notes', '28d Hours', '28d Pay'];
            const rows = staff.map(s => {
              const stats = staffStats[s.id];
              return [s.id, s.name, s.role, s.team, s.pref, s.skill, s.hourly_rate?.toFixed(2),
                s.start_date || '', s.wtr_opt_out ? 'Y' : 'N', s.active !== false ? 'Y' : 'N',
                s.notes || '', stats ? stats.totalHours.toFixed(1) : '', stats ? stats.totalPay.toFixed(0) : ''];
            });
            downloadCSV('staff_register.csv', headers, rows);
          }} className={BTN.secondary}>Export CSV</button>
          <button onClick={() => {
            const headers = ['ID', 'Name', 'Role', 'Team', 'Pref', 'Skill', 'Rate £/hr', 'Start Date', 'WTR Opt-Out', 'Active', 'Notes', '28d Hours', '28d Pay'];
            const rows = staff.map(s => {
              const stats = staffStats[s.id];
              return [s.id, s.name, s.role, s.team, s.pref, s.skill,
                s.hourly_rate != null ? parseFloat(s.hourly_rate.toFixed(2)) : '',
                s.start_date || '', s.wtr_opt_out ? 'Y' : 'N', s.active !== false ? 'Y' : 'N',
                s.notes || '',
                stats ? parseFloat(stats.totalHours.toFixed(1)) : '',
                stats ? parseFloat(stats.totalPay.toFixed(0)) : ''];
            });
            downloadXLSX('staff_register', [{ name: 'Staff Register', headers, rows }]);
          }} className={BTN.secondary}>Export Excel</button>
          <button onClick={handlePrint} className={BTN.secondary}>Print</button>
          <button onClick={() => { setNewStaff({ ...EMPTY_STAFF, hourly_rate: nlwRate }); setShowAdd(true); }} className={BTN.primary}>+ Add Staff</button>
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
      {showAdd && (
        <div className={MODAL.overlay}>
          <div className={MODAL.panel}>
            <h2 className={MODAL.title}>Add New Staff</h2>
            <div className="space-y-3">
              <div>
                <label className={INPUT.label}>Name</label>
                <input type="text" value={newStaff.name} onChange={e => setNewStaff({ ...newStaff, name: e.target.value })}
                  className={INPUT.base} />
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
                  {newStaff.hourly_rate < nlwRate && (
                    <p className="text-xs text-red-600 mt-1">Below NLW (£{nlwRate.toFixed(2)})</p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={INPUT.label}>Start Date</label>
                  <input type="date" value={newStaff.start_date}
                    onChange={e => setNewStaff({ ...newStaff, start_date: e.target.value })}
                    className={INPUT.base} />
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center text-sm">
                    <input type="checkbox" checked={newStaff.wtr_opt_out}
                      onChange={e => setNewStaff({ ...newStaff, wtr_opt_out: e.target.checked })} className="mr-2" />
                    WTR Opt-Out
                  </label>
                </div>
              </div>
              <div>
                <label className={INPUT.label}>Notes</label>
                <input type="text" value={newStaff.notes} onChange={e => setNewStaff({ ...newStaff, notes: e.target.value })}
                  className={INPUT.base} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={INPUT.label}>AL Entitlement Override</label>
                  <input type="number" min="0" max="60" value={newStaff.al_entitlement ?? ''}
                    placeholder={String(data.config.al_entitlement_days || 28)}
                    onChange={e => setNewStaff({ ...newStaff, al_entitlement: e.target.value ? parseInt(e.target.value) : null })}
                    className={INPUT.base} />
                  <p className="text-xs text-gray-400 mt-0.5">Blank = default ({data.config.al_entitlement_days || 28}d)</p>
                </div>
                <div>
                  <label className={INPUT.label}>Carryover (days)</label>
                  <input type="number" min="0" max="28" value={newStaff.al_carryover || 0}
                    onChange={e => setNewStaff({ ...newStaff, al_carryover: parseInt(e.target.value) || 0 })}
                    className={INPUT.base} />
                  <p className="text-xs text-gray-400 mt-0.5">From previous year</p>
                </div>
              </div>
            </div>
            <div className={MODAL.footer}>
              <button onClick={() => setShowAdd(false)} className={BTN.ghost}>Cancel</button>
              <button onClick={addStaff} disabled={!newStaff.name}
                className={`${BTN.primary} disabled:opacity-50`}>Add</button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className={CARD.flush}>
        <table className={TABLE.table}>
          <thead className={TABLE.thead}>
            <tr>
              <th className={TABLE.th}>ID</th>
              <SortHeader col="name">Name</SortHeader>
              <SortHeader col="role">Role</SortHeader>
              <SortHeader col="team">Team</SortHeader>
              <SortHeader col="pref">Pref</SortHeader>
              <SortHeader col="skill">Skill</SortHeader>
              <SortHeader col="hourly_rate">Rate</SortHeader>
              <th className={TABLE.th}>Start</th>
              <th className={TABLE.th}>WTR</th>
              <th className={TABLE.th}>Notes</th>
              <th className={TABLE.th}>AL</th>
              <th className={`${TABLE.th} text-center`}>Active</th>
              <th className={`${TABLE.th} text-right print:hidden`}>28d Hrs</th>
              <th className={`${TABLE.th} text-right print:hidden`}>28d Pay</th>
              <th className={`${TABLE.th} print:hidden`}></th>
            </tr>
          </thead>
          <tbody>
            {staff.map(s => {
              const stats = staffStats[s.id];
              return (
                <tr key={s.id} className={`${TABLE.tr} ${s.active === false ? 'opacity-50' : ''}`}>
                  <td className={`${TABLE.td} font-mono text-xs text-gray-400`}>{s.id}</td>

                  {/* Name — editable */}
                  <td className={TABLE.td}>
                    {isEd(s.id) ? (
                      <input type="text" value={s.name} onChange={e => updateStaff(s.id, 'name', e.target.value)}
                        className="border border-gray-300 rounded-lg px-1.5 py-0.5 text-sm w-32 font-medium focus:border-blue-500 focus:outline-none" autoFocus />
                    ) : (
                      <span className="font-medium cursor-pointer hover:text-blue-600 transition-colors" onClick={() => setEditing(s.id)}>{s.name}</span>
                    )}
                  </td>

                  {/* Role — editable */}
                  <td className={TABLE.td}>
                    {isEd(s.id) ? (
                      <select value={s.role} onChange={e => updateStaff(s.id, 'role', e.target.value)} className="border border-gray-300 rounded-lg px-1 py-0.5 text-xs w-28">
                        {ROLES.map(r => <option key={r}>{r}</option>)}
                      </select>
                    ) : <span className="cursor-pointer hover:text-blue-600 transition-colors" onClick={() => setEditing(s.id)}>{s.role}</span>}
                  </td>

                  {/* Team — editable */}
                  <td className={TABLE.td}>
                    {isEd(s.id) ? (
                      <select value={s.team} onChange={e => updateStaff(s.id, 'team', e.target.value)} className="border border-gray-300 rounded-lg px-1 py-0.5 text-xs w-20">
                        {TEAMS.map(t => <option key={t}>{t}</option>)}
                      </select>
                    ) : <span className="cursor-pointer hover:text-blue-600 transition-colors" onClick={() => setEditing(s.id)}>{s.team}</span>}
                  </td>

                  {/* Pref — editable */}
                  <td className={TABLE.td}>
                    {isEd(s.id) ? (
                      <select value={s.pref} onChange={e => updateStaff(s.id, 'pref', e.target.value)} className="border border-gray-300 rounded-lg px-1 py-0.5 text-xs w-16">
                        {PREFS.map(p => <option key={p}>{p}</option>)}
                      </select>
                    ) : <span className="font-mono text-xs cursor-pointer hover:text-blue-600 transition-colors" onClick={() => setEditing(s.id)}>{s.pref}</span>}
                  </td>

                  {/* Skill — editable */}
                  <td className={TABLE.td}>
                    {isEd(s.id) ? (
                      <input type="number" step="0.5" min="0" max="2" value={s.skill}
                        onChange={e => updateStaff(s.id, 'skill', parseFloat(e.target.value) || 0)}
                        className="border border-gray-300 rounded-lg px-1 py-0.5 text-xs w-14" />
                    ) : <span className="cursor-pointer hover:text-blue-600 transition-colors" onClick={() => setEditing(s.id)}>{s.skill}</span>}
                  </td>

                  {/* Rate — editable */}
                  <td className={TABLE.td}>
                    {isEd(s.id) ? (
                      <div>
                        <div className="flex items-center gap-0.5">
                          <span className="text-xs text-gray-400">£</span>
                          <input type="number" step="0.25" min={nlwRate} value={s.hourly_rate}
                            onChange={e => updateStaff(s.id, 'hourly_rate', parseFloat(e.target.value) || 0)}
                            className="border border-gray-300 rounded-lg px-1 py-0.5 text-xs w-16" />
                        </div>
                        {s.hourly_rate < nlwRate && (
                          <p className="text-[10px] text-red-600 mt-0.5">Below NLW</p>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 cursor-pointer" onClick={() => setEditing(s.id)}>
                        <span className="hover:text-blue-600 transition-colors">£{s.hourly_rate?.toFixed(2)}</span>
                        {isCareRole(s.role) && s.hourly_rate < nlwRate && (
                          <span className={BADGE.red}>Below NLW</span>
                        )}
                      </div>
                    )}
                  </td>

                  {/* Start Date — editable */}
                  <td className={TABLE.td}>
                    {isEd(s.id) ? (
                      <input type="date" value={s.start_date || ''} onChange={e => updateStaff(s.id, 'start_date', e.target.value)}
                        className="border border-gray-300 rounded-lg px-1 py-0.5 text-xs" />
                    ) : <span className="text-xs text-gray-500 cursor-pointer hover:text-blue-600 transition-colors" onClick={() => setEditing(s.id)}>{s.start_date || '-'}</span>}
                  </td>

                  {/* WTR Opt-Out — editable */}
                  <td className={TABLE.td}>
                    {isEd(s.id) ? (
                      <input type="checkbox" checked={!!s.wtr_opt_out}
                        onChange={e => updateStaff(s.id, 'wtr_opt_out', e.target.checked)} />
                    ) : (
                      <span className={`text-xs cursor-pointer hover:text-blue-600 transition-colors ${s.wtr_opt_out ? 'text-green-600' : 'text-red-600'}`}
                        onClick={() => setEditing(s.id)}>{s.wtr_opt_out ? 'Y' : 'N'}</span>
                    )}
                  </td>

                  {/* Notes — editable */}
                  <td className={TABLE.td}>
                    {isEd(s.id) ? (
                      <input type="text" value={s.notes || ''} onChange={e => updateStaff(s.id, 'notes', e.target.value)}
                        className="border border-gray-300 rounded-lg px-1.5 py-0.5 text-xs w-40" placeholder="Notes..." />
                    ) : <span className="text-xs text-gray-500 max-w-[150px] truncate block cursor-pointer hover:text-blue-600 transition-colors"
                      title={s.notes} onClick={() => setEditing(s.id)}>{s.notes || '-'}</span>}
                  </td>

                  {/* AL entitlement / carryover — editable */}
                  <td className={TABLE.td}>
                    {isEd(s.id) ? (
                      <div className="flex flex-col gap-1">
                        <input type="number" min="0" max="60" value={s.al_entitlement ?? ''}
                          placeholder={String(data.config.al_entitlement_days || 28)}
                          title="Entitlement override (blank = default)"
                          onChange={e => updateStaff(s.id, 'al_entitlement', e.target.value ? parseInt(e.target.value) : null)}
                          className="border border-gray-300 rounded-lg px-1 py-0.5 text-xs w-14" />
                        <input type="number" min="0" max="28" value={s.al_carryover || 0}
                          title="Carryover from previous year"
                          onChange={e => updateStaff(s.id, 'al_carryover', parseInt(e.target.value) || 0)}
                          className="border border-gray-300 rounded-lg px-1 py-0.5 text-xs w-14" />
                      </div>
                    ) : (
                      <span className="text-xs cursor-pointer hover:text-blue-600 transition-colors" onClick={() => setEditing(s.id)}>
                        {s.al_entitlement != null ? (
                          <span className="font-medium text-blue-700">{s.al_entitlement}d</span>
                        ) : (
                          <span className="text-gray-400">{data.config.al_entitlement_days || 28}d</span>
                        )}
                        {(s.al_carryover > 0) && <span className="ml-1 text-amber-600">+{s.al_carryover}c</span>}
                      </span>
                    )}
                  </td>

                  {/* Active — editable */}
                  <td className={`${TABLE.td} text-center`}>
                    {isEd(s.id) ? (
                      <select value={s.active === false ? 'N' : 'Y'} onChange={e => updateStaff(s.id, 'active', e.target.value === 'Y')}
                        className="border border-gray-300 rounded-lg px-1 py-0.5 text-xs">
                        <option value="Y">Y</option>
                        <option value="N">N</option>
                      </select>
                    ) : (
                      <span className={s.active !== false ? BADGE.green : BADGE.gray}
                        onClick={() => setEditing(s.id)} style={{ cursor: 'pointer' }}>{s.active !== false ? 'Y' : 'N'}</span>
                    )}
                  </td>

                  {/* 28d Hours & Pay (read-only, computed) */}
                  <td className={`${TABLE.td} text-right font-mono text-xs text-gray-600 print:hidden`}>
                    {stats ? stats.totalHours.toFixed(1) : '-'}
                  </td>
                  <td className={`${TABLE.td} text-right font-mono text-xs text-gray-600 print:hidden`}>
                    {stats ? `£${stats.totalPay.toFixed(0)}` : '-'}
                  </td>

                  {/* Actions */}
                  <td className={`${TABLE.td} print:hidden`}>
                    <div className="flex gap-2 justify-end">
                      {isEd(s.id) ? (
                        <button onClick={() => setEditing(null)} className="text-blue-500 hover:text-blue-700 text-xs font-medium transition-colors">Done</button>
                      ) : (
                        <button onClick={() => setEditing(s.id)} className="text-gray-400 hover:text-blue-600 text-xs transition-colors">Edit</button>
                      )}
                      <button onClick={() => removeStaff(s.id)} className="text-red-400 hover:text-red-600 text-xs transition-colors">Remove</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Financial impact note */}
      <div className="mt-3 text-xs text-gray-400 print:hidden">
        Click any field to edit. Changes to pay rates and skills affect all cost and coverage calculations across the app.
      </div>
    </div>
  );
}
