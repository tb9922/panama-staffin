import { useState, useMemo, useEffect, useCallback } from 'react';
import { CARD, BTN, BADGE, INPUT, MODAL, PAGE } from '../lib/design.js';
import { formatDate } from '../lib/rotation.js';
import { useLiveDate } from '../hooks/useLiveDate.js';
import { downloadXLSX } from '../lib/excel.js';
import Modal from '../components/Modal.jsx';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import {
  getCurrentHome, getSchedulingData, getTrainingData,
  getIncidents, getComplaints, getMaintenance, getIpcAudits,
  getRisks, getPolicies, getWhistleblowingConcerns, getDols, getCareCertData,
  getCqcEvidence, createCqcEvidence,
  deleteCqcEvidence, getLoggedInUser, logReportDownload,
  createSnapshot, getSnapshots, signOffSnapshot,
} from '../lib/api.js';
import {
  QUALITY_STATEMENTS, METRIC_DEFINITIONS, ENGINE_VERSION,
  calculateComplianceScore, getDateRange, getEvidenceForStatement,
} from '../lib/cqc.js';
import { useData } from '../contexts/DataContext.jsx';

const CATEGORY_LABELS = { safe: 'Safe', effective: 'Effective', caring: 'Caring', responsive: 'Responsive', 'well-led': 'Well-Led' };
const CATEGORY_COLORS = {
  safe: 'text-blue-700 bg-blue-50 border-blue-200',
  effective: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  caring: 'text-pink-700 bg-pink-50 border-pink-200',
  responsive: 'text-amber-700 bg-amber-50 border-amber-200',
  'well-led': 'text-purple-700 bg-purple-50 border-purple-200',
};

const RANGE_OPTIONS = [
  { days: 28, label: '28 Days' },
  { days: 90, label: '90 Days' },
  { days: 365, label: '1 Year' },
];

const SCORE_STYLES = {
  emerald: { card: 'rounded-xl p-3 bg-emerald-50 border border-emerald-200', label: 'text-xs font-medium text-emerald-600', value: 'text-3xl font-bold text-emerald-700 mt-0.5' },
  blue:    { card: 'rounded-xl p-3 bg-blue-50 border border-blue-200',       label: 'text-xs font-medium text-blue-600',    value: 'text-3xl font-bold text-blue-700 mt-0.5' },
  amber:   { card: 'rounded-xl p-3 bg-amber-50 border border-amber-200',     label: 'text-xs font-medium text-amber-600',   value: 'text-3xl font-bold text-amber-700 mt-0.5' },
  red:     { card: 'rounded-xl p-3 bg-red-50 border border-red-200',         label: 'text-xs font-medium text-red-600',     value: 'text-3xl font-bold text-red-700 mt-0.5' },
};

function metricColor(value, lowerIsBetter) {
  if (lowerIsBetter) return value <= 5 ? 'text-emerald-600' : value <= 15 ? 'text-amber-600' : 'text-red-600';
  return value >= 90 ? 'text-emerald-600' : value >= 70 ? 'text-amber-600' : 'text-red-600';
}

export default function CQCEvidence() {
  const homeSlug = getCurrentHome();
  const [moduleData, setModuleData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!homeSlug) return;
    // CQC scoring needs up to 365 days of overrides for the 1-year view
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate()))
      .toISOString().slice(0, 10);
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 7))
      .toISOString().slice(0, 10);

    Promise.all([
      getSchedulingData(homeSlug, { from, to }),
      getTrainingData(homeSlug).catch(e => { console.warn('Failed to load training data:', e.message); return {}; }),
      getIncidents(homeSlug).catch(e => { console.warn('Failed to load incidents:', e.message); return { incidents: [] }; }),
      getComplaints(homeSlug).catch(e => { console.warn('Failed to load complaints:', e.message); return { complaints: [], surveys: [] }; }),
      getMaintenance(homeSlug).catch(e => { console.warn('Failed to load maintenance:', e.message); return { checks: [] }; }),
      getIpcAudits(homeSlug).catch(e => { console.warn('Failed to load IPC audits:', e.message); return { audits: [] }; }),
      getRisks(homeSlug).catch(e => { console.warn('Failed to load risks:', e.message); return { risks: [] }; }),
      getPolicies(homeSlug).catch(e => { console.warn('Failed to load policies:', e.message); return { policies: [] }; }),
      getWhistleblowingConcerns(homeSlug).catch(e => { console.warn('Failed to load whistleblowing:', e.message); return { concerns: [] }; }),
      getDols(homeSlug).catch(e => { console.warn('Failed to load DoLS:', e.message); return { dols: [], mcaAssessments: [] }; }),
      getCareCertData(homeSlug).catch(e => { console.warn('Failed to load care cert:', e.message); return { careCert: {} }; }),
    ]).then(([sched, train, inc, comp, maint, ipc, risks, pol, wb, dols, cc]) => {
      setModuleData({
        config: sched.config,
        staff: sched.staff,
        overrides: sched.overrides,
        onboarding: sched.onboarding || {},
        training: train.training || sched.training || {},
        supervisions: train.supervisions || {},
        appraisals: train.appraisals || {},
        fire_drills: train.fireDrills || [],
        incidents: inc.incidents || [],
        complaints: comp.complaints || [],
        complaint_surveys: comp.surveys || [],
        maintenance: maint.checks || [],
        ipc_audits: ipc.audits || [],
        risk_register: risks.risks || [],
        policy_reviews: pol.policies || [],
        whistleblowing_concerns: wb.concerns || [],
        dols: dols.dols || [],
        mca_assessments: dols.mcaAssessments || [],
        care_certificate: cc.careCert || {},
      });
    }).catch(e => setError(e.message || 'Failed to load CQC data'))
      .finally(() => setLoading(false));
  }, [homeSlug]);

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400 text-sm" role="status">Loading CQC data...</div>;
  if (error || !moduleData) return <div className="p-6 text-red-600" role="alert">{error || 'Failed to load CQC data'}</div>;

  return <CQCEvidenceInner data={moduleData} />;
}

function CQCEvidenceInner({ data }) {
  const { canWrite } = useData();
  const canEdit = canWrite('compliance');
  const homeSlug = getCurrentHome();
  const [evidence, setEvidence] = useState([]);
  const [evidenceLoading, setEvidenceLoading] = useState(true);
  const [dateRangeDays, setDateRangeDays] = useState(28);
  const [expandedStatement, setExpandedStatement] = useState(null);
  const [showAddEvidence, setShowAddEvidence] = useState(false);
  const [evidenceForm, setEvidenceForm] = useState({ quality_statement: '', type: 'qualitative', title: '', description: '', date_from: '', date_to: '' });
  const [generating, setGenerating] = useState(false);
  const [savingEvidence, setSavingEvidence] = useState(false);
  const [snapshots, setSnapshots] = useState([]);
  const [snapshotSaving, setSnapshotSaving] = useState(false);

  useDirtyGuard(showAddEvidence);

  const loadEvidence = useCallback(async () => {
    try {
      const home = getCurrentHome();
      const result = await getCqcEvidence(home);
      setEvidence(result.evidence || []);
    } catch (err) {
      // Non-fatal: evidence list stays empty rather than breaking the whole page
      console.error('Failed to load CQC evidence:', err);
    } finally {
      setEvidenceLoading(false);
    }
  }, []);

  useEffect(() => { loadEvidence(); }, [loadEvidence]);

  // Load snapshot history
  useEffect(() => {
    if (!homeSlug) return;
    getSnapshots(homeSlug, 'cqc').then(setSnapshots).catch(() => {});
  }, [homeSlug]);

  const today = useLiveDate();
  const dateRange = useMemo(() => getDateRange(dateRangeDays), [dateRangeDays]);

  // Merge live evidence state into data for score computation and evidence-for-statement calls
  const dataWithEvidence = useMemo(() => {
    if (!data) return null;
    return { ...data, cqc_evidence: evidence };
  }, [data, evidence]);

  const score = useMemo(() => {
    if (!dataWithEvidence?.config) return null;
    return calculateComplianceScore(dataWithEvidence, dateRange, today);
  }, [dataWithEvidence, dateRange, today]);

  const evidenceByStatement = useMemo(() => {
    if (!dataWithEvidence?.config) return {};
    const map = {};
    for (const qs of QUALITY_STATEMENTS) {
      map[qs.id] = getEvidenceForStatement(qs.id, dataWithEvidence, dateRange, today);
    }
    return map;
  }, [dataWithEvidence, dateRange, today]);

  if (!data?.config || !score) {
    return <div className={PAGE.container}><p className="text-gray-400">Loading...</p></div>;
  }

  const bandColorMap = { green: 'emerald', blue: 'blue', amber: 'amber', red: 'red' };
  const scoreStyle = SCORE_STYLES[bandColorMap[score.band.color]] || SCORE_STYLES.red;

  async function handleTakeSnapshot() {
    if (snapshotSaving || !score) return;
    setSnapshotSaving(true);
    try {
      await createSnapshot(homeSlug, {
        engine: 'cqc',
        engine_version: ENGINE_VERSION,
        window_from: formatDate(dateRange.from),
        window_to: formatDate(dateRange.to),
        overall_score: score.overallScore,
        band: score.band.label,
        result: { metrics: score.metrics, availableWeight: score.availableWeight },
      });
      const updated = await getSnapshots(homeSlug, 'cqc');
      setSnapshots(updated);
    } catch (e) {
      alert(e.message || 'Failed to save snapshot');
    } finally {
      setSnapshotSaving(false);
    }
  }

  async function handleSignOff(snapshotId) {
    const notes = window.prompt('Sign-off notes (optional):');
    if (notes === null) return; // cancelled
    try {
      await signOffSnapshot(homeSlug, snapshotId, notes || undefined);
      const updated = await getSnapshots(homeSlug, 'cqc');
      setSnapshots(updated);
    } catch (e) {
      alert(e.message || 'Sign-off failed');
    }
  }

  function openAddEvidence(statementId) {
    setEvidenceForm({ quality_statement: statementId || '', type: 'qualitative', title: '', description: '', date_from: '', date_to: '' });
    setShowAddEvidence(true);
  }

  async function handleSaveEvidence() {
    if (savingEvidence) return;
    if (!evidenceForm.quality_statement || !evidenceForm.title.trim()) return;
    const home = getCurrentHome();
    setSavingEvidence(true);
    try {
      await createCqcEvidence(home, {
        ...evidenceForm,
        title: evidenceForm.title.trim(),
        description: evidenceForm.description.trim(),
        date_to: evidenceForm.date_to || null,
        added_by: getLoggedInUser()?.username || 'admin',
      });
      setShowAddEvidence(false);
      await loadEvidence();
    } catch (err) {
      alert('Failed to save evidence: ' + err.message);
    } finally {
      setSavingEvidence(false);
    }
  }

  async function handleDeleteEvidence(evId) {
    if (savingEvidence) return;
    if (!confirm('Remove this evidence item?')) return;
    const home = getCurrentHome();
    setSavingEvidence(true);
    try {
      await deleteCqcEvidence(home, evId);
      await loadEvidence();
    } catch (err) {
      alert('Failed to delete evidence: ' + err.message);
    } finally {
      setSavingEvidence(false);
    }
  }

  async function handleGeneratePDF() {
    setGenerating(true);
    try {
      await new Promise(r => setTimeout(r, 100));
      const { generateEvidencePackPDF } = await import('../lib/pdfReports.js');
      generateEvidencePackPDF(dataWithEvidence, dateRangeDays);
      logReportDownload('cqc-evidence', `${dateRangeDays} days`);
    } catch (err) {
      alert('Failed to generate PDF: ' + err.message);
    } finally {
      setGenerating(false);
    }
  }

  function handleExportExcel() {
    const rows = [];
    for (const qs of QUALITY_STATEMENTS) {
      const ev = evidenceByStatement[qs.id];
      if (!ev) continue;
      for (const ae of ev.autoEvidence) {
        rows.push([qs.cqcRef, qs.name, 'Auto', ae.label, `${ae.value}${ae.unit}`, ae.detail || '', ae.source]);
      }
      for (const me of ev.manualEvidence) {
        rows.push([qs.cqcRef, qs.name, me.type, me.title, '', me.description, `${me.date_from || ''} - ${me.date_to || 'ongoing'}`]);
      }
    }
    downloadXLSX(`CQC_Evidence_${formatDate(new Date())}`, [{
      name: 'CQC Evidence',
      headers: ['CQC Ref', 'Statement', 'Type', 'Title', 'Value', 'Detail', 'Source / Date Range'],
      rows,
    }]);
  }

  const categories = ['safe', 'effective', 'caring', 'responsive', 'well-led'];

  return (
    <div className={PAGE.container}>
      {/* Header */}
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>CQC Compliance Evidence</h1>
          <p className={PAGE.subtitle}>Single Assessment Framework — staffing compliance scorecard and evidence pack</p>
        </div>
        <div className="flex gap-2">
          {canEdit && (
            <button onClick={handleTakeSnapshot} disabled={snapshotSaving} className={`${BTN.secondary} ${BTN.sm}`}>
              {snapshotSaving ? 'Saving...' : 'Take Snapshot'}
            </button>
          )}
          <button onClick={handleExportExcel} className={`${BTN.secondary} ${BTN.sm}`}>Export Excel</button>
          <button onClick={handleGeneratePDF} disabled={generating} className={BTN.primary}>
            {generating ? 'Generating...' : 'Generate Evidence Pack'}
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {/* Overall Score */}
        <div className={scoreStyle.card}>
          <div className={scoreStyle.label}>Overall Score</div>
          <div className={scoreStyle.value}>{score.overallScore}%</div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className={BADGE[score.band.badgeKey]}>{score.band.label}</span>
            <span className="text-[10px] text-gray-400">{score.availableMetrics.length} of {METRIC_DEFINITIONS.length} metrics</span>
          </div>
        </div>

        {/* Training */}
        <div className="rounded-xl p-3 bg-blue-50 border border-blue-200">
          <div className="text-xs font-medium text-blue-600">Training Compliance</div>
          <div className="text-2xl font-bold text-blue-700 mt-0.5">{score.metrics.trainingCompliance?.raw ?? '-'}%</div>
          <div className="text-[10px] text-blue-500">Regulation 18 — 20% weight</div>
        </div>

        {/* Fill Rate */}
        <div className="rounded-xl p-3 bg-emerald-50 border border-emerald-200">
          <div className="text-xs font-medium text-emerald-600">Staffing Fill Rate</div>
          <div className="text-2xl font-bold text-emerald-700 mt-0.5">{score.metrics.staffingFillRate?.raw ?? '-'}%</div>
          <div className="text-[10px] text-emerald-500">{score.metrics.staffingFillRate?.detail?.shortfallDays || 0} shortfall days — 20% weight</div>
        </div>

        {/* Agency */}
        <div className={`rounded-xl p-3 ${(score.metrics.agencyDependency?.raw || 0) > 10 ? 'bg-red-50 border border-red-200' : 'bg-gray-50 border border-gray-200'}`}>
          <div className={`text-xs font-medium ${(score.metrics.agencyDependency?.raw || 0) > 10 ? 'text-red-600' : 'text-gray-600'}`}>Agency Dependency</div>
          <div className={`text-2xl font-bold ${(score.metrics.agencyDependency?.raw || 0) > 10 ? 'text-red-700' : 'text-gray-700'} mt-0.5`}>{score.metrics.agencyDependency?.raw ?? 0}%</div>
          <div className="text-[10px] text-gray-500">Target &lt;10% — 15% weight</div>
        </div>
      </div>

      {/* Snapshot History */}
      {snapshots.length > 0 && (
        <div className={`${CARD.padded} mb-5`}>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Snapshot History</h3>
          <div className="space-y-1">
            {snapshots.slice(0, 5).map(s => (
              <div key={s.id} className="flex items-center justify-between text-xs text-gray-600 py-1 border-b border-gray-50">
                <span>{new Date(s.computed_at).toLocaleDateString('en-GB')} — {s.overall_score}% ({s.band})</span>
                <div className="flex items-center gap-2">
                  {s.signed_off_by
                    ? <span className={BADGE.green}>Signed off by {s.signed_off_by}</span>
                    : canEdit && s.computed_by !== getLoggedInUser()?.username && (
                      <button onClick={() => handleSignOff(s.id)} className={`${BTN.ghost} ${BTN.xs}`}>Sign Off</button>
                    )
                  }
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Date Range Toggle */}
      <div className="flex gap-1 mb-5 print:hidden">
        {RANGE_OPTIONS.map(opt => (
          <button key={opt.days} onClick={() => setDateRangeDays(opt.days)}
            className={`${dateRangeDays === opt.days ? BTN.primary : BTN.ghost} ${BTN.xs}`}>
            {opt.label}
          </button>
        ))}
        <span className="text-xs text-gray-400 self-center ml-2">
          {formatDate(dateRange.from)} to {formatDate(dateRange.to)}
        </span>
      </div>

      {/* Quality Statements by Category */}
      {categories.map(cat => (
        <div key={cat} className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className={`text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${CATEGORY_COLORS[cat]}`}>
              {CATEGORY_LABELS[cat]}
            </span>
            <div className="flex-1 border-t border-gray-200" />
          </div>

          <div className="space-y-2">
            {QUALITY_STATEMENTS.filter(q => q.category === cat).map(qs => {
              const isExpanded = expandedStatement === qs.id;
              const ev = evidenceByStatement[qs.id];
              const autoCount = ev?.autoEvidence?.length || 0;
              const manualCount = ev?.manualEvidence?.length || 0;

              return (
                <div key={qs.id} className={CARD.padded}>
                  <div className="flex items-center justify-between cursor-pointer"
                    onClick={() => setExpandedStatement(isExpanded ? null : qs.id)}>
                    <div className="flex items-center gap-3">
                      <svg className="h-5 w-5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d={qs.icon} />
                      </svg>
                      <div>
                        <span className="font-medium text-gray-900">{qs.name}</span>
                        <span className="text-xs text-gray-400 ml-2">{qs.cqcRef}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-500">{autoCount + manualCount} evidence items</span>
                      {ev?.autoEvidence?.map((ae, i) => (
                        <span key={i} className={`text-sm font-bold ${metricColor(ae.value, ae.lowerIsBetter)}`}>
                          {ae.value}{ae.unit}
                        </span>
                      ))}
                      <span className="text-gray-400 text-xs">{isExpanded ? '\u25B2' : '\u25BC'}</span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-3 border-t border-gray-100 pt-3">
                      <p className="text-xs text-gray-500 mb-3">{qs.description}</p>

                      {/* Auto-computed metrics */}
                      {autoCount > 0 && (
                        <div className="mb-3">
                          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">System Metrics</div>
                          <div className="space-y-1">
                            {ev.autoEvidence.map((ae, i) => (
                              <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded bg-gray-50">
                                <span className="text-sm text-gray-700">{ae.label}</span>
                                <div className="flex items-center gap-2">
                                  <span className={`text-sm font-bold ${ae.value >= 90 ? 'text-emerald-600' : ae.value >= 70 ? 'text-amber-600' : 'text-red-600'}`}>
                                    {ae.value}{ae.unit}
                                  </span>
                                  {ae.detail && <span className="text-[10px] text-gray-400">{ae.detail}</span>}
                                  <span className={BADGE.gray}>{ae.source}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Manual evidence items */}
                      {manualCount > 0 && (
                        <div className="mb-3">
                          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Manual Evidence</div>
                          <div className="space-y-1.5">
                            {ev.manualEvidence.map(me => (
                              <div key={me.id} className="flex items-start justify-between py-1.5 px-2 rounded bg-gray-50">
                                <div>
                                  <div className="text-sm font-medium text-gray-800">{me.title}</div>
                                  {me.description && <div className="text-xs text-gray-500 mt-0.5">{me.description}</div>}
                                  <div className="text-[10px] text-gray-400 mt-0.5">
                                    {me.date_from}{me.date_to ? ` to ${me.date_to}` : ' — ongoing'}
                                    {me.added_by && ` | by ${me.added_by}`}
                                  </div>
                                </div>
                                {canEdit && <button onClick={(e) => { e.stopPropagation(); handleDeleteEvidence(me.id); }}
                                  disabled={savingEvidence}
                                  className="text-xs text-red-400 hover:text-red-600 shrink-0 ml-2">Remove</button>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {evidenceLoading ? (
                        <span className="text-xs text-gray-400">Loading evidence...</span>
                      ) : canEdit ? (
                        <button onClick={(e) => { e.stopPropagation(); openAddEvidence(qs.id); }}
                          className={`${BTN.secondary} ${BTN.xs}`}>
                          + Add Evidence
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Unavailable Metrics Info */}
      {score.unavailableMetrics.length > 0 && (
        <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 mt-4">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            {score.unavailableMetrics.length} Metrics Not Yet Tracked
          </div>
          <p className="text-xs text-gray-500 mb-2">
            The compliance score is calculated from {score.availableMetrics.length} of {METRIC_DEFINITIONS.length} metrics
            (weights normalized from {Math.round(score.availableWeight * 100)}% to 100%). These metrics will be added as features are built:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {score.unavailableMetrics.map(m => (
              <span key={m.id} className={BADGE.gray}>{m.label} ({Math.round(m.weight * 100)}%)</span>
            ))}
          </div>
        </div>
      )}

      {/* Add Evidence Modal */}
      <Modal isOpen={showAddEvidence} onClose={() => setShowAddEvidence(false)} title="Add Evidence Item" size="lg">

            <div className="space-y-3">
              <div>
                <label className={INPUT.label}>Quality Statement</label>
                <select className={INPUT.select} value={evidenceForm.quality_statement}
                  onChange={e => setEvidenceForm({ ...evidenceForm, quality_statement: e.target.value })}>
                  <option value="">Select statement...</option>
                  {QUALITY_STATEMENTS.map(qs => (
                    <option key={qs.id} value={qs.id}>{qs.cqcRef} — {qs.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className={INPUT.label}>Evidence Type</label>
                <div className="flex gap-4">
                  {['qualitative', 'quantitative'].map(t => (
                    <label key={t} className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                      <input type="radio" name="evidence-type" value={t} checked={evidenceForm.type === t}
                        onChange={() => setEvidenceForm({ ...evidenceForm, type: t })} className="accent-blue-600" />
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className={INPUT.label}>Title</label>
                <input type="text" className={INPUT.base} placeholder="Brief title..."
                  value={evidenceForm.title} onChange={e => setEvidenceForm({ ...evidenceForm, title: e.target.value })} />
              </div>

              <div>
                <label className={INPUT.label}>Description</label>
                <textarea className={`${INPUT.base} h-20`} placeholder="Detailed description..."
                  value={evidenceForm.description} onChange={e => setEvidenceForm({ ...evidenceForm, description: e.target.value })} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={INPUT.label}>Evidence From</label>
                  <input type="date" className={INPUT.base} value={evidenceForm.date_from}
                    onChange={e => setEvidenceForm({ ...evidenceForm, date_from: e.target.value })} />
                </div>
                <div>
                  <label className={INPUT.label}>Evidence To (optional)</label>
                  <input type="date" className={INPUT.base} value={evidenceForm.date_to}
                    onChange={e => setEvidenceForm({ ...evidenceForm, date_to: e.target.value })} />
                </div>
              </div>
            </div>

            <div className={MODAL.footer}>
              <button onClick={() => setShowAddEvidence(false)} className={BTN.ghost}>Cancel</button>
              <button onClick={handleSaveEvidence}
                disabled={savingEvidence || !evidenceForm.quality_statement || !evidenceForm.title.trim()}
                className={BTN.primary}>{savingEvidence ? 'Saving...' : 'Save Evidence'}</button>
            </div>
      </Modal>
    </div>
  );
}
