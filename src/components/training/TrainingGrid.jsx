import { useState, useMemo, useEffect } from 'react';
import { parseDate } from '../../lib/rotation.js';
import {
  buildComplianceMatrix, getComplianceStats,
  calculateExpiry, TRAINING_METHODS, TRAINING_STATUS, STATUS_DISPLAY,
} from '../../lib/training.js';
import { updateTrainingTypes, upsertTrainingRecord } from '../../lib/api.js';
import { downloadXLSX } from '../../lib/excel.js';
import { CARD, TABLE, INPUT, BTN, BADGE, MODAL } from '../../lib/design.js';
import Modal from '../Modal.jsx';
import TrainingRecordModal from './TrainingRecordModal.jsx';
import { todayLocalISO } from '../../lib/localDates.js';

const TEAMS = ['Day A', 'Day B', 'Night A', 'Night B', 'Float'];

const CELL_COLORS = {
  compliant:     'border border-[var(--ok)] bg-[var(--ok-soft)] text-[var(--ok)] cursor-pointer hover:brightness-95 hover:shadow-sm',
  expiring_soon: 'border border-[var(--caution)] bg-[var(--caution-soft)] text-[var(--caution)] cursor-pointer hover:brightness-95 hover:shadow-sm',
  urgent:        'border border-[var(--alert)] bg-[var(--alert-soft)] text-[var(--alert)] cursor-pointer hover:brightness-95 hover:shadow-sm',
  expired:       'border border-[var(--alert)] bg-[var(--alert)] text-white cursor-pointer hover:brightness-95 hover:shadow-sm',
  not_started:   'border border-dashed border-[var(--line-2)] bg-[var(--paper-2)] text-[var(--ink-4)] cursor-pointer hover:bg-[var(--paper-3)] hover:shadow-sm',
  not_required:  'bg-[var(--paper)] text-[var(--ink-4)] cursor-default opacity-30',
  wrong_level:   'border border-[var(--warn)] bg-[var(--warn-soft)] text-[var(--warn)] cursor-pointer hover:brightness-95 hover:shadow-sm',
};

export default function TrainingGrid({ training, trainingTypes, staff, homeSlug, _config, configUpdatedAt, onReload, readOnly = false }) {
  const [view, setView] = useState('matrix');
  const [filterTeam, setFilterTeam] = useState('All');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterCompliance, setFilterCompliance] = useState('all');
  const [search, setSearch] = useState('');
  const [showManageTypes, setShowManageTypes] = useState(false);
  const [expanded, setExpanded] = useState(null);

  // Training record modal state
  const [recordModal, setRecordModal] = useState({ isOpen: false, staffId: '', typeId: '' });

  // CSV import state
  const [showImportModal, setShowImportModal] = useState(false);
  const [csvRows, setCsvRows] = useState([]);
  const [csvErrors, setCsvErrors] = useState([]);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(null);

  const todayStr = todayLocalISO();
  const today = useMemo(() => parseDate(todayStr), [todayStr]);
  const activeStaff = useMemo(() => (staff || []).filter(s => s.active !== false), [staff]);
  const activeTypes = useMemo(() => trainingTypes.filter(t => t.active), [trainingTypes]);

  const matrix = useMemo(() => buildComplianceMatrix(activeStaff, activeTypes, training || {}, today), [activeStaff, activeTypes, training, today]);
  const stats = useMemo(() => getComplianceStats(matrix), [matrix]);

  const filteredTypes = useMemo(() => {
    if (filterCategory === 'all') return activeTypes;
    return activeTypes.filter(t => t.category === filterCategory);
  }, [activeTypes, filterCategory]);

  const filteredStaff = useMemo(() => {
    let list = activeStaff;
    if (filterTeam !== 'All') list = list.filter(s => s.team === filterTeam);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(s => s.name.toLowerCase().includes(q));
    }
    if (filterCompliance === 'non-compliant') {
      list = list.filter(s => {
        const staffMap = matrix.get(s.id);
        if (!staffMap) return false;
        for (const [, r] of staffMap) {
          if (r.status === TRAINING_STATUS.EXPIRED || r.status === TRAINING_STATUS.URGENT || r.status === TRAINING_STATUS.NOT_STARTED || r.status === TRAINING_STATUS.WRONG_LEVEL) return true;
        }
        return false;
      });
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [activeStaff, filterTeam, search, filterCompliance, matrix]);

  function staffCompliancePct(staffId) {
    const staffMap = matrix.get(staffId);
    if (!staffMap) return 100;
    let required = 0, compliant = 0;
    for (const [, r] of staffMap) {
      if (r.status === TRAINING_STATUS.NOT_REQUIRED) continue;
      required++;
      if (r.status === TRAINING_STATUS.COMPLIANT || r.status === TRAINING_STATUS.EXPIRING_SOON) compliant++;
    }
    return required > 0 ? Math.round((compliant / required) * 100) : 100;
  }

  function openRecordModal(staffId, typeId) {
    const existing = (training || {})[staffId]?.[typeId] || null;
    if (readOnly && !existing) return;
    setRecordModal({ isOpen: true, staffId, typeId, existing });
  }

  // ── Training Type Management ─────────────────────────────────────────────

  const [allTypes, setAllTypes] = useState(() => trainingTypes);
  const [typesSaving, setTypesSaving] = useState(false);
  const [typeError, setTypeError] = useState(null);

  // Keep allTypes in sync if parent reloads (after save)
  useEffect(() => { setAllTypes(trainingTypes); }, [trainingTypes]);

  function addTrainingType() {
    if (readOnly) return;
    const id = 'custom-' + Date.now();
    setAllTypes([...allTypes, { id, name: 'New Training', category: 'mandatory', refresher_months: 12, roles: null, legislation: '', active: true }]);
  }

  function updateTypeField(id, field, value) {
    if (readOnly) return;
    setAllTypes(allTypes.map(t => t.id === id ? { ...t, [field]: value } : t));
  }

  function removeType(id) {
    if (readOnly) return;
    if (!confirm('Remove this training type? Existing records will be kept.')) return;
    setAllTypes(allTypes.filter(t => t.id !== id));
  }

  async function saveTypes() {
    if (readOnly) return;
    setTypesSaving(true);
    setTypeError(null);
    try {
      await updateTrainingTypes(homeSlug, allTypes, configUpdatedAt);
      onReload();
    } catch (e) {
      setTypeError('Failed to save training types: ' + e.message);
    } finally {
      setTypesSaving(false);
    }
  }

  // ── Excel Export ─────────────────────────────────────────────────────────

  function handleExport() {
    const headers = ['Name', 'Team', 'Role', ...filteredTypes.map(t => t.name)];
    const rows = filteredStaff.map(s => {
      const staffMap = matrix.get(s.id);
      return [s.name, s.team, s.role, ...filteredTypes.map(t => {
        const r = staffMap?.get(t.id);
        if (!r) return '';
        if (r.status === TRAINING_STATUS.NOT_REQUIRED) return 'N/A';
        if (r.status === TRAINING_STATUS.NOT_STARTED) return 'Not Started';
        if (r.status === TRAINING_STATUS.WRONG_LEVEL) return `Wrong Level (has ${r.record?.level || 'none'}, needs ${r.requiredLevel?.id})`;
        return r.record ? `${r.record.completed} (exp: ${r.record.expiry})` : r.status;
      })];
    });
    downloadXLSX('training_matrix', [{ name: 'Training Matrix', headers, rows }]);
  }

  // ── CSV Import ────────────────────────────────────────────────────────────

  function parseCSV(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return { rows: [], errors: ['File must have a header row and at least one data row'] };

    const parseRow = (line) => {
      const result = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') { inQuotes = !inQuotes; continue; }
        if (line[i] === ',' && !inQuotes) { result.push(current.trim()); current = ''; continue; }
        current += line[i];
      }
      result.push(current.trim());
      return result;
    };

    const headers = parseRow(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
    const nameCol = headers.findIndex(h => h.includes('staff') && h.includes('name') || h === 'name');
    const idCol = headers.findIndex(h => h.includes('staff') && h.includes('id') || h === 'id');
    const typeCol = headers.findIndex(h => h.includes('training') || h.includes('course') || h.includes('type'));
    const dateCol = headers.findIndex(h => h.includes('date') || h.includes('completed'));
    const trainerCol = headers.findIndex(h => h.includes('trainer'));
    const methodCol = headers.findIndex(h => h.includes('method'));
    const certCol = headers.findIndex(h => h.includes('cert'));

    if (typeCol === -1 || dateCol === -1) {
      return { rows: [], errors: ['CSV must have columns for training type and completed date'] };
    }

    const rows = [];
    const errors = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseRow(lines[i]);
      const rawName = nameCol >= 0 ? cols[nameCol] : '';
      const rawId = idCol >= 0 ? cols[idCol] : '';
      const rawType = typeCol >= 0 ? cols[typeCol] : '';
      let rawDate = dateCol >= 0 ? cols[dateCol] : '';

      const ddmmyyyy = rawDate.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
      if (ddmmyyyy) rawDate = `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, '0')}-${ddmmyyyy[1].padStart(2, '0')}`;

      let matchedStaff = null;
      if (rawId) matchedStaff = activeStaff.find(s => s.id === rawId);
      if (!matchedStaff && rawName) matchedStaff = activeStaff.find(s => s.name.toLowerCase() === rawName.toLowerCase());

      let matchedType = null;
      if (rawType) {
        matchedType = activeTypes.find(t => t.id === rawType.toLowerCase()) ||
          activeTypes.find(t => t.name.toLowerCase() === rawType.toLowerCase()) ||
          activeTypes.find(t => t.name.toLowerCase().includes(rawType.toLowerCase()));
      }

      const row = {
        line: i + 1,
        rawName: rawName || rawId,
        rawType,
        rawDate,
        trainer: trainerCol >= 0 ? cols[trainerCol] || '' : '',
        method: methodCol >= 0 ? cols[methodCol] || '' : '',
        certRef: certCol >= 0 ? cols[certCol] || '' : '',
        matchedStaff,
        matchedType,
        valid: !!matchedStaff && !!matchedType && /^\d{4}-\d{2}-\d{2}$/.test(rawDate),
      };
      if (!matchedStaff) errors.push(`Row ${i + 1}: Staff "${rawName || rawId}" not found`);
      if (!matchedType) errors.push(`Row ${i + 1}: Training type "${rawType}" not matched`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) errors.push(`Row ${i + 1}: Invalid date "${rawDate}"`);
      rows.push(row);
    }
    return { rows, errors };
  }

  function handleCSVFile(e) {
    if (readOnly) return;
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const { rows, errors } = parseCSV(ev.target.result);
      setCsvRows(rows);
      setCsvErrors(errors);
    };
    reader.readAsText(file);
  }

  async function handleImportCSV() {
    if (readOnly) return;
    const validRows = csvRows.filter(r => r.valid);
    if (validRows.length === 0) return;
    setImporting(true);
    setImportError(null);
    try {
      for (const row of validRows) {
        const method = TRAINING_METHODS.includes(row.method?.toLowerCase()) ? row.method.toLowerCase() : 'e-learning';
        await upsertTrainingRecord(homeSlug, row.matchedStaff.id, row.matchedType.id, {
          completed: row.rawDate,
          expiry: calculateExpiry(row.rawDate, row.matchedType.refresher_months),
          trainer: row.trainer,
          method,
          certificate_ref: row.certRef,
          evidence_ref: '',
          notes: 'Imported from CSV',
        });
      }
      onReload();
      setShowImportModal(false);
      setCsvRows([]);
      setCsvErrors([]);
    } catch (e) {
      setImportError('Import failed: ' + e.message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      {/* Header bar */}
      <div className="mb-4 flex justify-end print:hidden">
        <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
          <button onClick={handleExport} className={`${BTN.secondary} flex-1 whitespace-nowrap sm:flex-none`}>Export Excel</button>
          {!readOnly && <button onClick={() => setShowImportModal(true)} className={`${BTN.secondary} flex-1 whitespace-nowrap sm:flex-none`}>Import CSV</button>}
          <button onClick={() => window.print()} className={`${BTN.secondary} flex-1 whitespace-nowrap sm:flex-none`}>Print</button>
          <button onClick={() => setView(view === 'matrix' ? 'list' : 'matrix')} className={`${BTN.secondary} flex-1 whitespace-nowrap sm:flex-none`}>
            {view === 'matrix' ? 'List View' : 'Grid View'}
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="rounded-xl border border-[var(--ok)] bg-[var(--ok-soft)] p-3">
          <div className="text-xs font-medium text-[var(--ok)]">Compliance</div>
          <div className={`mt-0.5 text-2xl font-bold ${stats.compliancePct >= 90 ? 'text-[var(--ok)]' : stats.compliancePct >= 70 ? 'text-[var(--caution)]' : 'text-[var(--alert)]'}`}>{stats.compliancePct}%</div>
          <div className="text-[10px] text-[var(--ok)]">{stats.compliant}/{stats.totalRequired} items</div>
        </div>
        <div className="rounded-xl border border-[var(--alert)] bg-[var(--alert-soft)] p-3">
          <div className="text-xs font-medium text-[var(--alert)]">Expired</div>
          <div className="mt-0.5 text-2xl font-bold text-[var(--alert)]">{stats.expired}</div>
          <div className="text-[10px] text-[var(--alert)]">require immediate action</div>
        </div>
        <div className="rounded-xl border border-[var(--caution)] bg-[var(--caution-soft)] p-3">
          <div className="text-xs font-medium text-[var(--caution)]">Expiring Soon</div>
          <div className="mt-0.5 text-2xl font-bold text-[var(--caution)]">{stats.expiringSoon + stats.urgent}</div>
          <div className="text-[10px] text-[var(--caution)]">within 60 days</div>
        </div>
        <div className="rounded-xl border border-[var(--warn)] bg-[var(--warn-soft)] p-3">
          <div className="text-xs font-medium text-[var(--warn)]">Wrong Level</div>
          <div className="mt-0.5 text-2xl font-bold text-[var(--warn)]">{stats.wrongLevel}</div>
          <div className="text-[10px] text-[var(--warn)]">level mismatch</div>
        </div>
        <div className="rounded-xl border border-[var(--line)] bg-[var(--paper-2)] p-3">
          <div className="text-xs font-medium text-[var(--ink-3)]">Not Started</div>
          <div className="mt-0.5 text-2xl font-bold text-[var(--ink)]">{stats.notStarted}</div>
          <div className="text-[10px] text-[var(--ink-4)]">no record yet</div>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3 print:hidden">
        <input type="text" placeholder="Search staff..." value={search} onChange={e => setSearch(e.target.value)} className={`${INPUT.sm} min-w-[12rem] flex-1 sm:flex-none`} />
        <select value={filterTeam} onChange={e => setFilterTeam(e.target.value)} className={`${INPUT.select} w-auto flex-1 sm:flex-none`}>
          <option value="All">All Teams</option>
          {TEAMS.map(t => <option key={t}>{t}</option>)}
        </select>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className={`${INPUT.select} w-auto flex-1 sm:flex-none`}>
          <option value="all">All Categories</option>
          <option value="statutory">Statutory</option>
          <option value="mandatory">Mandatory</option>
        </select>
        <select value={filterCompliance} onChange={e => setFilterCompliance(e.target.value)} className={`${INPUT.select} w-auto flex-1 sm:flex-none`}>
          <option value="all">All Staff</option>
          <option value="non-compliant">Non-Compliant Only</option>
        </select>
        <span className="self-center text-xs text-[var(--ink-4)]">{filteredStaff.length} staff | {filteredTypes.length} training types</span>
      </div>

      {/* Matrix View */}
      {view === 'matrix' && (
        <div className={CARD.flush}>
          <div className={TABLE.wrapper}>
            <table className="w-full min-w-[900px] text-[11px] text-[var(--ink)]">
              <thead>
                <tr className="border-b border-[var(--line)]">
                  <th scope="col" className="sticky left-0 z-10 min-w-[140px] bg-[var(--paper)] px-2 py-2 text-left font-semibold text-[var(--ink-3)]">Staff</th>
                  {filteredTypes.map(t => (
                    <th scope="col" key={t.id} className="px-0.5 py-2 text-center font-medium text-[var(--ink-3)]" style={{ minWidth: '80px', maxWidth: '120px', fontSize: '10px', lineHeight: '1.2' }}>
                      {t.name}
                    </th>
                  ))}
                  <th scope="col" className="min-w-[50px] px-2 py-2 text-center font-semibold text-[var(--ink-3)]">%</th>
                </tr>
              </thead>
              <tbody>
                {filteredStaff.map(s => {
                  const staffMap = matrix.get(s.id);
                  const pct = staffCompliancePct(s.id);
                  return (
                    <tr key={s.id} className="border-b border-[var(--line)] hover:bg-[var(--paper-2)]">
                      <td className="sticky left-0 z-10 bg-[var(--paper)] px-2 py-1 font-medium text-[var(--ink)]">
                        <div>{s.name}</div>
                        <div className="text-[9px] text-gray-400">{s.team} · {s.role}</div>
                      </td>
                      {filteredTypes.map(t => {
                        const r = staffMap?.get(t.id);
                        if (!r) return <td key={t.id} className="px-0.5 py-1 text-center"><div className="h-9 w-full" /></td>;
                        const display = STATUS_DISPLAY[r.status];
                        return (
                          <td key={t.id} className="px-0.5 py-1 text-center">
                            <button
                              onClick={() => r.status !== TRAINING_STATUS.NOT_REQUIRED && openRecordModal(s.id, t.id)}
                              disabled={r.status === TRAINING_STATUS.NOT_REQUIRED || (readOnly && !r.record)}
                              className={`flex h-9 w-full items-center justify-center rounded-lg text-[10px] font-bold transition-all ${CELL_COLORS[r.status]} ${(readOnly && !r.record) ? 'cursor-default hover:shadow-none' : ''}`}
                              title={`${s.name} — ${t.name}: ${display.label}${r.daysUntilExpiry != null ? ` (${r.daysUntilExpiry}d)` : ''}${r.requiredLevel ? ` [needs ${r.requiredLevel.name}]` : ''}`}
                            >
                              {display.symbol}
                            </button>
                          </td>
                        );
                      })}
                      <td className="px-2 py-1 text-center">
                        <span className={`text-xs font-bold ${pct >= 90 ? 'text-[var(--ok)]' : pct >= 70 ? 'text-[var(--caution)]' : 'text-[var(--alert)]'}`}>{pct}%</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filteredStaff.length === 0 && <div className="p-8 text-center text-sm text-[var(--ink-4)]">No staff match the current filters</div>}
        </div>
      )}

      {/* List View */}
      {view === 'list' && (
        <div className="space-y-2">
          {filteredStaff.map(s => {
            const staffMap = matrix.get(s.id);
            const pct = staffCompliancePct(s.id);
            const isExpanded = expanded === s.id;
            return (
              <div key={s.id} className={CARD.padded}>
                <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(isExpanded ? null : s.id)}>
                  <div>
                    <span className="font-medium text-gray-900">{s.name}</span>
                    <span className="text-xs text-gray-400 ml-2">{s.team} · {s.role}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-bold ${pct >= 90 ? 'text-emerald-600' : pct >= 70 ? 'text-amber-600' : 'text-red-600'}`}>{pct}%</span>
                    <span className="text-gray-400 text-xs">{isExpanded ? '\u25B2' : '\u25BC'}</span>
                  </div>
                </div>
                {isExpanded && (
                  <div className="mt-3 border-t border-gray-100 pt-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {filteredTypes.map(t => {
                        const r = staffMap?.get(t.id);
                        if (!r || r.status === TRAINING_STATUS.NOT_REQUIRED) return null;
                        const display = STATUS_DISPLAY[r.status];
                        const canOpen = !readOnly || !!r.record;
                        return (
                          <div
                            key={t.id}
                            className={`flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 text-xs transition-colors ${canOpen ? 'cursor-pointer hover:bg-gray-100' : ''}`}
                            onClick={() => canOpen && openRecordModal(s.id, t.id)}
                          >
                            <div>
                              <div className="font-medium text-gray-800">{t.name}</div>
                              {r.record && <div className="text-gray-400 mt-0.5">Completed: {r.record.completed} · Expires: {r.record.expiry}{r.record.level ? ` · ${r.record.level}` : ''}</div>}
                              {r.requiredLevel && r.status === TRAINING_STATUS.WRONG_LEVEL && (
                                <div className="text-orange-500 mt-0.5">Needs: {r.requiredLevel.name}</div>
                              )}
                            </div>
                            <span className={BADGE[display.badgeKey]}>{display.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Manage Training Types */}
      {!readOnly && (
        <div className="mt-6 print:hidden">
          <button onClick={() => setShowManageTypes(!showManageTypes)} className={BTN.ghost}>
            {showManageTypes ? 'Hide' : 'Manage'} Training Types
          </button>
          {showManageTypes && (
          <div className={`mt-3 ${CARD.flush}`}>
            <table className={TABLE.table}>
              <thead className={TABLE.thead}>
                <tr>
                  <th scope="col" className={TABLE.th}>Name</th>
                  <th scope="col" className={TABLE.th}>Category</th>
                  <th scope="col" className={TABLE.th}>Refresher</th>
                  <th scope="col" className={TABLE.th}>Roles</th>
                  <th scope="col" className={TABLE.th}>Levels</th>
                  <th scope="col" className={TABLE.th}>Legislation</th>
                  <th scope="col" className={`${TABLE.th} text-center`}>Active</th>
                  <th scope="col" className={TABLE.th}></th>
                </tr>
              </thead>
              <tbody>
                {allTypes.map(t => (
                  <tr key={t.id} className={`${TABLE.tr} ${!t.active ? 'opacity-50' : ''}`}>
                    <td className={`${TABLE.td} font-medium`}>
                      <input type="text" value={t.name} onChange={e => updateTypeField(t.id, 'name', e.target.value)}
                        className="border border-gray-200 rounded px-1.5 py-0.5 text-xs w-full" />
                    </td>
                    <td className={TABLE.td}>
                      <select value={t.category} onChange={e => updateTypeField(t.id, 'category', e.target.value)}
                        className="border border-gray-200 rounded px-1 py-0.5 text-xs">
                        <option value="statutory">Statutory</option>
                        <option value="mandatory">Mandatory</option>
                      </select>
                    </td>
                    <td className={TABLE.td}>
                      <div className="flex items-center gap-1">
                        <input type="number" min="1" max="60" value={t.refresher_months}
                          onChange={e => updateTypeField(t.id, 'refresher_months', parseInt(e.target.value) || 12)}
                          className="border border-gray-200 rounded px-1 py-0.5 text-xs w-12" />
                        <span className="text-xs text-gray-400">mo</span>
                      </div>
                    </td>
                    <td className={`${TABLE.td} text-xs text-gray-500`}>{t.roles ? t.roles.join(', ') : 'All'}</td>
                    <td className={`${TABLE.td} text-xs text-gray-400`}>
                      {t.levels ? t.levels.map(l => l.name).join(', ') : '-'}
                    </td>
                    <td className={`${TABLE.td} text-xs text-gray-400`}>{t.legislation || '-'}</td>
                    <td className={`${TABLE.td} text-center`}>
                      <input type="checkbox" checked={t.active} onChange={e => updateTypeField(t.id, 'active', e.target.checked)} />
                    </td>
                    <td className={TABLE.td}>
                      {t.id.startsWith('custom-') && (
                        <button onClick={() => removeType(t.id)} className="text-red-400 hover:text-red-600 text-xs">Remove</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="p-3 flex flex-col gap-2">
              {typeError && <p className="text-xs text-red-600">{typeError}</p>}
              <div className="flex gap-2">
                <button onClick={addTrainingType} className={`${BTN.secondary} ${BTN.sm}`}>+ Add Custom Type</button>
                <button onClick={saveTypes} disabled={typesSaving} className={`${BTN.primary} ${BTN.sm} disabled:opacity-50`}>
                  {typesSaving ? 'Saving...' : 'Save Types'}
                </button>
              </div>
            </div>
          </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="flex gap-4 text-[10px] text-gray-500 mt-4 print:hidden flex-wrap">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-200" /> Compliant</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-200" /> Expiring 30-60d</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-200" /> Urgent &lt;30d</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-300" /> Expired</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-orange-200" /> Wrong Level</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-gray-100 border border-dashed border-gray-300" /> Not Started</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-gray-50" /> N/A</span>
      </div>

      {/* Training Record Modal */}
      {recordModal.isOpen && (() => {
        const type = activeTypes.find(t => t.id === recordModal.typeId);
        const s = activeStaff.find(x => x.id === recordModal.staffId);
        return (
          <TrainingRecordModal
            isOpen={recordModal.isOpen}
            onClose={() => setRecordModal({ isOpen: false, staffId: '', typeId: '' })}
            staffId={recordModal.staffId}
            staffName={s?.name || ''}
            typeId={recordModal.typeId}
            typeName={type?.name || ''}
            type={type}
            existing={recordModal.existing}
            homeSlug={homeSlug}
            staff={activeStaff}
            onSaved={onReload}
            readOnly={readOnly}
          />
        );
      })()}

      {/* CSV Import Modal */}
      <Modal isOpen={!readOnly && showImportModal} onClose={() => { setShowImportModal(false); setCsvRows([]); setCsvErrors([]); setImportError(null); }} title="Import Training Records from CSV" size="lg">
        {csvRows.length === 0 ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Upload a CSV file with training completion records. Expected columns:
            </p>
            <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3 font-mono">
              staff_name, training_type, completed_date, trainer, method, certificate_ref
            </div>
            <p className="text-xs text-gray-400">
              Dates can be DD/MM/YYYY or YYYY-MM-DD. Staff and training types are matched by name (case-insensitive).
            </p>
            <div>
              <label className={INPUT.label}>Select CSV File</label>
              <input type="file" accept=".csv,.txt" onChange={handleCSVFile}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-3">
              <span className={BADGE.blue}>{csvRows.length} rows parsed</span>
              <span className={BADGE.green}>{csvRows.filter(r => r.valid).length} valid</span>
              {csvRows.filter(r => !r.valid).length > 0 && (
                <span className={BADGE.red}>{csvRows.filter(r => !r.valid).length} unmatched</span>
              )}
            </div>
            {csvErrors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 max-h-32 overflow-y-auto">
                <div className="text-xs font-semibold text-red-700 mb-1">Matching Issues:</div>
                {csvErrors.map((err, i) => (
                  <div key={i} className="text-xs text-red-600">{err}</div>
                ))}
              </div>
            )}
            <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg">
              <table className={TABLE.table}>
                <thead className={TABLE.thead}>
                  <tr>
                    <th scope="col" className={TABLE.th}>Row</th>
                    <th scope="col" className={TABLE.th}>Staff</th>
                    <th scope="col" className={TABLE.th}>Training</th>
                    <th scope="col" className={TABLE.th}>Date</th>
                    <th scope="col" className={TABLE.th}>Trainer</th>
                    <th scope="col" className={TABLE.th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {csvRows.map((row, i) => (
                    <tr key={i} className={row.valid ? '' : 'bg-red-50'}>
                      <td className={TABLE.tdMono}>{row.line}</td>
                      <td className={TABLE.td}>
                        {row.matchedStaff ? <span className="text-gray-900">{row.matchedStaff.name}</span> : <span className="text-red-600">{row.rawName || '?'}</span>}
                      </td>
                      <td className={TABLE.td}>
                        {row.matchedType ? <span className="text-gray-900">{row.matchedType.name}</span> : <span className="text-red-600">{row.rawType || '?'}</span>}
                      </td>
                      <td className={TABLE.tdMono}>{row.rawDate || '-'}</td>
                      <td className={TABLE.td}>{row.trainer || '-'}</td>
                      <td className={TABLE.td}>
                        <span className={row.valid ? BADGE.green : BADGE.red}>{row.valid ? 'Ready' : 'Error'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <label className="text-xs text-gray-500 cursor-pointer hover:text-blue-600">
                Choose a different file
                <input type="file" accept=".csv,.txt" onChange={handleCSVFile} className="hidden" />
              </label>
            </div>
          </div>
        )}

        {importError && <p className="text-xs text-red-600 mt-2">{importError}</p>}
        <div className={MODAL.footer}>
          <button onClick={() => { setShowImportModal(false); setCsvRows([]); setCsvErrors([]); setImportError(null); }} className={BTN.ghost}>Cancel</button>
          {csvRows.filter(r => r.valid).length > 0 && (
            <button onClick={handleImportCSV} disabled={importing} className={`${BTN.primary} disabled:opacity-50`}>
              {importing ? 'Importing...' : `Import ${csvRows.filter(r => r.valid).length} Records`}
            </button>
          )}
        </div>
      </Modal>
    </>
  );
}
