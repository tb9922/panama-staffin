import { useState, useMemo, useEffect, useCallback } from 'react';
import { useConfirm } from '../hooks/useConfirm.jsx';
import { CARD, BTN, BADGE, INPUT, MODAL, PAGE, TABLE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import TabBar from '../components/TabBar.jsx';
import { useLiveDate } from '../hooks/useLiveDate.js';
import { downloadXLSX } from '../lib/excel.js';
import FileAttachments from '../components/FileAttachments.jsx';
import {
  getCurrentHome, getWhistleblowingConcerns, createWhistleblowingConcern,
  updateWhistleblowingConcern, deleteWhistleblowingConcern,
  getRecordAttachments, uploadRecordAttachment, deleteRecordAttachment, downloadRecordAttachment,
} from '../lib/api.js';
import {
  getWhistleblowingStats,
  CONCERN_CATEGORIES, CONCERN_SEVERITIES, CONCERN_STATUSES,
  CONCERN_OUTCOMES, REPORTER_ROLES,
} from '../lib/whistleblowing.js';
import { clickableRowProps } from '../lib/a11y.js';
import useDirtyGuard from '../hooks/useDirtyGuard';
import { useData } from '../contexts/DataContext.jsx';

const TABS = [
  { id: 'details', label: 'Concern Details' },
  { id: 'investigation', label: 'Investigation & Outcome' },
];

const EMPTY_FORM = {
  date_raised: '', raised_by_role: '', anonymous: false,
  category: '', description: '', severity: 'low',
  status: 'registered', acknowledgement_date: '',
  investigator: '', investigation_start_date: '', findings: '',
  outcome: '', outcome_details: '',
  reporter_protected: false, protection_details: '',
  follow_up_date: '', follow_up_completed: false,
  resolution_date: '', lessons_learned: '',
};

export default function WhistleblowingTracker() {
  const { canWrite } = useData();
  const canEdit = canWrite('governance');
  const { confirm, ConfirmDialog } = useConfirm();
  const [concerns, setConcerns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  useDirtyGuard(showModal);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [activeTab, setActiveTab] = useState('details');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [saveError, setSaveError] = useState(null);

  const today = useLiveDate();
  const homeSlug = getCurrentHome();

  const load = useCallback(async () => {
    if (!homeSlug) return;
    try {
      setError(null);
      const result = await getWhistleblowingConcerns(homeSlug);
      setConcerns(result.concerns || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [homeSlug]);

  useEffect(() => { load(); }, [load]);

  // Date range for stats: last 90 days
  const statsRange = useMemo(() => {
    const d = new Date(today + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 89);
    return { from: d.toISOString().slice(0, 10), to: today };
  }, [today]);

  const stats = useMemo(() =>
    getWhistleblowingStats(concerns, statsRange.from, statsRange.to),
    [concerns, statsRange]);

  const filtered = useMemo(() => {
    let list = [...concerns].sort((a, b) => (b.date_raised || '').localeCompare(a.date_raised || ''));
    if (filterCategory) list = list.filter(c => c.category === filterCategory);
    if (filterSeverity) list = list.filter(c => c.severity === filterSeverity);
    if (filterStatus) list = list.filter(c => c.status === filterStatus);
    return list;
  }, [concerns, filterCategory, filterSeverity, filterStatus]);

  function openAdd() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, date_raised: today });
    setActiveTab('details');
    setSaveError(null);
    setShowModal(true);
  }

  function openEdit(concern) {
    setEditingId(concern.id);
    setForm({
      date_raised: concern.date_raised || '',
      raised_by_role: concern.raised_by_role || '',
      anonymous: !!concern.anonymous,
      category: concern.category || '',
      description: concern.description || '',
      severity: concern.severity || 'low',
      status: concern.status || 'registered',
      acknowledgement_date: concern.acknowledgement_date || '',
      investigator: concern.investigator || '',
      investigation_start_date: concern.investigation_start_date || '',
      findings: concern.findings || '',
      outcome: concern.outcome || '',
      outcome_details: concern.outcome_details || '',
      reporter_protected: !!concern.reporter_protected,
      protection_details: concern.protection_details || '',
      follow_up_date: concern.follow_up_date || '',
      follow_up_completed: !!concern.follow_up_completed,
      resolution_date: concern.resolution_date || '',
      lessons_learned: concern.lessons_learned || '',
      _version: concern.version,
    });
    setActiveTab('details');
    setSaveError(null);
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.date_raised || !form.category || !form.severity) return;
    try {
      if (editingId) {
        await updateWhistleblowingConcern(homeSlug, editingId, { ...form, _version: form._version });
      } else {
        await createWhistleblowingConcern(homeSlug, form);
      }
      setShowModal(false);
      await load();
    } catch (err) {
      setSaveError('Failed to save: ' + err.message);
    }
  }

  async function handleDelete() {
    if (!editingId) return;
    if (!await confirm('Delete this whistleblowing concern?')) return;
    try {
      await deleteWhistleblowingConcern(homeSlug, editingId);
      setShowModal(false);
      await load();
    } catch (err) {
      setSaveError('Failed to delete: ' + err.message);
    }
  }

  function handleExport() {
    const rows = filtered.map(c => {
      const catDef = CONCERN_CATEGORIES.find(cat => cat.id === c.category);
      const sevDef = CONCERN_SEVERITIES.find(s => s.id === c.severity);
      const statusDef = CONCERN_STATUSES.find(s => s.id === c.status);
      const outcomeDef = CONCERN_OUTCOMES.find(o => o.id === c.outcome);
      const roleDef = REPORTER_ROLES.find(r => r.id === c.raised_by_role);
      return [
        c.date_raised,
        catDef?.name || c.category,
        sevDef?.name || c.severity,
        c.anonymous ? 'Anonymous' : (roleDef?.name || c.raised_by_role || '-'),
        statusDef?.name || c.status,
        c.description,
        c.acknowledgement_date || '-',
        c.investigator || '-',
        c.investigation_start_date || '-',
        c.findings || '-',
        outcomeDef?.name || c.outcome || '-',
        c.outcome_details || '-',
        c.anonymous ? '-' : (c.reporter_protected ? 'Yes' : 'No'),
        c.follow_up_date || '-',
        c.follow_up_completed ? 'Yes' : 'No',
        c.resolution_date || '-',
        c.lessons_learned || '-',
      ];
    });
    downloadXLSX(`Whistleblowing_Register_${today}`, [{
      name: 'Concerns',
      headers: ['Date Raised', 'Category', 'Severity', 'Reporter', 'Status',
        'Description', 'Acknowledged', 'Investigator', 'Investigation Start',
        'Findings', 'Outcome', 'Outcome Details', 'Reporter Protected',
        'Follow-Up Date', 'Follow-Up Done', 'Resolution Date', 'Lessons Learned'],
      rows,
    }]);
  }

  const sevBadge = (severity) => {
    const def = CONCERN_SEVERITIES.find(s => s.id === severity);
    return def ? BADGE[def.badgeKey] : BADGE.gray;
  };
  const statusBadge = (status) => {
    const def = CONCERN_STATUSES.find(s => s.id === status);
    return def ? BADGE[def.badgeKey] : BADGE.gray;
  };

  if (loading) {
    return <div className={PAGE.container}><p className="text-gray-400">Loading...</p></div>;
  }
  if (error) {
    return <div className={PAGE.container}><p className="text-red-500">Error: {error}</p></div>;
  }

  return (
    <div className={PAGE.container}>
      {/* Header */}
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Whistleblowing / Freedom to Speak Up</h1>
          <p className={PAGE.subtitle}>CQC Regulation 17 — QS29</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExport} className={`${BTN.secondary} ${BTN.sm}`}>Export Excel</button>
          {canEdit && <button onClick={openAdd} className={BTN.primary}>+ New Concern</button>}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className={CARD.padded}>
          <div className="text-xs font-medium text-gray-500">Total Concerns</div>
          <div className="text-2xl font-bold text-gray-900 mt-0.5">{stats.total}</div>
          <div className="text-[10px] text-gray-400">Last 90 days</div>
        </div>
        <div className={`${CARD.padded} ${stats.open > 0 ? 'border-red-200 bg-red-50' : ''}`}>
          <div className={`text-xs font-medium ${stats.open > 0 ? 'text-red-600' : 'text-gray-500'}`}>Open</div>
          <div className={`text-2xl font-bold ${stats.open > 0 ? 'text-red-700' : 'text-gray-900'} mt-0.5`}>{stats.open}</div>
          <div className="text-[10px] text-gray-400">Require action</div>
        </div>
        <div className={CARD.padded}>
          <div className="text-xs font-medium text-gray-500">Avg Investigation Days</div>
          <div className="text-2xl font-bold text-gray-900 mt-0.5">{stats.avgInvestigationDays != null ? stats.avgInvestigationDays : '-'}</div>
          <div className="text-[10px] text-gray-400">Resolved concerns</div>
        </div>
        <div className={CARD.padded}>
          <div className="text-xs font-medium text-gray-500">Protection Rate</div>
          <div className="text-2xl font-bold text-gray-900 mt-0.5">{stats.protectionRate != null ? `${stats.protectionRate}%` : '-'}</div>
          <div className="text-[10px] text-gray-400">Non-anonymous reporters</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4 print:hidden">
        <select className={`${INPUT.select} w-auto`} value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
          <option value="">All Categories</option>
          {CONCERN_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className={`${INPUT.select} w-auto`} value={filterSeverity} onChange={e => setFilterSeverity(e.target.value)}>
          <option value="">All Severities</option>
          {CONCERN_SEVERITIES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className={`${INPUT.select} w-auto`} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {CONCERN_STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <span className="text-xs text-gray-400 self-center">{filtered.length} concerns</span>
      </div>

      {/* Concerns Table */}
      <div className={CARD.flush}>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th scope="col" className={TABLE.th}>Date</th>
                <th scope="col" className={TABLE.th}>Category</th>
                <th scope="col" className={TABLE.th}>Severity</th>
                <th scope="col" className={TABLE.th}>Reporter</th>
                <th scope="col" className={TABLE.th}>Status</th>
                <th scope="col" className={TABLE.th}>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={6} className={TABLE.empty}>No concerns recorded</td></tr>
              )}
              {filtered.map(concern => {
                const catDef = CONCERN_CATEGORIES.find(c => c.id === concern.category);
                const outcomeDef = CONCERN_OUTCOMES.find(o => o.id === concern.outcome);
                const roleDef = REPORTER_ROLES.find(r => r.id === concern.raised_by_role);
                return (
                  <tr key={concern.id} className={`${TABLE.tr} ${canEdit ? 'cursor-pointer' : ''}`} {...clickableRowProps(() => canEdit && openEdit(concern))}>
                    <td className={TABLE.td}>{concern.date_raised}</td>
                    <td className={TABLE.td}>{catDef?.name || concern.category}</td>
                    <td className={TABLE.td}>
                      <span className={sevBadge(concern.severity)}>
                        {CONCERN_SEVERITIES.find(s => s.id === concern.severity)?.name || concern.severity}
                      </span>
                    </td>
                    <td className={TABLE.td}>
                      {concern.anonymous
                        ? <span className={BADGE.purple}>Anonymous</span>
                        : <span className="text-sm text-gray-700">{roleDef?.name || concern.raised_by_role || '-'}</span>}
                    </td>
                    <td className={TABLE.td}>
                      <span className={statusBadge(concern.status)}>
                        {CONCERN_STATUSES.find(s => s.id === concern.status)?.name || concern.status}
                      </span>
                    </td>
                    <td className={TABLE.td}>{outcomeDef?.name || concern.outcome || <span className="text-gray-300">-</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editingId ? 'Edit Concern' : 'New Concern'} size="lg">
          <div className="max-h-[75vh] overflow-y-auto">
            {/* Tabs */}
            <TabBar tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />

            {/* Concern Details Tab */}
            {activeTab === 'details' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={INPUT.label}>Date Raised *</label>
                    <input type="date" className={INPUT.base} value={form.date_raised} onChange={e => setForm({ ...form, date_raised: e.target.value })} />
                  </div>
                  <div>
                    <label className={INPUT.label}>Acknowledgement Date</label>
                    <input type="date" className={INPUT.base} value={form.acknowledgement_date} onChange={e => setForm({ ...form, acknowledgement_date: e.target.value })} />
                  </div>
                </div>

                <div>
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer mb-2">
                    <input type="checkbox" checked={form.anonymous} onChange={e => setForm({ ...form, anonymous: e.target.checked })} className="accent-blue-600" />
                    Anonymous concern
                  </label>
                </div>

                {!form.anonymous && (
                  <div>
                    <label className={INPUT.label}>Reporter Role</label>
                    <select className={INPUT.select} value={form.raised_by_role} onChange={e => setForm({ ...form, raised_by_role: e.target.value })}>
                      <option value="">Select...</option>
                      {REPORTER_ROLES.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={INPUT.label}>Category *</label>
                    <select className={INPUT.select} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                      <option value="">Select...</option>
                      {CONCERN_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={INPUT.label}>Severity *</label>
                    <select className={INPUT.select} value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value })}>
                      {CONCERN_SEVERITIES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className={INPUT.label}>Description</label>
                  <textarea className={`${INPUT.base} h-24`} placeholder="Describe the concern in detail..." value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
                </div>
              </div>
            )}

            {/* Investigation & Outcome Tab */}
            {activeTab === 'investigation' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={INPUT.label}>Status</label>
                    <select className={INPUT.select} value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                      {CONCERN_STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={INPUT.label}>Investigator</label>
                    <input type="text" className={INPUT.base} placeholder="Name" value={form.investigator} onChange={e => setForm({ ...form, investigator: e.target.value })} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={INPUT.label}>Investigation Start Date</label>
                    <input type="date" className={INPUT.base} value={form.investigation_start_date} onChange={e => setForm({ ...form, investigation_start_date: e.target.value })} />
                  </div>
                  <div>
                    <label className={INPUT.label}>Resolution Date</label>
                    <input type="date" className={INPUT.base} value={form.resolution_date} onChange={e => setForm({ ...form, resolution_date: e.target.value })} />
                  </div>
                </div>

                <div>
                  <label className={INPUT.label}>Findings</label>
                  <textarea className={`${INPUT.base} h-20`} placeholder="Investigation findings..." value={form.findings} onChange={e => setForm({ ...form, findings: e.target.value })} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={INPUT.label}>Outcome</label>
                    <select className={INPUT.select} value={form.outcome} onChange={e => setForm({ ...form, outcome: e.target.value })}>
                      <option value="">Select...</option>
                      {CONCERN_OUTCOMES.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={INPUT.label}>Outcome Details</label>
                    <input type="text" className={INPUT.base} placeholder="Details..." value={form.outcome_details} onChange={e => setForm({ ...form, outcome_details: e.target.value })} />
                  </div>
                </div>

                {/* Reporter Protection */}
                <div className="border-t border-gray-100 pt-3">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Reporter Protection</div>
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer mb-2">
                    <input type="checkbox" checked={form.reporter_protected} onChange={e => setForm({ ...form, reporter_protected: e.target.checked })} className="accent-blue-600" />
                    Reporter protection measures in place
                  </label>
                  {form.reporter_protected && (
                    <div>
                      <label className={INPUT.label}>Protection Details</label>
                      <textarea className={`${INPUT.base} h-14`} placeholder="Describe protection measures..." value={form.protection_details} onChange={e => setForm({ ...form, protection_details: e.target.value })} />
                    </div>
                  )}
                </div>

                {/* Follow-up */}
                <div className="border-t border-gray-100 pt-3">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Follow-Up</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={INPUT.label}>Follow-Up Date</label>
                      <input type="date" className={INPUT.base} value={form.follow_up_date} onChange={e => setForm({ ...form, follow_up_date: e.target.value })} />
                    </div>
                    <div className="flex items-end pb-2">
                      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                        <input type="checkbox" checked={form.follow_up_completed} onChange={e => setForm({ ...form, follow_up_completed: e.target.checked })} className="accent-blue-600" />
                        Follow-up completed
                      </label>
                    </div>
                  </div>
                </div>

                <div>
                  <label className={INPUT.label}>Lessons Learned</label>
                  <textarea className={`${INPUT.base} h-16`} placeholder="Key learnings..." value={form.lessons_learned} onChange={e => setForm({ ...form, lessons_learned: e.target.value })} />
                </div>
              </div>
            )}

            <div className="mt-4 border-t border-gray-100 pt-4">
              <FileAttachments
                caseType="whistleblowing"
                caseId={editingId}
                readOnly={!canEdit}
                getFiles={getRecordAttachments}
                uploadFile={uploadRecordAttachment}
                deleteFile={deleteRecordAttachment}
                downloadFile={downloadRecordAttachment}
                title="Concern Evidence"
                emptyText="No supporting evidence uploaded yet."
                saveFirstMessage="Save the concern first to attach supporting evidence."
              />
            </div>

          </div>
            {/* Footer */}
            <div className={MODAL.footer}>
              {editingId && canEdit && (
                <button onClick={handleDelete} className={`${BTN.danger} ${BTN.sm} mr-auto`}>Delete</button>
              )}
              {saveError && <p className="text-sm text-red-600 mr-auto">{saveError}</p>}
              <button onClick={() => setShowModal(false)} className={BTN.ghost}>Cancel</button>
              {canEdit && (
                <button onClick={handleSave} disabled={!form.date_raised || !form.category || !form.severity} className={BTN.primary}>
                  {editingId ? 'Update' : 'Save'}
                </button>
              )}
            </div>
      </Modal>
      {ConfirmDialog}
    </div>
  );
}
