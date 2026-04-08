import { useState, useEffect, useMemo, useCallback } from 'react';
import { useConfirm } from '../hooks/useConfirm.jsx';
import { BTN, CARD, TABLE, INPUT, BADGE, PAGE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import FileAttachments from '../components/FileAttachments.jsx';
import { useData } from '../contexts/DataContext.jsx';
import {
  getCurrentHome,
  getDpiaAssessments,
  createDpiaAssessment,
  updateDpiaAssessment,
  deleteDpiaAssessment,
  getRecordAttachments,
  uploadRecordAttachment,
  deleteRecordAttachment,
  downloadRecordAttachment,
} from '../lib/api.js';
import { LEGAL_BASES } from '../lib/gdpr.js';

const EMPTY_FORM = {
  title: '', processing_description: '', purpose: '', scope: '',
  screening_result: 'required', screening_rationale: '', high_risk_triggers: '',
  legal_basis: '', status: 'screening', notes: '',
};

const STATUS_BADGES = { screening: 'gray', in_progress: 'amber', completed: 'blue', approved: 'green', review_due: 'red' };
const RISK_BADGES = { low: 'green', medium: 'amber', high: 'red', very_high: 'purple' };
const STATUS_LABELS = { screening: 'Screening', in_progress: 'In Progress', completed: 'Completed', approved: 'Approved', review_due: 'Review Due' };
const SCREENING_LABELS = { required: 'DPIA Required', recommended: 'Recommended', not_required: 'Not Required' };

export default function DpiaManager() {
  const home = getCurrentHome();
  const { canWrite } = useData();
  const canEdit = canWrite('gdpr');
  const { confirm, ConfirmDialog } = useConfirm();

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  useDirtyGuard(showModal);

  const load = useCallback(async () => {
    if (!home) return;
    setLoading(true); setError(null);
    try {
      const data = await getDpiaAssessments(home, { limit: 200 });
      setItems(data.rows || []); setTotal(data.total || 0);
    } catch (e) { setError(e.message || 'Failed to load'); }
    finally { setLoading(false); }
  }, [home]);

  useEffect(() => { load(); }, [load]);

  function openNew() { setEditing(null); setForm({ ...EMPTY_FORM }); setFormError(''); setShowModal(true); }
  function openEdit(item) {
    setEditing(item);
    setForm(Object.fromEntries(Object.keys(EMPTY_FORM).map(k => [k, item[k] ?? EMPTY_FORM[k]])));
    setFormError(''); setShowModal(true);
  }
  function closeModal() { setShowModal(false); setEditing(null); setFormError(''); }

  async function handleSave() {
    if (!form.title.trim() || !form.processing_description.trim()) {
      setFormError('Title and processing description are required'); return;
    }
    setSaving(true); setFormError('');
    try {
      if (editing) await updateDpiaAssessment(home, editing.id, { ...form, _version: editing.version });
      else await createDpiaAssessment(home, form);
      closeModal(); load();
    } catch (e) { setFormError(e.message || 'Save failed'); }
    finally { setSaving(false); }
  }

  async function handleStatusChange(id, status, version) {
    try { await updateDpiaAssessment(home, id, { status, _version: version }); load(); }
    catch (e) { setError(e.message); }
  }

  async function handleDelete(id) {
    if (!await confirm('Archive this DPIA?')) return;
    try {
      await deleteDpiaAssessment(home, id);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  const stats = useMemo(() => ({
    total, screening: items.filter(i => i.status === 'screening').length,
    inProgress: items.filter(i => i.status === 'in_progress').length,
    highRisk: items.filter(i => i.risk_level === 'high' || i.risk_level === 'very_high').length,
  }), [items, total]);

  if (!home) return <div className={PAGE.container}><p>Select a home</p></div>;

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Data Protection Impact Assessments</h1>
          <p className="text-sm text-gray-500">Article 35 UK GDPR — DPIA screening, assessment, and review</p>
        </div>
        {canEdit && <button className={BTN.primary} onClick={openNew}>+ New DPIA</button>}
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">{error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className={CARD.padded}><p className="text-xs text-gray-500">Total DPIAs</p><p className="text-2xl font-bold">{stats.total}</p></div>
        <div className={CARD.padded}><p className="text-xs text-gray-500">Screening</p><p className="text-2xl font-bold text-gray-600">{stats.screening}</p></div>
        <div className={CARD.padded}><p className="text-xs text-gray-500">In Progress</p><p className="text-2xl font-bold text-amber-600">{stats.inProgress}</p></div>
        <div className={CARD.padded}><p className="text-xs text-gray-500">High/Very High Risk</p><p className="text-2xl font-bold text-red-600">{stats.highRisk}</p></div>
      </div>

      <div className={CARD.flush}>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th className={TABLE.th}>Title</th>
                <th className={TABLE.th}>Screening</th>
                <th className={TABLE.th}>Risk Level</th>
                <th className={TABLE.th}>Status</th>
                {canEdit && <th className={TABLE.th}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={canEdit ? 5 : 4} className={TABLE.empty} role="status">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={canEdit ? 5 : 4} className={TABLE.empty}>No DPIAs recorded</td></tr>
              ) : items.map(item => (
                <tr key={item.id} className={TABLE.tr}>
                  <td className={TABLE.td}>
                    <div className="font-medium">{item.title}</div>
                    <div className="text-xs text-gray-400 mt-0.5 line-clamp-1">{item.processing_description}</div>
                  </td>
                  <td className={TABLE.td}><span className={BADGE[item.screening_result === 'required' ? 'red' : item.screening_result === 'recommended' ? 'amber' : 'green']}>{SCREENING_LABELS[item.screening_result] || item.screening_result?.replace(/_/g, ' ')}</span></td>
                  <td className={TABLE.td}>{item.risk_level && <span className={BADGE[RISK_BADGES[item.risk_level] || 'gray']}>{item.risk_level?.replace(/_/g, ' ')}</span>}</td>
                  <td className={TABLE.td}><span className={BADGE[STATUS_BADGES[item.status] || 'gray']}>{STATUS_LABELS[item.status] || item.status}</span></td>
                  {canEdit && (
                    <td className={TABLE.td}>
                      <div className="flex gap-1 flex-wrap">
                        <button className={`${BTN.ghost} ${BTN.xs}`} onClick={() => openEdit(item)}>Edit</button>
                        {item.status === 'screening' && <button className={`${BTN.ghost} ${BTN.xs}`} onClick={() => handleStatusChange(item.id, 'in_progress', item.version)}>Start</button>}
                        {item.status === 'in_progress' && <button className={`${BTN.ghost} ${BTN.xs}`} onClick={() => handleStatusChange(item.id, 'completed', item.version)}>Complete</button>}
                        {item.status === 'completed' && <button className={`${BTN.success} ${BTN.xs}`} onClick={() => handleStatusChange(item.id, 'approved', item.version)}>Approve</button>}
                        <button className={`${BTN.ghost} ${BTN.xs}`} onClick={() => handleDelete(item.id)}>Archive</button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={showModal} onClose={closeModal} title={editing ? 'Edit DPIA' : 'New DPIA'} size="xl">
        <div className="space-y-4">
          {formError && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{formError}</div>}
          <div>
            <label className={INPUT.label} htmlFor="dpia-title">Title *</label>
            <input id="dpia-title" className={INPUT.base} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. New biometric clock-in system" />
          </div>
          <div>
            <label className={INPUT.label} htmlFor="dpia-processing-description">Processing Description *</label>
            <textarea id="dpia-processing-description" className={INPUT.base} rows={3} value={form.processing_description} onChange={e => setForm({ ...form, processing_description: e.target.value })} placeholder="Describe the processing activity that requires assessment..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={INPUT.label}>Screening Result</label>
              <select className={INPUT.select} value={form.screening_result} onChange={e => setForm({ ...form, screening_result: e.target.value })}>
                <option value="required">DPIA Required</option>
                <option value="recommended">Recommended</option>
                <option value="not_required">Not Required</option>
              </select>
            </div>
            <div>
              <label className={INPUT.label}>Legal Basis</label>
              <select className={INPUT.select} value={form.legal_basis} onChange={e => setForm({ ...form, legal_basis: e.target.value })}>
                <option value="">— Select —</option>
                {LEGAL_BASES.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={INPUT.label}>High Risk Triggers</label>
            <textarea className={INPUT.base} rows={2} value={form.high_risk_triggers} onChange={e => setForm({ ...form, high_risk_triggers: e.target.value })} placeholder="e.g. Processing of special category data, vulnerable individuals..." />
          </div>
          <div>
            <label className={INPUT.label}>Notes</label>
            <textarea className={INPUT.base} rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
          <FileAttachments
            caseType="dpia"
            caseId={editing?.id}
            readOnly={!canEdit}
            title="DPIA Evidence"
            emptyText="No DPIA evidence uploaded yet."
            saveFirstText="Save this DPIA first, then attach screening notes, approvals, and supporting documents."
            getFiles={getRecordAttachments}
            uploadFile={uploadRecordAttachment}
            deleteFile={deleteRecordAttachment}
            downloadFile={downloadRecordAttachment}
          />
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button className={BTN.secondary} onClick={closeModal}>Cancel</button>
          <button className={BTN.primary} onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : editing ? 'Update' : 'Create'}</button>
        </div>
      </Modal>
      {ConfirmDialog}
    </div>
  );
}
