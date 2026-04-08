import { useState, useMemo } from 'react';
import { formatDate, parseDate } from '../../lib/rotation.js';
import {
  getSupervisionStatus, getSupervisionStats, getSupervisionFrequency, isInProbation,
} from '../../lib/training.js';
import FileAttachments from '../FileAttachments.jsx';
import {
  createSupervision,
  updateSupervision,
  deleteSupervision,
  getRecordAttachments,
  uploadRecordAttachment,
  deleteRecordAttachment,
  downloadRecordAttachment,
} from '../../lib/api.js';
import { downloadXLSX } from '../../lib/excel.js';
import { CARD, TABLE, INPUT, BTN, BADGE, MODAL } from '../../lib/design.js';
import Modal from '../Modal.jsx';
import useDirtyGuard from '../../hooks/useDirtyGuard.js';

const TEAMS = ['Day A', 'Day B', 'Night A', 'Night B', 'Float'];

const SUP_STATUS_BADGE = {
  up_to_date: { badge: BADGE.green, label: 'Up to Date' },
  due_soon:   { badge: BADGE.amber, label: 'Due Soon' },
  due:        { badge: BADGE.orange, label: 'Overdue' },
  overdue:    { badge: BADGE.red, label: 'Overdue' },
  not_started:{ badge: BADGE.gray, label: 'No Records' },
};

export default function SupervisionPanel({ supervisions, staff, homeSlug, config, onReload, readOnly = false }) {
  const [filterTeam, setFilterTeam] = useState('All');
  const [search, setSearch] = useState('');
  const [supFilter, setSupFilter] = useState('all');
  const [expanded, setExpanded] = useState(null);

  const [showModal, setShowModal] = useState(false);
  const [modalData, setModalData] = useState({ staffId: '', id: '', date: '', supervisor: '', topics: '', actions: '', next_due: '', notes: '', updated_at: '', existing: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useDirtyGuard(showModal);

  const todayStr = formatDate(new Date());
  const today = useMemo(() => parseDate(todayStr), [todayStr]);
  const activeStaff = useMemo(() => (staff || []).filter(s => s.active !== false), [staff]);
  const supervisionsData = useMemo(() => supervisions || {}, [supervisions]);

  const supStats = useMemo(() => getSupervisionStats(activeStaff, config, supervisionsData, today), [activeStaff, config, supervisionsData, today]);

  const filteredStaff = useMemo(() => {
    let list = activeStaff;
    if (filterTeam !== 'All') list = list.filter(s => s.team === filterTeam);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(s => s.name.toLowerCase().includes(q));
    }
    if (supFilter !== 'all') {
      list = list.filter(s => {
        const result = getSupervisionStatus(s, config, supervisionsData, today);
        if (supFilter === 'overdue') return result.status === 'overdue' || result.status === 'due';
        if (supFilter === 'due_soon') return result.status === 'due_soon';
        if (supFilter === 'up_to_date') return result.status === 'up_to_date';
        return true;
      });
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [activeStaff, filterTeam, search, supFilter, config, supervisionsData, today]);

  // Auto-calculate next_due when date changes (new records only)
  const supNextDue = useMemo(() => {
    if (!modalData.date || !modalData.staffId || modalData.existing) return modalData.next_due;
    const s = activeStaff.find(x => x.id === modalData.staffId);
    if (!s) return modalData.next_due;
    const freq = getSupervisionFrequency(s, config, today);
    const d = new Date(modalData.date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + freq);
    return formatDate(d);
  }, [modalData.date, modalData.staffId, modalData.existing, modalData.next_due, activeStaff, config, today]);

  function openModal(staffId, session) {
    if (readOnly && !session) return;
    if (session) {
      setModalData({ staffId, id: session.id, date: session.date, supervisor: session.supervisor || '', topics: session.topics || '', actions: session.actions || '', next_due: session.next_due || '', notes: session.notes || '', updated_at: session.updated_at || '', existing: true });
    } else {
      const s = activeStaff.find(x => x.id === staffId);
      const freq = s ? getSupervisionFrequency(s, config, today) : 49;
      const nextDue = new Date(today);
      nextDue.setUTCDate(nextDue.getUTCDate() + freq);
      setModalData({ staffId, id: 'sup-' + Date.now(), date: todayStr, supervisor: '', topics: '', actions: '', next_due: formatDate(nextDue), notes: '', updated_at: '', existing: false });
    }
    setError(null);
    setShowModal(true);
  }

  async function handleSave() {
    if (readOnly || !modalData.staffId || !modalData.date) return;
    setSaving(true);
    setError(null);
    const effectiveNextDue = modalData.existing ? modalData.next_due : supNextDue;
    const record = {
      id: modalData.id,
      staffId: modalData.staffId,
      date: modalData.date,
      supervisor: modalData.supervisor,
      topics: modalData.topics,
      actions: modalData.actions,
      next_due: effectiveNextDue,
      notes: modalData.notes,
      ...(modalData.updated_at ? { _clientUpdatedAt: modalData.updated_at } : {}),
    };
    try {
      if (modalData.existing) {
        await updateSupervision(homeSlug, modalData.id, record);
      } else {
        await createSupervision(homeSlug, record);
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
    if (!confirm('Delete this supervision record?')) return;
    setSaving(true);
    setError(null);
    try {
      await deleteSupervision(homeSlug, modalData.id);
      onReload();
      setShowModal(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function handleExport() {
    const headers = ['Name', 'Team', 'Role', 'Status', 'Last Session', 'Next Due', 'Supervisor'];
    const rows = filteredStaff.map(s => {
      const result = getSupervisionStatus(s, config, supervisionsData, today);
      return [s.name, s.team, s.role, result.status, result.lastSession?.date || '-', result.nextDue || '-', result.lastSession?.supervisor || '-'];
    });
    downloadXLSX('supervisions', [{ name: 'Supervisions', headers, rows }]);
  }

  return (
    <>
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className={`rounded-xl p-3 ${supStats.completionPct >= 90 ? 'bg-emerald-50 border-emerald-200' : supStats.completionPct >= 70 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'} border`}>
          <div className="text-xs font-medium text-gray-600">Supervision Rate</div>
          <div className={`text-2xl font-bold mt-0.5 ${supStats.completionPct >= 90 ? 'text-emerald-700' : supStats.completionPct >= 70 ? 'text-amber-700' : 'text-red-700'}`}>{supStats.completionPct}%</div>
          <div className="text-[10px] text-gray-400">{supStats.upToDate + supStats.dueSoon}/{supStats.total} staff</div>
        </div>
        <div className="rounded-xl p-3 bg-red-50 border border-red-200">
          <div className="text-xs font-medium text-red-600">Overdue</div>
          <div className="text-2xl font-bold text-red-700 mt-0.5">{supStats.overdue}</div>
          <div className="text-[10px] text-red-400">past due date</div>
        </div>
        <div className="rounded-xl p-3 bg-amber-50 border border-amber-200">
          <div className="text-xs font-medium text-amber-600">Due Soon</div>
          <div className="text-2xl font-bold text-amber-700 mt-0.5">{supStats.dueSoon}</div>
          <div className="text-[10px] text-amber-400">within 14 days</div>
        </div>
        <div className="rounded-xl p-3 bg-gray-50 border border-gray-200">
          <div className="text-xs font-medium text-gray-500">No Records</div>
          <div className="text-2xl font-bold text-gray-700 mt-0.5">{supStats.notStarted}</div>
          <div className="text-[10px] text-gray-400">never supervised</div>
        </div>
      </div>

      {/* Filters & export */}
      <div className="flex gap-3 mb-4 flex-wrap items-center">
        <input type="text" placeholder="Search staff..." value={search} onChange={e => setSearch(e.target.value)} className={`${INPUT.sm} w-44`} />
        <select value={filterTeam} onChange={e => setFilterTeam(e.target.value)} className={`${INPUT.select} w-auto`}>
          <option value="All">All Teams</option>
          {TEAMS.map(t => <option key={t}>{t}</option>)}
        </select>
        <select value={supFilter} onChange={e => setSupFilter(e.target.value)} className={`${INPUT.select} w-auto`}>
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
          const result = getSupervisionStatus(s, config, supervisionsData, today);
          const sb = SUP_STATUS_BADGE[result.status] || SUP_STATUS_BADGE.not_started;
          const isExpanded = expanded === s.id;
          const staffSups = [...(supervisionsData[s.id] || [])].sort((a, b) => b.date.localeCompare(a.date));
          const probation = isInProbation(s, config, today);
          const freq = getSupervisionFrequency(s, config, today);
          return (
            <div key={s.id} className={CARD.padded}>
              <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(isExpanded ? null : s.id)}>
                <div>
                  <span className="font-medium text-gray-900">{s.name}</span>
                  <span className="text-xs text-gray-400 ml-2">{s.team} · {s.role}</span>
                  {probation && <span className={`${BADGE.purple} ml-2`}>Probation</span>}
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <span className={sb.badge}>{sb.label}</span>
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      {result.nextDue ? `Due: ${result.nextDue}` : 'No sessions'} · Every {freq}d
                    </div>
                  </div>
                  <span className="text-gray-400 text-xs">{isExpanded ? '\u25B2' : '\u25BC'}</span>
                </div>
              </div>
              {isExpanded && (
                <div className="mt-3 border-t border-gray-100 pt-3">
                  <div className="flex justify-end mb-2">
                    {!readOnly && <button onClick={() => openModal(s.id, null)} className={`${BTN.primary} ${BTN.sm}`}>Record Supervision</button>}
                  </div>
                  {staffSups.length === 0 ? (
                    <div className="text-sm text-gray-400 text-center py-4">No supervision records</div>
                  ) : (
                    <table className={TABLE.table}>
                      <thead className={TABLE.thead}>
                        <tr>
                          <th scope="col" className={TABLE.th}>Date</th>
                          <th scope="col" className={TABLE.th}>Supervisor</th>
                          <th scope="col" className={TABLE.th}>Topics</th>
                          <th scope="col" className={TABLE.th}>Actions</th>
                          <th scope="col" className={TABLE.th}>Next Due</th>
                        </tr>
                      </thead>
                      <tbody>
                        {staffSups.map(sup => (
                          <tr key={sup.id} className={`${TABLE.tr} cursor-pointer`} onClick={() => openModal(s.id, sup)}>
                            <td className={TABLE.td}>{sup.date}</td>
                            <td className={TABLE.td}>{sup.supervisor || '-'}</td>
                            <td className={`${TABLE.td} max-w-[200px] truncate`}>{sup.topics || '-'}</td>
                            <td className={`${TABLE.td} max-w-[200px] truncate`}>{sup.actions || '-'}</td>
                            <td className={TABLE.td}>{sup.next_due || '-'}</td>
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

      {/* Supervision Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={readOnly ? 'View Supervision' : modalData.existing ? 'Edit Supervision' : 'Record Supervision'} size="lg">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={INPUT.label}>Date</label>
              <input type="date" value={modalData.date} onChange={e => setModalData({ ...modalData, date: e.target.value })} className={INPUT.base} disabled={readOnly} />
            </div>
            <div>
              <label className={INPUT.label}>Supervisor</label>
              <input type="text" value={modalData.supervisor} onChange={e => setModalData({ ...modalData, supervisor: e.target.value })}
                disabled={readOnly}
                className={INPUT.base} placeholder="Supervisor name" />
            </div>
          </div>
          <div>
            <label className={INPUT.label}>Topics Discussed</label>
            <textarea value={modalData.topics} onChange={e => setModalData({ ...modalData, topics: e.target.value })}
              disabled={readOnly}
              className={`${INPUT.base} h-20 resize-none`} placeholder="Key topics covered in the session..." />
          </div>
          <div>
            <label className={INPUT.label}>Actions Agreed</label>
            <textarea value={modalData.actions} onChange={e => setModalData({ ...modalData, actions: e.target.value })}
              disabled={readOnly}
              className={`${INPUT.base} h-20 resize-none`} placeholder="Action items agreed upon..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={INPUT.label}>Next Due (auto)</label>
              <input type="date" value={modalData.existing ? modalData.next_due : supNextDue}
                onChange={e => setModalData({ ...modalData, next_due: e.target.value })} className={INPUT.base} disabled={readOnly} />
              {!modalData.existing && modalData.staffId && (() => {
                const s = activeStaff.find(x => x.id === modalData.staffId);
                if (!s) return null;
                const freq = getSupervisionFrequency(s, config, today);
                const prob = isInProbation(s, config, today);
                return <p className="text-[10px] text-gray-400 mt-0.5">{prob ? 'Probation' : 'Standard'}: every {freq} days</p>;
              })()}
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
              caseType="supervision"
              caseId={modalData.existing ? modalData.id : null}
              readOnly={readOnly}
              title="Supervision Evidence"
              emptyText="No supervision evidence uploaded yet."
              saveFirstMessage="Save this supervision record first, then reopen it here to upload supporting evidence."
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
