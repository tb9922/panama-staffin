import { useState, useMemo } from 'react';
import { isCareRole, calculateStaffPeriodHours, getCycleDates } from '../lib/rotation.js';

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
    <th className={`py-2 px-2 cursor-pointer select-none hover:text-blue-600 text-left text-xs ${className}`} onClick={() => toggleSort(col)}>
      {children} {sortCol === col ? (sortDir === 1 ? '\u25B2' : '\u25BC') : ''}
    </th>
  );

  function handlePrint() {
    window.print();
  }

  const isEd = (id) => editing === id;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
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
          }} className="border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded text-sm font-medium">Export CSV</button>
          <button onClick={handlePrint}
            className="border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded text-sm font-medium">Print</button>
          <button onClick={() => setShowAdd(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-medium">+ Add Staff</button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap print:hidden">
        <input type="text" placeholder="Search name or ID..." value={search} onChange={e => setSearch(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm w-48" />
        <select value={filterTeam} onChange={e => setFilterTeam(e.target.value)} className="border rounded px-3 py-1.5 text-sm">
          <option value="All">All Teams</option>
          {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filterActive} onChange={e => setFilterActive(e.target.value)} className="border rounded px-3 py-1.5 text-sm">
          <option value="active">Active Only</option>
          <option value="inactive">Inactive Only</option>
          <option value="all">All</option>
        </select>
        <span className="text-sm text-gray-500 self-center">{staff.length} shown</span>
      </div>

      {/* Add Staff Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 print:hidden">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4">Add New Staff</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Name</label>
                <input type="text" value={newStaff.name} onChange={e => setNewStaff({ ...newStaff, name: e.target.value })}
                  className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">Role</label>
                  <select value={newStaff.role} onChange={e => setNewStaff({ ...newStaff, role: e.target.value })}
                    className="w-full border rounded px-3 py-2 text-sm">
                    {ROLES.map(r => <option key={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">Team</label>
                  <select value={newStaff.team} onChange={e => setNewStaff({ ...newStaff, team: e.target.value })}
                    className="w-full border rounded px-3 py-2 text-sm">
                    {TEAMS.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">Pref</label>
                  <select value={newStaff.pref} onChange={e => setNewStaff({ ...newStaff, pref: e.target.value })}
                    className="w-full border rounded px-3 py-2 text-sm">
                    {PREFS.map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">Skill</label>
                  <input type="number" step="0.5" value={newStaff.skill}
                    onChange={e => setNewStaff({ ...newStaff, skill: parseFloat(e.target.value) || 0 })}
                    className="w-full border rounded px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">Rate £/hr</label>
                  <input type="number" step="0.5" value={newStaff.hourly_rate}
                    onChange={e => setNewStaff({ ...newStaff, hourly_rate: parseFloat(e.target.value) || 0 })}
                    className="w-full border rounded px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">Start Date</label>
                  <input type="date" value={newStaff.start_date}
                    onChange={e => setNewStaff({ ...newStaff, start_date: e.target.value })}
                    className="w-full border rounded px-3 py-2 text-sm" />
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
                <label className="block text-sm font-medium text-gray-600 mb-1">Notes</label>
                <input type="text" value={newStaff.notes} onChange={e => setNewStaff({ ...newStaff, notes: e.target.value })}
                  className="w-full border rounded px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button onClick={addStaff} disabled={!newStaff.name}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm disabled:opacity-50">Add</button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
            <tr>
              <th className="py-2 px-2 text-left">ID</th>
              <SortHeader col="name">Name</SortHeader>
              <SortHeader col="role">Role</SortHeader>
              <SortHeader col="team">Team</SortHeader>
              <SortHeader col="pref">Pref</SortHeader>
              <SortHeader col="skill">Skill</SortHeader>
              <SortHeader col="hourly_rate">Rate</SortHeader>
              <th className="py-2 px-2 text-left text-xs">Start</th>
              <th className="py-2 px-2 text-left text-xs">WTR</th>
              <th className="py-2 px-2 text-left text-xs">Notes</th>
              <th className="py-2 px-2 text-center text-xs">Active</th>
              <th className="py-2 px-2 text-right text-xs print:hidden">28d Hrs</th>
              <th className="py-2 px-2 text-right text-xs print:hidden">28d Pay</th>
              <th className="py-2 px-2 text-xs print:hidden"></th>
            </tr>
          </thead>
          <tbody>
            {staff.map(s => {
              const stats = staffStats[s.id];
              return (
                <tr key={s.id} className={`border-b hover:bg-gray-50 ${s.active === false ? 'opacity-50' : ''}`}>
                  <td className="py-1.5 px-2 font-mono text-xs text-gray-400">{s.id}</td>

                  {/* Name — editable */}
                  <td className="py-1.5 px-2">
                    {isEd(s.id) ? (
                      <input type="text" value={s.name} onChange={e => updateStaff(s.id, 'name', e.target.value)}
                        className="border rounded px-1.5 py-0.5 text-sm w-32 font-medium" autoFocus />
                    ) : (
                      <span className="font-medium cursor-pointer hover:text-blue-600" onClick={() => setEditing(s.id)}>{s.name}</span>
                    )}
                  </td>

                  {/* Role — editable */}
                  <td className="py-1.5 px-2">
                    {isEd(s.id) ? (
                      <select value={s.role} onChange={e => updateStaff(s.id, 'role', e.target.value)} className="border rounded px-1 py-0.5 text-xs w-28">
                        {ROLES.map(r => <option key={r}>{r}</option>)}
                      </select>
                    ) : <span className="cursor-pointer hover:text-blue-600" onClick={() => setEditing(s.id)}>{s.role}</span>}
                  </td>

                  {/* Team — editable */}
                  <td className="py-1.5 px-2">
                    {isEd(s.id) ? (
                      <select value={s.team} onChange={e => updateStaff(s.id, 'team', e.target.value)} className="border rounded px-1 py-0.5 text-xs w-20">
                        {TEAMS.map(t => <option key={t}>{t}</option>)}
                      </select>
                    ) : <span className="cursor-pointer hover:text-blue-600" onClick={() => setEditing(s.id)}>{s.team}</span>}
                  </td>

                  {/* Pref — editable */}
                  <td className="py-1.5 px-2">
                    {isEd(s.id) ? (
                      <select value={s.pref} onChange={e => updateStaff(s.id, 'pref', e.target.value)} className="border rounded px-1 py-0.5 text-xs w-16">
                        {PREFS.map(p => <option key={p}>{p}</option>)}
                      </select>
                    ) : <span className="font-mono text-xs cursor-pointer hover:text-blue-600" onClick={() => setEditing(s.id)}>{s.pref}</span>}
                  </td>

                  {/* Skill — editable */}
                  <td className="py-1.5 px-2">
                    {isEd(s.id) ? (
                      <input type="number" step="0.5" min="0" max="2" value={s.skill}
                        onChange={e => updateStaff(s.id, 'skill', parseFloat(e.target.value) || 0)}
                        className="border rounded px-1 py-0.5 text-xs w-14" />
                    ) : <span className="cursor-pointer hover:text-blue-600" onClick={() => setEditing(s.id)}>{s.skill}</span>}
                  </td>

                  {/* Rate — editable */}
                  <td className="py-1.5 px-2">
                    {isEd(s.id) ? (
                      <div className="flex items-center gap-0.5">
                        <span className="text-xs text-gray-400">£</span>
                        <input type="number" step="0.25" min="0" value={s.hourly_rate}
                          onChange={e => updateStaff(s.id, 'hourly_rate', parseFloat(e.target.value) || 0)}
                          className="border rounded px-1 py-0.5 text-xs w-16" />
                      </div>
                    ) : <span className="cursor-pointer hover:text-blue-600" onClick={() => setEditing(s.id)}>£{s.hourly_rate?.toFixed(2)}</span>}
                  </td>

                  {/* Start Date — editable */}
                  <td className="py-1.5 px-2">
                    {isEd(s.id) ? (
                      <input type="date" value={s.start_date || ''} onChange={e => updateStaff(s.id, 'start_date', e.target.value)}
                        className="border rounded px-1 py-0.5 text-xs" />
                    ) : <span className="text-xs text-gray-500 cursor-pointer hover:text-blue-600" onClick={() => setEditing(s.id)}>{s.start_date || '-'}</span>}
                  </td>

                  {/* WTR Opt-Out — editable */}
                  <td className="py-1.5 px-2">
                    {isEd(s.id) ? (
                      <input type="checkbox" checked={!!s.wtr_opt_out}
                        onChange={e => updateStaff(s.id, 'wtr_opt_out', e.target.checked)} />
                    ) : (
                      <span className={`text-xs cursor-pointer hover:text-blue-600 ${s.wtr_opt_out ? 'text-green-600' : 'text-red-600'}`}
                        onClick={() => setEditing(s.id)}>{s.wtr_opt_out ? 'Y' : 'N'}</span>
                    )}
                  </td>

                  {/* Notes — editable */}
                  <td className="py-1.5 px-2">
                    {isEd(s.id) ? (
                      <input type="text" value={s.notes || ''} onChange={e => updateStaff(s.id, 'notes', e.target.value)}
                        className="border rounded px-1.5 py-0.5 text-xs w-40" placeholder="Notes..." />
                    ) : <span className="text-xs text-gray-500 max-w-[150px] truncate block cursor-pointer hover:text-blue-600"
                      title={s.notes} onClick={() => setEditing(s.id)}>{s.notes || '-'}</span>}
                  </td>

                  {/* Active — editable */}
                  <td className="py-1.5 px-2 text-center">
                    {isEd(s.id) ? (
                      <select value={s.active === false ? 'N' : 'Y'} onChange={e => updateStaff(s.id, 'active', e.target.value === 'Y')}
                        className="border rounded px-1 py-0.5 text-xs">
                        <option value="Y">Y</option>
                        <option value="N">N</option>
                      </select>
                    ) : (
                      <span className={`cursor-pointer px-1.5 py-0.5 rounded text-xs font-medium ${
                        s.active !== false ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`} onClick={() => setEditing(s.id)}>{s.active !== false ? 'Y' : 'N'}</span>
                    )}
                  </td>

                  {/* 28d Hours & Pay (read-only, computed) */}
                  <td className="py-1.5 px-2 text-right font-mono text-xs text-gray-600 print:hidden">
                    {stats ? stats.totalHours.toFixed(1) : '-'}
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono text-xs text-gray-600 print:hidden">
                    {stats ? `£${stats.totalPay.toFixed(0)}` : '-'}
                  </td>

                  {/* Actions */}
                  <td className="py-1.5 px-2 print:hidden">
                    <div className="flex gap-2 justify-end">
                      {isEd(s.id) ? (
                        <button onClick={() => setEditing(null)} className="text-blue-500 hover:text-blue-700 text-xs font-medium">Done</button>
                      ) : (
                        <button onClick={() => setEditing(s.id)} className="text-gray-400 hover:text-blue-600 text-xs">Edit</button>
                      )}
                      <button onClick={() => removeStaff(s.id)} className="text-red-400 hover:text-red-600 text-xs">Remove</button>
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
