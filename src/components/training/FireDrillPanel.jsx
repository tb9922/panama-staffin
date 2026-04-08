import { useState, useMemo } from 'react';
import { formatDate, parseDate } from '../../lib/rotation.js';
import { getFireDrillStatus } from '../../lib/training.js';
import FileAttachments from '../FileAttachments.jsx';
import {
  createFireDrill,
  updateFireDrill,
  deleteFireDrill,
  getRecordAttachments,
  uploadRecordAttachment,
  deleteRecordAttachment,
  downloadRecordAttachment,
} from '../../lib/api.js';
import { downloadXLSX } from '../../lib/excel.js';
import { CARD, TABLE, INPUT, BTN, BADGE, MODAL } from '../../lib/design.js';
import Modal from '../Modal.jsx';
import useDirtyGuard from '../../hooks/useDirtyGuard.js';

export default function FireDrillPanel({ fireDrills, staff, homeSlug, onReload, readOnly = false }) {
  const [showModal, setShowModal] = useState(false);
  const [modalData, setModalData] = useState({ id: '', date: '', time: '', scenario: '', evacuation_time_seconds: '', staff_present: [], residents_evacuated: '', issues: '', corrective_actions: '', conducted_by: '', notes: '', updated_at: '', existing: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useDirtyGuard(showModal);

  const todayStr = formatDate(new Date());
  const today = useMemo(() => parseDate(todayStr), [todayStr]);
  const activeStaff = useMemo(() => (staff || []).filter(s => s.active !== false), [staff]);
  const drillsList = useMemo(() => fireDrills || [], [fireDrills]);

  const drillStatus = useMemo(() => getFireDrillStatus(drillsList, today), [drillsList, today]);

  function openModal(drill) {
    if (readOnly && !drill) return;
    if (drill) {
      setModalData({ id: drill.id, date: drill.date, time: drill.time || '', scenario: drill.scenario || '', evacuation_time_seconds: drill.evacuation_time_seconds ?? '', staff_present: drill.staff_present || [], residents_evacuated: drill.residents_evacuated ?? '', issues: drill.issues || '', corrective_actions: drill.corrective_actions || '', conducted_by: drill.conducted_by || '', notes: drill.notes || '', updated_at: drill.updated_at || '', existing: true });
    } else {
      setModalData({ id: 'fd-' + Date.now(), date: todayStr, time: '', scenario: '', evacuation_time_seconds: '', staff_present: [], residents_evacuated: '', issues: '', corrective_actions: '', conducted_by: '', notes: '', updated_at: '', existing: false });
    }
    setError(null);
    setShowModal(true);
  }

  function toggleDrillStaff(staffId) {
    if (readOnly) return;
    const present = [...modalData.staff_present];
    const idx = present.indexOf(staffId);
    if (idx >= 0) present.splice(idx, 1);
    else present.push(staffId);
    setModalData({ ...modalData, staff_present: present });
  }

  async function handleSave() {
    if (readOnly || !modalData.date) return;
    setSaving(true);
    setError(null);
    const record = {
      id: modalData.id,
      date: modalData.date,
      time: modalData.time,
      scenario: modalData.scenario,
      evacuation_time_seconds: parseInt(modalData.evacuation_time_seconds) || 0,
      staff_present: modalData.staff_present,
      residents_evacuated: parseInt(modalData.residents_evacuated) || 0,
      issues: modalData.issues,
      corrective_actions: modalData.corrective_actions,
      conducted_by: modalData.conducted_by,
      notes: modalData.notes,
      ...(modalData.updated_at ? { _clientUpdatedAt: modalData.updated_at } : {}),
    };
    try {
      if (modalData.existing) {
        await updateFireDrill(homeSlug, modalData.id, record);
      } else {
        await createFireDrill(homeSlug, record);
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
    if (!confirm('Delete this fire drill record?')) return;
    setSaving(true);
    setError(null);
    try {
      await deleteFireDrill(homeSlug, modalData.id);
      onReload();
      setShowModal(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function handleExport() {
    const headers = ['Date', 'Time', 'Scenario', 'Evacuation Time (s)', 'Staff Count', 'Residents', 'Issues', 'Conducted By'];
    const sorted = [...drillsList].sort((a, b) => b.date.localeCompare(a.date));
    const rows = sorted.map(d => [d.date, d.time || '-', d.scenario || '-', d.evacuation_time_seconds || '-', d.staff_present?.length || 0, d.residents_evacuated || '-', d.issues || '-', d.conducted_by || '-']);
    downloadXLSX('fire_drills', [{ name: 'Fire Drills', headers, rows }]);
  }

  return (
    <>
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className={`rounded-xl p-3 border ${drillStatus.drillsThisYear >= 4 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
          <div className="text-xs font-medium text-gray-600">Drills This Year</div>
          <div className={`text-2xl font-bold mt-0.5 ${drillStatus.drillsThisYear >= 4 ? 'text-emerald-700' : 'text-red-700'}`}>{drillStatus.drillsThisYear}/4</div>
          <div className="text-[10px] text-gray-400">minimum 4 per year</div>
        </div>
        <div className="rounded-xl p-3 bg-blue-50 border border-blue-200">
          <div className="text-xs font-medium text-blue-600">Last Drill</div>
          <div className="text-lg font-bold text-blue-700 mt-0.5">{drillStatus.lastDrill?.date || 'Never'}</div>
          <div className="text-[10px] text-blue-400">{drillStatus.lastDrill?.scenario ? drillStatus.lastDrill.scenario.substring(0, 30) : '-'}</div>
        </div>
        <div className={`rounded-xl p-3 border ${drillStatus.status === 'overdue' ? 'bg-red-50 border-red-200' : drillStatus.status === 'due_soon' ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
          <div className="text-xs font-medium text-gray-600">Next Due</div>
          <div className={`text-lg font-bold mt-0.5 ${drillStatus.status === 'overdue' ? 'text-red-700' : drillStatus.status === 'due_soon' ? 'text-amber-700' : 'text-emerald-700'}`}>
            {drillStatus.nextDue || 'N/A'}
          </div>
          <div className="text-[10px] text-gray-400">
            {drillStatus.status === 'overdue' ? 'OVERDUE' : drillStatus.status === 'due_soon' ? `${drillStatus.daysUntilDue}d remaining` : drillStatus.daysUntilDue != null ? `${drillStatus.daysUntilDue}d remaining` : '-'}
          </div>
        </div>
        <div className="rounded-xl p-3 bg-gray-50 border border-gray-200">
          <div className="text-xs font-medium text-gray-500">Avg Evacuation</div>
          <div className="text-2xl font-bold text-gray-700 mt-0.5">{drillStatus.avgEvacTime != null ? `${Math.floor(drillStatus.avgEvacTime / 60)}m ${drillStatus.avgEvacTime % 60}s` : '-'}</div>
          <div className="text-[10px] text-gray-400">last 12 months</div>
        </div>
      </div>

      {/* Action Bar */}
      <div className="flex justify-between items-center mb-4">
        <span className="text-xs text-gray-400">{drillsList.length} drill{drillsList.length !== 1 ? 's' : ''} recorded</span>
        <div className="flex gap-2">
          <button onClick={handleExport} className={`${BTN.secondary} ${BTN.sm}`}>Export Excel</button>
          {!readOnly && <button onClick={() => openModal(null)} className={BTN.primary}>Record Fire Drill</button>}
        </div>
      </div>

      {/* Drills Table */}
      {drillsList.length === 0 ? (
        <div className={`${CARD.padded} text-center text-sm text-gray-400 py-8`}>
          {readOnly ? 'No fire drills recorded.' : 'No fire drills recorded. Click "Record Fire Drill" to add the first one.'}
        </div>
      ) : (
        <div className={CARD.flush}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th scope="col" className={TABLE.th}>Date</th>
                <th scope="col" className={TABLE.th}>Time</th>
                <th scope="col" className={TABLE.th}>Scenario</th>
                <th scope="col" className={TABLE.th}>Evacuation Time</th>
                <th scope="col" className={TABLE.th}>Staff</th>
                <th scope="col" className={TABLE.th}>Issues</th>
                <th scope="col" className={TABLE.th}>Conducted By</th>
              </tr>
            </thead>
            <tbody>
              {[...drillsList].sort((a, b) => b.date.localeCompare(a.date)).map(drill => (
                <tr key={drill.id} className={`${TABLE.tr} cursor-pointer`} onClick={() => openModal(drill)}>
                  <td className={TABLE.td}>{drill.date}</td>
                  <td className={TABLE.td}>{drill.time || '-'}</td>
                  <td className={`${TABLE.td} max-w-[250px] truncate`}>{drill.scenario || '-'}</td>
                  <td className={TABLE.tdMono}>
                    {drill.evacuation_time_seconds > 0
                      ? `${Math.floor(drill.evacuation_time_seconds / 60)}m ${drill.evacuation_time_seconds % 60}s`
                      : '-'}
                  </td>
                  <td className={TABLE.td}>{drill.staff_present?.length || 0}</td>
                  <td className={`${TABLE.td} max-w-[200px] truncate`}>
                    {drill.issues ? <span className="text-amber-600">{drill.issues}</span> : <span className="text-gray-400">None</span>}
                  </td>
                  <td className={TABLE.td}>{drill.conducted_by || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Fire Drill Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={readOnly ? 'View Fire Drill' : modalData.existing ? 'Edit Fire Drill' : 'Record Fire Drill'} size="lg">
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={INPUT.label}>Date</label>
              <input type="date" value={modalData.date} onChange={e => setModalData({ ...modalData, date: e.target.value })} className={INPUT.base} disabled={readOnly} />
            </div>
            <div>
              <label className={INPUT.label}>Time</label>
              <input type="time" value={modalData.time} onChange={e => setModalData({ ...modalData, time: e.target.value })} className={INPUT.base} disabled={readOnly} />
            </div>
            <div>
              <label className={INPUT.label}>Evacuation Time (seconds)</label>
              <input type="number" min="0" value={modalData.evacuation_time_seconds}
                onChange={e => setModalData({ ...modalData, evacuation_time_seconds: e.target.value })}
                disabled={readOnly}
                className={INPUT.base} placeholder="e.g. 240" />
            </div>
          </div>
          <div>
            <label className={INPUT.label}>Scenario</label>
            <textarea value={modalData.scenario} onChange={e => setModalData({ ...modalData, scenario: e.target.value })}
              disabled={readOnly}
              className={`${INPUT.base} h-16 resize-none`} placeholder="e.g. Kitchen fire — full evacuation" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={INPUT.label}>Residents Evacuated</label>
              <input type="number" min="0" value={modalData.residents_evacuated}
                onChange={e => setModalData({ ...modalData, residents_evacuated: e.target.value })}
                disabled={readOnly}
                className={INPUT.base} placeholder="Number" />
            </div>
            <div>
              <label className={INPUT.label}>Conducted By</label>
              <input type="text" value={modalData.conducted_by} onChange={e => setModalData({ ...modalData, conducted_by: e.target.value })}
                disabled={readOnly}
                className={INPUT.base} placeholder="Fire Marshal name" />
            </div>
          </div>
          <div>
            <label className={INPUT.label}>Staff Present ({modalData.staff_present.length} selected)</label>
            <div className="max-h-32 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1">
              {activeStaff.map(s => (
                <label key={s.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-50 px-1.5 py-0.5 rounded">
                  <input type="checkbox" checked={modalData.staff_present.includes(s.id)} onChange={() => toggleDrillStaff(s.id)} disabled={readOnly} />
                  <span>{s.name}</span>
                  <span className="text-gray-400">({s.team})</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className={INPUT.label}>Issues Identified</label>
            <textarea value={modalData.issues} onChange={e => setModalData({ ...modalData, issues: e.target.value })}
              disabled={readOnly}
              className={`${INPUT.base} h-16 resize-none`} placeholder="Any issues observed during the drill..." />
          </div>
          <div>
            <label className={INPUT.label}>Corrective Actions</label>
            <textarea value={modalData.corrective_actions} onChange={e => setModalData({ ...modalData, corrective_actions: e.target.value })}
              disabled={readOnly}
              className={`${INPUT.base} h-16 resize-none`} placeholder="Actions taken to address issues..." />
          </div>
          <div>
            <label className={INPUT.label}>Notes</label>
            <input type="text" value={modalData.notes} onChange={e => setModalData({ ...modalData, notes: e.target.value })}
              disabled={readOnly}
              className={INPUT.base} placeholder="Optional notes" />
          </div>
          <div className="border-t pt-3">
            <FileAttachments
              caseType="fire_drill"
              caseId={modalData.existing ? modalData.id : null}
              readOnly={readOnly}
              title="Fire Drill Evidence"
              emptyText="No fire drill evidence uploaded yet."
              saveFirstMessage="Save this fire drill first, then reopen it here to upload supporting evidence."
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
            <button onClick={handleSave} disabled={!modalData.date || saving}
              className={`${BTN.primary} disabled:opacity-50`}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
        </div>
      </Modal>
    </>
  );
}
