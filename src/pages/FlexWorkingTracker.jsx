import { useState, useEffect, useCallback } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import Modal from '../components/Modal.jsx';
import { getCurrentHome, getLoggedInUser, getHrFlexWorking, createHrFlexWorking, updateHrFlexWorking } from '../lib/api.js';
import { FLEX_WORKING_STATUSES, FLEX_REFUSAL_REASONS, getStatusBadge } from '../lib/hr.js';
import { parseDate } from '../lib/rotation.js';
import StaffPicker from '../components/StaffPicker.jsx';
import FileAttachments from '../components/FileAttachments.jsx';
import Pagination from '../components/Pagination.jsx';

const DECISION_OPTIONS = [
  { id: '', name: '— Not decided —' },
  { id: 'approved', name: 'Approved' },
  { id: 'approved_modified', name: 'Approved (Modified)' },
  { id: 'refused', name: 'Refused' },
  { id: 'withdrawn', name: 'Withdrawn' },
];

function statusName(id) {
  return FLEX_WORKING_STATUSES.find(s => s.id === id)?.name || id;
}

function isOverdue(item) {
  if (!item.decision_deadline) return false;
  if (item.status !== 'pending' && item.status !== 'meeting_scheduled') return false;
  return item.decision_deadline < new Date().toISOString().slice(0, 10);
}

const blankForm = () => ({
  staff_id: '', request_date: new Date().toISOString().slice(0, 10),
  requested_change: '', decision_deadline: '', status: 'pending',
  reason: '', current_pattern: '',
  decision: '', decision_date: '', decision_reason: '',
  trial_period_end: '', appeal_date: '', appeal_outcome: '', notes: '',
});

export default function FlexWorkingTracker() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);

  // Filters
  const [filterStaff, setFilterStaff] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const home = getCurrentHome();
  const isAdmin = getLoggedInUser()?.role === 'admin';
  useDirtyGuard(showModal);

  const LIMIT = 50;

  const load = useCallback(async () => {
    if (!home) return;
    setLoading(true);
    try {
      const filters = { limit: LIMIT, offset };
      if (filterStaff) filters.staffId = filterStaff;
      if (filterStatus) filters.status = filterStatus;
      const res = await getHrFlexWorking(home, filters);
      setItems(res?.rows || []);
      setTotal(res?.total || 0);
      setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [home, filterStaff, filterStatus, offset]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => { setOffset(0); }, [filterStaff, filterStatus]);

  function closeModal() {
    setShowModal(false);
    setEditing(null);
    setForm(blankForm());
    setFormError('');
  }

  function openNew() {
    setEditing(null);
    const today = new Date().toISOString().slice(0, 10);
    // ERA 2025: employer must decide within 2 months
    // Clamp day to avoid month overflow (e.g. Dec 31 + 2 months → Feb 28, not Mar 3)
    const deadline = parseDate(today);
    const targetMonth = deadline.getUTCMonth() + 2;
    deadline.setUTCDate(1);
    deadline.setUTCMonth(targetMonth);
    const lastDay = new Date(Date.UTC(deadline.getUTCFullYear(), deadline.getUTCMonth() + 1, 0)).getUTCDate();
    deadline.setUTCDate(Math.min(parseDate(today).getUTCDate(), lastDay));
    setForm({ ...blankForm(), request_date: today, decision_deadline: deadline.toISOString().slice(0, 10) });
    setShowModal(true);
  }

  function openEdit(item) {
    setEditing(item);
    setForm({
      staff_id: item.staff_id || '',
      request_date: item.request_date || '',
      requested_change: item.requested_change || '',
      decision_deadline: item.decision_deadline || '',
      status: item.status || 'pending',
      reason: item.reason || '',
      current_pattern: item.current_pattern || '',
      decision: item.decision || '',
      decision_date: item.decision_date || '',
      decision_reason: item.decision_reason || '',
      trial_period_end: item.trial_period_end || '',
      appeal_date: item.appeal_date || '',
      appeal_outcome: item.appeal_outcome || '',
      notes: item.notes || '',
    });
    setShowModal(true);
  }

  async function handleSave() {
    setFormError('');
    setError(null);
    if (!form.staff_id) { setFormError('Staff member is required'); return; }
    if (!form.request_date) { setFormError('Request date is required'); return; }
    if (!form.requested_change) { setFormError('Requested change is required'); return; }
    setSaving(true);
    try {
      if (editing) {
        await updateHrFlexWorking(editing.id, { ...form, _version: editing.version });
      } else {
        await createHrFlexWorking(home, form);
      }
      setShowModal(false);
      setForm(blankForm());
      setEditing(null);
      load();
    } catch (e) {
      if (e.message?.includes('modified by another user')) {
        setError('This record was modified by another user. Please close and reopen to get the latest version.');
        load();
      } else { setError(e.message); }
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    const { downloadXLSX } = await import('../lib/excel.js');
    downloadXLSX('flexible_working', [{
      name: 'Flexible Working',
      headers: ['Staff ID', 'Request Date', 'Requested Change', 'Decision Deadline', 'Status', 'Decision', 'Decision Date', 'Notes'],
      rows: items.map(i => [
        i.staff_id, i.request_date || '', i.requested_change || '', i.decision_deadline || '',
        statusName(i.status), i.decision || '', i.decision_date || '', i.notes || '',
      ]),
    }]);
  }

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  if (loading) return <div className={PAGE.container} role="status"><div className={CARD.padded}><p className="text-center py-10 text-gray-500">Loading flexible working data...</p></div></div>;

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Flexible Working Requests</h1>
          <p className={PAGE.subtitle}>ERA 2025 day-one right — employer must decide within 2 months of request</p>
        </div>
        <div className="flex gap-2">
          <button className={BTN.secondary + ' ' + BTN.sm} onClick={handleExport}>Export Excel</button>
          {isAdmin && <button className={BTN.primary + ' ' + BTN.sm} onClick={openNew}>New Request</button>}
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">{error}</div>}

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <StaffPicker value={filterStaff} onChange={setFilterStaff} showAll showInactive small />
        <select className={INPUT.select + ' max-w-[200px]'} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {FLEX_WORKING_STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className={CARD.flush}>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th scope="col" className={TABLE.th}>Staff ID</th>
                <th scope="col" className={TABLE.th}>Request Date</th>
                <th scope="col" className={TABLE.th}>Requested Change</th>
                <th scope="col" className={TABLE.th}>Decision Deadline</th>
                <th scope="col" className={TABLE.th}>Status</th>
                <th scope="col" className={TABLE.th}>Decision</th>
                <th scope="col" className={TABLE.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && <tr><td colSpan={7} className={TABLE.empty}>No flexible working requests</td></tr>}
              {items.map(item => {
                const overdue = isOverdue(item);
                return (
                  <tr key={item.id} className={`${TABLE.tr} ${overdue ? 'bg-red-50' : ''}`}>
                    <td className={TABLE.td}>{item.staff_id}</td>
                    <td className={TABLE.td}>{item.request_date || '—'}</td>
                    <td className={TABLE.td}><span className="line-clamp-2 text-sm">{item.requested_change || '—'}</span></td>
                    <td className={TABLE.td}>
                      <span className={overdue ? 'text-red-600 font-semibold' : ''}>
                        {item.decision_deadline || '—'}
                        {overdue && ' (overdue)'}
                      </span>
                    </td>
                    <td className={TABLE.td}><span className={BADGE[getStatusBadge(item.status, FLEX_WORKING_STATUSES)]}>{statusName(item.status)}</span></td>
                    <td className={TABLE.td}>{DECISION_OPTIONS.find(d => d.id === item.decision)?.name || item.decision || '—'}</td>
                    {isAdmin && <td className={TABLE.td}>
                      <button className={BTN.ghost + ' ' + BTN.xs} onClick={() => openEdit(item)}>Edit</button>
                    </td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination total={total} limit={LIMIT} offset={offset} onChange={setOffset} />

      {/* Modal */}
      {showModal && (
        <Modal isOpen={showModal} onClose={closeModal} title={editing ? 'Edit Flexible Working Request' : 'New Flexible Working Request'} size="xl">
            <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-4">
                <StaffPicker value={form.staff_id || ''} onChange={val => set('staff_id', val)} label="Staff Member" required />
                <div>
                  <label className={INPUT.label}>Request Date *</label>
                  <input type="date" className={INPUT.base} value={form.request_date} onChange={e => set('request_date', e.target.value)} />
                </div>
              </div>
              <div>
                <label className={INPUT.label}>Requested Change *</label>
                <textarea className={INPUT.base} rows={3} value={form.requested_change} onChange={e => set('requested_change', e.target.value)} placeholder="Describe the flexible working arrangement requested" />
              </div>
              <div>
                <label className={INPUT.label}>Reason for Request</label>
                <textarea className={INPUT.base} rows={2} value={form.reason} onChange={e => set('reason', e.target.value)} />
              </div>
              <div>
                <label className={INPUT.label}>Current Pattern</label>
                <input className={INPUT.base} value={form.current_pattern} onChange={e => set('current_pattern', e.target.value)} placeholder="e.g. Mon-Fri 9-5" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={INPUT.label}>Decision Deadline</label>
                  <input type="date" className={INPUT.base} value={form.decision_deadline} onChange={e => set('decision_deadline', e.target.value)} />
                </div>
                <div>
                  <label className={INPUT.label}>Status</label>
                  <select className={INPUT.select} value={form.status} onChange={e => set('status', e.target.value)}>
                    {FLEX_WORKING_STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>

              <hr className="border-gray-100" />
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Decision</p>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={INPUT.label}>Decision</label>
                  <select className={INPUT.select} value={form.decision} onChange={e => set('decision', e.target.value)}>
                    {DECISION_OPTIONS.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={INPUT.label}>Decision Date</label>
                  <input type="date" className={INPUT.base} value={form.decision_date} onChange={e => set('decision_date', e.target.value)} />
                </div>
              </div>

              {form.decision === 'refused' && (
                <div>
                  <label className={INPUT.label}>Refusal Reason (statutory)</label>
                  <select className={INPUT.select} value={form.decision_reason} onChange={e => set('decision_reason', e.target.value)}>
                    <option value="">— Select reason —</option>
                    {FLEX_REFUSAL_REASONS.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
              )}

              {form.decision && form.decision !== 'refused' && (
                <div>
                  <label className={INPUT.label}>Decision Reason / Notes</label>
                  <textarea className={INPUT.base} rows={2} value={form.decision_reason} onChange={e => set('decision_reason', e.target.value)} />
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={INPUT.label}>Trial Period End</label>
                  <input type="date" className={INPUT.base} value={form.trial_period_end} onChange={e => set('trial_period_end', e.target.value)} />
                </div>
                <div>
                  <label className={INPUT.label}>Appeal Date</label>
                  <input type="date" className={INPUT.base} value={form.appeal_date} onChange={e => set('appeal_date', e.target.value)} />
                </div>
              </div>
              {form.appeal_date && (
                <div>
                  <label className={INPUT.label}>Appeal Outcome</label>
                  <input className={INPUT.base} value={form.appeal_outcome} onChange={e => set('appeal_outcome', e.target.value)} />
                </div>
              )}
              <div>
                <label className={INPUT.label}>Notes</label>
                <textarea className={INPUT.base} rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
              </div>
            </div>
            <FileAttachments caseType="flexible_working" caseId={editing?.id} />
            {formError && <p className="text-sm text-red-600 mt-2">{formError}</p>}
            <div className={MODAL.footer}>
              <button className={BTN.secondary} onClick={closeModal} disabled={saving}>Cancel</button>
              <button className={BTN.primary} onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : editing ? 'Update' : 'Create'}</button>
            </div>
        </Modal>
      )}
    </div>
  );
}
