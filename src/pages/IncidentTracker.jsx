import { useState, useMemo, useEffect, useRef } from 'react';
import { useConfirm } from '../hooks/useConfirm.jsx';
import { CARD, BTN, BADGE, INPUT, PAGE, TABLE } from '../lib/design.js';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import { useLiveDate } from '../hooks/useLiveDate.js';
import { downloadXLSX } from '../lib/excel.js';
import {
  getCurrentHome, getLoggedInUser,
  getIncidents, createIncident, updateIncident, deleteIncident,
  freezeIncident, getIncidentAddenda, addIncidentAddendum,
} from '../lib/api.js';
import {
  DEFAULT_INCIDENT_TYPES, getIncidentStats,
  SEVERITY_LEVELS, INVESTIGATION_STATUSES, PERSON_AFFECTED_TYPES,
  INCIDENT_CATEGORIES, isCqcNotificationOverdue, isRiddorOverdue,
} from '../lib/incidents.js';
import { clickableRowProps } from '../lib/a11y.js';
import { useData } from '../contexts/DataContext.jsx';
import IncidentTrackerModal from '../components/incidents/IncidentTrackerModal.jsx';
import { addDaysLocalISO } from '../lib/localDates.js';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';

const TABS = [
  { id: 'details', label: 'Details' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'investigation', label: 'Investigation' },
  { id: 'addenda', label: 'Notes' },
];

const EMPTY_FORM = {
  date: '', time: '', location: '', type: '', severity: 'minor',
  description: '', person_affected: 'resident', person_affected_name: '', resident_id: null,
  staff_involved: [], immediate_action: '', medical_attention: false, hospital_attendance: false,
  witnesses: [],
  cqc_notifiable: false, cqc_notification_type: '', cqc_notification_deadline: '',
  cqc_notified: false, cqc_notified_date: '', cqc_reference: '',
  riddor_reportable: false, riddor_category: '', riddor_reported: false,
  riddor_reported_date: '', riddor_reference: '',
  safeguarding_referral: false, safeguarding_to: '', safeguarding_reference: '', safeguarding_date: '',
  msp_wishes_recorded: false, msp_outcome_preferences: '', msp_person_involved: false,
  duty_of_candour_applies: false, candour_notification_date: '', candour_letter_sent_date: '', candour_recipient: '',
  police_involved: false, police_reference: '', police_contact_date: '',
  investigation_status: 'open', investigation_start_date: '', investigation_lead: '', investigation_review_date: '',
  root_cause: '', corrective_actions: [],
  lessons_learned: '', investigation_closed_date: '',
};

export default function IncidentTracker() {
  const { canWrite } = useData();
  const canEdit = canWrite('compliance');
  const { confirm, ConfirmDialog } = useConfirm();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [incidentTypes, setIncidentTypes] = useState([]);
  const [staff, setStaff] = useState([]);

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const editingIdRef = useRef(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [activeTab, setActiveTab] = useState('details');
  const [isFrozen, setIsFrozen] = useState(false);
  const [addenda, setAddenda] = useState([]);
  const [addendumText, setAddendumText] = useState('');
  const [freezing, setFreezing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  useDirtyGuard(showModal && !isFrozen);
  const [filterType, setFilterType] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch] = useState('');

  const home = getCurrentHome();
  async function load() {
    if (!home) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getIncidents(home);
      setIncidents(result.incidents || []);
      const types = result.incidentTypes && result.incidentTypes.length > 0
        ? result.incidentTypes
        : DEFAULT_INCIDENT_TYPES;
      setIncidentTypes(types.filter(t => t.active !== false));
      setStaff(result.staff || []);
    } catch (err) {
      setError(err.message || 'Failed to load incidents');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [home]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = useLiveDate();
  const activeStaff = useMemo(() => staff.filter(s => s.active !== false), [staff]);

  // Date range for stats: last 90 days
  const statsRange = useMemo(() => {
    return { from: addDaysLocalISO(today, -89), to: today };
  }, [today]);

  const stats = useMemo(() =>
    getIncidentStats(incidents, {}, statsRange.from, statsRange.to),
    [incidents, statsRange]);

  const filtered = useMemo(() => {
    let list = [...incidents].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
    if (filterType) list = list.filter(i => i.type === filterType);
    if (filterSeverity) list = list.filter(i => i.severity === filterSeverity);
    if (filterStatus) list = list.filter(i => i.investigation_status === filterStatus);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(i =>
        i.description?.toLowerCase().includes(q) ||
        i.person_affected_name?.toLowerCase().includes(q) ||
        i.type?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [incidents, filterType, filterSeverity, filterStatus, search]);

  function openAdd() {
    setEditingId(null);
    setIsFrozen(false);
    setAddenda([]);
    setAddendumText('');
    setForm({ ...EMPTY_FORM, date: today });
    setActiveTab('details');
    setSaveError(null);
    setShowModal(true);
  }

  function openEdit(inc) {
    editingIdRef.current = inc.id;
    setEditingId(inc.id);
    setIsFrozen(!!inc.frozen_at);
    setAddenda([]);
    setAddendumText('');
    setForm({
      date: inc.date || '', time: inc.time || '', location: inc.location || '',
      type: inc.type || '', severity: inc.severity || 'minor',
      description: inc.description || '', person_affected: inc.person_affected || 'resident',
      person_affected_name: inc.person_affected_name || '',
      staff_involved: inc.staff_involved || [], immediate_action: inc.immediate_action || '',
      medical_attention: !!inc.medical_attention, hospital_attendance: !!inc.hospital_attendance,
      witnesses: inc.witnesses || [],
      cqc_notifiable: !!inc.cqc_notifiable, cqc_notification_type: inc.cqc_notification_type || '',
      cqc_notification_deadline: inc.cqc_notification_deadline || '',
      cqc_notified: !!inc.cqc_notified, cqc_notified_date: inc.cqc_notified_date || '',
      cqc_reference: inc.cqc_reference || '',
      riddor_reportable: !!inc.riddor_reportable, riddor_category: inc.riddor_category || '',
      riddor_reported: !!inc.riddor_reported, riddor_reported_date: inc.riddor_reported_date || '',
      riddor_reference: inc.riddor_reference || '',
      safeguarding_referral: !!inc.safeguarding_referral, safeguarding_to: inc.safeguarding_to || '',
      safeguarding_reference: inc.safeguarding_reference || '', safeguarding_date: inc.safeguarding_date || '',
      msp_wishes_recorded: !!inc.msp_wishes_recorded, msp_outcome_preferences: inc.msp_outcome_preferences || '',
      msp_person_involved: !!inc.msp_person_involved,
      duty_of_candour_applies: !!inc.duty_of_candour_applies,
      candour_notification_date: inc.candour_notification_date || '',
      candour_letter_sent_date: inc.candour_letter_sent_date || '',
      candour_recipient: inc.candour_recipient || '',
      police_involved: !!inc.police_involved, police_reference: inc.police_reference || '',
      police_contact_date: inc.police_contact_date || '',
      investigation_status: inc.investigation_status || 'open',
      investigation_start_date: inc.investigation_start_date || '',
      investigation_lead: inc.investigation_lead || '',
      investigation_review_date: inc.investigation_review_date || '',
      root_cause: inc.root_cause || '',
      corrective_actions: inc.corrective_actions || [],
      lessons_learned: inc.lessons_learned || '',
      investigation_closed_date: inc.investigation_closed_date || '',
      resident_id: inc.resident_id || null,
      _version: inc.version,
    });
    setActiveTab(inc.frozen_at ? 'addenda' : 'details');
    setSaveError(null);
    setShowModal(true);
    // Load addenda in background — guard against stale response if user switches incidents rapidly
    const home = getCurrentHome();
    const loadedForId = inc.id;
    if (home) getIncidentAddenda(home, loadedForId)
      .then(a => { if (editingIdRef.current === loadedForId) setAddenda(a); })
      .catch(e => console.warn('Failed to load addenda:', e.message));
  }

  async function handleFreeze() {
    if (!editingId) return;
    if (!await confirm('Freeze this incident record? Once frozen, the incident details cannot be edited. You can still add notes.')) return;
    setFreezing(true);
    try {
      const home = getCurrentHome();
      await freezeIncident(home, editingId);
      setIsFrozen(true);
      await load();
    } catch (err) {
      setSaveError(err.message || 'Failed to freeze incident');
    } finally {
      setFreezing(false);
    }
  }

  async function handleAddAddendum() {
    if (saving || !editingId || !addendumText.trim()) return;
    setSaving(true);
    try {
      const home = getCurrentHome();
      const result = await addIncidentAddendum(home, editingId, addendumText.trim());
      setAddenda(prev => [...prev, result]);
      setAddendumText('');
    } catch (err) {
      setSaveError(err.message || 'Failed to add note');
    } finally { setSaving(false); }
  }

  async function handleSave() {
    if (saving) return;
    if (isFrozen) return;
    const validationError = validateFormBeforeSave();
    if (validationError) {
      setSaveError(validationError.message);
      setActiveTab(validationError.tab);
      focusField(validationError.fieldId);
      return;
    }
    const home = getCurrentHome();
    const username = getLoggedInUser()?.username || 'admin';
    setSaving(true);
    setSaveError(null);
    try {
      if (editingId) {
        await updateIncident(home, editingId, form);
      } else {
        await createIncident(home, { ...form, reported_by: username });
      }
      await load();
      setShowModal(false);
    } catch (err) {
      setSaveError(err.message || 'Failed to save incident');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (saving) return;
    if (isFrozen) return;
    if (!editingId) return;
    if (!await confirm('Delete this incident record?')) return;
    const home = getCurrentHome();
    setSaving(true);
    try {
      await deleteIncident(home, editingId);
      await load();
      setShowModal(false);
    } catch (err) {
      setSaveError(err.message || 'Failed to delete incident');
    } finally {
      setSaving(false);
    }
  }

  function toggleStaff(staffId) {
    const list = form.staff_involved.includes(staffId)
      ? form.staff_involved.filter(id => id !== staffId)
      : [...form.staff_involved, staffId];
    setForm({ ...form, staff_involved: list });
  }

  function focusField(fieldId) {
    if (typeof document === 'undefined') return;
    window.requestAnimationFrame(() => {
      const element = document.getElementById(fieldId);
      if (element?.focus) element.focus();
    });
  }

  function validateFormBeforeSave() {
    if (!form.date) return { tab: 'details', fieldId: 'incident-date', message: 'Date is required before you can save this incident.' };
    if (!form.type) return { tab: 'details', fieldId: 'incident-type', message: 'Incident type is required before you can save this incident.' };
    if (!form.severity) return { tab: 'details', fieldId: 'incident-severity', message: 'Severity is required before you can save this incident.' };
    if (form.cqc_notifiable && !form.cqc_notification_type) {
      return { tab: 'notifications', fieldId: 'incident-cqc-type', message: 'Select the CQC notification type before saving this incident.' };
    }
    if (form.riddor_reportable && !form.riddor_category) {
      return { tab: 'notifications', fieldId: 'incident-riddor-category', message: 'Select the RIDDOR category before saving this incident.' };
    }
    return null;
  }

  function handleExport() {
    const rows = filtered.map(inc => {
      const typeDef = incidentTypes.find(t => t.id === inc.type);
      const sevDef = SEVERITY_LEVELS.find(s => s.id === inc.severity);
      const statusDef = INVESTIGATION_STATUSES.find(s => s.id === inc.investigation_status);
      const witnessCount = (inc.witnesses || []).length;
      const actionsDone = (inc.corrective_actions || []).filter(a => a.status === 'completed').length;
      const actionsTotal = (inc.corrective_actions || []).length;
      return [
        inc.date, inc.time, typeDef?.name || inc.type, sevDef?.name || inc.severity,
        inc.person_affected, inc.person_affected_name, inc.description,
        inc.immediate_action, inc.medical_attention ? 'Yes' : 'No', witnessCount,
        inc.cqc_notifiable ? 'Yes' : 'No', inc.cqc_notified ? 'Yes' : 'No',
        inc.cqc_notified_date || '', inc.cqc_reference,
        inc.riddor_reportable ? 'Yes' : 'No', inc.riddor_reported ? 'Yes' : 'No',
        inc.safeguarding_referral ? 'Yes' : 'No',
        inc.duty_of_candour_applies ? 'Yes' : 'No', inc.candour_notification_date || '',
        inc.police_involved ? 'Yes' : 'No', inc.police_reference || '',
        statusDef?.name || inc.investigation_status, inc.investigation_lead || '',
        inc.root_cause, actionsTotal > 0 ? `${actionsDone}/${actionsTotal}` : '-',
      ];
    });
    downloadXLSX(`Incident_Register_${today}`, [{
      name: 'Incidents',
      headers: ['Date', 'Time', 'Type', 'Severity', 'Person', 'Person Name', 'Description',
        'Immediate Action', 'Medical', 'Witnesses',
        'CQC Notifiable', 'CQC Notified', 'CQC Date', 'CQC Ref',
        'RIDDOR', 'RIDDOR Reported', 'Safeguarding Referral',
        'Duty of Candour', 'DoC Date', 'Police', 'Police Ref',
        'Investigation', 'Lead', 'Root Cause', 'Actions'],
      rows,
    }]);
  }

  const sevBadge = (severity) => {
    const def = SEVERITY_LEVELS.find(s => s.id === severity);
    return def ? BADGE[def.badgeKey] : BADGE.gray;
  };
  const statusBadge = (status) => {
    const def = INVESTIGATION_STATUSES.find(s => s.id === status);
    return def ? BADGE[def.badgeKey] : BADGE.gray;
  };

  if (loading) return <div className={PAGE.container}><LoadingState message="Loading incidents..." card /></div>;

  return (
    <div className={PAGE.container}>
      {/* Header */}
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Incident & Safety Reporting</h1>
          <p className={PAGE.subtitle}>CQC Regulation 16/18, RIDDOR 2013</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExport} className={`${BTN.secondary} ${BTN.sm}`}>Export Excel</button>
          {canEdit && <button onClick={openAdd} className={BTN.primary}>+ New Incident</button>}
        </div>
      </div>

      {error && <ErrorState title="Unable to load incidents" message={error} onRetry={load} className="mb-4" />}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className={CARD.padded}>
          <div className="text-xs font-medium text-gray-500">Total Incidents</div>
          <div className="text-2xl font-bold text-gray-900 mt-0.5">{stats.total}</div>
          <div className="text-[10px] text-gray-400">Last 90 days</div>
        </div>
        <div className={`${CARD.padded} ${stats.openInvestigations > 0 ? 'border-red-200 bg-red-50' : ''}`}>
          <div className={`text-xs font-medium ${stats.openInvestigations > 0 ? 'text-red-600' : 'text-gray-500'}`}>Open Investigations</div>
          <div className={`text-2xl font-bold ${stats.openInvestigations > 0 ? 'text-red-700' : 'text-gray-900'} mt-0.5`}>{stats.openInvestigations}</div>
          <div className="text-[10px] text-gray-400">Require review</div>
        </div>
        <div className={`${CARD.padded} ${stats.overdueNotifications > 0 ? 'border-red-200 bg-red-50' : ''}`}>
          <div className={`text-xs font-medium ${stats.overdueNotifications > 0 ? 'text-red-600' : 'text-gray-500'}`}>Pending CQC</div>
          <div className={`text-2xl font-bold ${stats.overdueNotifications > 0 ? 'text-red-700' : 'text-gray-900'} mt-0.5`}>
            {stats.pendingCqcNotifications}
          </div>
          <div className="text-[10px] text-gray-400">{stats.overdueNotifications > 0 ? `${stats.overdueNotifications} overdue` : 'Notifications'}</div>
        </div>
        <div className={CARD.padded}>
          <div className="text-xs font-medium text-gray-500">Avg Response</div>
          <div className="text-2xl font-bold text-gray-900 mt-0.5">{stats.avgResponseTimeHours != null ? `${stats.avgResponseTimeHours}h` : '-'}</div>
          <div className="text-[10px] text-gray-400">CQC notification time</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4 print:hidden">
        <select className={`${INPUT.select} w-auto`} value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="">All Types</option>
          {INCIDENT_CATEGORIES.map(cat => (
            <optgroup key={cat.id} label={cat.name}>
              {incidentTypes.filter(t => t.category === cat.id).map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <select className={`${INPUT.select} w-auto`} value={filterSeverity} onChange={e => setFilterSeverity(e.target.value)}>
          <option value="">All Severities</option>
          {SEVERITY_LEVELS.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className={`${INPUT.select} w-auto`} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {INVESTIGATION_STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="text" className={`${INPUT.sm} w-48`} placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
        <span className="text-xs text-gray-400 self-center">{filtered.length} incidents</span>
      </div>

      {/* Incident Table */}
      <div className={CARD.flush}>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th scope="col" className={TABLE.th}>Date</th>
                <th scope="col" className={TABLE.th}>Time</th>
                <th scope="col" className={TABLE.th}>Type</th>
                <th scope="col" className={TABLE.th}>Severity</th>
                <th scope="col" className={TABLE.th}>Person</th>
                <th scope="col" className={TABLE.th}>Status</th>
                <th scope="col" className={TABLE.th}>CQC</th>
                <th scope="col" className={TABLE.th}>RIDDOR</th>
                <th scope="col" className={TABLE.th}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className={TABLE.empty}>
                    <EmptyState
                      compact
                      title="No incidents recorded yet"
                      description={canEdit ? 'Click "New Incident" to log the first incident for this home.' : 'No incidents have been logged for this home yet.'}
                      actionLabel={canEdit ? 'New Incident' : undefined}
                      onAction={canEdit ? openAdd : undefined}
                    />
                  </td>
                </tr>
              )}
              {filtered.map(inc => {
                const typeDef = incidentTypes.find(t => t.id === inc.type);
                const personDef = PERSON_AFFECTED_TYPES.find(p => p.id === inc.person_affected);
                const cqcOverdue = isCqcNotificationOverdue(inc);
                const riddorOverdue = isRiddorOverdue(inc);
                return (
                  <tr key={inc.id} className={`${TABLE.tr} ${canEdit ? 'cursor-pointer' : ''}`} {...clickableRowProps(() => canEdit && openEdit(inc))}>
                    <td className={TABLE.td}>{inc.date}</td>
                    <td className={TABLE.td}>{inc.time || '-'}</td>
                    <td className={TABLE.td}>{typeDef?.name || inc.type}</td>
                    <td className={TABLE.td}><span className={sevBadge(inc.severity)}>{SEVERITY_LEVELS.find(s => s.id === inc.severity)?.name || inc.severity}</span></td>
                    <td className={TABLE.td}>{personDef?.name || inc.person_affected}</td>
                    <td className={TABLE.td}><span className={statusBadge(inc.investigation_status)}>{INVESTIGATION_STATUSES.find(s => s.id === inc.investigation_status)?.name || inc.investigation_status}</span></td>
                    <td className={TABLE.td}>
                      {inc.cqc_notifiable ? (
                        inc.cqc_notified ? <span className={BADGE.green}>Sent</span>
                          : cqcOverdue ? <span className={BADGE.red}>OVERDUE</span>
                          : <span className={BADGE.amber}>Pending</span>
                      ) : <span className="text-gray-300">-</span>}
                    </td>
                    <td className={TABLE.td}>
                      {inc.riddor_reportable ? (
                        inc.riddor_reported ? <span className={BADGE.green}>Sent</span>
                          : riddorOverdue ? <span className={BADGE.red}>OVERDUE</span>
                          : <span className={BADGE.amber}>Pending</span>
                      ) : <span className="text-gray-300">-</span>}
                    </td>
                    <td className={TABLE.td}>
                      {inc.frozen_at && <span className={BADGE.purple} title={`Frozen ${inc.frozen_at.slice(0, 10)}`}>Frozen</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <IncidentTrackerModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        tabs={TABS}
        editingId={editingId}
        isFrozen={isFrozen}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        form={form}
        setForm={setForm}
        incidentTypes={incidentTypes}
        activeStaff={activeStaff}
        addenda={addenda}
        addendumText={addendumText}
        setAddendumText={setAddendumText}
        saving={saving}
        freezing={freezing}
        saveError={saveError}
        canEdit={canEdit}
        toggleStaff={toggleStaff}
        handleDelete={handleDelete}
        handleFreeze={handleFreeze}
        handleSave={handleSave}
        handleAddAddendum={handleAddAddendum}
      />
      {ConfirmDialog}
    </div>
  );
}
