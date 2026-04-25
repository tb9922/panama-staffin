import { useState, useEffect } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import ModalWrapper from '../components/Modal.jsx';
import EmptyState from '../components/EmptyState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import TabBar from '../components/TabBar.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import { getCurrentHome, getHrPerformance, createHrPerformance, updateHrPerformance, getLoggedInUser } from '../lib/api.js';
import { PERFORMANCE_TYPES, PERFORMANCE_STATUSES, PERFORMANCE_AREAS, getStatusBadge } from '../lib/hr.js';
import StaffPicker from '../components/StaffPicker.jsx';
import FileAttachments from '../components/FileAttachments.jsx';
import InvestigationMeetings from '../components/InvestigationMeetings.jsx';
import Pagination from '../components/Pagination.jsx';
import { useData } from '../contexts/DataContext.jsx';
import { todayLocalISO } from '../lib/localDates.js';
import useTransientNotice from '../hooks/useTransientNotice.js';

const MODAL_TABS = [
  { id: 'concern', label: 'Concern' },
  { id: 'informal', label: 'Informal' },
  { id: 'pip', label: 'PIP' },
  { id: 'hearing', label: 'Hearing' },
  { id: 'outcome', label: 'Outcome' },
  { id: 'appeal', label: 'Appeal' },
  { id: 'notes', label: 'Notes' },
];

const APPEAL_OUTCOME_OPTIONS = [
  { value: 'upheld', label: 'Upheld' },
  { value: 'partially_upheld', label: 'Partially Upheld' },
  { value: 'overturned', label: 'Overturned' },
];

const emptyForm = () => ({
  staff_id: '', date_raised: todayLocalISO(), type: 'capability', performance_area: 'other',
  description: '', status: 'open',
  informal_notes: '', informal_targets: '',
  pip_objectives: '', pip_start_date: '', pip_end_date: '',
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
  const [modalTab, setModalTab] = useState('concern');
  const [saving, setSaving] = useState(false);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [modalNotice, setModalNotice] = useState(null);
  useDirtyGuard(showModal);

  // Filters
  const [filterStaff, setFilterStaff] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');

  const [refreshKey, setRefreshKey] = useState(0);
  const home = getCurrentHome();
  const { canWrite } = useData();
  const canEdit = canWrite('hr');
  const { notice, showNotice, clearNotice } = useTransientNotice();

  const LIMIT = 50;

  useEffect(() => {
    let stale = false;
    (async () => {
      if (!home) return;
      setLoading(true);
      try {
        const filters = { limit: LIMIT, offset };
        if (filterStaff) filters.staffId = filterStaff;
        if (filterStatus) filters.status = filterStatus;
        if (filterType) filters.type = filterType;
        const res = await getHrPerformance(home, filters);
        if (!stale) { setItems(res?.rows || []); setTotal(res?.total || 0); setError(null); }
      } catch (e) { if (!stale) setError(e.message); }
      finally { if (!stale) setLoading(false); }
    })();
    return () => { stale = true; };
  }, [home, filterStaff, filterStatus, filterType, offset, refreshKey]);

  useEffect(() => { setOffset(0); }, [filterStaff, filterStatus, filterType]);

  function openNew() {
    setEditing(null);
    setForm(emptyForm());
    setModalTab('concern');
    setModalNotice(null);
    setShowModal(true);
  }

  function openEdit(item) {
    setEditing(item);
    setForm({
      staff_id: item.staff_id || '',
      date_raised: item.date_raised || '',
      type: item.type || 'capability',
      performance_area: item.performance_area || 'other',
      description: item.description || '',
      status: item.status || 'open',
      informal_notes: item.informal_notes || '',
      informal_targets: item.informal_targets || '',
      pip_objectives: item.pip_objectives || '',
      pip_start_date: item.pip_start_date || '',
      pip_end_date: item.pip_end_date || '',
      hearing_date: item.hearing_date || '',
      hearing_chair: item.hearing_chair || '',
      outcome: item.outcome || '',
      outcome_date: item.outcome_date || '',
      warning_expiry_date: item.warning_expiry_date || '',
      appeal_date: item.appeal_date || '',
      appeal_outcome: item.appeal_outcome || '',
    });
    setModalTab('concern');
    setModalNotice(null);
    setShowModal(true);
  }

  async function handleSave() {
    setError(null);
    const missing = [];
    if (!form.staff_id) missing.push('Staff member');
    if (!form.date_raised) missing.push('Date raised');
    if (!form.performance_area) missing.push('Performance area');
    if (missing.length) { setError(`Required fields missing: ${missing.join(', ')}`); return; }
    setSaving(true);
    try {
      const payload = { ...form };
      if (editing) {
        await updateHrPerformance(editing.id, { ...payload, _version: editing.version });
        setShowModal(false);
        setForm(emptyForm());
        setEditing(null);
        setModalNotice(null);
        showNotice('Performance case updated.');
      } else {
        const created = await createHrPerformance(home, {
          ...payload,
          raised_by: getLoggedInUser()?.username || 'system',
        });
        setEditing(created);
        setForm({
          ...emptyForm(),
          ...created,
          performance_area: created.performance_area || 'other',
          type: created.type || 'capability',
          status: created.status || 'open',
        });
        setModalTab('informal');
        setModalNotice({
          variant: 'success',
          content: 'Case created. Continue with the informal stage, PIP milestones, and supporting files.',
        });
        showNotice('Performance case created.');
      }
      setRefreshKey(k => k + 1);
    } catch (e) {
      if (e.message?.includes('modified by another user')) {
        setError('This record was modified by another user. Please close and reopen to get the latest version.');
        setRefreshKey(k => k + 1);
      } else { setError(e.message); }
    }
    finally { setSaving(false); }
  }

  async function handleExport() {
    const { downloadXLSX } = await import('../lib/excel.js');
    const exportRows = [];
    let exportOffset = 0;
    let exportTotal = Infinity;
    while (exportRows.length < exportTotal) {
      const filters = { limit: 500, offset: exportOffset };
      if (filterStaff) filters.staffId = filterStaff;
      if (filterStatus) filters.status = filterStatus;
      if (filterType) filters.type = filterType;
      const res = await getHrPerformance(home, filters);
      const rows = res?.rows || [];
      exportRows.push(...rows);
      exportTotal = res?.total ?? exportRows.length;
      if (rows.length === 0) break;
      exportOffset += rows.length;
    }
    downloadXLSX('performance_cases', [{
      name: 'Performance',
      headers: ['Staff ID', 'Date Raised', 'Type', 'Status', 'Outcome', 'Outcome Date'],
      rows: exportRows.map(i => [
        i.staff_id, i.date_raised,
        PERFORMANCE_TYPES.find(t => t.id === i.type)?.name || i.type,
        PERFORMANCE_STATUSES.find(s => s.id === i.status)?.name || i.status,
        i.outcome || '', i.outcome_date || '',
      ]),
    }]);
  }

  const f = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  if (loading) return <div className={PAGE.container}><LoadingState message="Loading performance cases..." card /></div>;

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Performance Management</h1>
          <p className={PAGE.subtitle}>Capability concerns, PIPs, and performance hearings</p>
        </div>
        <div className="flex gap-2">
          <button className={BTN.secondary + ' ' + BTN.sm} onClick={handleExport}>Export Excel</button>
          {canEdit && <button className={BTN.primary + ' ' + BTN.sm} onClick={openNew}>New Case</button>}
        </div>
      </div>

      {notice && (
        <InlineNotice variant={notice.variant} onDismiss={clearNotice} className="mb-4">
          {notice.content}
        </InlineNotice>
      )}

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
                <th scope="col" className={TABLE.th}>Staff ID</th>
                <th scope="col" className={TABLE.th}>Date Raised</th>
                <th scope="col" className={TABLE.th}>Type</th>
                <th scope="col" className={TABLE.th}>Status</th>
                {canEdit && <th scope="col" className={TABLE.th}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={5} className={TABLE.empty}>
                    <EmptyState
                      title="No performance cases"
                      description={canEdit ? 'Create the first case to track informal support, PIPs, and hearings.' : 'Performance cases will appear here once they have been recorded.'}
                      actionLabel={canEdit ? 'New Case' : undefined}
                      onAction={canEdit ? openNew : undefined}
                      compact
                    />
                  </td>
                </tr>
              )}
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
                  {canEdit && <td className={TABLE.td}>
                    <button className={BTN.ghost + ' ' + BTN.xs} onClick={() => openEdit(item)}>Edit</button>
                  </td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination total={total} limit={LIMIT} offset={offset} onChange={setOffset} />

      {/* Modal */}
      {showModal && (
        <ModalWrapper isOpen={showModal} onClose={() => { setShowModal(false); setForm(emptyForm()); setEditing(null); setError(null); setModalNotice(null); }} title={editing ? 'Edit Performance Case' : 'New Performance Case'} size="xl">
            {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4" role="alert">{error}</div>}
            {modalNotice && (
              <InlineNotice variant={modalNotice.variant} onDismiss={() => setModalNotice(null)} className="mb-4">
                {modalNotice.content}
              </InlineNotice>
            )}
            {/* Modal tab bar */}
            <TabBar tabs={editing ? MODAL_TABS : [MODAL_TABS[0]]} activeTab={modalTab} onTabChange={setModalTab} />

            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              {modalTab === 'concern' && <>
                <div className="grid grid-cols-2 gap-4">
                  <StaffPicker value={form.staff_id} onChange={val => f('staff_id', val)} label="Staff Member" required />
                  <div>
                    <label htmlFor="performance-date-raised" className={INPUT.label}>Date Raised *</label>
                    <input id="performance-date-raised" type="date" className={INPUT.base} value={form.date_raised} onChange={e => f('date_raised', e.target.value)} />
                  </div>
                </div>
                <div>
                  <label htmlFor="performance-type" className={INPUT.label}>Type *</label>
                  <select id="performance-type" className={INPUT.select} value={form.type} onChange={e => f('type', e.target.value)}>
                    {PERFORMANCE_TYPES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="performance-area" className={INPUT.label}>Performance Area *</label>
                  <select id="performance-area" className={INPUT.select} value={form.performance_area} onChange={e => f('performance_area', e.target.value)}>
                    {PERFORMANCE_AREAS.map(area => <option key={area.id} value={area.id}>{area.name}</option>)}
                  </select>
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

              {modalTab === 'informal' && <>
                <div>
                  <label className={INPUT.label}>Informal Stage Notes</label>
                  <textarea className={INPUT.base} rows={4} value={form.informal_notes} onChange={e => f('informal_notes', e.target.value)} placeholder="Notes from informal discussions..." />
                </div>
                <div>
                  <label className={INPUT.label}>Informal Targets</label>
                  <textarea className={INPUT.base} rows={3} value={form.informal_targets} onChange={e => f('informal_targets', e.target.value)} placeholder="Targets set during informal stage..." />
                </div>
              </>}

              {modalTab === 'pip' && <>
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
                <InvestigationMeetings caseType="performance" caseId={editing?.id} />
              </>}

              {modalTab === 'hearing' && <>
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

              {modalTab === 'outcome' && <>
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

              {modalTab === 'appeal' && <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={INPUT.label}>Appeal Date</label>
                    <input type="date" className={INPUT.base} value={form.appeal_date} onChange={e => f('appeal_date', e.target.value)} />
                  </div>
                  <div>
                    <label className={INPUT.label}>Appeal Outcome</label>
                    <select className={INPUT.select} value={form.appeal_outcome} onChange={e => f('appeal_outcome', e.target.value)}>
                      <option value="">Select outcome...</option>
                      {APPEAL_OUTCOME_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </>}

              {modalTab === 'notes' && <>
                <FileAttachments caseType="performance" caseId={editing?.id} />
              </>}
            </div>

            <div className={MODAL.footer}>
              <button className={BTN.secondary} onClick={() => { setShowModal(false); setError(null); setModalNotice(null); }} disabled={saving}>Cancel</button>
              <button className={BTN.primary} onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : editing ? 'Update' : 'Create'}</button>
            </div>
        </ModalWrapper>
      )}
    </div>
  );
}
