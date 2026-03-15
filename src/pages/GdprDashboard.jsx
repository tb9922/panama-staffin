import { useState, useEffect, useCallback } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import TabBar from '../components/TabBar.jsx';
import Modal from '../components/Modal.jsx';
import {
  getDataRequests, createDataRequest, updateDataRequest, gatherRequestData, executeErasure,
  getDataBreaches, createDataBreach, updateDataBreach, assessBreach,
  getRetentionSchedule, scanRetention,
  getConsentRecords, createConsentRecord, updateConsentRecord,
  getDPComplaints, createDPComplaint, updateDPComplaint,
  getAccessLog, getCurrentHome, } from '../lib/api.js';
import {
  REQUEST_TYPES, BREACH_SEVERITIES, RISK_TO_RIGHTS, LEGAL_BASES,
  DP_COMPLAINT_CATEGORIES, DATA_CATEGORIES,
  calculateDeadline, daysUntilDeadline, isOverdue,
  calculateGdprComplianceScore, getStatusBadgeKey, getSeverityBadgeKey, formatRequestType,
} from '../lib/gdpr.js';
import { useData } from '../contexts/DataContext.jsx';
import useDirtyGuard from '../hooks/useDirtyGuard.js';

const TABS = [
  { id: 'overview',   label: 'Overview' },
  { id: 'requests',   label: 'Data Requests' },
  { id: 'breaches',   label: 'Breaches' },
  { id: 'retention',  label: 'Retention' },
  { id: 'consent',    label: 'Consent' },
  { id: 'complaints', label: 'Complaints' },
  { id: 'access',     label: 'Access Log' },
];

export default function GdprDashboard() {
  const { canWrite } = useData();
  const canEdit = canWrite('gdpr');
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Data state
  const [requests, setRequests] = useState([]);
  const [breaches, setBreaches] = useState([]);
  const [retention, setRetention] = useState([]);
  const [retentionScan, setRetentionScan] = useState(null);
  const [consent, setConsent] = useState([]);
  const [complaints, setComplaints] = useState([]);
  const [accessLogData, setAccessLogData] = useState([]);

  // Modal state
  const [showModal, setShowModal] = useState(null); // 'request' | 'breach' | 'consent' | 'complaint'
  const [form, setForm] = useState({});

  // Erasure confirmation state
  const [erasureConfirm, setErasureConfirm] = useState(null); // request id to erase
  const [erasureInput, setErasureInput] = useState('');

  const home = getCurrentHome();
  useDirtyGuard(showModal !== null || !!erasureConfirm);

  const load = useCallback(async () => {
    if (!home) return;
    setLoading(true);
    try {
      const [req, br, ret, con, comp, acc] = await Promise.all([
        getDataRequests(home),
        getDataBreaches(home),
        getRetentionSchedule(),
        getConsentRecords(home),
        getDPComplaints(home),
        getAccessLog(200),
      ]);
      setRequests(req);
      setBreaches(br);
      setRetention(ret);
      setConsent(con);
      setComplaints(comp);
      setAccessLogData(acc);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [home]);

  useEffect(() => { load(); }, [load]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  async function handleCreateRequest() {
    if (!form.request_type || !form.subject_type || !form.subject_id || !form.date_received) return;
    try {
      const data = {
        ...form,
        deadline: form.deadline || calculateDeadline(form.date_received, 30),
      };
      await createDataRequest(home, data);
      setShowModal(null);
      setForm({});
      load();
    } catch (e) { setError(e.message); }
  }

  async function handleCreateBreach() {
    if (!form.title || !form.discovered_date) return;
    try {
      const data = { ...form };
      // Combine date + time into UTC ISO datetime for precise ICO deadline calculation
      if (data.discovered_time) {
        data.discovered_date = new Date(`${data.discovered_date}T${data.discovered_time}`).toISOString();
      }
      delete data.discovered_time;
      if (data.data_categories && typeof data.data_categories === 'string') {
        data.data_categories = data.data_categories.split(',').map(s => s.trim()).filter(Boolean);
      }
      await createDataBreach(home, data);
      setShowModal(null);
      setForm({});
      load();
    } catch (e) { setError(e.message); }
  }

  async function handleCreateConsent() {
    if (!form.subject_type || !form.subject_id || !form.purpose || !form.legal_basis) return;
    try {
      await createConsentRecord(home, form);
      setShowModal(null);
      setForm({});
      load();
    } catch (e) { setError(e.message); }
  }

  async function handleCreateComplaint() {
    if (!form.date_received || !form.category || !form.description) return;
    try {
      await createDPComplaint(home, form);
      setShowModal(null);
      setForm({});
      load();
    } catch (e) { setError(e.message); }
  }

  async function handleAssessBreach(id) {
    try {
      await assessBreach(home, id);
      load();
    } catch (e) { setError(e.message); }
  }

  async function handleGatherData(id) {
    try {
      const data = await gatherRequestData(home, id);
      // Download as JSON
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sar_data_${data.subject_id}_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError(e.message); }
  }

  function handleExecuteErasure(id) {
    setErasureConfirm(id);
    setErasureInput('');
  }

  async function confirmErasure() {
    if (erasureInput !== 'ERASE' || !erasureConfirm) return;
    try {
      await executeErasure(home, erasureConfirm);
      setErasureConfirm(null);
      setErasureInput('');
      load();
    } catch (e) { setError(e.message); }
  }

  async function handleUpdateStatus(type, id, status) {
    try {
      if (type === 'request') await updateDataRequest(home, id, { status });
      else if (type === 'breach') await updateDataBreach(home, id, { status });
      else if (type === 'complaint') await updateDPComplaint(home, id, { status });
      load();
    } catch (e) { setError(e.message); }
  }

  async function handleRunRetentionScan() {
    try {
      const scan = await scanRetention(home);
      setRetentionScan(scan);
    } catch (e) { setError(e.message); }
  }

  async function handleWithdrawConsent(id) {
    try {
      await updateConsentRecord(home, id, { withdrawn: new Date().toISOString() });
      load();
    } catch (e) { setError(e.message); }
  }

  // ── Compliance Score ─────────────────────────────────────────────────────

  const compliance = calculateGdprComplianceScore(requests, breaches, complaints, retentionScan);
  const bandColors = { good: 'green', adequate: 'blue', requires_improvement: 'amber', inadequate: 'red' };

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) return <div className={PAGE.container} role="status"><div className={CARD.padded}><p className="text-center py-10 text-gray-500">Loading GDPR data...</p></div></div>;

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>GDPR & Data Protection</h1>
          <p className={PAGE.subtitle}>UK GDPR compliance — data requests, breaches, retention, consent</p>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4" role="alert">{error}</div>}

      {/* Tab bar */}
      <TabBar tabs={TABS} activeTab={tab} onTabChange={setTab} className="mb-6" />

      {/* Tab content */}
      {tab === 'overview' && renderOverview()}
      {tab === 'requests' && renderRequests()}
      {tab === 'breaches' && renderBreaches()}
      {tab === 'retention' && renderRetention()}
      {tab === 'consent' && renderConsent()}
      {tab === 'complaints' && renderComplaints()}
      {tab === 'access' && renderAccessLog()}

      {/* Modals */}
      {showModal === 'request' && renderRequestModal()}
      {showModal === 'breach' && renderBreachModal()}
      {showModal === 'consent' && renderConsentModal()}
      {showModal === 'complaint' && renderComplaintModal()}

      {/* Erasure Confirmation Modal */}
      <Modal isOpen={!!erasureConfirm} onClose={() => { setErasureConfirm(null); setErasureInput(''); }} title="Confirm Permanent Erasure" size="sm">
        <div className="space-y-3">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
            This will permanently anonymise all personal data for this subject. This action cannot be undone.
          </div>
          <div>
            <label className={INPUT.label}>Type <strong>ERASE</strong> to confirm</label>
            <input
              className={INPUT.base}
              value={erasureInput}
              onChange={e => setErasureInput(e.target.value)}
              placeholder="ERASE"
              autoFocus
            />
          </div>
        </div>
        <div className={MODAL.footer}>
          <button className={BTN.secondary} onClick={() => { setErasureConfirm(null); setErasureInput(''); }}>Cancel</button>
          <button className={BTN.danger} disabled={erasureInput !== 'ERASE'} onClick={confirmErasure}>Execute Erasure</button>
        </div>
      </Modal>
    </div>
  );

  // ── Tab Renderers ──────────────────────────────────────────────────────

  function renderOverview() {
    const openRequests = requests.filter(r => r.status !== 'completed' && r.status !== 'rejected');
    const overdueRequests = openRequests.filter(r => isOverdue(r.deadline));
    const openBreaches = breaches.filter(b => b.status === 'open' || b.status === 'contained');
    const unnotified = breaches.filter(b => b.ico_notifiable && !b.ico_notified);
    const openComplaints = complaints.filter(c => c.status !== 'closed' && c.status !== 'resolved');

    return (
      <div className="space-y-6">
        {/* Compliance Score */}
        <div className={CARD.padded}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Compliance Score</h2>
            <span className={BADGE[bandColors[compliance.band] || 'gray']}>
              {compliance.score}/100 — {compliance.band.replace(/_/g, ' ')}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3 mb-3">
            <div className={`h-3 rounded-full transition-all ${
              compliance.score >= 90 ? 'bg-green-500' : compliance.score >= 70 ? 'bg-blue-500' : compliance.score >= 50 ? 'bg-amber-500' : 'bg-red-500'
            }`} style={{ width: `${compliance.score}%` }} />
          </div>
          {compliance.issues.length > 0 && (
            <ul className="text-sm text-gray-600 space-y-1">
              {compliance.issues.map((issue, i) => <li key={i} className="flex items-center gap-2"><span className="text-red-500">!</span> {issue}</li>)}
            </ul>
          )}
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className={CARD.padded}>
            <p className="text-sm text-gray-500">Open Requests</p>
            <p className="text-2xl font-bold">{openRequests.length}</p>
            {overdueRequests.length > 0 && <p className="text-sm text-red-600">{overdueRequests.length} overdue</p>}
          </div>
          <div className={CARD.padded}>
            <p className="text-sm text-gray-500">Open Breaches</p>
            <p className="text-2xl font-bold">{openBreaches.length}</p>
            {unnotified.length > 0 && <p className="text-sm text-red-600">{unnotified.length} ICO notification pending</p>}
          </div>
          <div className={CARD.padded}>
            <p className="text-sm text-gray-500">DP Complaints</p>
            <p className="text-2xl font-bold">{openComplaints.length}</p>
          </div>
          <div className={CARD.padded}>
            <p className="text-sm text-gray-500">Consent Records</p>
            <p className="text-2xl font-bold">{consent.length}</p>
            <p className="text-sm text-gray-400">{consent.filter(c => c.withdrawn).length} withdrawn</p>
          </div>
        </div>
      </div>
    );
  }

  function renderRequests() {
    return (
      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Data Requests</h2>
          {canEdit && <button className={BTN.primary + ' ' + BTN.sm} onClick={() => { setForm({ request_type: 'sar', subject_type: 'staff', date_received: new Date().toISOString().slice(0, 10) }); setShowModal('request'); }}>
            New Request
          </button>}
        </div>
        <div className={CARD.flush}>
          <div className={TABLE.wrapper}>
            <table className={TABLE.table}>
              <thead className={TABLE.thead}>
                <tr><th scope="col" className={TABLE.th}>Type</th><th scope="col" className={TABLE.th}>Subject</th><th scope="col" className={TABLE.th}>Received</th><th scope="col" className={TABLE.th}>Deadline</th><th scope="col" className={TABLE.th}>Status</th><th scope="col" className={TABLE.th}>Actions</th></tr>
              </thead>
              <tbody>
                {requests.length === 0 && <tr><td colSpan={6} className={TABLE.empty}>No data requests</td></tr>}
                {requests.map(r => {
                  const days = daysUntilDeadline(r.deadline);
                  const overdue = r.status !== 'completed' && r.status !== 'rejected' && days < 0;
                  return (
                    <tr key={r.id} className={TABLE.tr}>
                      <td className={TABLE.td}>{formatRequestType(r.request_type)}</td>
                      <td className={TABLE.td}>{r.subject_name || r.subject_id}<br /><span className="text-xs text-gray-400">{r.subject_type}</span></td>
                      <td className={TABLE.td}>{r.date_received}</td>
                      <td className={TABLE.td}>
                        <span className={overdue ? 'text-red-600 font-semibold' : days <= 7 ? 'text-amber-600' : ''}>
                          {r.deadline} {overdue ? `(${Math.abs(days)}d overdue)` : r.status !== 'completed' && r.status !== 'rejected' ? `(${days}d)` : ''}
                        </span>
                      </td>
                      <td className={TABLE.td}><span className={BADGE[getStatusBadgeKey(r.status)]}>{r.status}</span></td>
                      <td className={TABLE.td}>
                        {canEdit && <div className="flex gap-1 flex-wrap">
                          {r.request_type === 'sar' && r.status !== 'completed' && (
                            <button className={BTN.ghost + ' ' + BTN.xs} onClick={() => handleGatherData(r.id)}>Gather</button>
                          )}
                          {r.request_type === 'erasure' && r.status !== 'completed' && r.identity_verified && (
                            <button className={BTN.danger + ' ' + BTN.xs} onClick={() => handleExecuteErasure(r.id)}>Execute</button>
                          )}
                          {r.status === 'received' && (
                            <button className={BTN.ghost + ' ' + BTN.xs} onClick={() => handleUpdateStatus('request', r.id, 'in_progress')}>Start</button>
                          )}
                          {r.status === 'in_progress' && (
                            <button className={BTN.success + ' ' + BTN.xs} onClick={() => handleUpdateStatus('request', r.id, 'completed')}>Complete</button>
                          )}
                        </div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  function renderBreaches() {
    return (
      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Data Breaches</h2>
          {canEdit && <button className={BTN.primary + ' ' + BTN.sm} onClick={() => { const now = new Date(); setForm({ severity: 'low', risk_to_rights: 'unlikely', discovered_date: now.toISOString().slice(0, 10), discovered_time: now.toTimeString().slice(0, 5) }); setShowModal('breach'); }}>
            Report Breach
          </button>}
        </div>
        <div className={CARD.flush}>
          <div className={TABLE.wrapper}>
            <table className={TABLE.table}>
              <thead className={TABLE.thead}>
                <tr><th scope="col" className={TABLE.th}>Title</th><th scope="col" className={TABLE.th}>Discovered</th><th scope="col" className={TABLE.th}>Severity</th><th scope="col" className={TABLE.th}>ICO</th><th scope="col" className={TABLE.th}>Status</th><th scope="col" className={TABLE.th}>Actions</th></tr>
              </thead>
              <tbody>
                {breaches.length === 0 && <tr><td colSpan={6} className={TABLE.empty}>No data breaches recorded</td></tr>}
                {breaches.map(b => (
                  <tr key={b.id} className={TABLE.tr}>
                    <td className={TABLE.td}>{b.title}<br /><span className="text-xs text-gray-400">{b.individuals_affected} affected</span></td>
                    <td className={TABLE.td}>{b.discovered_date?.slice(0, 10)}{b.discovered_date?.length > 10 && <><br /><span className="text-xs text-gray-400">{new Date(b.discovered_date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span></>}</td>
                    <td className={TABLE.td}><span className={BADGE[getSeverityBadgeKey(b.severity)]}>{b.severity}</span></td>
                    <td className={TABLE.td}>
                      {b.ico_notifiable ? (
                        b.ico_notified ? <span className={BADGE.green}>Notified</span> : <span className={BADGE.red}>Required</span>
                      ) : <span className={BADGE.gray}>N/A</span>}
                    </td>
                    <td className={TABLE.td}><span className={BADGE[getStatusBadgeKey(b.status)]}>{b.status}</span></td>
                    <td className={TABLE.td}>
                      {canEdit && <div className="flex gap-1 flex-wrap">
                        <button className={BTN.ghost + ' ' + BTN.xs} onClick={() => handleAssessBreach(b.id)}>Assess</button>
                        {b.status === 'open' && <button className={BTN.ghost + ' ' + BTN.xs} onClick={() => handleUpdateStatus('breach', b.id, 'contained')}>Contain</button>}
                        {b.status === 'contained' && <button className={BTN.ghost + ' ' + BTN.xs} onClick={() => handleUpdateStatus('breach', b.id, 'resolved')}>Resolve</button>}
                        {b.status === 'resolved' && <button className={BTN.success + ' ' + BTN.xs} onClick={() => handleUpdateStatus('breach', b.id, 'closed')}>Close</button>}
                      </div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  function renderRetention() {
    return (
      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Retention Schedule</h2>
          <button className={BTN.secondary + ' ' + BTN.sm} onClick={handleRunRetentionScan}>Run Scan</button>
        </div>
        <div className={CARD.flush}>
          <div className={TABLE.wrapper}>
            <table className={TABLE.table}>
              <thead className={TABLE.thead}>
                <tr>
                  <th scope="col" className={TABLE.th}>Category</th><th scope="col" className={TABLE.th}>Period</th><th scope="col" className={TABLE.th}>Basis</th>
                  <th scope="col" className={TABLE.th}>Special</th><th scope="col" className={TABLE.th}>Table</th>
                  {retentionScan && <><th scope="col" className={TABLE.th}>Records</th><th scope="col" className={TABLE.th}>Expired</th></>}
                </tr>
              </thead>
              <tbody>
                {(retentionScan || retention).map((r, i) => (
                  <tr key={i} className={TABLE.tr}>
                    <td className={TABLE.td + ' font-medium'}>{r.data_category}</td>
                    <td className={TABLE.td}>{r.retention_period}</td>
                    <td className={TABLE.td}><span className="text-xs">{r.retention_basis}</span></td>
                    <td className={TABLE.td}>{r.special_category ? <span className={BADGE.purple}>Special</span> : <span className={BADGE.gray}>Standard</span>}</td>
                    <td className={TABLE.td + ' font-mono text-xs'}>{r.applies_to_table}</td>
                    {retentionScan && <>
                      <td className={TABLE.td}>{r.total_records}</td>
                      <td className={TABLE.td}>{r.expired_records > 0 ? <span className="text-red-600 font-semibold">{r.expired_records}</span> : '0'}</td>
                    </>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  function renderConsent() {
    return (
      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Consent Records</h2>
          {canEdit && <button className={BTN.primary + ' ' + BTN.sm} onClick={() => { setForm({ subject_type: 'staff', legal_basis: 'consent' }); setShowModal('consent'); }}>
            Record Consent
          </button>}
        </div>
        <div className={CARD.flush}>
          <div className={TABLE.wrapper}>
            <table className={TABLE.table}>
              <thead className={TABLE.thead}>
                <tr><th scope="col" className={TABLE.th}>Subject</th><th scope="col" className={TABLE.th}>Purpose</th><th scope="col" className={TABLE.th}>Legal Basis</th><th scope="col" className={TABLE.th}>Given</th><th scope="col" className={TABLE.th}>Status</th><th scope="col" className={TABLE.th}>Actions</th></tr>
              </thead>
              <tbody>
                {consent.length === 0 && <tr><td colSpan={6} className={TABLE.empty}>No consent records</td></tr>}
                {consent.map(c => (
                  <tr key={c.id} className={TABLE.tr}>
                    <td className={TABLE.td}>{c.subject_name || c.subject_id}<br /><span className="text-xs text-gray-400">{c.subject_type}</span></td>
                    <td className={TABLE.td}>{c.purpose}</td>
                    <td className={TABLE.td}><span className="text-xs">{LEGAL_BASES.find(l => l.id === c.legal_basis)?.label || c.legal_basis}</span></td>
                    <td className={TABLE.td}>{c.given ? c.given.slice(0, 10) : '—'}</td>
                    <td className={TABLE.td}>
                      {c.withdrawn ? <span className={BADGE.red}>Withdrawn {c.withdrawn.slice(0, 10)}</span> : <span className={BADGE.green}>Active</span>}
                    </td>
                    <td className={TABLE.td}>
                      {canEdit && !c.withdrawn && <button className={BTN.ghost + ' ' + BTN.xs} onClick={() => handleWithdrawConsent(c.id)}>Withdraw</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  function renderComplaints() {
    return (
      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Data Protection Complaints</h2>
          {canEdit && <button className={BTN.primary + ' ' + BTN.sm} onClick={() => { setForm({ category: 'access', severity: 'low', date_received: new Date().toISOString().slice(0, 10) }); setShowModal('complaint'); }}>
            Log Complaint
          </button>}
        </div>
        <div className={CARD.flush}>
          <div className={TABLE.wrapper}>
            <table className={TABLE.table}>
              <thead className={TABLE.thead}>
                <tr><th scope="col" className={TABLE.th}>Date</th><th scope="col" className={TABLE.th}>Category</th><th scope="col" className={TABLE.th}>Description</th><th scope="col" className={TABLE.th}>Severity</th><th scope="col" className={TABLE.th}>ICO</th><th scope="col" className={TABLE.th}>Status</th><th scope="col" className={TABLE.th}>Actions</th></tr>
              </thead>
              <tbody>
                {complaints.length === 0 && <tr><td colSpan={7} className={TABLE.empty}>No DP complaints</td></tr>}
                {complaints.map(c => (
                  <tr key={c.id} className={TABLE.tr}>
                    <td className={TABLE.td}>{c.date_received}</td>
                    <td className={TABLE.td}>{DP_COMPLAINT_CATEGORIES.find(cat => cat.id === c.category)?.label || c.category}</td>
                    <td className={TABLE.td}><span className="text-sm line-clamp-2">{c.description}</span></td>
                    <td className={TABLE.td}><span className={BADGE[getSeverityBadgeKey(c.severity)]}>{c.severity}</span></td>
                    <td className={TABLE.td}>{c.ico_involved ? <span className={BADGE.red}>Yes</span> : <span className={BADGE.gray}>No</span>}</td>
                    <td className={TABLE.td}><span className={BADGE[getStatusBadgeKey(c.status)]}>{c.status}</span></td>
                    <td className={TABLE.td}>
                      {canEdit && <div className="flex gap-1 flex-wrap">
                        {c.status === 'open' && <button className={BTN.ghost + ' ' + BTN.xs} onClick={() => handleUpdateStatus('complaint', c.id, 'investigating')}>Investigate</button>}
                        {c.status === 'investigating' && <button className={BTN.success + ' ' + BTN.xs} onClick={() => handleUpdateStatus('complaint', c.id, 'resolved')}>Resolve</button>}
                      </div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  function renderAccessLog() {
    return (
      <div>
        <h2 className="text-lg font-semibold mb-4">Access Log</h2>
        <div className={CARD.flush}>
          <div className={TABLE.wrapper}>
            <table className={TABLE.table}>
              <thead className={TABLE.thead}>
                <tr><th scope="col" className={TABLE.th}>Time</th><th scope="col" className={TABLE.th}>User</th><th scope="col" className={TABLE.th}>Role</th><th scope="col" className={TABLE.th}>Method</th><th scope="col" className={TABLE.th}>Endpoint</th><th scope="col" className={TABLE.th}>Categories</th><th scope="col" className={TABLE.th}>Status</th></tr>
              </thead>
              <tbody>
                {accessLogData.length === 0 && <tr><td colSpan={7} className={TABLE.empty}>No access log entries</td></tr>}
                {accessLogData.map(a => (
                  <tr key={a.id} className={TABLE.tr}>
                    <td className={TABLE.td + ' text-xs font-mono'}>{a.ts ? new Date(a.ts).toLocaleString('en-GB') : '—'}</td>
                    <td className={TABLE.td}>{a.user_name || '—'}</td>
                    <td className={TABLE.td}>{a.user_role || '—'}</td>
                    <td className={TABLE.td}><span className="font-mono text-xs">{a.method}</span></td>
                    <td className={TABLE.td}><span className="font-mono text-xs">{a.endpoint}</span></td>
                    <td className={TABLE.td}><span className="text-xs">{(a.data_categories || []).join(', ') || '—'}</span></td>
                    <td className={TABLE.td}>{a.status_code}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // ── Modals ─────────────────────────────────────────────────────────────

  function renderRequestModal() {
    return (
      <Modal isOpen={true} onClose={() => setShowModal(null)} title="New Data Request" size="lg">
        <div className="space-y-4">
          <div>
            <label className={INPUT.label}>Request Type</label>
            <select className={INPUT.select} value={form.request_type || ''} onChange={e => setForm({ ...form, request_type: e.target.value })}>
              {REQUEST_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={INPUT.label}>Subject Type</label>
              <select className={INPUT.select} value={form.subject_type || 'staff'} onChange={e => setForm({ ...form, subject_type: e.target.value })}>
                <option value="staff">Staff</option>
                <option value="resident">Resident</option>
              </select>
            </div>
            <div>
              <label className={INPUT.label}>Subject ID / Name</label>
              <input className={INPUT.base} value={form.subject_id || ''} onChange={e => setForm({ ...form, subject_id: e.target.value })} placeholder="e.g. S001 or name" />
            </div>
          </div>
          <div>
            <label className={INPUT.label}>Subject Name</label>
            <input className={INPUT.base} value={form.subject_name || ''} onChange={e => setForm({ ...form, subject_name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={INPUT.label}>Date Received</label>
              <input type="date" className={INPUT.base} value={form.date_received || ''} onChange={e => setForm({ ...form, date_received: e.target.value })} />
            </div>
            <div>
              <label className={INPUT.label}>Deadline</label>
              <input type="date" className={INPUT.base} value={form.deadline || (form.date_received ? calculateDeadline(form.date_received) : '')}
                onChange={e => setForm({ ...form, deadline: e.target.value })} />
            </div>
          </div>
          <div>
            <label className={INPUT.label}>Notes</label>
            <textarea className={INPUT.base} rows={3} value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <div className={MODAL.footer}>
          <button className={BTN.secondary} onClick={() => setShowModal(null)}>Cancel</button>
          <button className={BTN.primary} onClick={handleCreateRequest}>Create Request</button>
        </div>
      </Modal>
    );
  }

  function renderBreachModal() {
    return (
      <Modal isOpen={true} onClose={() => setShowModal(null)} title="Report Data Breach" size="lg">
        <div className="space-y-4">
          <div>
            <label className={INPUT.label}>Title</label>
            <input className={INPUT.base} value={form.title || ''} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Brief description of the breach" />
          </div>
          <div>
            <label className={INPUT.label}>Description</label>
            <textarea className={INPUT.base} rows={3} value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label className={INPUT.label}>Discovered Date</label>
              <input type="date" className={INPUT.base} value={form.discovered_date || ''} onChange={e => setForm({ ...form, discovered_date: e.target.value })} />
            </div>
            <div>
              <label className={INPUT.label}>Time</label>
              <input type="time" className={INPUT.base} value={form.discovered_time || ''} onChange={e => setForm({ ...form, discovered_time: e.target.value })} />
            </div>
            <div>
              <label className={INPUT.label}>Severity</label>
              <select className={INPUT.select} value={form.severity || 'low'} onChange={e => setForm({ ...form, severity: e.target.value })}>
                {BREACH_SEVERITIES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className={INPUT.label}>Risk to Rights</label>
              <select className={INPUT.select} value={form.risk_to_rights || 'unlikely'} onChange={e => setForm({ ...form, risk_to_rights: e.target.value })}>
                {RISK_TO_RIGHTS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={INPUT.label}>Individuals Affected</label>
              <input type="number" className={INPUT.base} value={form.individuals_affected || 0} onChange={e => setForm({ ...form, individuals_affected: parseInt(e.target.value, 10) || 0 })} />
            </div>
            <div>
              <label className={INPUT.label}>Data Categories (comma-separated)</label>
              <input className={INPUT.base} value={form.data_categories || ''} onChange={e => setForm({ ...form, data_categories: e.target.value })} placeholder="e.g. staff_health, dbs" />
            </div>
          </div>
          <div>
            <label className={INPUT.label}>Containment Actions</label>
            <textarea className={INPUT.base} rows={2} value={form.containment_actions || ''} onChange={e => setForm({ ...form, containment_actions: e.target.value })} />
          </div>
        </div>
        <div className={MODAL.footer}>
          <button className={BTN.secondary} onClick={() => setShowModal(null)}>Cancel</button>
          <button className={BTN.primary} onClick={handleCreateBreach}>Report Breach</button>
        </div>
      </Modal>
    );
  }

  function renderConsentModal() {
    return (
      <Modal isOpen={true} onClose={() => setShowModal(null)} title="Record Consent" size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={INPUT.label}>Subject Type</label>
              <select className={INPUT.select} value={form.subject_type || 'staff'} onChange={e => setForm({ ...form, subject_type: e.target.value })}>
                <option value="staff">Staff</option>
                <option value="resident">Resident</option>
              </select>
            </div>
            <div>
              <label className={INPUT.label}>Subject ID</label>
              <input className={INPUT.base} value={form.subject_id || ''} onChange={e => setForm({ ...form, subject_id: e.target.value })} />
            </div>
          </div>
          <div>
            <label className={INPUT.label}>Subject Name</label>
            <input className={INPUT.base} value={form.subject_name || ''} onChange={e => setForm({ ...form, subject_name: e.target.value })} />
          </div>
          <div>
            <label className={INPUT.label}>Purpose</label>
            <input className={INPUT.base} value={form.purpose || ''} onChange={e => setForm({ ...form, purpose: e.target.value })} placeholder="e.g. Photo consent for marketing" />
          </div>
          <div>
            <label className={INPUT.label}>Legal Basis</label>
            <select className={INPUT.select} value={form.legal_basis || 'consent'} onChange={e => setForm({ ...form, legal_basis: e.target.value })}>
              {LEGAL_BASES.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </div>
          <div>
            <label className={INPUT.label}>Notes</label>
            <textarea className={INPUT.base} rows={2} value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <div className={MODAL.footer}>
          <button className={BTN.secondary} onClick={() => setShowModal(null)}>Cancel</button>
          <button className={BTN.primary} onClick={handleCreateConsent}>Record Consent</button>
        </div>
      </Modal>
    );
  }

  function renderComplaintModal() {
    return (
      <Modal isOpen={true} onClose={() => setShowModal(null)} title="Log DP Complaint" size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={INPUT.label}>Date Received</label>
              <input type="date" className={INPUT.base} value={form.date_received || ''} onChange={e => setForm({ ...form, date_received: e.target.value })} />
            </div>
            <div>
              <label className={INPUT.label}>Category</label>
              <select className={INPUT.select} value={form.category || 'access'} onChange={e => setForm({ ...form, category: e.target.value })}>
                {DP_COMPLAINT_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={INPUT.label}>Complainant Name</label>
            <input className={INPUT.base} value={form.complainant_name || ''} onChange={e => setForm({ ...form, complainant_name: e.target.value })} />
          </div>
          <div>
            <label className={INPUT.label}>Description</label>
            <textarea className={INPUT.base} rows={3} value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={INPUT.label}>Severity</label>
              <select className={INPUT.select} value={form.severity || 'low'} onChange={e => setForm({ ...form, severity: e.target.value })}>
                {BREACH_SEVERITIES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div className="flex items-center pt-6">
              <input type="checkbox" id="ico_involved" checked={form.ico_involved || false} onChange={e => setForm({ ...form, ico_involved: e.target.checked })} className="mr-2" />
              <label htmlFor="ico_involved" className="text-sm">ICO Involved</label>
            </div>
          </div>
        </div>
        <div className={MODAL.footer}>
          <button className={BTN.secondary} onClick={() => setShowModal(null)}>Cancel</button>
          <button className={BTN.primary} onClick={handleCreateComplaint}>Log Complaint</button>
        </div>
      </Modal>
    );
  }
}
