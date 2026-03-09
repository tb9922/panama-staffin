import { useState, useMemo, useEffect } from 'react';
import { CARD, BTN, BADGE, INPUT, MODAL, PAGE, TABLE } from '../lib/design.js';
import { formatDate } from '../lib/rotation.js';
import { useLiveDate } from '../hooks/useLiveDate.js';
import { downloadXLSX } from '../lib/excel.js';
import Modal from '../components/Modal.jsx';
import TabBar from '../components/TabBar.jsx';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import {
  DEFAULT_COMPLAINT_CATEGORIES, getComplaintStats, getSurveyStats,
  getComplaintStatus, COMPLAINT_STATUSES, RAISED_BY_TYPES, SURVEY_TYPES,
} from '../lib/complaints.js';
import {
  getCurrentHome, getComplaints, createComplaint, updateComplaint, deleteComplaint,
  createComplaintSurvey, updateComplaintSurvey, deleteComplaintSurvey, getLoggedInUser,
} from '../lib/api.js';

const TABS = [
  { id: 'details', label: 'Details' },
  { id: 'investigation', label: 'Investigation' },
  { id: 'resolution', label: 'Resolution' },
];

const EMPTY_FORM = {
  date: '', raised_by: 'resident', raised_by_name: '', category: '',
  title: '', description: '',
  acknowledged_date: '', response_deadline: '', status: 'open',
  investigator: '', investigation_notes: '',
  resolution: '', resolution_date: '', outcome_shared: false,
  root_cause: '', improvements: '', lessons_learned: '',
  reported_by: '',
};

const EMPTY_SURVEY = {
  type: 'residents', date: '', title: '', total_sent: '',
  responses: '', overall_satisfaction: '', key_feedback: '', actions: '',
  conducted_by: '',
};

export default function ComplaintsTracker() {
  const isAdmin = getLoggedInUser()?.role === 'admin';
  const [complaints, setComplaints] = useState([]);
  const [surveys, setSurveys] = useState([]);
  const [complaintCategories, setComplaintCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [activeTab, setActiveTab] = useState('details');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch] = useState('');
  const [showSurveyModal, setShowSurveyModal] = useState(false);
  const [editingSurveyId, setEditingSurveyId] = useState(null);
  const [surveyForm, setSurveyForm] = useState({ ...EMPTY_SURVEY });
  const [viewMode, setViewMode] = useState('complaints');

  useDirtyGuard(showModal || showSurveyModal);

  const home = getCurrentHome();

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await getComplaints(home);
      setComplaints(result.complaints || []);
      setSurveys(result.surveys || []);
      setComplaintCategories(
        result.complaintCategories?.length ? result.complaintCategories : DEFAULT_COMPLAINT_CATEGORIES
      );
    } catch (err) {
      setError(err.message || 'Failed to load complaints');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const today = useLiveDate();

  // Minimal config object for functions that need complaint_response_days.
  // The dedicated endpoint does not return this setting; default to 28 days (Reg 16 standard).
  const complaintConfig = { complaint_response_days: 28 };

  const statsRange = useMemo(() => {
    const d = new Date(today + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 89);
    return { from: d.toISOString().slice(0, 10), to: today };
  }, [today]);

  const stats = useMemo(() =>
    getComplaintStats(complaints, complaintConfig, statsRange.from, statsRange.to),
    [complaints, statsRange]);

  const surveyStats = useMemo(() =>
    getSurveyStats(surveys, statsRange.from, statsRange.to),
    [surveys, statsRange]);

  const filtered = useMemo(() => {
    let list = [...complaints].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (filterCategory) list = list.filter(c => c.category === filterCategory);
    if (filterStatus) list = list.filter(c => c.status === filterStatus);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.title?.toLowerCase().includes(q) ||
        c.raised_by_name?.toLowerCase().includes(q) ||
        c.description?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [complaints, filterCategory, filterStatus, search]);

  function openAdd() {
    setEditingId(null);
    const deadline = formatDate(new Date(Date.now() + (complaintConfig.complaint_response_days) * 86400000));
    setForm({ ...EMPTY_FORM, date: today, response_deadline: deadline });
    setActiveTab('details');
    setShowModal(true);
  }

  function openEdit(item) {
    setEditingId(item.id);
    setForm({ ...EMPTY_FORM, ...item });
    setActiveTab('details');
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.date || !form.title) return;
    try {
      if (editingId) {
        await updateComplaint(home, editingId, form);
      } else {
        await createComplaint(home, { ...form, reported_by: getLoggedInUser()?.username || 'admin' });
      }
      setShowModal(false);
      load();
    } catch (err) {
      alert(err.message || 'Failed to save complaint');
    }
  }

  async function handleDelete() {
    if (!editingId || !confirm('Delete this complaint?')) return;
    try {
      await deleteComplaint(home, editingId);
      setShowModal(false);
      load();
    } catch (err) {
      alert(err.message || 'Failed to delete complaint');
    }
  }

  function openAddSurvey() {
    setEditingSurveyId(null);
    setSurveyForm({ ...EMPTY_SURVEY, date: today });
    setShowSurveyModal(true);
  }

  function openEditSurvey(item) {
    setEditingSurveyId(item.id);
    setSurveyForm({ ...EMPTY_SURVEY, ...item });
    setShowSurveyModal(true);
  }

  async function handleSaveSurvey() {
    if (!surveyForm.date || !surveyForm.type) return;
    try {
      if (editingSurveyId) {
        await updateComplaintSurvey(home, editingSurveyId, surveyForm);
      } else {
        await createComplaintSurvey(home, surveyForm);
      }
      setShowSurveyModal(false);
      load();
    } catch (err) {
      alert(err.message || 'Failed to save survey');
    }
  }

  async function handleDeleteSurvey() {
    if (!editingSurveyId || !confirm('Delete this survey?')) return;
    try {
      await deleteComplaintSurvey(home, editingSurveyId);
      setShowSurveyModal(false);
      load();
    } catch (err) {
      alert(err.message || 'Failed to delete survey');
    }
  }

  function handleExport() {
    const rows = filtered.map(c => {
      const cat = complaintCategories.find(cat => cat.id === c.category);
      const st = getComplaintStatus(c, complaintConfig);
      return [
        c.date, c.raised_by, c.raised_by_name, cat?.name || c.category,
        c.title, c.description, c.acknowledged_date || '',
        c.response_deadline || '', c.status,
        c.resolution || '', c.resolution_date || '',
        st.responseDaysActual !== null ? st.responseDaysActual : '',
      ];
    });
    downloadXLSX(`Complaints_${today}`, [{
      name: 'Complaints',
      headers: ['Date', 'Raised By', 'Name', 'Category', 'Title', 'Description',
        'Acknowledged', 'Deadline', 'Status', 'Resolution', 'Resolved Date', 'Response Days'],
      rows,
    }]);
  }

  const statusBadge = (status) => {
    const s = COMPLAINT_STATUSES.find(st => st.id === status);
    return s ? <span className={BADGE[s.badgeKey]}>{s.name}</span> : status;
  };

  if (loading) {
    return (
      <div className={PAGE.container}>
        <div className="text-center py-12 text-gray-400">Loading complaints...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={PAGE.container}>
        <div className="text-center py-12 text-red-500">{error}</div>
        <div className="text-center">
          <button onClick={load} className={BTN.secondary}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <h1 className={PAGE.title}>Complaints & Feedback</h1>
        <div className="flex gap-2">
          <button onClick={() => setViewMode(viewMode === 'complaints' ? 'surveys' : 'complaints')}
            className={`${BTN.secondary} ${BTN.sm}`}>
            {viewMode === 'complaints' ? 'View Surveys' : 'View Complaints'}
          </button>
          {viewMode === 'complaints' ? (
            <>
              <button onClick={handleExport} className={`${BTN.secondary} ${BTN.sm}`}>Export Excel</button>
              {isAdmin && <button onClick={openAdd} className={`${BTN.primary} ${BTN.sm}`}>Log Complaint</button>}
            </>
          ) : (
            isAdmin && <button onClick={openAddSurvey} className={`${BTN.primary} ${BTN.sm}`}>Add Survey</button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className={CARD.padded}>
          <div className="text-xs text-gray-500 mb-1">Open Complaints</div>
          <div className="text-2xl font-bold text-gray-900">{stats.open}</div>
          <div className="text-xs text-gray-400">{stats.overdue} overdue</div>
        </div>
        <div className={CARD.padded}>
          <div className="text-xs text-gray-500 mb-1">Avg Response</div>
          <div className="text-2xl font-bold text-gray-900">{stats.avgResponseDays !== null ? `${stats.avgResponseDays}d` : '--'}</div>
          <div className="text-xs text-gray-400">target {complaintConfig.complaint_response_days}d</div>
        </div>
        <div className={CARD.padded}>
          <div className="text-xs text-gray-500 mb-1">Resolution Rate</div>
          <div className="text-2xl font-bold text-gray-900">{stats.resolutionRate}%</div>
          <div className="text-xs text-gray-400">{stats.resolved}/{stats.total} resolved</div>
        </div>
        <div className={CARD.padded}>
          <div className="text-xs text-gray-500 mb-1">Satisfaction</div>
          <div className="text-2xl font-bold text-gray-900">{surveyStats.avgSatisfaction !== null ? `${surveyStats.avgSatisfaction}/5` : '--'}</div>
          <div className="text-xs text-gray-400">{surveyStats.surveyCount} surveys</div>
        </div>
      </div>

      {viewMode === 'complaints' ? (
        <>
          {/* Filters */}
          <div className="flex flex-wrap gap-2 mb-4">
            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className={`${INPUT.select} ${INPUT.sm}`}>
              <option value="">All Categories</option>
              {complaintCategories.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={`${INPUT.select} ${INPUT.sm}`}>
              <option value="">All Statuses</option>
              {COMPLAINT_STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..."
              className={`${INPUT.base} ${INPUT.sm} w-48`} />
          </div>

          {/* Complaints Table */}
          <div className={CARD.flush}>
            <div className="overflow-x-auto">
              <table className={TABLE.table}>
                <thead className={TABLE.thead}>
                  <tr>
                    <th scope="col" className={TABLE.th}>Date</th>
                    <th scope="col" className={TABLE.th}>Raised By</th>
                    <th scope="col" className={TABLE.th}>Category</th>
                    <th scope="col" className={TABLE.th}>Title</th>
                    <th scope="col" className={TABLE.th}>Status</th>
                    <th scope="col" className={TABLE.th}>Deadline</th>
                    <th scope="col" className={TABLE.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan="7" className={`${TABLE.td} text-center text-gray-400`}>No complaints recorded</td></tr>
                  )}
                  {filtered.map(c => {
                    const cat = complaintCategories.find(cat => cat.id === c.category);
                    const st = getComplaintStatus(c, complaintConfig);
                    return (
                      <tr key={c.id} className={TABLE.tr}>
                        <td className={TABLE.tdMono}>{c.date}</td>
                        <td className={TABLE.td}>
                          <div className="text-sm">{c.raised_by_name || '--'}</div>
                          <div className="text-xs text-gray-400">{RAISED_BY_TYPES.find(r => r.id === c.raised_by)?.name || c.raised_by}</div>
                        </td>
                        <td className={TABLE.td}>{cat?.name || c.category}</td>
                        <td className={TABLE.td}>
                          <div className="text-sm font-medium max-w-xs truncate">{c.title || '--'}</div>
                        </td>
                        <td className={TABLE.td}>
                          {statusBadge(c.status)}
                          {st.isOverdueResponse && <span className={`${BADGE.red} ml-1`}>Overdue</span>}
                        </td>
                        <td className={TABLE.tdMono}>
                          {c.response_deadline || '--'}
                        </td>
                        <td className={TABLE.td}>
                          {isAdmin && <button onClick={() => openEdit(c)} className={`${BTN.ghost} ${BTN.xs}`}>Edit</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Surveys Table */}
          <div className={CARD.flush}>
            <div className="overflow-x-auto">
              <table className={TABLE.table}>
                <thead className={TABLE.thead}>
                  <tr>
                    <th scope="col" className={TABLE.th}>Date</th>
                    <th scope="col" className={TABLE.th}>Type</th>
                    <th scope="col" className={TABLE.th}>Title</th>
                    <th scope="col" className={TABLE.th}>Responses</th>
                    <th scope="col" className={TABLE.th}>Satisfaction</th>
                    <th scope="col" className={TABLE.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {surveys.length === 0 && (
                    <tr><td colSpan="6" className={`${TABLE.td} text-center text-gray-400`}>No surveys recorded</td></tr>
                  )}
                  {[...surveys].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(s => (
                    <tr key={s.id} className={TABLE.tr}>
                      <td className={TABLE.tdMono}>{s.date}</td>
                      <td className={TABLE.td}>{SURVEY_TYPES.find(t => t.id === s.type)?.name || s.type}</td>
                      <td className={TABLE.td}>{s.title || '--'}</td>
                      <td className={TABLE.td}>{s.responses || 0}/{s.total_sent || 0}</td>
                      <td className={TABLE.td}>
                        {s.overall_satisfaction ? (
                          <span className={BADGE[s.overall_satisfaction >= 4 ? 'green' : s.overall_satisfaction >= 3 ? 'amber' : 'red']}>
                            {s.overall_satisfaction}/5
                          </span>
                        ) : '--'}
                      </td>
                      <td className={TABLE.td}>
                        {isAdmin && <button onClick={() => openEditSurvey(s)} className={`${BTN.ghost} ${BTN.xs}`}>Edit</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Complaint Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editingId ? 'Edit Complaint' : 'Log Complaint'} size="lg">

            {/* Tabs */}
            <TabBar tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />

            <div className="max-h-[60vh] overflow-y-auto space-y-3">
              {activeTab === 'details' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={INPUT.label}>Date</label>
                      <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })}
                        className={INPUT.base} />
                    </div>
                    <div>
                      <label className={INPUT.label}>Category</label>
                      <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
                        className={INPUT.select}>
                        <option value="">Select...</option>
                        {complaintCategories.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className={INPUT.label}>Title</label>
                    <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
                      className={INPUT.base} placeholder="Brief summary of complaint" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={INPUT.label}>Raised By</label>
                      <select value={form.raised_by} onChange={e => setForm({ ...form, raised_by: e.target.value })}
                        className={INPUT.select}>
                        {RAISED_BY_TYPES.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={INPUT.label}>Name</label>
                      <input value={form.raised_by_name} onChange={e => setForm({ ...form, raised_by_name: e.target.value })}
                        className={INPUT.base} placeholder="Person's name" />
                    </div>
                  </div>
                  <div>
                    <label className={INPUT.label}>Description</label>
                    <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                      className={INPUT.base} rows={3} placeholder="Full details of the complaint" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={INPUT.label}>Acknowledged Date</label>
                      <input type="date" value={form.acknowledged_date}
                        onChange={e => setForm({ ...form, acknowledged_date: e.target.value, status: form.status === 'open' ? 'acknowledged' : form.status })}
                        className={INPUT.base} />
                    </div>
                    <div>
                      <label className={INPUT.label}>Response Deadline</label>
                      <input type="date" value={form.response_deadline}
                        onChange={e => setForm({ ...form, response_deadline: e.target.value })}
                        className={INPUT.base} />
                    </div>
                  </div>
                  <div>
                    <label className={INPUT.label}>Status</label>
                    <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}
                      className={INPUT.select}>
                      {COMPLAINT_STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={INPUT.label}>Reported By (Staff)</label>
                    <input value={form.reported_by} onChange={e => setForm({ ...form, reported_by: e.target.value })}
                      className={INPUT.base} placeholder="Manager recording this complaint" />
                  </div>
                </>
              )}

              {activeTab === 'investigation' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={INPUT.label}>Investigator</label>
                      <input value={form.investigator} onChange={e => setForm({ ...form, investigator: e.target.value })}
                        className={INPUT.base} />
                    </div>
                    <div>
                      <label className={INPUT.label}>Status</label>
                      <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}
                        className={INPUT.select}>
                        {COMPLAINT_STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className={INPUT.label}>Investigation Notes</label>
                    <textarea value={form.investigation_notes} onChange={e => setForm({ ...form, investigation_notes: e.target.value })}
                      className={INPUT.base} rows={3} placeholder="Findings from investigation" />
                  </div>
                  <div>
                    <label className={INPUT.label}>Root Cause</label>
                    <textarea value={form.root_cause} onChange={e => setForm({ ...form, root_cause: e.target.value })}
                      className={INPUT.base} rows={2} />
                  </div>
                </>
              )}

              {activeTab === 'resolution' && (
                <>
                  <div>
                    <label className={INPUT.label}>Resolution</label>
                    <textarea value={form.resolution} onChange={e => setForm({ ...form, resolution: e.target.value })}
                      className={INPUT.base} rows={3} placeholder="How the complaint was resolved" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={INPUT.label}>Resolution Date</label>
                      <input type="date" value={form.resolution_date}
                        onChange={e => setForm({ ...form, resolution_date: e.target.value, status: e.target.value ? 'resolved' : form.status })}
                        className={INPUT.base} />
                    </div>
                    <div className="flex items-end">
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={form.outcome_shared}
                          onChange={e => setForm({ ...form, outcome_shared: e.target.checked })} />
                        Outcome shared with complainant
                      </label>
                    </div>
                  </div>
                  <div>
                    <label className={INPUT.label}>Improvements Made</label>
                    <textarea value={form.improvements} onChange={e => setForm({ ...form, improvements: e.target.value })}
                      className={INPUT.base} rows={2} placeholder="You Said, We Did — what changed as a result" />
                  </div>
                  <div>
                    <label className={INPUT.label}>Lessons Learned</label>
                    <textarea value={form.lessons_learned} onChange={e => setForm({ ...form, lessons_learned: e.target.value })}
                      className={INPUT.base} rows={2} />
                  </div>
                </>
              )}
            </div>

            <div className={MODAL.footer}>
              {isAdmin && editingId && <button onClick={handleDelete} className={BTN.danger}>Delete</button>}
              <div className="flex-1" />
              <button onClick={() => setShowModal(false)} className={BTN.secondary}>Cancel</button>
              {isAdmin && <button onClick={handleSave} className={BTN.primary}>Save</button>}
            </div>
      </Modal>

      {/* Survey Modal */}
      <Modal isOpen={showSurveyModal} onClose={() => setShowSurveyModal(false)} title={editingSurveyId ? 'Edit Survey' : 'Add Survey'} size="md">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={INPUT.label}>Date</label>
                  <input type="date" value={surveyForm.date}
                    onChange={e => setSurveyForm({ ...surveyForm, date: e.target.value })} className={INPUT.base} />
                </div>
                <div>
                  <label className={INPUT.label}>Survey Type</label>
                  <select value={surveyForm.type}
                    onChange={e => setSurveyForm({ ...surveyForm, type: e.target.value })} className={INPUT.select}>
                    {SURVEY_TYPES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className={INPUT.label}>Title</label>
                <input value={surveyForm.title}
                  onChange={e => setSurveyForm({ ...surveyForm, title: e.target.value })}
                  className={INPUT.base} placeholder="e.g. Q1 2026 Family Satisfaction Survey" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={INPUT.label}>Sent</label>
                  <input type="number" value={surveyForm.total_sent}
                    onChange={e => setSurveyForm({ ...surveyForm, total_sent: (() => { const v = parseInt(e.target.value); return isNaN(v) ? '' : v; })() })}
                    className={INPUT.base} />
                </div>
                <div>
                  <label className={INPUT.label}>Responses</label>
                  <input type="number" value={surveyForm.responses}
                    onChange={e => setSurveyForm({ ...surveyForm, responses: (() => { const v = parseInt(e.target.value); return isNaN(v) ? '' : v; })() })}
                    className={INPUT.base} />
                </div>
                <div>
                  <label className={INPUT.label}>Satisfaction (1-5)</label>
                  <input type="number" min="1" max="5" step="0.1" value={surveyForm.overall_satisfaction}
                    onChange={e => setSurveyForm({ ...surveyForm, overall_satisfaction: (() => { const v = parseFloat(e.target.value); return isNaN(v) ? '' : v; })() })}
                    className={INPUT.base} />
                </div>
              </div>
              <div>
                <label className={INPUT.label}>Key Feedback</label>
                <textarea value={surveyForm.key_feedback}
                  onChange={e => setSurveyForm({ ...surveyForm, key_feedback: e.target.value })}
                  className={INPUT.base} rows={2} />
              </div>
              <div>
                <label className={INPUT.label}>Actions from Feedback</label>
                <textarea value={surveyForm.actions}
                  onChange={e => setSurveyForm({ ...surveyForm, actions: e.target.value })}
                  className={INPUT.base} rows={2} placeholder="You Said, We Did" />
              </div>
              <div>
                <label className={INPUT.label}>Conducted By</label>
                <input value={surveyForm.conducted_by}
                  onChange={e => setSurveyForm({ ...surveyForm, conducted_by: e.target.value })}
                  className={INPUT.base} />
              </div>
            </div>
            <div className={MODAL.footer}>
              {isAdmin && editingSurveyId && <button onClick={handleDeleteSurvey} className={BTN.danger}>Delete</button>}
              <div className="flex-1" />
              <button onClick={() => setShowSurveyModal(false)} className={BTN.secondary}>Cancel</button>
              {isAdmin && <button onClick={handleSaveSurvey} className={BTN.primary}>Save</button>}
            </div>
      </Modal>
    </div>
  );
}
