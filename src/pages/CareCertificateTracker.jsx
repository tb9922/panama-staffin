import { useState, useMemo, useEffect } from 'react';
import { formatDate } from '../lib/rotation.js';
import {
  CARE_CERTIFICATE_STANDARDS, CC_CATEGORIES, CC_STATUSES, CC_STANDARD_STATUSES,
  TOTAL_STANDARDS, CC_COMPLETION_WEEKS,
  ensureCareCertDefaults, getCareCertStatus, getCareCertStats,
} from '../lib/careCertificate.js';
import { downloadXLSX } from '../lib/excel.js';
import { CARD, BTN, BADGE, INPUT, MODAL, PAGE, TABLE } from '../lib/design.js';

const STATUS_BADGE_MAP = {
  not_started: BADGE.gray,
  in_progress: BADGE.blue,
  completed: BADGE.green,
  overdue: BADGE.red,
};

const STD_BADGE_MAP = {
  not_started: BADGE.gray,
  in_progress: BADGE.amber,
  passed: BADGE.green,
  failed: BADGE.red,
};

export default function CareCertificateTracker({ data, updateData }) {
  const [showModal, setShowModal] = useState(false);
  const [selectedStaffId, setSelectedStaffId] = useState(null);
  const [showStartModal, setShowStartModal] = useState(false);
  const [startForm, setStartForm] = useState({ staffId: '', start_date: '', supervisor: '' });
  const [filterStatus, setFilterStatus] = useState('all');
  const [search, setSearch] = useState('');
  // Track which standard is expanded in the detail modal
  const [expandedStd, setExpandedStd] = useState(null);
  // Editable supervisor in detail modal
  const [editSupervisor, setEditSupervisor] = useState('');

  // Ensure defaults on first load
  useEffect(() => {
    const updated = ensureCareCertDefaults(data);
    if (updated) updateData(updated);
  }, []);

  const today = new Date();
  const todayStr = formatDate(today);
  const activeStaff = useMemo(() => (data.staff || []).filter(s => s.active !== false), [data.staff]);
  const careCertData = data.care_certificate || {};

  const stats = useMemo(() => getCareCertStats(careCertData, activeStaff, today), [careCertData, activeStaff]);

  // Staff who have CC records
  const trackedStaff = useMemo(() => {
    let list = activeStaff.filter(s => careCertData[s.id]);
    if (filterStatus !== 'all') {
      list = list.filter(s => {
        const result = getCareCertStatus(s.id, careCertData, careCertData[s.id]?.start_date, today);
        return result.status === filterStatus;
      });
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(s => s.name.toLowerCase().includes(q));
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [activeStaff, careCertData, filterStatus, search]);

  // Staff eligible to start CC (active, no existing CC record)
  const eligibleStaff = useMemo(() => {
    return activeStaff.filter(s => !careCertData[s.id]).sort((a, b) => a.name.localeCompare(b.name));
  }, [activeStaff, careCertData]);

  // ── Start New CC ──────────────────────────────────────────────────────

  function openStartModal() {
    setStartForm({
      staffId: eligibleStaff.length > 0 ? eligibleStaff[0].id : '',
      start_date: todayStr,
      supervisor: '',
    });
    setShowStartModal(true);
  }

  function handleStartSave() {
    if (!startForm.staffId || !startForm.start_date) return;
    const cc = JSON.parse(JSON.stringify(data.care_certificate || {}));
    // Calculate expected completion: start + 12 weeks (84 days)
    const startDate = new Date(startForm.start_date + 'T00:00:00');
    startDate.setDate(startDate.getDate() + CC_COMPLETION_WEEKS * 7);
    const expectedCompletion = formatDate(startDate);

    // Build empty standards
    const standards = {};
    for (const std of CARE_CERTIFICATE_STANDARDS) {
      standards[std.id] = { status: 'not_started', completion_date: null, assessor: '', notes: '' };
    }

    cc[startForm.staffId] = {
      start_date: startForm.start_date,
      expected_completion: expectedCompletion,
      supervisor: startForm.supervisor,
      status: 'in_progress',
      completion_date: null,
      standards,
    };
    updateData({ ...data, care_certificate: cc });
    setShowStartModal(false);
  }

  // ── Detail Modal ──────────────────────────────────────────────────────

  function openDetailModal(staffId) {
    setSelectedStaffId(staffId);
    setExpandedStd(null);
    setEditSupervisor(careCertData[staffId]?.supervisor || '');
    setShowModal(true);
  }

  function getSelectedRecord() {
    if (!selectedStaffId) return null;
    return careCertData[selectedStaffId] || null;
  }

  function handleStandardUpdate(stdId, field, value) {
    const cc = JSON.parse(JSON.stringify(data.care_certificate || {}));
    if (!cc[selectedStaffId]) return;
    if (!cc[selectedStaffId].standards) cc[selectedStaffId].standards = {};
    if (!cc[selectedStaffId].standards[stdId]) {
      cc[selectedStaffId].standards[stdId] = { status: 'not_started', completion_date: null, assessor: '', notes: '' };
    }
    cc[selectedStaffId].standards[stdId][field] = value;

    // If status changed to passed and no completion_date, set today
    if (field === 'status' && value === 'passed' && !cc[selectedStaffId].standards[stdId].completion_date) {
      cc[selectedStaffId].standards[stdId].completion_date = todayStr;
    }

    // Auto-calculate overall status
    const standards = cc[selectedStaffId].standards;
    let passedCount = 0;
    let hasInProgress = false;
    for (const std of CARE_CERTIFICATE_STANDARDS) {
      const s = standards[std.id];
      if (s?.status === 'passed') passedCount++;
      if (s?.status === 'in_progress') hasInProgress = true;
    }
    if (passedCount === TOTAL_STANDARDS) {
      cc[selectedStaffId].status = 'completed';
      if (!cc[selectedStaffId].completion_date) cc[selectedStaffId].completion_date = todayStr;
    } else if (passedCount > 0 || hasInProgress) {
      cc[selectedStaffId].status = 'in_progress';
      cc[selectedStaffId].completion_date = null;
    } else {
      cc[selectedStaffId].status = 'not_started';
      cc[selectedStaffId].completion_date = null;
    }

    updateData({ ...data, care_certificate: cc });
  }

  function handleSaveSupervisor() {
    const cc = JSON.parse(JSON.stringify(data.care_certificate || {}));
    if (!cc[selectedStaffId]) return;
    cc[selectedStaffId].supervisor = editSupervisor;
    updateData({ ...data, care_certificate: cc });
  }

  function handleRemoveStaff() {
    if (!confirm('Remove this staff member from Care Certificate tracking? All progress will be lost.')) return;
    const cc = JSON.parse(JSON.stringify(data.care_certificate || {}));
    delete cc[selectedStaffId];
    updateData({ ...data, care_certificate: cc });
    setShowModal(false);
    setSelectedStaffId(null);
  }

  // ── Excel Export ──────────────────────────────────────────────────────

  function handleExport() {
    const stdHeaders = CARE_CERTIFICATE_STANDARDS.map(s => s.name);
    const headers = ['Name', 'Role', 'Status', 'Progress', 'Start Date', 'Expected Completion', 'Supervisor', ...stdHeaders];
    const rows = trackedStaff.map(s => {
      const record = careCertData[s.id];
      const result = getCareCertStatus(s.id, careCertData, record?.start_date, today);
      const stdCols = CARE_CERTIFICATE_STANDARDS.map(std => {
        const stdRec = record?.standards?.[std.id];
        if (!stdRec) return 'Not Started';
        const label = CC_STANDARD_STATUSES[stdRec.status]?.label || stdRec.status;
        return stdRec.completion_date ? `${label} (${stdRec.completion_date})` : label;
      });
      return [
        s.name, s.role,
        CC_STATUSES[result.status]?.label || result.status,
        `${result.completedCount}/${TOTAL_STANDARDS}`,
        record?.start_date || '-',
        record?.expected_completion || '-',
        record?.supervisor || '-',
        ...stdCols,
      ];
    });
    downloadXLSX('care_certificate', [{ name: 'Care Certificate', headers, rows }]);
  }

  // ── Progress Bar Component ────────────────────────────────────────────

  function ProgressBar({ completed, total }) {
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    const color = pct === 100 ? 'bg-emerald-500' : pct >= 50 ? 'bg-blue-500' : pct > 0 ? 'bg-amber-500' : 'bg-gray-300';
    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs font-medium text-gray-600 whitespace-nowrap">{completed}/{total}</span>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────

  const selectedRecord = getSelectedRecord();
  const selectedStaff = selectedStaffId ? activeStaff.find(s => s.id === selectedStaffId) : null;
  const selectedResult = selectedStaffId ? getCareCertStatus(selectedStaffId, careCertData, selectedRecord?.start_date, today) : null;

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Care Certificate Tracker</h1>
          <p className="text-xs text-gray-500 mt-1">CQC Regulation 18 — 16 standards (2025 update incl. Oliver McGowan)</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExport} className={BTN.secondary}>Export Excel</button>
          <button onClick={openStartModal} className={BTN.primary}>Start New</button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className={CARD.padded}>
          <div className="text-xs font-medium text-blue-600">In Progress</div>
          <div className="text-2xl font-bold text-blue-700 mt-0.5">{stats.inProgress}</div>
          <div className="text-[10px] text-gray-400">currently working through CC</div>
        </div>
        <div className={CARD.padded}>
          <div className="text-xs font-medium text-emerald-600">Completed</div>
          <div className="text-2xl font-bold text-emerald-700 mt-0.5">{stats.completed}</div>
          <div className="text-[10px] text-gray-400">all 16 standards passed</div>
        </div>
        <div className={CARD.padded}>
          <div className="text-xs font-medium text-amber-600">On Track</div>
          <div className="text-2xl font-bold text-amber-700 mt-0.5">{stats.onTrack}</div>
          <div className="text-[10px] text-gray-400">within 12-week target</div>
        </div>
        <div className={CARD.padded}>
          <div className="text-xs font-medium text-red-600">Overdue</div>
          <div className="text-2xl font-bold text-red-700 mt-0.5">{stats.overdue}</div>
          <div className="text-[10px] text-gray-400">exceeded 12-week deadline</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <input type="text" placeholder="Search staff..." value={search} onChange={e => setSearch(e.target.value)} className={`${INPUT.sm} w-44`} />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={`${INPUT.select} w-auto`}>
          <option value="all">All Statuses</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="overdue">Overdue</option>
        </select>
        <span className="text-xs text-gray-400 self-center">{trackedStaff.length} staff tracked | {stats.totalTracked} total</span>
      </div>

      {/* Staff Table */}
      <div className={CARD.flush}>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th className={TABLE.th}>Staff Name</th>
                <th className={TABLE.th}>Role</th>
                <th className={TABLE.th}>Start Date</th>
                <th className={TABLE.th}>Supervisor</th>
                <th className={TABLE.th} style={{ minWidth: '160px' }}>Progress</th>
                <th className={TABLE.th}>Status</th>
                <th className={TABLE.th}>Weeks</th>
                <th className={TABLE.th}></th>
              </tr>
            </thead>
            <tbody>
              {trackedStaff.length === 0 && (
                <tr><td colSpan={8} className={TABLE.empty}>
                  {Object.keys(careCertData).length === 0
                    ? 'No staff are being tracked for Care Certificate. Click "Start New" to begin.'
                    : 'No staff match the current filters.'}
                </td></tr>
              )}
              {trackedStaff.map(s => {
                const record = careCertData[s.id];
                const result = getCareCertStatus(s.id, careCertData, record?.start_date, today);
                const badgeClass = STATUS_BADGE_MAP[result.status] || BADGE.gray;
                const statusLabel = CC_STATUSES[result.status]?.label || result.status;
                return (
                  <tr key={s.id} className={`${TABLE.tr} cursor-pointer`} onClick={() => openDetailModal(s.id)}>
                    <td className={`${TABLE.td} font-medium`}>{s.name}</td>
                    <td className={TABLE.td}>{s.role}</td>
                    <td className={TABLE.tdMono}>{record?.start_date || '-'}</td>
                    <td className={TABLE.td}>{record?.supervisor || '-'}</td>
                    <td className={TABLE.td}><ProgressBar completed={result.completedCount} total={TOTAL_STANDARDS} /></td>
                    <td className={TABLE.td}><span className={badgeClass}>{statusLabel}</span></td>
                    <td className={TABLE.td}>
                      <span className={`text-xs ${result.weeksElapsed > CC_COMPLETION_WEEKS && result.status !== 'completed' ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>
                        {result.weeksElapsed}w
                      </span>
                    </td>
                    <td className={TABLE.td}>
                      <button onClick={e => { e.stopPropagation(); openDetailModal(s.id); }} className={`${BTN.ghost} ${BTN.xs}`}>Edit</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Start New Modal ─────────────────────────────────────────────── */}
      {showStartModal && (
        <div className={MODAL.overlay} onClick={() => setShowStartModal(false)}>
          <div className={MODAL.panel} onClick={e => e.stopPropagation()}>
            <h2 className={MODAL.title}>Start Care Certificate</h2>

            <div className="space-y-4">
              <div>
                <label className={INPUT.label}>Staff Member</label>
                {eligibleStaff.length === 0 ? (
                  <p className="text-sm text-gray-500">All active staff already have a Care Certificate record.</p>
                ) : (
                  <select value={startForm.staffId} onChange={e => setStartForm({ ...startForm, staffId: e.target.value })} className={INPUT.select}>
                    {eligibleStaff.map(s => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}
                  </select>
                )}
              </div>
              <div>
                <label className={INPUT.label}>Start Date</label>
                <input type="date" value={startForm.start_date} onChange={e => setStartForm({ ...startForm, start_date: e.target.value })} className={INPUT.base} />
              </div>
              <div>
                <label className={INPUT.label}>Supervisor / Assessor</label>
                <input type="text" value={startForm.supervisor} onChange={e => setStartForm({ ...startForm, supervisor: e.target.value })} className={INPUT.base} placeholder="e.g. Jane Smith" />
              </div>
              {startForm.start_date && (
                <div className="text-xs text-gray-500">
                  Expected completion: <span className="font-medium">{(() => {
                    const d = new Date(startForm.start_date + 'T00:00:00');
                    d.setDate(d.getDate() + CC_COMPLETION_WEEKS * 7);
                    return formatDate(d);
                  })()}</span> (12 weeks)
                </div>
              )}
            </div>

            <div className={MODAL.footer}>
              <button onClick={() => setShowStartModal(false)} className={BTN.secondary}>Cancel</button>
              <button onClick={handleStartSave} className={BTN.primary} disabled={!startForm.staffId || !startForm.start_date}>Start</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Detail Modal ────────────────────────────────────────────────── */}
      {showModal && selectedStaffId && selectedRecord && (
        <div className={MODAL.overlay} onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-2xl mx-4 animate-modal-in max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className={MODAL.title}>{selectedStaff?.name}</h2>
                <p className="text-sm text-gray-500 -mt-2">{selectedStaff?.role} — Care Certificate</p>
              </div>
              <span className={STATUS_BADGE_MAP[selectedResult?.status] || BADGE.gray}>
                {CC_STATUSES[selectedResult?.status]?.label || selectedResult?.status}
              </span>
            </div>

            {/* Summary Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="text-xs">
                <span className="text-gray-500">Start Date</span>
                <div className="font-medium">{selectedRecord.start_date}</div>
              </div>
              <div className="text-xs">
                <span className="text-gray-500">Expected Completion</span>
                <div className="font-medium">{selectedRecord.expected_completion}</div>
              </div>
              <div className="text-xs">
                <span className="text-gray-500">Weeks Elapsed</span>
                <div className={`font-medium ${selectedResult?.weeksElapsed > CC_COMPLETION_WEEKS && selectedResult?.status !== 'completed' ? 'text-red-600' : ''}`}>
                  {selectedResult?.weeksElapsed}w / {CC_COMPLETION_WEEKS}w
                </div>
              </div>
              <div className="text-xs">
                <span className="text-gray-500">Progress</span>
                <div className="font-medium">{selectedResult?.completedCount}/{TOTAL_STANDARDS} ({selectedResult?.progressPct}%)</div>
              </div>
            </div>

            {/* Supervisor edit */}
            <div className="flex items-center gap-2 mb-4">
              <label className="text-xs text-gray-500">Supervisor:</label>
              <input type="text" value={editSupervisor} onChange={e => setEditSupervisor(e.target.value)} className={`${INPUT.sm} w-48`} placeholder="Assessor name" />
              {editSupervisor !== selectedRecord.supervisor && (
                <button onClick={handleSaveSupervisor} className={`${BTN.primary} ${BTN.xs}`}>Save</button>
              )}
            </div>

            {/* Progress Bar */}
            <div className="mb-4">
              <ProgressBar completed={selectedResult?.completedCount || 0} total={TOTAL_STANDARDS} />
            </div>

            {/* Standards List */}
            <div className="space-y-1">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Standards</div>
              {CARE_CERTIFICATE_STANDARDS.map(std => {
                const stdRec = selectedRecord.standards?.[std.id] || { status: 'not_started', completion_date: null, assessor: '', notes: '' };
                const isExpanded = expandedStd === std.id;
                const badgeClass = STD_BADGE_MAP[stdRec.status] || BADGE.gray;
                const statusLabel = CC_STANDARD_STATUSES[stdRec.status]?.label || stdRec.status;
                const cat = CC_CATEGORIES.find(c => c.id === std.category);
                return (
                  <div key={std.id} className="border border-gray-100 rounded-lg overflow-hidden">
                    {/* Standard header row */}
                    <button
                      onClick={() => setExpandedStd(isExpanded ? null : std.id)}
                      className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 transition-colors text-left"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs text-gray-400 font-mono w-8 shrink-0">{std.id.replace('std-', '#')}</span>
                        <span className="text-sm text-gray-800 truncate">{std.name}</span>
                        <span className="text-[10px] text-gray-400">({cat?.name})</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {stdRec.completion_date && <span className="text-[10px] text-gray-400">{stdRec.completion_date}</span>}
                        <span className={badgeClass}>{statusLabel}</span>
                        <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                      </div>
                    </button>

                    {/* Expanded edit area */}
                    {isExpanded && (
                      <div className="px-3 py-3 bg-gray-50 border-t border-gray-100 space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className={INPUT.label}>Status</label>
                            <select
                              value={stdRec.status}
                              onChange={e => handleStandardUpdate(std.id, 'status', e.target.value)}
                              className={INPUT.select}
                            >
                              <option value="not_started">Not Started</option>
                              <option value="in_progress">In Progress</option>
                              <option value="passed">Passed</option>
                              <option value="failed">Failed</option>
                            </select>
                          </div>
                          <div>
                            <label className={INPUT.label}>Completion Date</label>
                            <input
                              type="date"
                              value={stdRec.completion_date || ''}
                              onChange={e => handleStandardUpdate(std.id, 'completion_date', e.target.value || null)}
                              className={INPUT.base}
                            />
                          </div>
                        </div>
                        <div>
                          <label className={INPUT.label}>Assessor</label>
                          <input
                            type="text"
                            value={stdRec.assessor || ''}
                            onChange={e => handleStandardUpdate(std.id, 'assessor', e.target.value)}
                            className={INPUT.base}
                            placeholder="Name of assessor"
                          />
                        </div>
                        <div>
                          <label className={INPUT.label}>Notes</label>
                          <textarea
                            value={stdRec.notes || ''}
                            onChange={e => handleStandardUpdate(std.id, 'notes', e.target.value)}
                            className={INPUT.base}
                            rows={2}
                            placeholder="Additional notes..."
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="flex justify-between mt-6 pt-4 border-t border-gray-100">
              <button onClick={handleRemoveStaff} className={`${BTN.danger} ${BTN.sm}`}>Remove from Tracking</button>
              <button onClick={() => setShowModal(false)} className={BTN.secondary}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
