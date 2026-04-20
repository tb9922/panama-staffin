import { useState, useEffect, useCallback } from 'react';
import { useConfirm } from '../hooks/useConfirm.jsx';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import TabBar from '../components/TabBar.jsx';
import Modal from '../components/Modal.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import StaffPicker from '../components/StaffPicker.jsx';
import ResidentPicker from '../components/ResidentPicker.jsx';
import {
  getDataRequests, createDataRequest, updateDataRequest, gatherRequestData, executeErasure,
  getDataBreaches, createDataBreach, updateDataBreach, assessBreach,
  getRetentionSchedule, scanRetention,
  getConsentRecords, createConsentRecord, updateConsentRecord,
  getDPComplaints, createDPComplaint, updateDPComplaint,
  getAccessLog, getCurrentHome, getLoggedInUser,
  getRopaActivities, getDpiaAssessments,
  createSnapshot, getSnapshots, getSnapshot, signOffSnapshot, } from '../lib/api.js';
import {
  REQUEST_TYPES, BREACH_SEVERITIES, RISK_TO_RIGHTS, LEGAL_BASES,
  DP_COMPLAINT_CATEGORIES, DATA_CATEGORIES,
  calculateDeadline, daysUntilDeadline, isOverdue,
  calculateGdprControlsScore,
  getStatusBadgeKey, getSeverityBadgeKey, formatRequestType,
} from '../lib/gdpr.js';
import { useData } from '../contexts/DataContext.jsx';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import useTransientNotice from '../hooks/useTransientNotice.js';
import { todayLocalISO } from '../lib/localDates.js';

const TABS = [
  { id: 'overview',   label: 'Overview' },
  { id: 'requests',   label: 'Data Requests' },
  { id: 'breaches',   label: 'Breaches' },
  { id: 'retention',  label: 'Retention' },
  { id: 'consent',    label: 'Consent' },
  { id: 'complaints', label: 'Complaints' },
  { id: 'access',     label: 'Access Log' },
];

function focusField(id) {
  queueMicrotask(() => document.getElementById(id)?.focus());
}

export default function GdprDashboard() {
  const { canWrite } = useData();
  const canEdit = canWrite('gdpr');
  const { confirm, ConfirmDialog } = useConfirm();
  const { notice, showNotice, clearNotice } = useTransientNotice();
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [snapshotNotice, setSnapshotNotice] = useState(null);

  // Data state
  const [requests, setRequests] = useState([]);
  const [breaches, setBreaches] = useState([]);
  const [retention, setRetention] = useState([]);
  const [retentionScan, setRetentionScan] = useState(null);
  const [consent, setConsent] = useState([]);
  const [complaints, setComplaints] = useState([]);
  const [accessLogData, setAccessLogData] = useState([]);
  const [ropaData, setRopaData] = useState([]);
  const [dpiaData, setDpiaData] = useState([]);

  // Modal state
  const [showModal, setShowModal] = useState(null); // 'request' | 'breach' | 'consent' | 'complaint'
  const [form, setForm] = useState({});

  const [saving, setSaving] = useState(false);

  // ICO decision-record state
  const [decisionBreach, setDecisionBreach] = useState(null); // breach object for decision modal
  const [decisionForm, setDecisionForm] = useState({ manual_decision: false, decision_rationale: '' });

  // Snapshot state
  const [gdprSnapshots, setGdprSnapshots] = useState([]);
  const [viewingGdprSnapshot, setViewingGdprSnapshot] = useState(null);
  const [showGdprSnapshots, setShowGdprSnapshots] = useState(false);

  // Erasure confirmation state
  const [erasureConfirm, setErasureConfirm] = useState(null); // request id to erase
  const [erasureInput, setErasureInput] = useState('');

  const home = getCurrentHome();
  useDirtyGuard(showModal !== null || !!erasureConfirm);

  const load = useCallback(async () => {
    if (!home) return;
    setLoading(true);
    try {
      const [req, br, ret, con, comp, acc, ropa, dpia, retScan] = await Promise.all([
        getDataRequests(home),
        getDataBreaches(home),
        getRetentionSchedule().catch(() => []),
        getConsentRecords(home),
        getDPComplaints(home),
        getAccessLog(200).catch(() => []),  // admin-only — graceful fallback for non-admin
        getRopaActivities(home).catch(() => ({ rows: [] })),
        getDpiaAssessments(home).catch(() => ({ rows: [] })),
        scanRetention(home).catch(() => []),  // auto-scan on load for accurate live score
      ]);
      setRequests(req);
      setBreaches(br);
      setRetention(ret);
      setConsent(con);
      setComplaints(comp);
      setAccessLogData(acc);
      setRopaData(ropa?.rows || []);
      setDpiaData(dpia?.rows || []);
      setRetentionScan(retScan);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [home]);

  useEffect(() => { load(); }, [load]);

  const loadGdprSnapshots = useCallback(async () => {
    if (!home) return;
    try {
      const result = await getSnapshots(home, 'gdpr');
      setGdprSnapshots(Array.isArray(result) ? result : []);
    } catch (e) { console.warn('Failed to load GDPR snapshots:', e.message); setGdprSnapshots([]); }
  }, [home]);

  useEffect(() => { loadGdprSnapshots(); }, [loadGdprSnapshots]);

  async function handleCreateGdprSnapshot() {
    if (saving) return;
    setSaving(true);
    setSnapshotNotice(null);
    try {
      await createSnapshot(home, 'gdpr');
      await loadGdprSnapshots();
      showNotice('GDPR snapshot saved. Snapshot History has been refreshed.');
    } catch (e) {
      if (e?.status === 409 && /identical snapshot/i.test(e.message || '')) {
        await loadGdprSnapshots();
        setShowGdprSnapshots(true);
        setSnapshotNotice('This exact snapshot is already saved. Snapshot History has been opened below.');
      } else {
        setError(e.message);
      }
    }
    finally { setSaving(false); }
  }

  async function handleViewGdprSnapshot(id) {
    try { const snap = await getSnapshot(home, id); setViewingGdprSnapshot(snap); }
    catch (e) { setError(e.message); }
  }

  async function handleSignOffGdprSnapshot(id) {
    try {
      await signOffSnapshot(home, id, '');
      loadGdprSnapshots();
      if (viewingGdprSnapshot?.id === id) { const snap = await getSnapshot(home, id); setViewingGdprSnapshot(snap); }
      showNotice('GDPR snapshot signed off.');
    } catch (e) { setError(e.message); }
  }

  function closeModal() { setShowModal(null); setForm({}); }

  // ── Handlers ─────────────────────────────────────────────────────────────

  async function handleCreateRequest() {
    if (saving) return;
    if (!form.request_type) { setError('Request type is required.'); focusField('gdpr-request-type'); return; }
    if (!form.subject_type) { setError('Subject type is required.'); focusField('gdpr-request-subject-type'); return; }
    if (!form.subject_id) { setError('Please select a subject.'); focusField(form.subject_type === 'resident' ? 'gdpr-request-resident' : 'gdpr-request-staff'); return; }
    if (!form.date_received) { setError('Date received is required.'); focusField('gdpr-request-date'); return; }
    setSaving(true);
    try {
      const data = {
        ...form,
        deadline: form.deadline || calculateDeadline(form.date_received, 30),
      };
      await createDataRequest(home, data);
      setShowModal(null);
      setForm({});
      showNotice('Data request created.');
      load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  async function handleCreateBreach() {
    if (saving) return;
    if (!form.title) { setError('Breach title is required.'); focusField('gdpr-breach-title'); return; }
    if (!form.discovered_date) { setError('Discovered date is required.'); focusField('gdpr-breach-date'); return; }
    setSaving(true);
    try {
      const data = { ...form };
      // Combine date + time into UTC ISO datetime for precise ICO deadline calculation
      if (data.discovered_time) {
        data.discovered_date = new Date(`${data.discovered_date}T${data.discovered_time}Z`).toISOString();
      }
      delete data.discovered_time;
      if (data.data_categories && typeof data.data_categories === 'string') {
        data.data_categories = data.data_categories.split(',').map(s => s.trim()).filter(Boolean);
      }
      await createDataBreach(home, data);
      setShowModal(null);
      setForm({});
      showNotice('Data breach recorded.');
      load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  async function handleCreateConsent() {
    if (saving) return;
    if (!form.subject_type) { setError('Subject type is required.'); focusField('gdpr-consent-subject-type'); return; }
    if (!form.subject_id) { setError('Subject ID is required.'); focusField('gdpr-consent-subject-id'); return; }
    if (!form.purpose) { setError('Purpose is required.'); focusField('gdpr-consent-purpose'); return; }
    if (!form.legal_basis) { setError('Legal basis is required.'); focusField('gdpr-consent-legal-basis'); return; }
    setSaving(true);
    try {
      await createConsentRecord(home, form);
      setShowModal(null);
      setForm({});
      showNotice('Consent record created.');
      load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  async function handleCreateComplaint() {
    if (saving) return;
    if (!form.date_received) { setError('Date received is required.'); focusField('gdpr-complaint-date'); return; }
    if (!form.category) { setError('Complaint category is required.'); focusField('gdpr-complaint-category'); return; }
    if (form.subject_type && !form.subject_id) {
      setError('Please select the linked subject.');
      focusField(form.subject_type === 'resident' ? 'gdpr-complaint-resident' : 'gdpr-complaint-staff');
      return;
    }
    if (!form.description) { setError('Complaint description is required.'); focusField('gdpr-complaint-description'); return; }
    setSaving(true);
    try {
      await createDPComplaint(home, form);
      setShowModal(null);
      setForm({});
      showNotice('Data protection complaint logged.');
      load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  async function handleAssessBreach(id) {
    if (saving) return;
    setSaving(true);
    try {
      await assessBreach(home, id);
      showNotice('Breach assessment updated.');
      load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  function openDecisionModal(breach) {
    setDecisionBreach(breach);
    setDecisionForm({
      manual_decision: breach.manual_decision ?? breach.recommended_ico_notification ?? false,
      decision_rationale: breach.decision_rationale || '',
    });
  }

  async function handleSaveDecision() {
    if (saving || !decisionBreach) return;
    if (!decisionForm.decision_rationale?.trim()) { setError('Decision rationale is required'); return; }
    setSaving(true);
    try {
      const today = todayLocalISO();
      await updateDataBreach(home, decisionBreach.id, {
        manual_decision: decisionForm.manual_decision,
        decision_by: getLoggedInUser()?.username || 'admin',
        decision_at: today,
        decision_rationale: decisionForm.decision_rationale,
        ico_notifiable: decisionForm.manual_decision,
        _version: decisionBreach.version,
      });
      setDecisionBreach(null);
      showNotice('ICO decision recorded.');
      load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  async function handleGatherData(id) {
    if (saving) return;
    setSaving(true);
    try {
      const data = await gatherRequestData(home, id);
      // Download as JSON
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sar_data_${data.subject_id}_${todayLocalISO()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  function handleExecuteErasure(id) {
    setErasureConfirm(id);
    setErasureInput('');
  }

  async function confirmErasure() {
    if (saving || erasureInput !== 'ERASE' || !erasureConfirm) return;
    setSaving(true);
    try {
      await executeErasure(home, erasureConfirm);
      setErasureConfirm(null);
      setErasureInput('');
      showNotice('Erasure completed and records refreshed.');
      load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  async function handleUpdateStatus(type, id, status) {
    if (saving) return;
    const record = type === 'request' ? requests.find(r => r.id === id)
      : type === 'breach' ? breaches.find(b => b.id === id)
      : complaints.find(c => c.id === id);
    const _version = record?.version;
    setSaving(true);
    try {
      if (type === 'request') await updateDataRequest(home, id, { status, _version });
      else if (type === 'breach') await updateDataBreach(home, id, { status, _version });
      else if (type === 'complaint') await updateDPComplaint(home, id, { status, _version });
      showNotice(`${type === 'request' ? 'Request' : type === 'breach' ? 'Breach' : 'Complaint'} status updated to ${status}.`);
      load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  async function handleRunRetentionScan() {
    if (saving) return;
    setSaving(true);
    try {
      const scan = await scanRetention(home);
      setRetentionScan(scan);
      showNotice('Retention scan completed.');
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  async function handleWithdrawConsent(id) {
    if (saving) return;
    if (!await confirm('Withdraw this consent record? This cannot be undone.')) return;
    setSaving(true);
    try {
      const record = consent.find(c => c.id === id);
      await updateConsentRecord(home, id, { withdrawn: new Date().toISOString(), _version: record?.version });
      showNotice('Consent withdrawn.');
      load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  // ── Compliance Score ─────────────────────────────────────────────────────

  // Use the same 7-domain controls model that snapshots use, so live view matches saved snapshots
  const controlsScore = calculateGdprControlsScore({ requests, breaches, complaints, retentionScan, consent, ropa: ropaData, dpia: dpiaData });
  const compliance = controlsScore.operationalHealth; // backward compat for issues list
  const bandColors = { Good: 'green', Adequate: 'blue', 'Requires Improvement': 'amber', Inadequate: 'red' };

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) return <div className={PAGE.container}><LoadingState card message="Loading GDPR data..." /></div>;

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>GDPR & Data Protection</h1>
          <p className={PAGE.subtitle}>UK GDPR compliance — data requests, breaches, retention, consent</p>
        </div>
        {canEdit && <button onClick={handleCreateGdprSnapshot} disabled={saving} className={`${BTN.secondary} ${BTN.sm}`}>Save Snapshot</button>}
      </div>

      {snapshotNotice && (
        <InlineNotice className="mb-4" variant="warning" onDismiss={() => setSnapshotNotice(null)}>
          {snapshotNotice}
        </InlineNotice>
      )}
      {notice && (
        <InlineNotice className="mb-4" variant={notice.variant} onDismiss={clearNotice}>
          {notice.content}
        </InlineNotice>
      )}
      {error && <ErrorState className="mb-4" title="Unable to complete GDPR action" message={error} onRetry={load} />}

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

      {/* ICO Decision Record Modal */}
      {decisionBreach && (
        <Modal isOpen={true} onClose={() => setDecisionBreach(null)} title="ICO Notification Decision" size="md">
          <div className="space-y-4">
            <div className="p-3 rounded bg-gray-50 text-sm">
              <div className="font-medium text-gray-700">{decisionBreach.title}</div>
              <div className="text-xs text-gray-500 mt-1">
                Severity: {decisionBreach.severity} | Risk: {decisionBreach.risk_to_rights} | Affected: {decisionBreach.individuals_affected}
              </div>
              {decisionBreach.recommended_ico_notification != null && (
                <div className="mt-2">
                  <span className="text-xs font-medium text-gray-600">AI Assessment: </span>
                  <span className={decisionBreach.recommended_ico_notification ? BADGE.red : BADGE.green}>
                    {decisionBreach.recommended_ico_notification ? 'ICO notification recommended' : 'ICO notification not required'}
                  </span>
                </div>
              )}
            </div>
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={decisionForm.manual_decision}
                  onChange={e => setDecisionForm({ ...decisionForm, manual_decision: e.target.checked })}
                  className="rounded border-gray-300" />
                <span className={INPUT.label + ' mb-0'}>Notify the ICO about this breach</span>
              </label>
            </div>
            <div>
              <label className={INPUT.label}>Decision Rationale</label>
              <textarea className={INPUT.base} rows={3} value={decisionForm.decision_rationale}
                onChange={e => setDecisionForm({ ...decisionForm, decision_rationale: e.target.value })}
                placeholder="Record the reasoning behind this decision for audit purposes..." />
            </div>
          </div>
          <div className={MODAL.footer}>
            <button className={BTN.secondary} onClick={() => setDecisionBreach(null)}>Cancel</button>
            <button className={BTN.primary} onClick={handleSaveDecision} disabled={saving}>
              {saving ? 'Saving...' : 'Record Decision'}
            </button>
          </div>
        </Modal>
      )}

      {/* GDPR Snapshot Viewing Modal */}
      {viewingGdprSnapshot && (
        <Modal isOpen={true} onClose={() => setViewingGdprSnapshot(null)} title={`GDPR Snapshot — ${viewingGdprSnapshot.computed_at?.slice(0, 10)}`} size="xl">
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className={CARD.padded}><div className="text-xs text-gray-500">Score</div><div className="text-2xl font-bold">{viewingGdprSnapshot.overall_score}%</div></div>
              <div className={CARD.padded}><div className="text-xs text-gray-500">Band</div><div className="text-lg font-semibold">{viewingGdprSnapshot.band}</div></div>
              <div className={CARD.padded}><div className="text-xs text-gray-500">Engine</div><div className="text-lg">{viewingGdprSnapshot.engine_version}</div></div>
              <div className={CARD.padded}><div className="text-xs text-gray-500">Signed Off</div><div className="text-lg">{viewingGdprSnapshot.signed_off_by || 'Pending'}</div></div>
            </div>
            {viewingGdprSnapshot.result?.domains && (
              <div>
                <div className="text-sm font-semibold text-gray-600 mb-2">ICO Domain Scores</div>
                <div className="space-y-2">
                  {Object.entries(viewingGdprSnapshot.result.domains).map(([id, d]) => (
                    <div key={id} className="flex items-center gap-3">
                      <div className="w-40 text-sm text-gray-700">{d.label}</div>
                      <div className="flex-1 bg-gray-200 rounded-full h-2">
                        <div className={`h-2 rounded-full ${d.score >= 90 ? 'bg-green-500' : d.score >= 70 ? 'bg-blue-500' : d.score >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                          style={{ width: `${d.score}%` }} />
                      </div>
                      <div className="w-12 text-right text-sm font-medium">{d.score}%</div>
                      <span className={BADGE[d.band?.badgeKey || 'gray']}>{d.confidence || '-'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {viewingGdprSnapshot.result?.operationalHealth && (
              <div className="text-sm text-gray-600">
                <span className="font-medium">Operational Health:</span> {viewingGdprSnapshot.result.operationalHealth.score}/100
                {viewingGdprSnapshot.result.operationalHealth.issues?.length > 0 && (
                  <span className="text-red-500 ml-2">({viewingGdprSnapshot.result.operationalHealth.issues.length} issues)</span>
                )}
              </div>
            )}
          </div>
          <div className={MODAL.footer}>
            <button className={BTN.secondary} onClick={() => setViewingGdprSnapshot(null)}>Close</button>
          </div>
        </Modal>
      )}

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
      {ConfirmDialog}
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
        {/* Controls Score (7-domain ICO framework) */}
        <div className={CARD.padded}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">GDPR Controls Score</h2>
            <span className={BADGE[bandColors[controlsScore.band?.label] || 'gray']}>
              {controlsScore.overallScore}/100 — {controlsScore.band?.label || 'Unknown'}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3 mb-3">
            <div className={`h-3 rounded-full transition-all ${
              controlsScore.overallScore >= 90 ? 'bg-green-500' : controlsScore.overallScore >= 70 ? 'bg-blue-500' : controlsScore.overallScore >= 50 ? 'bg-amber-500' : 'bg-red-500'
            }`} style={{ width: `${controlsScore.overallScore}%` }} />
          </div>
          {/* Per-domain breakdown */}
          {controlsScore.domains && (
            <div className="space-y-2 mt-3">
              {Object.entries(controlsScore.domains).map(([id, d]) => (
                <div key={id} className="flex items-center gap-3">
                  <div className="w-36 text-xs text-gray-600 truncate">{d.label}</div>
                  <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                    <div className={`h-1.5 rounded-full ${d.score >= 90 ? 'bg-green-500' : d.score >= 70 ? 'bg-blue-500' : d.score >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                      style={{ width: `${d.score}%` }} />
                  </div>
                  <div className="w-10 text-right text-xs font-medium">{d.score}%</div>
                  <span className={`text-[10px] ${BADGE[d.confidence === 'high' ? 'green' : d.confidence === 'medium' ? 'amber' : 'gray']}`}>{d.confidence}</span>
                </div>
              ))}
            </div>
          )}
          {/* Operational issues from legacy scorer */}
          {compliance.issues.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <div className="text-xs font-semibold text-gray-500 mb-1">Operational Issues</div>
              <ul className="text-sm text-gray-600 space-y-1">
                {compliance.issues.map((issue, i) => <li key={i} className="flex items-center gap-2"><span className="text-red-500">!</span> {issue}</li>)}
              </ul>
            </div>
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

        {/* Snapshot History */}
        <div>
          <button onClick={() => setShowGdprSnapshots(!showGdprSnapshots)} className={`${BTN.ghost} ${BTN.sm} mb-2`}>
            {showGdprSnapshots ? 'Hide' : 'Show'} Snapshot History ({gdprSnapshots.length})
          </button>
          {showGdprSnapshots && (
            gdprSnapshots.length > 0 ? (
              <div className={CARD.flush}>
                <table className={TABLE.table}>
                  <thead className={TABLE.thead}>
                    <tr><th className={TABLE.th}>Date</th><th className={TABLE.th}>Score</th><th className={TABLE.th}>Band</th><th className={TABLE.th}>Engine</th><th className={TABLE.th}>Sign-off</th><th className={TABLE.th}>Actions</th></tr>
                  </thead>
                  <tbody>
                    {gdprSnapshots.map(s => (
                      <tr key={s.id} className={TABLE.tr}>
                        <td className={TABLE.td}>{s.computed_at?.slice(0, 10)}</td>
                        <td className={TABLE.td}>{s.overall_score}%</td>
                        <td className={TABLE.td}><span className={BADGE[s.band === 'Good' ? 'green' : s.band === 'Adequate' ? 'blue' : s.band === 'Requires Improvement' ? 'amber' : 'red']}>{s.band}</span></td>
                        <td className={TABLE.td}><span className={BADGE.gray}>{s.engine_version}</span></td>
                        <td className={TABLE.td}>{s.signed_off_by ? <span className={BADGE.green}>{s.signed_off_by}</span> : <span className={BADGE.gray}>Pending</span>}</td>
                        <td className={TABLE.td}>
                          <div className="flex gap-1">
                            <button className={`${BTN.ghost} ${BTN.xs}`} onClick={() => handleViewGdprSnapshot(s.id)}>View</button>
                            {!s.signed_off_by && canEdit && <button className={`${BTN.ghost} ${BTN.xs}`} onClick={() => handleSignOffGdprSnapshot(s.id)}>Sign Off</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={CARD.padded}>
                <EmptyState compact title="No saved snapshots yet" description="Save a GDPR snapshot to freeze the live controls score, issues, and sign-off state." />
              </div>
            )
          )}
        </div>
      </div>
    );
  }

  function renderRequests() {
    return (
      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Data Requests</h2>
          {canEdit && <button className={BTN.primary + ' ' + BTN.sm} onClick={() => { setForm({ request_type: 'sar', subject_type: 'staff', date_received: todayLocalISO() }); setShowModal('request'); }}>
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
                {requests.length === 0 && (
                  <tr>
                    <td colSpan={6} className={TABLE.empty}>
                      <EmptyState compact title="No data requests" description="Subject access, rectification, erasure, and portability requests will appear here." />
                    </td>
                  </tr>
                )}
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
          {canEdit && <button className={BTN.primary + ' ' + BTN.sm} onClick={() => { const now = new Date(); setForm({ severity: 'low', risk_to_rights: 'unlikely', discovered_date: todayLocalISO(now), discovered_time: now.toTimeString().slice(0, 5) }); setShowModal('breach'); }}>
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
                {breaches.length === 0 && (
                  <tr>
                    <td colSpan={6} className={TABLE.empty}>
                      <EmptyState compact title="No data breaches recorded" description="Potential or confirmed personal-data breaches will appear here with ICO decision support and status tracking." />
                    </td>
                  </tr>
                )}
                {breaches.map(b => (
                  <tr key={b.id} className={TABLE.tr}>
                    <td className={TABLE.td}>{b.title}<br /><span className="text-xs text-gray-400">{b.individuals_affected} affected</span></td>
                    <td className={TABLE.td}>{b.discovered_date?.slice(0, 10)}{b.discovered_date?.length > 10 && <><br /><span className="text-xs text-gray-400">{new Date(b.discovered_date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span></>}</td>
                    <td className={TABLE.td}><span className={BADGE[getSeverityBadgeKey(b.severity)]}>{b.severity}</span></td>
                    <td className={TABLE.td}>
                      {b.ico_notifiable ? (
                        b.ico_notified ? <span className={BADGE.green}>Notified</span> : <span className={BADGE.red}>Required</span>
                      ) : b.ico_notifiable === false ? <span className={BADGE.gray}>Not Required</span> : <span className={BADGE.gray}>Not Assessed</span>}
                      {b.decision_at && <><br /><span className="text-[10px] text-gray-400">Decision by {b.decision_by}</span></>}
                    </td>
                    <td className={TABLE.td}><span className={BADGE[getStatusBadgeKey(b.status)]}>{b.status}</span></td>
                    <td className={TABLE.td}>
                      {canEdit && <div className="flex gap-1 flex-wrap">
                        <button className={BTN.ghost + ' ' + BTN.xs} onClick={() => handleAssessBreach(b.id)}>Assess</button>
                        {b.ico_notifiable != null && <button className={BTN.ghost + ' ' + BTN.xs} onClick={() => openDecisionModal(b)}>Decision</button>}
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
          {canEdit && <button className={BTN.secondary + ' ' + BTN.sm} onClick={handleRunRetentionScan}>Run Scan</button>}
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
                {consent.length === 0 && (
                  <tr>
                    <td colSpan={6} className={TABLE.empty}>
                      <EmptyState compact title="No consent records" description="Record explicit consent decisions here when consent is the legal basis for processing." />
                    </td>
                  </tr>
                )}
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
          {canEdit && <button className={BTN.primary + ' ' + BTN.sm} onClick={() => { setForm({ category: 'access', severity: 'low', date_received: todayLocalISO() }); setShowModal('complaint'); }}>
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
                {complaints.length === 0 && (
                  <tr>
                    <td colSpan={7} className={TABLE.empty}>
                      <EmptyState compact title="No DP complaints" description="Complaints about privacy, access, retention, or consent will appear here for investigation and closure." />
                    </td>
                  </tr>
                )}
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
                {accessLogData.length === 0 && (
                  <tr>
                    <td colSpan={7} className={TABLE.empty}>
                      <EmptyState compact title="No access log entries" description="Audit log access events will appear here once requests are made against protected data endpoints." />
                    </td>
                  </tr>
                )}
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
      <Modal isOpen={true} onClose={closeModal} title="New Data Request" size="lg">
        <div className="space-y-4">
          <div>
            <label className={INPUT.label}>Request Type</label>
            <select id="gdpr-request-type" className={INPUT.select} value={form.request_type || ''} onChange={e => setForm({ ...form, request_type: e.target.value })}>
              {REQUEST_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={INPUT.label}>Subject Type</label>
              <select id="gdpr-request-subject-type" className={INPUT.select} value={form.subject_type || 'staff'} onChange={e => setForm({ ...form, subject_type: e.target.value })}>
                <option value="staff">Staff</option>
                <option value="resident">Resident</option>
              </select>
            </div>
            <div>
              {form.subject_type === 'resident' ? (
                <ResidentPicker id="gdpr-request-resident" label="Resident" required value={form.subject_id}
                  onChange={(id, resident) => setForm({ ...form, subject_id: id ? String(id) : '', subject_name: resident?.resident_name || '' })} />
              ) : (
                <StaffPicker id="gdpr-request-staff" label="Staff Member" required value={form.subject_id}
                  onChange={val => {
                    setForm({ ...form, subject_id: val });
                  }} />
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={INPUT.label}>Date Received</label>
              <input id="gdpr-request-date" type="date" className={INPUT.base} value={form.date_received || ''} onChange={e => setForm({ ...form, date_received: e.target.value })} />
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
          <button className={BTN.secondary} onClick={closeModal}>Cancel</button>
          <button className={BTN.primary} onClick={handleCreateRequest} disabled={saving}>{saving ? 'Creating...' : 'Create Request'}</button>
        </div>
      </Modal>
    );
  }

  function renderBreachModal() {
    return (
      <Modal isOpen={true} onClose={closeModal} title="Report Data Breach" size="lg">
        <div className="space-y-4">
          <div>
            <label className={INPUT.label}>Title</label>
            <input id="gdpr-breach-title" className={INPUT.base} value={form.title || ''} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Brief description of the breach" />
          </div>
          <div>
            <label className={INPUT.label}>Description</label>
            <textarea className={INPUT.base} rows={3} value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label className={INPUT.label}>Discovered Date</label>
              <input id="gdpr-breach-date" type="date" className={INPUT.base} value={form.discovered_date || ''} onChange={e => setForm({ ...form, discovered_date: e.target.value })} />
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
          <button className={BTN.secondary} onClick={closeModal}>Cancel</button>
          <button className={BTN.primary} onClick={handleCreateBreach} disabled={saving}>{saving ? 'Reporting...' : 'Report Breach'}</button>
        </div>
      </Modal>
    );
  }

  function renderConsentModal() {
    return (
      <Modal isOpen={true} onClose={closeModal} title="Record Consent" size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={INPUT.label}>Subject Type</label>
              <select id="gdpr-consent-subject-type" className={INPUT.select} value={form.subject_type || 'staff'} onChange={e => setForm({ ...form, subject_type: e.target.value })}>
                <option value="staff">Staff</option>
                <option value="resident">Resident</option>
              </select>
            </div>
            <div>
              <label className={INPUT.label}>Subject ID</label>
              <input id="gdpr-consent-subject-id" className={INPUT.base} value={form.subject_id || ''} onChange={e => setForm({ ...form, subject_id: e.target.value })} />
            </div>
          </div>
          <div>
            <label className={INPUT.label}>Subject Name</label>
            <input className={INPUT.base} value={form.subject_name || ''} onChange={e => setForm({ ...form, subject_name: e.target.value })} />
          </div>
          <div>
            <label className={INPUT.label}>Purpose</label>
            <input id="gdpr-consent-purpose" className={INPUT.base} value={form.purpose || ''} onChange={e => setForm({ ...form, purpose: e.target.value })} placeholder="e.g. Photo consent for marketing" />
          </div>
          <div>
            <label className={INPUT.label}>Legal Basis</label>
            <select id="gdpr-consent-legal-basis" className={INPUT.select} value={form.legal_basis || 'consent'} onChange={e => setForm({ ...form, legal_basis: e.target.value })}>
              {LEGAL_BASES.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </div>
          <div>
            <label className={INPUT.label}>Notes</label>
            <textarea className={INPUT.base} rows={2} value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <div className={MODAL.footer}>
          <button className={BTN.secondary} onClick={closeModal}>Cancel</button>
          <button className={BTN.primary} onClick={handleCreateConsent} disabled={saving}>{saving ? 'Recording...' : 'Record Consent'}</button>
        </div>
      </Modal>
    );
  }

  function renderComplaintModal() {
    return (
      <Modal isOpen={true} onClose={closeModal} title="Log DP Complaint" size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={INPUT.label}>Date Received</label>
              <input id="gdpr-complaint-date" type="date" className={INPUT.base} value={form.date_received || ''} onChange={e => setForm({ ...form, date_received: e.target.value })} />
            </div>
            <div>
              <label className={INPUT.label}>Category</label>
              <select id="gdpr-complaint-category" className={INPUT.select} value={form.category || 'access'} onChange={e => setForm({ ...form, category: e.target.value })}>
                {DP_COMPLAINT_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={INPUT.label}>Complainant Name</label>
            <input className={INPUT.base} value={form.complainant_name || ''} onChange={e => setForm({ ...form, complainant_name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={INPUT.label}>Link to Subject</label>
                <select
                  className={INPUT.select}
                  value={form.subject_type || ''}
                  onChange={e => setForm({ ...form, subject_type: e.target.value || null, subject_id: null })}
                >
                <option value="">None</option>
                <option value="staff">Staff</option>
                <option value="resident">Resident</option>
              </select>
            </div>
            <div>
              {form.subject_type === 'resident' ? (
                <ResidentPicker
                  id="gdpr-complaint-resident"
                  label="Resident"
                  value={form.subject_id || ''}
                  onChange={(id, resident) => setForm({
                    ...form,
                    subject_id: id ? String(id) : null,
                    complainant_name: resident?.resident_name || form.complainant_name || '',
                  })}
                />
              ) : form.subject_type === 'staff' ? (
                <StaffPicker
                  id="gdpr-complaint-staff"
                  label="Staff Member"
                  value={form.subject_id || ''}
                  onChange={(val) => setForm({ ...form, subject_id: val || null })}
                />
              ) : (
                <div>
                  <label className={INPUT.label}>Linked Record</label>
                  <input className={INPUT.base} value="" disabled placeholder="Optional" />
                </div>
              )}
            </div>
          </div>
          <div>
            <label className={INPUT.label}>Description</label>
            <textarea id="gdpr-complaint-description" className={INPUT.base} rows={3} value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })} />
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
          <button className={BTN.secondary} onClick={closeModal}>Cancel</button>
          <button className={BTN.primary} onClick={handleCreateComplaint} disabled={saving}>{saving ? 'Logging...' : 'Log Complaint'}</button>
        </div>
      </Modal>
    );
  }
}
