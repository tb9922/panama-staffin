import { useState, useMemo } from 'react';
import { formatDate, parseDate } from '../../lib/rotation.js';
import { getAppraisalStatus, getAppraisalStats } from '../../lib/training.js';
import FileAttachments from '../FileAttachments.jsx';
import {
  createAppraisal,
  updateAppraisal,
  deleteAppraisal,
  getRecordAttachments,
  uploadRecordAttachment,
  deleteRecordAttachment,
  downloadRecordAttachment,
} from '../../lib/api.js';
import { downloadXLSX } from '../../lib/excel.js';
import { CARD, TABLE, INPUT, BTN, BADGE, MODAL } from '../../lib/design.js';
import Modal from '../Modal.jsx';
import useDirtyGuard from '../../hooks/useDirtyGuard.js';
import { todayLocalISO } from '../../lib/localDates.js';
import { clickableRowProps } from '../../lib/a11y.js';

const TEAMS = ['Day A', 'Day B', 'Night A', 'Night B', 'Float'];

const APR_STATUS_BADGE = {
  up_to_date: { badge: BADGE.green, label: 'Up to Date' },
  due_soon:   { badge: BADGE.amber, label: 'Due Soon' },
  due:        { badge: BADGE.orange, label: 'Overdue' },
  overdue:    { badge: BADGE.red, label: 'Overdue' },
  not_started:{ badge: BADGE.gray, label: 'No Records' },
};

export default function AppraisalPanel({ appraisals, staff, homeSlug, onReload, readOnly = false }) {
  const [filterTeam, setFilterTeam] = useState('All');
  const [search, setSearch] = useState('');
  const [aprFilter, setAprFilter] = useState('all');
  const [expanded, setExpanded] = useState(null);

  const [showModal, setShowModal] = useState(false);
  const [modalData, setModalData] = useState({ staffId: '', id: '', date: '', appraiser: '', objectives: '', training_needs: '', development_plan: '', next_due: '', notes: '', updated_at: '', existing: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useDirtyGuard(showModal);

  const todayStr = todayLocalISO();
  const today = useMemo(() => parseDate(todayStr), [todayStr]);
  const activeStaff = useMemo(() => (staff || []).filter(s => s.active !== false), [staff]);
  const appraisalsData = useMemo(() => appraisals || {}, [appraisals]);

  const aprStats = useMemo(() => getAppraisalStats(activeStaff, appraisalsData, today), [activeStaff, appraisalsData, today]);

  const filteredStaff = useMemo(() => {
    let list = activeStaff;
    if (filterTeam !== 'All') list = list.filter(s => s.team === filterTeam);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(s => s.name.toLowerCase().includes(q));
    }
    if (aprFilter !== 'all') {
      list = list.filter(s => {
        const result = getAppraisalStatus(s, appraisalsData, today);
        if (aprFilter === 'overdue') return result.status === 'overdue';
        if (aprFilter === 'due_soon') return result.status === 'due_soon';
        if (aprFilter === 'up_to_date') return result.status === 'up_to_date';
        return true;
      });
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [activeStaff, filterTeam, search, aprFilter, appraisalsData, today]);

  // Auto-calculate next_due (+1 year) when date changes (new records only)
  const aprNextDue = useMemo(() => {
    if (!modalData.date || modalData.existing) return modalData.next_due;
    const d = new Date(modalData.date + 'T00:00:00Z');
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    return formatDate(d);
  }, [modalData.date, modalData.existing, modalData.next_due]);

  function openModal(staffId, appraisal) {
    if (readOnly && !appraisal) return;
    if (appraisal) {
      setModalData({ staffId, id: appraisal.id, date: appraisal.date, appraiser: appraisal.appraiser || '', objectives: appraisal.objectives || '', training_needs: appraisal.training_needs || '', development_plan: appraisal.development_plan || '', next_due: appraisal.next_due || '', notes: appraisal.notes || '', updated_at: appraisal.updated_at || '', existing: true });
    } else {
      const nextDue = new Date(today);
      nextDue.setUTCFullYear(nextDue.getUTCFullYear() + 1);
      setModalData({ staffId, id: 'apr-' + Date.now(), date: todayStr, appraiser: '', objectives: '', training_needs: '', development_plan: '', next_due: formatDate(nextDue), notes: '', updated_at: '', existing: false });
    }
    setError(null);
    setShowModal(true);
  }

  async function handleSave() {
    if (readOnly || !modalData.staffId || !modalData.date) return;
    setSaving(true);
    setError(null);
    const effectiveNextDue = modalData.existing ? modalData.next_due : aprNextDue;
    const record = {
      id: modalData.id,
      staffId: modalData.staffId,
      date: modalData.date,
      appraiser: modalData.appraiser,
      objectives: modalData.objectives,
      training_needs: modalData.training_needs,
      development_plan: modalData.development_plan,
      next_due: effectiveNextDue,
      notes: modalData.notes,
      ...(modalData.updated_at ? { _clientUpdatedAt: modalData.updated_at } : {}),
    };
    try {
      if (modalData.existing) {
        await updateAppraisal(homeSlug, modalData.id, record);
      } else {
        await createAppraisal(homeSlug, record);
      }
      onReload();
      setShowModal(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (readOnly) return;
    if (!confirm('Delete this appraisal record?')) return;
    setSaving(true);
    setError(null);
    try {
      await deleteAppraisal(homeSlug, modalData.id);
      onReload();
      setShowModal(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function handleExport() {
    const headers = ['Name', 'Team', 'Role', 'Status', 'Last Appraisal', 'Next Due', 'Appraiser'];
    const rows = filteredStaff.map(s => {
      const result = getAppraisalStatus(s, appraisalsData, today);
      return [s.name, s.team, s.role, result.status, result.lastAppraisal?.date || '-', result.nextDue || '-', result.lastAppraisal?.appraiser || '-'];
    });
    downloadXLSX('appraisals', [{ name: 'Appraisals', headers, rows }]);
  }

  return (
    <>
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className={`rounded-xl p-3 ${aprStats.completionPct >= 90 ? 'bg-emerald-50 border-emerald-200' : aprStats.completionPct >= 70 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'} border`}>
          <div className="text-xs font-medium text-gray-600">Up to Date</div>
          <div className={`text-2xl font-bold mt-0.5 ${aprStats.completionPct >= 90 ? 'text-emerald-700' : aprStats.completionPct >= 70 ? 'text-amber-700' : 'text-red-700'}`}>{aprStats.completionPct}%</div>
          <div className="text-[10px] text-gray-400">{aprStats.upToDate + aprStats.dueSoon}/{aprStats.total} staff</div>
        </div>
        <div className="rounded-xl p-3 bg-red-50 border border-red-200">
          <div className="text-xs font-medium text-red-600">Overdue</div>
          <div className="text-2xl font-bold text-red-700 mt-0.5">{aprStats.overdue}</div>
          <div className="text-[10px] text-red-400">past 12 months</div>
        </div>
        <div className="rounded-xl p-3 bg-amber-50 border border-amber-200">
          <div className="text-xs font-medium text-amber-600">Due Soon</div>
          <div className="text-2xl font-bold text-amber-700 mt-0.5">{aprStats.dueSoon}</div>
          <div className="text-[10px] text-amber-400">within 30 days</div>
        </div>
        <div className="rounded-xl p-3 bg-gray-50 border border-gray-200">
          <div className="text-xs font-medium text-gray-500">No Records</div>
          <div className="text-2xl font-bold text-gray-700 mt-0.5">{aprStats.notStarted}</div>
          <div className="text-[10px] text-gray-400">never appraised</div>
        </div>
      </div>

      {/* Filters & export */}
      <div className="flex gap-3 mb-4 flex-wrap items-center">
        <input type="text" placeholder="Search staff..." value={search} onChange={e => setSearch(e.target.value)} className={`${INPUT.sm} w-44`} />
        <select value={filterTeam} onChange={e => setFilterTeam(e.target.value)} className={`${INPUT.select} w-auto`}>
          <option value="All">All Teams</option>
          {TEAMS.map(t => <option key={t}>{t}</option>)}
        </select>
        <select value={aprFilter} onChange={e => setAprFilter(e.target.value)} className={`${INPUT.select} w-auto`}>
          <option value="all">All Status</option>
          <option value="overdue">Overdue</option>
          <option value="due_soon">Due Soon</option>
          <option value="up_to_date">Up to Date</option>
        </select>
        <span className="text-xs text-gray-400 self-center">{filteredStaff.length} staff</span>
        <button onClick={handleExport} className={`${BTN.secondary} ${BTN.sm} ml-auto`}>Export Excel</button>
      </div>

      {/* Staff List */}
      <div className="space-y-2">
        {filteredStaff.map(s => {
          const result = getAppraisalStatus(s, appraisalsData, today);
          const sb = APR_STATUS_BADGE[result.status] || APR_STATUS_BADGE.not_started;
          const isExpanded = expanded === s.id;
          const staffAprs = [...(appraisalsData[s.id] || [])].sort((a, b) => b.date.localeCompare(a.date));
          return (
            <div key={s.id} className={CARD.padded}>
              <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setExpanded(isExpanded ? null : s.id)} aria-expanded={isExpanded}>
                <div>
                  <span className="font-medium text-gray-900">{s.name}</span>
                  <span className="ml-2 text-xs text-gray-500">{s.team} · {s.role}</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <span className={sb.badge}>{sb.label}</span>
                    <div className="mt-0.5 text-xs text-gray-500">
                      {result.nextDue ? `Due: ${result.nextDue}` : 'No appraisals'} · Annual
                    </div>
                  </div>
                  <span className="text-xs text-gray-500" aria-hidden="true">{isExpanded ? '\u25B2' : '\u25BC'}</span>
                </div>
              </button>
              {isExpanded && (
                <div className="mt-3 border-t border-gray-100 pt-3">
                  <div className="flex justify-end mb-2">
                    {!readOnly && <button onClick={() => openModal(s.id, null)} className={`${BTN.primary} ${BTN.sm}`}>Record Appraisal</button>}
                  </div>
                  {staffAprs.length === 0 ? (
                    <div className="text-sm text-gray-400 text-center py-4">No appraisal records</div>
                  ) : (
                    <table className={TABLE.table}>
                      <thead className={TABLE.thead}>
                        <tr>
                          <th scope="col" className={TABLE.th}>Date</th>
                          <th scope="col" className={TABLE.th}>Appraiser</th>
                          <th scope="col" className={TABLE.th}>Objectives</th>
                          <th scope="col" className={TABLE.th}>Training Needs</th>
                          <th scope="col" className={TABLE.th}>Next Due</th>
                        </tr>
                      </thead>
                      <tbody>
                        {staffAprs.map(apr => (
                          <tr
                            key={apr.id}
                            className={`${TABLE.tr} cursor-pointer`}
                            {...clickableRowProps(() => openModal(s.id, apr), { label: `Open appraisal from ${apr.date} for ${s.name}` })}
                          >
                            <td className={TABLE.td}>{apr.date}</td>
                            <td className={TABLE.td}>{apr.appraiser || '-'}</td>
                            <td className={`${TABLE.td} max-w-[200px] truncate`}>{apr.objectives || '-'}</td>
                            <td className={`${TABLE.td} max-w-[200px] truncate`}>{apr.training_needs || '-'}</td>
                            <td className={TABLE.td}>{apr.next_due || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {filteredStaff.length === 0 && <div className="p-8 text-center text-sm text-gray-400">No staff match the current filters</div>}
      </div>

      {/* Appraisal Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={readOnly ? 'View Appraisal' : modalData.existing ? 'Edit Appraisal' : 'Record Appraisal'} size="lg">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={INPUT.label}>Date</label>
              <input type="date" value={modalData.date} onChange={e => setModalData({ ...modalData, date: e.target.value })} className={INPUT.base} disabled={readOnly} />
            </div>
            <div>
              <label className={INPUT.label}>Appraiser</label>
              <input type="text" value={modalData.appraiser} onChange={e => setModalData({ ...modalData, appraiser: e.target.value })}
                disabled={readOnly}
                className={INPUT.base} placeholder="Appraiser name" />
            </div>
          </div>
          <div>
            <label className={INPUT.label}>Objectives</label>
            <textarea value={modalData.objectives} onChange={e => setModalData({ ...modalData, objectives: e.target.value })}
              disabled={readOnly}
              className={`${INPUT.base} h-20 resize-none`} placeholder="Performance objectives set..." />
          </div>
          <div>
            <label className={INPUT.label}>Training Needs Identified</label>
            <textarea value={modalData.training_needs} onChange={e => setModalData({ ...modalData, training_needs: e.target.value })}
              disabled={readOnly}
              className={`${INPUT.base} h-16 resize-none`} placeholder="Training and development needs..." />
          </div>
          <div>
            <label className={INPUT.label}>Development Plan</label>
            <textarea value={modalData.development_plan} onChange={e => setModalData({ ...modalData, development_plan: e.target.value })}
              disabled={readOnly}
              className={`${INPUT.base} h-16 resize-none`} placeholder="Personal development plan..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={INPUT.label}>Next Due (auto +12 months)</label>
              <input type="date" value={modalData.existing ? modalData.next_due : aprNextDue}
                onChange={e => setModalData({ ...modalData, next_due: e.target.value })} className={INPUT.base} disabled={readOnly} />
            </div>
            <div>
              <label className={INPUT.label}>Notes</label>
              <input type="text" value={modalData.notes} onChange={e => setModalData({ ...modalData, notes: e.target.value })}
                disabled={readOnly}
                className={INPUT.base} placeholder="Optional notes" />
            </div>
          </div>
          <div className="border-t pt-3">
            <FileAttachments
              caseType="appraisal"
              caseId={modalData.existing ? modalData.id : null}
              readOnly={readOnly}
              title="Appraisal Evidence"
              emptyText="No appraisal evidence uploaded yet."
              saveFirstMessage="Save this appraisal first, then reopen it here to upload supporting evidence."
              getFiles={getRecordAttachments}
              uploadFile={uploadRecordAttachment}
              deleteFile={deleteRecordAttachment}
              downloadFile={downloadRecordAttachment}
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className={MODAL.footer}>
          {modalData.existing && !readOnly && (
            <button onClick={handleDelete} disabled={saving} className={`${BTN.danger} ${BTN.sm} mr-auto`}>Delete</button>
          )}
          <button onClick={() => setShowModal(false)} className={BTN.ghost}>Cancel</button>
          {!readOnly && (
            <button onClick={handleSave}
              disabled={!modalData.staffId || !modalData.date || saving}
              className={`${BTN.primary} disabled:opacity-50`}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
        </div>
      </Modal>
    </>
  );
}
