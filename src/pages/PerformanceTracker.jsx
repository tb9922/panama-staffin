import { useState, useEffect, useCallback } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import { getCurrentHome, getHrPerformance, createHrPerformance, updateHrPerformance } from '../lib/api.js';
import { PERFORMANCE_TYPES, PERFORMANCE_STATUSES, getStatusBadge } from '../lib/hr.js';
import StaffPicker from '../components/StaffPicker.jsx';
import FileAttachments from '../components/FileAttachments.jsx';
import InvestigationMeetings from '../components/InvestigationMeetings.jsx';

const MODAL_TABS = ['Concern', 'Informal', 'PIP', 'Hearing', 'Outcome', 'Appeal', 'Notes'];

const emptyForm = () => ({
  staff_id: '', date_raised: new Date().toISOString().slice(0, 10), type: 'capability',
  description: '', manager: '', status: 'open',
  informal_notes: '', informal_targets: '',
  pip_objectives: '', pip_start_date: '', pip_end_date: '', pip_review_dates: '',
  hearing_date: '', hearing_chair: '',
  outcome: '', outcome_date: '', warning_expiry_date: '',
  appeal_date: '', appeal_outcome: '',
});

export default function PerformanceTracker() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [modalTab, setModalTab] = useState(0);
  useDirtyGuard(showModal);

  // Filters
  const [filterStaff, setFilterStaff] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');

  const home = getCurrentHome();

  const load = useCallback(async () => {
    if (!home) return;
    setLoading(true);
    try {
      const filters = {};
      if (filterStaff) filters.staffId = filterStaff;
      if (filterStatus) filters.status = filterStatus;
      if (filterType) filters.type = filterType;
      setItems(await getHrPerformance(home, filters));
      setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [home, filterStaff, filterStatus, filterType]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!showModal) return;
    const handler = e => {
      if (e.key === 'Escape') { setShowModal(false); setForm(emptyForm()); setEditing(null); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [showModal]);

  function openNew() {
    setEditing(null);
    setForm(emptyForm());
    setModalTab(0);
    setShowModal(true);
  }

  function openEdit(item) {
    setEditing(item);
    setForm({
      staff_id: item.staff_id || '',
      date_raised: item.date_raised || '',
      type: item.type || 'capability',
      description: item.description || '',
      manager: item.manager || '',
      status: item.status || 'open',
      informal_notes: item.informal_notes || '',
      informal_targets: item.informal_targets || '',
      pip_objectives: item.pip_objectives || '',
      pip_start_date: item.pip_start_date || '',
      pip_end_date: item.pip_end_date || '',
      pip_review_dates: item.pip_review_dates || '',
      hearing_date: item.hearing_date || '',
      hearing_chair: item.hearing_chair || '',
      outcome: item.outcome || '',
      outcome_date: item.outcome_date || '',
      warning_expiry_date: item.warning_expiry_date || '',
      appeal_date: item.appeal_date || '',
      appeal_outcome: item.appeal_outcome || '',
    });
    setModalTab(0);
    setShowModal(true);
  }

  async function handleSave() {
    setError(null);
    if (!form.staff_id || !form.date_raised) return;
    try {
      if (editing) {
        await updateHrPerformance(editing.id, form);
      } else {
        await createHrPerformance(home, form);
      }
      setShowModal(false);
      setForm(emptyForm());
      setEditing(null);
      load();
    } catch (e) { setError(e.message); }
  }

  async function handleExport() {
    const { downloadXLSX } = await import('../lib/excel.js');
    downloadXLSX('performance_cases', [{
      name: 'Performance',
      headers: ['Staff ID', 'Date Raised', 'Type', 'Status', 'Manager', 'Outcome', 'Outcome Date'],
      rows: items.map(i => [
        i.staff_id, i.date_raised,
        PERFORMANCE_TYPES.find(t => t.id === i.type)?.name || i.type,
        PERFORMANCE_STATUSES.find(s => s.id === i.status)?.name || i.status,
        i.manager || '', i.outcome || '', i.outcome_date || '',
      ]),
    }]);
  }

  const f = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  if (loading) return <div className={PAGE.container}><div className={CARD.padded}><p className="text-center py-10 text-gray-500">Loading performance cases...</p></div></div>;

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Performance Management</h1>
          <p className={PAGE.subtitle}>Capability concerns, PIPs, and performance hearings</p>
        </div>
        <div className="flex gap-2">
          <button className={BTN.secondary + ' ' + BTN.sm} onClick={handleExport}>Export Excel</button>
          <button className={BTN.primary + ' ' + BTN.sm} onClick={openNew}>New Case</button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">{error}</div>}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <StaffPicker value={filterStaff} onChange={setFilterStaff} showAll showInactive small />
        <select className={INPUT.select + ' max-w-[160px]'} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {PERFORMANCE_STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className={INPUT.select + ' max-w-[180px]'} value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="">All Types</option>
          {PERFORMANCE_TYPES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className={CARD.flush}>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th className={TABLE.th}>Staff ID</th>
                <th className={TABLE.th}>Date Raised</th>
                <th className={TABLE.th}>Type</th>
                <th className={TABLE.th}>Status</th>
                <th className={TABLE.th}>Manager</th>
                <th className={TABLE.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && <tr><td colSpan={6} className={TABLE.empty}>No performance cases</td></tr>}
              {items.map(item => (
                <tr key={item.id} className={TABLE.tr}>
                  <td className={TABLE.td + ' font-medium'}>{item.staff_id}</td>
                  <td className={TABLE.td}>{item.date_raised}</td>
                  <td className={TABLE.td}>
                    <span className={BADGE[getStatusBadge(item.type, PERFORMANCE_TYPES.map(t => ({ ...t, badgeKey: 'blue' }))) || 'blue']}>
                      {PERFORMANCE_TYPES.find(t => t.id === item.type)?.name || item.type}
                    </span>
                  </td>
                  <td className={TABLE.td}>
                    <span className={BADGE[getStatusBadge(item.status, PERFORMANCE_STATUSES)]}>
                      {PERFORMANCE_STATUSES.find(s => s.id === item.status)?.name || item.status}
                    </span>
                  </td>
                  <td className={TABLE.td}>{item.manager || '—'}</td>
                  <td className={TABLE.td}>
                    <button className={BTN.ghost + ' ' + BTN.xs} onClick={() => openEdit(item)}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className={MODAL.overlay} onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className={MODAL.panelXl}>
            <h3 className={MODAL.title}>{editing ? 'Edit Performance Case' : 'New Performance Case'}</h3>

            {/* Modal tab bar */}
            <div className="flex gap-1 mb-4 border-b border-gray-200 overflow-x-auto">
              {MODAL_TABS.map((t, i) => (
                <button key={t} onClick={() => setModalTab(i)}
                  className={`px-3 py-1.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                    modalTab === i ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}>{t}</button>
              ))}
            </div>

            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              {modalTab === 0 && <>
                <div className="grid grid-cols-2 gap-4">
                  <StaffPicker value={form.staff_id} onChange={val => f('staff_id', val)} label="Staff Member" />
                  <div>
                    <label className={INPUT.label}>Date Raised</label>
                    <input type="date" className={INPUT.base} value={form.date_raised} onChange={e => f('date_raised', e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={INPUT.label}>Type</label>
                    <select className={INPUT.select} value={form.type} onChange={e => f('type', e.target.value)}>
                      {PERFORMANCE_TYPES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={INPUT.label}>Manager</label>
                    <input className={INPUT.base} value={form.manager} onChange={e => f('manager', e.target.value)} />
                  </div>
                </div>
                {editing && (
                  <div>
                    <label className={INPUT.label}>Status</label>
                    <select className={INPUT.select} value={form.status} onChange={e => f('status', e.target.value)}>
                      {PERFORMANCE_STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label className={INPUT.label}>Description</label>
                  <textarea className={INPUT.base} rows={3} value={form.description} onChange={e => f('description', e.target.value)} />
                </div>
              </>}

              {modalTab === 1 && <>
                <div>
                  <label className={INPUT.label}>Informal Stage Notes</label>
                  <textarea className={INPUT.base} rows={4} value={form.informal_notes} onChange={e => f('informal_notes', e.target.value)} placeholder="Notes from informal discussions..." />
                </div>
                <div>
                  <label className={INPUT.label}>Informal Targets</label>
                  <textarea className={INPUT.base} rows={3} value={form.informal_targets} onChange={e => f('informal_targets', e.target.value)} placeholder="Targets set during informal stage..." />
                </div>
              </>}

              {modalTab === 2 && <>
                <div>
                  <label className={INPUT.label}>PIP Objectives</label>
                  <textarea className={INPUT.base} rows={4} value={form.pip_objectives} onChange={e => f('pip_objectives', e.target.value)} placeholder="SMART objectives for performance improvement..." />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={INPUT.label}>PIP Start Date</label>
                    <input type="date" className={INPUT.base} value={form.pip_start_date} onChange={e => f('pip_start_date', e.target.value)} />
                  </div>
                  <div>
                    <label className={INPUT.label}>PIP End Date</label>
                    <input type="date" className={INPUT.base} value={form.pip_end_date} onChange={e => f('pip_end_date', e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className={INPUT.label}>PIP Review Dates</label>
                  <input className={INPUT.base} value={form.pip_review_dates} onChange={e => f('pip_review_dates', e.target.value)} placeholder="e.g. 2026-03-15, 2026-04-15" />
                </div>
                <InvestigationMeetings caseType="performance" caseId={editing?.id} />
              </>}

              {modalTab === 3 && <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={INPUT.label}>Hearing Date</label>
                    <input type="date" className={INPUT.base} value={form.hearing_date} onChange={e => f('hearing_date', e.target.value)} />
                  </div>
                  <div>
                    <label className={INPUT.label}>Hearing Chair</label>
                    <input className={INPUT.base} value={form.hearing_chair} onChange={e => f('hearing_chair', e.target.value)} />
                  </div>
                </div>
              </>}

              {modalTab === 4 && <>
                <div>
                  <label className={INPUT.label}>Outcome</label>
                  <input className={INPUT.base} value={form.outcome} onChange={e => f('outcome', e.target.value)} placeholder="e.g. Extended PIP, Returned to normal management" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={INPUT.label}>Outcome Date</label>
                    <input type="date" className={INPUT.base} value={form.outcome_date} onChange={e => f('outcome_date', e.target.value)} />
                  </div>
                  <div>
                    <label className={INPUT.label}>Warning Expiry Date</label>
                    <input type="date" className={INPUT.base} value={form.warning_expiry_date} onChange={e => f('warning_expiry_date', e.target.value)} />
                  </div>
                </div>
              </>}

              {modalTab === 5 && <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={INPUT.label}>Appeal Date</label>
                    <input type="date" className={INPUT.base} value={form.appeal_date} onChange={e => f('appeal_date', e.target.value)} />
                  </div>
                  <div>
                    <label className={INPUT.label}>Appeal Outcome</label>
                    <input className={INPUT.base} value={form.appeal_outcome} onChange={e => f('appeal_outcome', e.target.value)} placeholder="e.g. Upheld, Overturned" />
                  </div>
                </div>
              </>}

              {modalTab === 6 && <>
                <FileAttachments caseType="performance" caseId={editing?.id} />
              </>}
            </div>

            <div className={MODAL.footer}>
              <button className={BTN.secondary} onClick={() => setShowModal(false)}>Cancel</button>
              <button className={BTN.primary} onClick={handleSave}>{editing ? 'Update' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
