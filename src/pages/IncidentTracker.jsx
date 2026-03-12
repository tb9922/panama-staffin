import { useState, useMemo, useEffect } from 'react';
import { CARD, BTN, BADGE, INPUT, MODAL, PAGE, TABLE } from '../lib/design.js';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import ModalWrapper from '../components/Modal.jsx';
import TabBar from '../components/TabBar.jsx';
import { useLiveDate } from '../hooks/useLiveDate.js';
import { downloadXLSX } from '../lib/excel.js';
import {
  getCurrentHome, getLoggedInUser,
  getIncidents, createIncident, updateIncident, deleteIncident,
  freezeIncident, getIncidentAddenda, addIncidentAddendum,
} from '../lib/api.js';
import {
  DEFAULT_INCIDENT_TYPES, getIncidentStats,
  SEVERITY_LEVELS, INVESTIGATION_STATUSES, LOCATIONS,
  CQC_NOTIFICATION_TYPES, RIDDOR_CATEGORIES, PERSON_AFFECTED_TYPES,
  INCIDENT_CATEGORIES, isCqcNotificationOverdue, isRiddorOverdue,
} from '../lib/incidents.js';
import { clickableRowProps } from '../lib/a11y.js';
import { useData } from '../contexts/DataContext.jsx';

const TABS = [
  { id: 'details', label: 'Details' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'investigation', label: 'Investigation' },
  { id: 'addenda', label: 'Notes' },
];

const EMPTY_FORM = {
  date: '', time: '', location: '', type: '', severity: 'minor',
  description: '', person_affected: 'resident', person_affected_name: '',
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [incidentTypes, setIncidentTypes] = useState([]);
  const [staff, setStaff] = useState([]);

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [activeTab, setActiveTab] = useState('details');
  const [isFrozen, setIsFrozen] = useState(false);
  const [addenda, setAddenda] = useState([]);
  const [addendumText, setAddendumText] = useState('');
  const [freezing, setFreezing] = useState(false);
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
    const d = new Date(today + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 89);
    return { from: d.toISOString().slice(0, 10), to: today };
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
    setShowModal(true);
  }

  function openEdit(inc) {
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
    });
    setActiveTab(inc.frozen_at ? 'addenda' : 'details');
    setShowModal(true);
    // Load addenda in background
    const home = getCurrentHome();
    if (home) getIncidentAddenda(home, inc.id).then(setAddenda).catch(e => console.warn('Failed to load addenda:', e.message));
  }

  async function handleFreeze() {
    if (!editingId) return;
    if (!confirm('Freeze this incident record? Once frozen, the incident details cannot be edited. You can still add notes.')) return;
    setFreezing(true);
    try {
      const home = getCurrentHome();
      await freezeIncident(home, editingId);
      setIsFrozen(true);
      await load();
    } catch (err) {
      alert(err.message || 'Failed to freeze incident');
    } finally {
      setFreezing(false);
    }
  }

  async function handleAddAddendum() {
    if (!editingId || !addendumText.trim()) return;
    try {
      const home = getCurrentHome();
      const result = await addIncidentAddendum(home, editingId, addendumText.trim());
      setAddenda(prev => [...prev, result]);
      setAddendumText('');
    } catch (err) {
      alert(err.message || 'Failed to add note');
    }
  }

  async function handleSave() {
    if (isFrozen) return;
    if (!form.date || !form.type || !form.severity) return;
    const home = getCurrentHome();
    const username = getLoggedInUser()?.username || 'admin';
    try {
      if (editingId) {
        await updateIncident(home, editingId, form);
      } else {
        await createIncident(home, { ...form, reported_by: username });
      }
      await load();
      setShowModal(false);
    } catch (err) {
      alert(err.message || 'Failed to save incident');
    }
  }

  async function handleDelete() {
    if (isFrozen) return;
    if (!editingId || !confirm('Delete this incident record?')) return;
    const home = getCurrentHome();
    try {
      await deleteIncident(home, editingId);
      await load();
      setShowModal(false);
    } catch (err) {
      alert(err.message || 'Failed to delete incident');
    }
  }

  function toggleStaff(staffId) {
    const list = form.staff_involved.includes(staffId)
      ? form.staff_involved.filter(id => id !== staffId)
      : [...form.staff_involved, staffId];
    setForm({ ...form, staff_involved: list });
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

  if (loading) return <div className="p-6 text-gray-400" role="status">Loading...</div>;

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

      {error && <div className="mb-4 text-red-600 text-sm" role="alert">{error}</div>}

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
                <tr><td colSpan={9} className={TABLE.empty}>No incidents recorded</td></tr>
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

      {/* Add/Edit Modal */}
      <ModalWrapper isOpen={showModal} onClose={() => setShowModal(false)} title={editingId ? (isFrozen ? 'Incident (Frozen)' : 'Edit Incident') : 'New Incident'} size="xl">
            {/* Frozen banner */}
            {isFrozen && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg px-3 py-2 mb-3 text-sm text-purple-700">
                This incident record is frozen and cannot be edited. Use the Notes tab to add post-freeze addenda.
              </div>
            )}
            {/* Tabs */}
            <TabBar tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />

            {/* Details Tab */}
            {activeTab === 'details' && (
              <fieldset disabled={isFrozen} className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className={INPUT.label}>Date *</label>
                    <input type="date" className={INPUT.base} value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
                  </div>
                  <div>
                    <label className={INPUT.label}>Time</label>
                    <input type="time" className={INPUT.base} value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} />
                  </div>
                  <div>
                    <label className={INPUT.label}>Location</label>
                    <select className={INPUT.select} value={form.location} onChange={e => setForm({ ...form, location: e.target.value })}>
                      <option value="">Select...</option>
                      {LOCATIONS.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={INPUT.label}>Incident Type *</label>
                    <select className={INPUT.select} value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                      <option value="">Select...</option>
                      {INCIDENT_CATEGORIES.map(cat => (
                        <optgroup key={cat.id} label={cat.name}>
                          {incidentTypes.filter(t => t.category === cat.id).map(t => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={INPUT.label}>Severity *</label>
                    <select className={INPUT.select} value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value })}>
                      {SEVERITY_LEVELS.map(s => <option key={s.id} value={s.id}>{s.name} — {s.description}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={INPUT.label}>Person Affected</label>
                    <select className={INPUT.select} value={form.person_affected} onChange={e => setForm({ ...form, person_affected: e.target.value })}>
                      {PERSON_AFFECTED_TYPES.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={INPUT.label}>Person Name</label>
                    <input type="text" className={INPUT.base} value={form.person_affected_name} onChange={e => setForm({ ...form, person_affected_name: e.target.value })} />
                  </div>
                </div>

                <fieldset>
                  <legend className={INPUT.label}>Staff Involved</legend>
                  <div className="border border-gray-200 rounded-lg max-h-32 overflow-y-auto p-2 space-y-1">
                    {activeStaff.map(s => (
                      <label key={s.id} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer hover:bg-gray-50 px-1 rounded">
                        <input type="checkbox" checked={form.staff_involved.includes(s.id)}
                          onChange={() => toggleStaff(s.id)} className="accent-blue-600" />
                        {s.name} <span className="text-xs text-gray-400">({s.role})</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div>
                  <label className={INPUT.label}>Description</label>
                  <textarea className={`${INPUT.base} h-20`} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
                </div>
                <div>
                  <label className={INPUT.label}>Immediate Action Taken</label>
                  <textarea className={`${INPUT.base} h-16`} value={form.immediate_action} onChange={e => setForm({ ...form, immediate_action: e.target.value })} />
                </div>

                <fieldset>
                  <legend className={INPUT.label}>Medical Response</legend>
                  <div className="flex gap-6">
                    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                      <input type="checkbox" checked={form.medical_attention} onChange={e => setForm({ ...form, medical_attention: e.target.checked })} className="accent-blue-600" />
                      Medical Attention Required
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                      <input type="checkbox" checked={form.hospital_attendance} onChange={e => setForm({ ...form, hospital_attendance: e.target.checked })} className="accent-blue-600" />
                      Hospital Attendance
                    </label>
                  </div>
                </fieldset>

                {/* Witnesses */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className={INPUT.label}>Witnesses</label>
                    <button type="button" className={`${BTN.ghost} ${BTN.xs}`}
                      onClick={() => setForm({ ...form, witnesses: [...form.witnesses, { name: '', role: '', statement_summary: '' }] })}>
                      + Add Witness
                    </button>
                  </div>
                  {form.witnesses.length === 0 && <p className="text-xs text-gray-400">No witnesses recorded</p>}
                  {form.witnesses.map((w, i) => (
                    <div key={i} className="border border-gray-200 rounded-lg p-2 mb-2 space-y-1.5">
                      <div className="flex gap-2">
                        <input type="text" className={INPUT.sm} placeholder="Name" value={w.name}
                          onChange={e => { const ws = [...form.witnesses]; ws[i] = { ...ws[i], name: e.target.value }; setForm({ ...form, witnesses: ws }); }} />
                        <input type="text" className={`${INPUT.sm} w-32`} placeholder="Role" value={w.role}
                          onChange={e => { const ws = [...form.witnesses]; ws[i] = { ...ws[i], role: e.target.value }; setForm({ ...form, witnesses: ws }); }} />
                        <button type="button" className="text-red-400 hover:text-red-600 text-xs px-1"
                          onClick={() => setForm({ ...form, witnesses: form.witnesses.filter((_, j) => j !== i) })}>Remove</button>
                      </div>
                      <textarea className={`${INPUT.sm} h-12`} placeholder="Statement summary..."
                        value={w.statement_summary}
                        onChange={e => { const ws = [...form.witnesses]; ws[i] = { ...ws[i], statement_summary: e.target.value }; setForm({ ...form, witnesses: ws }); }} />
                    </div>
                  ))}
                </div>
              </fieldset>
            )}

            {/* Notifications Tab */}
            {activeTab === 'notifications' && (
              <fieldset disabled={isFrozen} className="space-y-5">
                {/* CQC */}
                <div>
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">CQC Notification (Regulation 16/18)</div>
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer mb-2">
                    <input type="checkbox" checked={form.cqc_notifiable} onChange={e => setForm({ ...form, cqc_notifiable: e.target.checked })} className="accent-blue-600" />
                    This incident is CQC notifiable
                  </label>
                  {form.cqc_notifiable && (
                    <div className="ml-6 space-y-2">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className={INPUT.label}>Notification Type</label>
                          <select className={INPUT.select} value={form.cqc_notification_type}
                            onChange={e => {
                              const t = CQC_NOTIFICATION_TYPES.find(n => n.id === e.target.value);
                              setForm({ ...form, cqc_notification_type: e.target.value, cqc_notification_deadline: t?.deadline || '' });
                            }}>
                            <option value="">Select...</option>
                            {CQC_NOTIFICATION_TYPES.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className={INPUT.label}>Deadline</label>
                          <input type="text" className={INPUT.base} readOnly
                            value={form.cqc_notification_deadline === 'immediate' ? 'Immediate (24 hours)' : form.cqc_notification_deadline === '72h' ? 'Within 72 hours' : '-'} />
                        </div>
                      </div>
                      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                        <input type="checkbox" checked={form.cqc_notified} onChange={e => setForm({ ...form, cqc_notified: e.target.checked })} className="accent-blue-600" />
                        CQC has been notified
                      </label>
                      {form.cqc_notified && (
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className={INPUT.label}>Date Notified</label>
                            <input type="date" className={INPUT.base} value={form.cqc_notified_date} onChange={e => setForm({ ...form, cqc_notified_date: e.target.value })} />
                          </div>
                          <div>
                            <label className={INPUT.label}>CQC Reference</label>
                            <input type="text" className={INPUT.base} value={form.cqc_reference} onChange={e => setForm({ ...form, cqc_reference: e.target.value })} />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* RIDDOR */}
                <div>
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">RIDDOR (HSE Reporting)</div>
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer mb-2">
                    <input type="checkbox" checked={form.riddor_reportable} onChange={e => setForm({ ...form, riddor_reportable: e.target.checked })} className="accent-blue-600" />
                    This incident is RIDDOR reportable
                  </label>
                  {form.riddor_reportable && (
                    <div className="ml-6 space-y-2">
                      <div>
                        <label className={INPUT.label}>RIDDOR Category</label>
                        <select className={INPUT.select} value={form.riddor_category} onChange={e => setForm({ ...form, riddor_category: e.target.value })}>
                          <option value="">Select...</option>
                          {RIDDOR_CATEGORIES.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                      </div>
                      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                        <input type="checkbox" checked={form.riddor_reported} onChange={e => setForm({ ...form, riddor_reported: e.target.checked })} className="accent-blue-600" />
                        Reported to HSE
                      </label>
                      {form.riddor_reported && (
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className={INPUT.label}>Date Reported</label>
                            <input type="date" className={INPUT.base} value={form.riddor_reported_date} onChange={e => setForm({ ...form, riddor_reported_date: e.target.value })} />
                          </div>
                          <div>
                            <label className={INPUT.label}>HSE F2508 Reference</label>
                            <input type="text" className={INPUT.base} value={form.riddor_reference} onChange={e => setForm({ ...form, riddor_reference: e.target.value })} />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Safeguarding */}
                <div>
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Safeguarding Referral</div>
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer mb-2">
                    <input type="checkbox" checked={form.safeguarding_referral} onChange={e => setForm({ ...form, safeguarding_referral: e.target.checked })} className="accent-blue-600" />
                    Safeguarding referral made
                  </label>
                  {form.safeguarding_referral && (
                    <div className="ml-6 space-y-3">
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className={INPUT.label}>Referred To</label>
                          <input type="text" className={INPUT.base} placeholder="e.g. Local Authority" value={form.safeguarding_to} onChange={e => setForm({ ...form, safeguarding_to: e.target.value })} />
                        </div>
                        <div>
                          <label className={INPUT.label}>Reference</label>
                          <input type="text" className={INPUT.base} value={form.safeguarding_reference} onChange={e => setForm({ ...form, safeguarding_reference: e.target.value })} />
                        </div>
                        <div>
                          <label className={INPUT.label}>Date</label>
                          <input type="date" className={INPUT.base} value={form.safeguarding_date} onChange={e => setForm({ ...form, safeguarding_date: e.target.value })} />
                        </div>
                      </div>
                      {/* Making Safeguarding Personal */}
                      <div className="border-t border-gray-100 pt-2">
                        <div className="text-xs font-medium text-gray-500 mb-1.5">Making Safeguarding Personal</div>
                        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer mb-1.5">
                          <input type="checkbox" checked={form.msp_wishes_recorded} onChange={e => setForm({ ...form, msp_wishes_recorded: e.target.checked })} className="accent-blue-600" />
                          Person's wishes and outcomes recorded
                        </label>
                        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer mb-1.5">
                          <input type="checkbox" checked={form.msp_person_involved} onChange={e => setForm({ ...form, msp_person_involved: e.target.checked })} className="accent-blue-600" />
                          Person / representative involved in safeguarding response
                        </label>
                        {form.msp_wishes_recorded && (
                          <div>
                            <label className={INPUT.label}>Outcome Preferences</label>
                            <textarea className={`${INPUT.base} h-14`} placeholder="What outcome does the person want?" value={form.msp_outcome_preferences} onChange={e => setForm({ ...form, msp_outcome_preferences: e.target.value })} />
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Duty of Candour */}
                <div>
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Duty of Candour (Regulation 20)</div>
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer mb-2">
                    <input type="checkbox" checked={form.duty_of_candour_applies} onChange={e => setForm({ ...form, duty_of_candour_applies: e.target.checked })} className="accent-blue-600" />
                    Duty of Candour applies to this incident
                  </label>
                  {form.duty_of_candour_applies && (
                    <div className="ml-6 space-y-2">
                      <div>
                        <label className={INPUT.label}>Recipient (Person / Family)</label>
                        <input type="text" className={INPUT.base} placeholder="Name of person or family notified" value={form.candour_recipient} onChange={e => setForm({ ...form, candour_recipient: e.target.value })} />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className={INPUT.label}>Verbal Notification Date</label>
                          <input type="date" className={INPUT.base} value={form.candour_notification_date} onChange={e => setForm({ ...form, candour_notification_date: e.target.value })} />
                        </div>
                        <div>
                          <label className={INPUT.label}>Written Follow-up Sent</label>
                          <input type="date" className={INPUT.base} value={form.candour_letter_sent_date} onChange={e => setForm({ ...form, candour_letter_sent_date: e.target.value })} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Police Referral */}
                <div>
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Police Referral</div>
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer mb-2">
                    <input type="checkbox" checked={form.police_involved} onChange={e => setForm({ ...form, police_involved: e.target.checked })} className="accent-blue-600" />
                    Police involved in this incident
                  </label>
                  {form.police_involved && (
                    <div className="ml-6 grid grid-cols-2 gap-3">
                      <div>
                        <label className={INPUT.label}>Crime / Incident Reference</label>
                        <input type="text" className={INPUT.base} value={form.police_reference} onChange={e => setForm({ ...form, police_reference: e.target.value })} />
                      </div>
                      <div>
                        <label className={INPUT.label}>Date Contacted</label>
                        <input type="date" className={INPUT.base} value={form.police_contact_date} onChange={e => setForm({ ...form, police_contact_date: e.target.value })} />
                      </div>
                    </div>
                  )}
                </div>
              </fieldset>
            )}

            {/* Investigation Tab */}
            {activeTab === 'investigation' && (
              <fieldset disabled={isFrozen} className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <label className={INPUT.label}>Status</label>
                    <select className={INPUT.select} value={form.investigation_status} onChange={e => setForm({ ...form, investigation_status: e.target.value })}>
                      {INVESTIGATION_STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={INPUT.label}>Start Date</label>
                    <input type="date" className={INPUT.base} value={form.investigation_start_date} onChange={e => setForm({ ...form, investigation_start_date: e.target.value })} />
                  </div>
                  <div>
                    <label className={INPUT.label}>Investigation Lead</label>
                    <input type="text" className={INPUT.base} placeholder="Name" value={form.investigation_lead} onChange={e => setForm({ ...form, investigation_lead: e.target.value })} />
                  </div>
                  {form.investigation_status === 'closed' ? (
                    <div>
                      <label className={INPUT.label}>Closed Date</label>
                      <input type="date" className={INPUT.base} value={form.investigation_closed_date} onChange={e => setForm({ ...form, investigation_closed_date: e.target.value })} />
                    </div>
                  ) : (
                    <div>
                      <label className={INPUT.label}>Review Date</label>
                      <input type="date" className={INPUT.base} value={form.investigation_review_date} onChange={e => setForm({ ...form, investigation_review_date: e.target.value })} />
                    </div>
                  )}
                </div>
                <div>
                  <label className={INPUT.label}>Root Cause Analysis</label>
                  <textarea className={`${INPUT.base} h-20`} placeholder="What was the root cause?" value={form.root_cause} onChange={e => setForm({ ...form, root_cause: e.target.value })} />
                </div>

                {/* Corrective Actions */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className={INPUT.label}>Corrective Actions</label>
                    <button type="button" className={`${BTN.ghost} ${BTN.xs}`}
                      onClick={() => setForm({ ...form, corrective_actions: [...form.corrective_actions, { description: '', assigned_to: '', due_date: '', completed_date: '', status: 'pending' }] })}>
                      + Add Action
                    </button>
                  </div>
                  {form.corrective_actions.length === 0 && <p className="text-xs text-gray-400">No corrective actions recorded</p>}
                  {form.corrective_actions.map((action, i) => (
                    <div key={i} className="border border-gray-200 rounded-lg p-2 mb-2 space-y-1.5">
                      <div className="flex gap-2">
                        <input type="text" className={`${INPUT.sm} flex-1`} placeholder="Action description" value={action.description}
                          onChange={e => { const a = [...form.corrective_actions]; a[i] = { ...a[i], description: e.target.value }; setForm({ ...form, corrective_actions: a }); }} />
                        <button type="button" className="text-red-400 hover:text-red-600 text-xs px-1"
                          onClick={() => setForm({ ...form, corrective_actions: form.corrective_actions.filter((_, j) => j !== i) })}>Remove</button>
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        <input type="text" className={INPUT.sm} placeholder="Assigned to" value={action.assigned_to}
                          onChange={e => { const a = [...form.corrective_actions]; a[i] = { ...a[i], assigned_to: e.target.value }; setForm({ ...form, corrective_actions: a }); }} />
                        <input type="date" className={INPUT.sm} title="Due date" value={action.due_date}
                          onChange={e => { const a = [...form.corrective_actions]; a[i] = { ...a[i], due_date: e.target.value }; setForm({ ...form, corrective_actions: a }); }} />
                        <input type="date" className={INPUT.sm} title="Completed date" value={action.completed_date}
                          onChange={e => { const a = [...form.corrective_actions]; a[i] = { ...a[i], completed_date: e.target.value }; setForm({ ...form, corrective_actions: a }); }} />
                        <select className={INPUT.sm} value={action.status}
                          onChange={e => { const a = [...form.corrective_actions]; a[i] = { ...a[i], status: e.target.value }; setForm({ ...form, corrective_actions: a }); }}>
                          <option value="pending">Pending</option>
                          <option value="in_progress">In Progress</option>
                          <option value="completed">Completed</option>
                        </select>
                      </div>
                    </div>
                  ))}
                </div>

                <div>
                  <label className={INPUT.label}>Lessons Learned</label>
                  <textarea className={`${INPUT.base} h-16`} placeholder="Key learnings..." value={form.lessons_learned} onChange={e => setForm({ ...form, lessons_learned: e.target.value })} />
                </div>
              </fieldset>
            )}

            {/* Addenda / Notes Tab */}
            {activeTab === 'addenda' && (
              <div className="space-y-3">
                {addenda.length === 0 && <p className="text-xs text-gray-400">No addenda recorded</p>}
                {addenda.map(a => (
                  <div key={a.id} className="border border-gray-200 rounded-lg p-3">
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span className="font-medium text-gray-600">{a.author}</span>
                      <span>{a.created_at ? new Date(a.created_at).toLocaleString('en-GB') : ''}</span>
                    </div>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{a.content}</p>
                  </div>
                ))}
                <div>
                  <label className={INPUT.label}>Add Note</label>
                  <textarea className={`${INPUT.base} h-20`} placeholder="Post-event note, update, or correction..."
                    value={addendumText} onChange={e => setAddendumText(e.target.value)} />
                  <button onClick={handleAddAddendum} disabled={!addendumText.trim()}
                    className={`${BTN.primary} ${BTN.sm} mt-2`}>Add Note</button>
                </div>
              </div>
            )}

            {/* Footer */}
            <div className={MODAL.footer}>
              {canEdit && editingId && !isFrozen && (
                <button onClick={handleDelete} className={`${BTN.danger} ${BTN.sm} mr-auto`}>Delete</button>
              )}
              {canEdit && editingId && !isFrozen && (form.cqc_notified || form.safeguarding_referral || form.investigation_status === 'closed') && (
                <button onClick={handleFreeze} disabled={freezing} className={`${BTN.secondary} ${BTN.sm}`}>
                  {freezing ? 'Freezing...' : 'Freeze Record'}
                </button>
              )}
              <div className="flex-1" />
              <button onClick={() => setShowModal(false)} className={BTN.ghost}>Close</button>
              {canEdit && !isFrozen && (
                <button onClick={handleSave} disabled={!form.date || !form.type || !form.severity} className={BTN.primary}>
                  {editingId ? 'Update' : 'Save'}
                </button>
              )}
            </div>
      </ModalWrapper>
    </div>
  );
}
