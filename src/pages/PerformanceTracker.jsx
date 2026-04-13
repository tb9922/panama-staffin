import { useState, useEffect, useCallback } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import ModalWrapper from '../components/Modal.jsx';
import TabBar from '../components/TabBar.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { getCurrentHome, getHrPerformance, createHrPerformance, updateHrPerformance } from '../lib/api.js';
import { PERFORMANCE_TYPES, PERFORMANCE_STATUSES, getStatusBadge } from '../lib/hr.js';
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

const LIMIT = 50;

const emptyForm = () => ({
  staff_id: '',
  date_raised: todayLocalISO(),
  type: 'capability',
  description: '',
  status: 'open',
  informal_notes: '',
  informal_targets: '',
  pip_objectives: '',
  pip_start_date: '',
  pip_end_date: '',
  hearing_date: '',
  hearing_chair: '',
  outcome: '',
  outcome_date: '',
  warning_expiry_date: '',
  appeal_date: '',
  appeal_outcome: '',
});

export default function PerformanceTracker() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [modalTab, setModalTab] = useState('concern');
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [filterStaff, setFilterStaff] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const home = getCurrentHome();
  const { canWrite } = useData();
  const canEdit = canWrite('hr');
  const { notice, showNotice, clearNotice } = useTransientNotice();

  useDirtyGuard(showModal);

  const load = useCallback(async () => {
    if (!home) return;
    setLoading(true);
    try {
      const filters = { limit: LIMIT, offset };
      if (filterStaff) filters.staffId = filterStaff;
      if (filterStatus) filters.status = filterStatus;
      if (filterType) filters.type = filterType;
      const res = await getHrPerformance(home, filters);
      setItems(res?.rows || []);
      setTotal(res?.total || 0);
      setPageError(null);
    } catch (e) {
      setPageError(e.message || 'Failed to load performance cases');
    } finally {
      setLoading(false);
    }
  }, [home, filterStaff, filterStatus, filterType, offset]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    setOffset(0);
  }, [filterStaff, filterStatus, filterType]);

  function openNew() {
    setEditing(null);
    setForm(emptyForm());
    setModalTab('concern');
    setModalError(null);
    setShowModal(true);
  }

  function openEdit(item) {
    setEditing(item);
    setForm({
      staff_id: item.staff_id || '',
      date_raised: item.date_raised || '',
      type: item.type || 'capability',
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
    setModalError(null);
    setShowModal(true);
  }

  async function handleSave() {
    setModalError(null);
    const missing = [];
    if (!form.staff_id) missing.push('Staff member');
    if (!form.date_raised) missing.push('Date raised');
    if (missing.length) {
      setModalError(`Required fields missing: ${missing.join(', ')}`);
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await updateHrPerformance(editing.id, { ...form, _version: editing.version });
      } else {
        await createHrPerformance(home, form);
      }
      setShowModal(false);
      setForm(emptyForm());
      setEditing(null);
      showNotice(editing ? 'Performance case updated.' : 'Performance case created.');
      setRefreshKey(key => key + 1);
    } catch (e) {
      if (e.message?.includes('modified by another user')) {
        setModalError('This record was modified by another user. Please close and reopen to get the latest version.');
        setRefreshKey(key => key + 1);
      } else {
        setModalError(e.message || 'Failed to save performance case');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    const { downloadXLSX } = await import('../lib/excel.js');
    downloadXLSX('performance_cases', [{
      name: 'Performance',
      headers: ['Staff ID', 'Date Raised', 'Type', 'Status', 'Outcome', 'Outcome Date'],
      rows: items.map(item => [
        item.staff_id,
        item.date_raised,
        PERFORMANCE_TYPES.find(type => type.id === item.type)?.name || item.type,
        PERFORMANCE_STATUSES.find(status => status.id === item.status)?.name || item.status,
        item.outcome || '',
        item.outcome_date || '',
      ]),
    }]);
  }

  function setField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  if (loading) {
    return (
      <div className={PAGE.container}>
        <LoadingState message="Loading performance cases..." card />
      </div>
    );
  }

  if (pageError) {
    return (
      <div className={PAGE.container}>
        <ErrorState title="Could not load performance cases" message={pageError} onRetry={() => void load()} />
      </div>
    );
  }

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

      <div className="flex flex-wrap gap-3 mb-4">
        <StaffPicker value={filterStaff} onChange={setFilterStaff} showAll showInactive small />
        <select className={INPUT.select + ' max-w-[160px]'} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {PERFORMANCE_STATUSES.map(status => <option key={status.id} value={status.id}>{status.name}</option>)}
        </select>
        <select className={INPUT.select + ' max-w-[180px]'} value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="">All Types</option>
          {PERFORMANCE_TYPES.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}
        </select>
      </div>

      {items.length === 0 ? (
        <div className={CARD.padded}>
          <EmptyState
            title="No performance cases yet"
            description={canEdit ? 'Add the first case to track informal support, PIP objectives, hearings, and outcomes in one place.' : 'Performance cases will appear here once they are recorded.'}
            actionLabel={canEdit ? 'New Case' : undefined}
            onAction={canEdit ? openNew : undefined}
          />
        </div>
      ) : (
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
                {items.map(item => (
                  <tr key={item.id} className={TABLE.tr}>
                    <td className={TABLE.td + ' font-medium'}>{item.staff_id}</td>
                    <td className={TABLE.td}>{item.date_raised}</td>
                    <td className={TABLE.td}>
                      <span className={BADGE[getStatusBadge(item.type, PERFORMANCE_TYPES.map(type => ({ ...type, badgeKey: 'blue' }))) || 'blue']}>
                        {PERFORMANCE_TYPES.find(type => type.id === item.type)?.name || item.type}
                      </span>
                    </td>
                    <td className={TABLE.td}>
                      <span className={BADGE[getStatusBadge(item.status, PERFORMANCE_STATUSES)]}>
                        {PERFORMANCE_STATUSES.find(status => status.id === item.status)?.name || item.status}
                      </span>
                    </td>
                    {canEdit && (
                      <td className={TABLE.td}>
                        <button className={BTN.ghost + ' ' + BTN.xs} onClick={() => openEdit(item)}>Edit</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <Pagination total={total} limit={LIMIT} offset={offset} onChange={setOffset} />

      {showModal && (
        <ModalWrapper
          isOpen={showModal}
          onClose={() => {
            setShowModal(false);
            setForm(emptyForm());
            setEditing(null);
            setModalError(null);
          }}
          title={editing ? 'Edit Performance Case' : 'New Performance Case'}
          size="xl"
        >
          {modalError && <ErrorState title="This performance case needs attention" message={modalError} className="mb-4" />}

          <TabBar tabs={MODAL_TABS} activeTab={modalTab} onTabChange={setModalTab} />

          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            {modalTab === 'concern' && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <StaffPicker value={form.staff_id} onChange={val => setField('staff_id', val)} label="Staff Member" required />
                  <div>
                    <label className={INPUT.label}>Date Raised *</label>
                    <input type="date" className={INPUT.base} value={form.date_raised} onChange={e => setField('date_raised', e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className={INPUT.label}>Type</label>
                  <select className={INPUT.select} value={form.type} onChange={e => setField('type', e.target.value)}>
                    {PERFORMANCE_TYPES.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}
                  </select>
                </div>
                {editing && (
                  <div>
                    <label className={INPUT.label}>Status</label>
                    <select className={INPUT.select} value={form.status} onChange={e => setField('status', e.target.value)}>
                      {PERFORMANCE_STATUSES.map(status => <option key={status.id} value={status.id}>{status.name}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label className={INPUT.label}>Description</label>
                  <textarea className={INPUT.base} rows={3} value={form.description} onChange={e => setField('description', e.target.value)} />
                </div>
              </>
            )}

            {modalTab === 'informal' && (
              <>
                <div>
                  <label className={INPUT.label}>Informal Stage Notes</label>
                  <textarea className={INPUT.base} rows={4} value={form.informal_notes} onChange={e => setField('informal_notes', e.target.value)} placeholder="Notes from informal discussions..." />
                </div>
                <div>
                  <label className={INPUT.label}>Informal Targets</label>
                  <textarea className={INPUT.base} rows={3} value={form.informal_targets} onChange={e => setField('informal_targets', e.target.value)} placeholder="Targets set during informal stage..." />
                </div>
              </>
            )}

            {modalTab === 'pip' && (
              <>
                <div>
                  <label className={INPUT.label}>PIP Objectives</label>
                  <textarea className={INPUT.base} rows={4} value={form.pip_objectives} onChange={e => setField('pip_objectives', e.target.value)} placeholder="SMART objectives for performance improvement..." />
                  <p className="mt-1 text-xs text-gray-500">Use clear, measurable objectives so managers and staff can review progress consistently.</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={INPUT.label}>PIP Start Date</label>
                    <input type="date" className={INPUT.base} value={form.pip_start_date} onChange={e => setField('pip_start_date', e.target.value)} />
                  </div>
                  <div>
                    <label className={INPUT.label}>PIP End Date</label>
                    <input type="date" className={INPUT.base} value={form.pip_end_date} onChange={e => setField('pip_end_date', e.target.value)} />
                  </div>
                </div>
                <InvestigationMeetings caseType="performance" caseId={editing?.id} />
              </>
            )}

            {modalTab === 'hearing' && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={INPUT.label}>Hearing Date</label>
                    <input type="date" className={INPUT.base} value={form.hearing_date} onChange={e => setField('hearing_date', e.target.value)} />
                  </div>
                  <div>
                    <label className={INPUT.label}>Hearing Chair</label>
                    <input className={INPUT.base} value={form.hearing_chair} onChange={e => setField('hearing_chair', e.target.value)} />
                  </div>
                </div>
              </>
            )}

            {modalTab === 'outcome' && (
              <>
                <div>
                  <label className={INPUT.label}>Outcome</label>
                  <input className={INPUT.base} value={form.outcome} onChange={e => setField('outcome', e.target.value)} placeholder="e.g. Extended PIP, Returned to normal management" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={INPUT.label}>Outcome Date</label>
                    <input type="date" className={INPUT.base} value={form.outcome_date} onChange={e => setField('outcome_date', e.target.value)} />
                  </div>
                  <div>
                    <label className={INPUT.label}>Warning Expiry Date</label>
                    <input type="date" className={INPUT.base} value={form.warning_expiry_date} onChange={e => setField('warning_expiry_date', e.target.value)} />
                  </div>
                </div>
              </>
            )}

            {modalTab === 'appeal' && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={INPUT.label}>Appeal Date</label>
                    <input type="date" className={INPUT.base} value={form.appeal_date} onChange={e => setField('appeal_date', e.target.value)} />
                  </div>
                  <div>
                    <label className={INPUT.label}>Appeal Outcome</label>
                    <select className={INPUT.select} value={form.appeal_outcome} onChange={e => setField('appeal_outcome', e.target.value)}>
                      <option value="">-- Select --</option>
                      <option value="upheld">Upheld</option>
                      <option value="partially_upheld">Partially Upheld</option>
                      <option value="overturned">Overturned</option>
                    </select>
                  </div>
                </div>
              </>
            )}

            {modalTab === 'notes' && <FileAttachments caseType="performance" caseId={editing?.id} />}
          </div>

          <div className={MODAL.footer}>
            <button
              className={BTN.secondary}
              onClick={() => {
                setShowModal(false);
                setModalError(null);
              }}
              disabled={saving}
            >
              Cancel
            </button>
            <button className={BTN.primary} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Update' : 'Create'}
            </button>
          </div>
        </ModalWrapper>
      )}
    </div>
  );
}
