import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useConfirm } from '../hooks/useConfirm.jsx';
import { CARD, BTN, BADGE, INPUT, MODAL, PAGE, TABLE } from '../lib/design.js';
import { formatDate } from '../lib/rotation.js';
import { useLiveDate } from '../hooks/useLiveDate.js';
import { downloadXLSX } from '../lib/excel.js';
import Modal from '../components/Modal.jsx';
import FileAttachments from '../components/FileAttachments.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import {
  getCurrentHome, getSchedulingData, getTrainingData,
  getIncidents, getComplaints, getMaintenance, getIpcAudits,
  getRisks, getPolicies, getWhistleblowingConcerns, getDols, getCareCertData,
  getCqcEvidence, createCqcEvidence, updateCqcEvidence,
  getCqcEvidenceFiles, uploadCqcEvidenceFile, deleteCqcEvidenceFile, downloadCqcEvidenceFile,
  deleteCqcEvidence, getLoggedInUser, logReportDownload,
  createSnapshot, getSnapshots, getSnapshot, signOffSnapshot,
  getCqcNarratives, getCqcReadiness, upsertCqcNarrative,
} from '../lib/api.js';
import {
  QUALITY_STATEMENTS, METRIC_DEFINITIONS,
  calculateComplianceScore, getDateRange, getEvidenceForStatement,
} from '../lib/cqc.js';
import { buildReadinessMatrix, getOverallReadiness, getQuestionReadiness, getReadinessGaps } from '../lib/cqcReadiness.js';
import { getAllEvidenceCategories, getEvidenceCategoryLabel } from '../lib/cqcEvidenceCategories.js';
import { useData } from '../contexts/DataContext.jsx';
import { addDaysLocalISO, todayLocalISO } from '../lib/localDates.js';

const CATEGORY_LABELS = { safe: 'Safe', effective: 'Effective', caring: 'Caring', responsive: 'Responsive', 'well-led': 'Well-Led' };
const CATEGORY_COLORS = {
  safe: 'border-[var(--info)] bg-[var(--info-soft)] text-[var(--info)]',
  effective: 'border-[var(--ok)] bg-[var(--ok-soft)] text-[var(--ok)]',
  caring: 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]',
  responsive: 'border-[var(--caution)] bg-[var(--caution-soft)] text-[var(--caution)]',
  'well-led': 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]',
};

const EVIDENCE_CATEGORY_OPTIONS = getAllEvidenceCategories();

const RANGE_OPTIONS = [
  { days: 28, label: '28 Days' },
  { days: 90, label: '90 Days' },
  { days: 365, label: '1 Year' },
];

const SCORE_STYLES = {
  emerald: { card: 'rounded-xl border border-[var(--ok)] bg-[var(--ok-soft)] p-3', label: 'text-xs font-medium text-[var(--ok)]', value: 'mt-0.5 text-3xl font-bold text-[var(--ok)]' },
  amber:   { card: 'rounded-xl border border-[var(--caution)] bg-[var(--caution-soft)] p-3', label: 'text-xs font-medium text-[var(--caution)]', value: 'mt-0.5 text-3xl font-bold text-[var(--caution)]' },
  red:     { card: 'rounded-xl border border-[var(--alert)] bg-[var(--alert-soft)] p-3', label: 'text-xs font-medium text-[var(--alert)]', value: 'mt-0.5 text-3xl font-bold text-[var(--alert)]' },
};

function blankEvidenceForm(statementId = '') {
  return {
    id: null,
    version: undefined,
    quality_statement: statementId || '',
    type: 'qualitative',
    title: '',
    description: '',
    date_from: '',
    date_to: '',
    evidence_category: '',
    evidence_owner: '',
    review_due: '',
  };
}

function toEvidenceForm(evidence) {
  return {
    id: evidence?.id || null,
    version: evidence?.version,
    quality_statement: evidence?.quality_statement || '',
    type: evidence?.type || 'qualitative',
    title: evidence?.title || '',
    description: evidence?.description || '',
    date_from: evidence?.date_from || '',
    date_to: evidence?.date_to || '',
    evidence_category: evidence?.evidence_category || '',
    evidence_owner: evidence?.evidence_owner || '',
    review_due: evidence?.review_due || '',
  };
}

function buildEvidencePayload(form) {
  return {
    quality_statement: form.quality_statement,
    type: form.type,
    title: form.title.trim(),
    description: form.description.trim(),
    date_from: form.date_from || null,
    date_to: form.date_to || null,
    evidence_category: form.evidence_category || null,
    evidence_owner: form.evidence_owner.trim() || null,
    review_due: form.review_due || null,
  };
}

function getEvidenceDateRangeError(form) {
  if (form?.date_from && form?.date_to && form.date_to < form.date_from) {
    return 'Evidence To cannot be before Evidence From.';
  }
  return null;
}

function formatFileCount(count) {
  return `${count} file${count === 1 ? '' : 's'}`;
}

function blankNarrativeForm(statementId = '', existing = null) {
  return {
    quality_statement: statementId || existing?.quality_statement || '',
    narrative: existing?.narrative || '',
    risks: existing?.risks || '',
    actions: existing?.actions || '',
    reviewed_by: existing?.reviewed_by || '',
    reviewed_at: existing?.reviewed_at ? String(existing.reviewed_at).slice(0, 16) : '',
    review_due: existing?.review_due || '',
    version: existing?.version,
  };
}

function metricColor(value, lowerIsBetter) {
  if (lowerIsBetter) return value <= 5 ? 'text-[var(--ok)]' : value <= 15 ? 'text-[var(--caution)]' : 'text-[var(--alert)]';
  return value >= 90 ? 'text-[var(--ok)]' : value >= 70 ? 'text-[var(--caution)]' : 'text-[var(--alert)]';
}

function readinessBadgeClass(status) {
  if (status === 'strong') return BADGE.green;
  if (status === 'stale') return BADGE.amber;
  if (status === 'partial') return BADGE.amber;
  if (status === 'weak') return BADGE.red;
  return BADGE.red;
}

function readinessStatusLabel(status) {
  if (status === 'strong') return 'Strong';
  if (status === 'stale') return 'Stale';
  if (status === 'partial') return 'Partial';
  if (status === 'weak') return 'Weak';
  return 'Missing';
}

export default function CQCEvidence() {
  const homeSlug = getCurrentHome();
  const [moduleData, setModuleData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!homeSlug) return;
    let cancelled = false;
    // CQC scoring needs up to 365 days of overrides for the 1-year view
    const now = new Date();
    const fromDate = new Date(now);
    fromDate.setFullYear(fromDate.getFullYear() - 1);
    const from = todayLocalISO(fromDate);
    const to = addDaysLocalISO(todayLocalISO(now), 7);

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
      if (cancelled) return;
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
    }).catch(e => { if (!cancelled) setError(e.message || 'Failed to load CQC data'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [homeSlug, refreshKey]);

  if (loading) return <div className={PAGE.container}><LoadingState message="Loading CQC data..." /></div>;
  if (error || !moduleData) {
    return (
      <div className={PAGE.container}>
        <ErrorState
          title="Unable to load the CQC workspace"
          message={error || 'Failed to load CQC data'}
          onRetry={() => setRefreshKey((value) => value + 1)}
        />
      </div>
    );
  }

  return <CQCEvidenceInner data={moduleData} />;
}

function CQCEvidenceInner({ data }) {
  const { canWrite } = useData();
  const canEdit = canWrite('compliance');
  const { confirm, ConfirmDialog } = useConfirm();
  const isMounted = useRef(true);
  useEffect(() => { isMounted.current = true; return () => { isMounted.current = false; }; }, []);
  const [evidence, setEvidence] = useState([]);
  const [narratives, setNarratives] = useState([]);
  const [narrativeDrafts, setNarrativeDrafts] = useState({});
  const [evidenceLoading, setEvidenceLoading] = useState(true);
  const [narrativesLoading, setNarrativesLoading] = useState(true);
  const [liveReadiness, setLiveReadiness] = useState(null);
  const [readinessLoading, setReadinessLoading] = useState(true);
  const [readinessError, setReadinessError] = useState(null);
  const [dateRangeDays, setDateRangeDays] = useState(28);
  const [expandedStatement, setExpandedStatement] = useState(null);
  const [showAddEvidence, setShowAddEvidence] = useState(false);
  const [evidenceForm, setEvidenceForm] = useState(blankEvidenceForm());
  const [generating, setGenerating] = useState(false);
  const [savingEvidence, setSavingEvidence] = useState(false);
  const [savingNarrativeId, setSavingNarrativeId] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saveNotice, setSaveNotice] = useState(null);
  const [narrativeError, setNarrativeError] = useState(null);
  const [narrativeNotice, setNarrativeNotice] = useState(null);
  const [snapshotError, setSnapshotError] = useState(null);
  const [snapshotNotice, setSnapshotNotice] = useState(null);
  const [pdfError, setPdfError] = useState(null);

  // Snapshot state
  const [snapshots, setSnapshots] = useState([]);
  const [_snapshotLoading, setSnapshotLoading] = useState(false);
  const [viewingSnapshot, setViewingSnapshot] = useState(null);
  const [showSnapshots, setShowSnapshots] = useState(false);

  useDirtyGuard(showAddEvidence);

  const loadEvidence = useCallback(async () => {
    try {
      const home = getCurrentHome();
      const result = await getCqcEvidence(home);
      if (isMounted.current) setEvidence(result.evidence || []);
    } catch (err) {
      // Non-fatal: evidence list stays empty rather than breaking the whole page
      if (isMounted.current) console.error('Failed to load CQC evidence:', err);
    } finally {
      if (isMounted.current) setEvidenceLoading(false);
    }
  }, []);

  useEffect(() => { loadEvidence(); }, [loadEvidence]);

  const loadNarratives = useCallback(async () => {
    try {
      const home = getCurrentHome();
      const rows = await getCqcNarratives(home);
      if (isMounted.current) setNarratives(Array.isArray(rows) ? rows : []);
    } catch (err) {
      if (isMounted.current) console.error('Failed to load CQC narratives:', err);
    } finally {
      if (isMounted.current) setNarrativesLoading(false);
    }
  }, []);

  useEffect(() => { loadNarratives(); }, [loadNarratives]);

  const loadReadiness = useCallback(async (signal) => {
    const home = getCurrentHome();
    if (!home) return;
    if (isMounted.current) {
      setReadinessLoading(true);
      setReadinessError(null);
    }
    try {
      const result = await getCqcReadiness(home, dateRangeDays, signal);
      if (isMounted.current && !signal?.aborted) setLiveReadiness(result || null);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      if (isMounted.current) {
        console.warn('Failed to load authoritative readiness:', err);
        setReadinessError(err.message || 'Failed to load readiness');
        setLiveReadiness(null);
      }
    } finally {
      if (isMounted.current && !signal?.aborted) setReadinessLoading(false);
    }
  }, [dateRangeDays]);

  useEffect(() => {
    const controller = new AbortController();
    loadReadiness(controller.signal);
    return () => controller.abort();
  }, [loadReadiness, evidence, narratives]);

  const loadSnapshots = useCallback(async () => {
    const home = getCurrentHome();
    if (!home) return;
    if (isMounted.current) setSnapshotLoading(true);
    try {
      const result = await getSnapshots(home, 'cqc');
      if (isMounted.current && Array.isArray(result)) setSnapshots(result);
    } catch (e) {
      if (isMounted.current) { console.warn('Failed to load snapshots:', e.message); setSnapshots([]); }
    } finally {
      if (isMounted.current) setSnapshotLoading(false);
    }
  }, []);

  useEffect(() => { loadSnapshots(); }, [loadSnapshots]);

  async function handleCreateSnapshot() {
    const home = getCurrentHome();
    if (!home || generating) return;
    setGenerating(true);
    setSnapshotError(null);
    setSnapshotNotice(null);
    try {
      await createSnapshot(home, 'cqc', formatDate(dateRange.from), formatDate(dateRange.to));
      await loadSnapshots();
    } catch (e) {
      if (e?.status === 409 && /identical snapshot/i.test(e.message || '')) {
        await loadSnapshots();
        setShowSnapshots(true);
        setSnapshotNotice('This exact snapshot is already saved. Snapshot History has been opened below.');
      } else {
        setSnapshotError(e.message);
      }
    }
    finally { setGenerating(false); }
  }

  async function handleViewSnapshot(id) {
    const home = getCurrentHome();
    setSnapshotError(null);
    try {
      const snap = await getSnapshot(home, id);
      setViewingSnapshot(snap);
    } catch (e) { setSnapshotError(e.message); }
  }

  async function handleSignOff(id, notes) {
    const home = getCurrentHome();
    setSnapshotError(null);
    try {
      await signOffSnapshot(home, id, notes);
      loadSnapshots();
      if (viewingSnapshot?.id === id) {
        const snap = await getSnapshot(home, id);
        setViewingSnapshot(snap);
      }
    } catch (e) { setSnapshotError(e.message); }
  }

  const today = useLiveDate();
  const dateRange = useMemo(() => getDateRange(dateRangeDays), [dateRangeDays]);
  const narrativeByStatement = useMemo(
    () => Object.fromEntries((narratives || []).map((entry) => [entry.quality_statement, entry])),
    [narratives]
  );

  // Merge live evidence state into data for score computation and evidence-for-statement calls
  const dataWithEvidence = useMemo(() => {
    if (!data) return null;
    return {
      ...data,
      cqc_evidence: evidence,
      cqc_statement_narratives: narratives,
    };
  }, [data, evidence, narratives]);

  const score = useMemo(() => {
    if (!dataWithEvidence?.config) return null;
    return calculateComplianceScore(dataWithEvidence, dateRange, today);
  }, [dataWithEvidence, dateRange, today]);

  const fallbackReadinessMatrix = useMemo(() => {
    if (!dataWithEvidence?.config) return new Map();
    return buildReadinessMatrix(dataWithEvidence, dateRange, today);
  }, [dataWithEvidence, dateRange, today]);

  const fallbackReadiness = useMemo(() => ({
    entries: [...fallbackReadinessMatrix.values()],
    questionSummary: getQuestionReadiness(fallbackReadinessMatrix),
    overall: getOverallReadiness(fallbackReadinessMatrix),
    gaps: getReadinessGaps(fallbackReadinessMatrix),
    computedAt: today,
  }), [fallbackReadinessMatrix, today]);

  const readinessPayload = liveReadiness || fallbackReadiness;
  const questionReadiness = readinessPayload?.questionSummary || fallbackReadiness.questionSummary;
  const readinessGaps = readinessPayload?.gaps || fallbackReadiness.gaps;
  const readinessEntries = useMemo(
    () => Object.fromEntries((readinessPayload?.entries || []).map((entry) => [entry.statementId, entry])),
    [readinessPayload]
  );

  const evidenceByStatement = useMemo(() => {
    if (!dataWithEvidence?.config) return {};
    const map = {};
    for (const qs of QUALITY_STATEMENTS) {
      map[qs.id] = getEvidenceForStatement(qs.id, dataWithEvidence, dateRange, today);
    }
    return map;
  }, [dataWithEvidence, dateRange, today]);

  if (!data?.config || !score) {
    return <div className={PAGE.container}><LoadingState message="Preparing the CQC readiness view..." /></div>;
  }

  const bandColorMap = { green: 'emerald', amber: 'amber', red: 'red' };
  const scoreStyle = SCORE_STYLES[bandColorMap[score.band.color]] || SCORE_STYLES.red;

  function openAddEvidence(statementId) {
    setEvidenceForm(blankEvidenceForm(statementId));
    setSaveError(null);
    setSaveNotice(null);
    setShowAddEvidence(true);
  }

  function openEditEvidence(item) {
    setEvidenceForm(toEvidenceForm(item));
    setSaveError(null);
    setSaveNotice(null);
    setShowAddEvidence(true);
  }

  function getNarrativeDraft(statementId) {
    return narrativeDrafts[statementId] || blankNarrativeForm(statementId, narrativeByStatement[statementId]);
  }

  function updateNarrativeDraft(statementId, patch) {
    setNarrativeDrafts((prev) => ({
      ...prev,
      [statementId]: {
        ...blankNarrativeForm(statementId, narrativeByStatement[statementId]),
        ...prev[statementId],
        ...patch,
      },
    }));
  }

  async function handleSaveNarrative(statementId) {
    if (savingNarrativeId) return;
    const home = getCurrentHome();
    const draft = getNarrativeDraft(statementId);
    setSavingNarrativeId(statementId);
    setNarrativeError(null);
    setNarrativeNotice(null);
    try {
      const saved = await upsertCqcNarrative(home, statementId, {
        narrative: draft.narrative || null,
        risks: draft.risks || null,
        actions: draft.actions || null,
        reviewed_by: draft.reviewed_by || null,
        reviewed_at: draft.reviewed_at ? new Date(draft.reviewed_at).toISOString() : null,
        review_due: draft.review_due || null,
        _version: draft.version,
      });
      setNarratives((prev) => {
        const next = prev.filter((entry) => entry.quality_statement !== statementId);
        next.push(saved);
        return next.sort((a, b) => a.quality_statement.localeCompare(b.quality_statement));
      });
      setNarrativeDrafts((prev) => ({
        ...prev,
        [statementId]: blankNarrativeForm(statementId, saved),
      }));
      setNarrativeNotice(`Self-assessment saved for ${statementId}.`);
    } catch (err) {
      setNarrativeError(`Failed to save self-assessment: ${err.message}`);
    } finally {
      setSavingNarrativeId(null);
    }
  }

  async function handleSaveEvidence() {
    if (savingEvidence) return;
    if (!evidenceForm.quality_statement || !evidenceForm.title.trim()) return;
    const dateError = getEvidenceDateRangeError(evidenceForm);
    if (dateError) {
      setSaveError(dateError);
      return;
    }
    setSavingEvidence(true);
    setSaveError(null);
    try {
      const saved = await persistEvidenceDraft();
      setSaveNotice(evidenceForm.id ? 'Evidence updated.' : 'Evidence saved. Supporting files are uploaded separately below.');
      setEvidenceForm(toEvidenceForm(saved));
      await loadEvidence();
    } catch (err) {
      setSaveError('Failed to save evidence: ' + err.message);
    } finally {
      setSavingEvidence(false);
    }
  }

  async function persistEvidenceDraft() {
    const home = getCurrentHome();
    const payload = buildEvidencePayload(evidenceForm);
    if (evidenceForm.id) {
      return updateCqcEvidence(home, evidenceForm.id, {
        ...payload,
        _version: evidenceForm.version,
      });
    }
    return createCqcEvidence(home, {
      ...payload,
      added_by: getLoggedInUser()?.username || 'admin',
    });
  }

  async function ensureEvidenceForUploads() {
    if (evidenceForm.id) return evidenceForm.id;
    if (!evidenceForm.quality_statement || !evidenceForm.title.trim()) {
      throw new Error('Add a quality statement and title before uploading supporting files.');
    }
    const dateError = getEvidenceDateRangeError(evidenceForm);
    if (dateError) {
      setSaveError(dateError);
      throw new Error(dateError);
    }
    if (savingEvidence) {
      throw new Error('Evidence is already being saved. Please wait a moment and try again.');
    }
    setSavingEvidence(true);
    setSaveError(null);
    setSaveNotice(null);
    try {
      const saved = await persistEvidenceDraft();
      setEvidenceForm(toEvidenceForm(saved));
      await loadEvidence();
      setSaveNotice('Evidence saved. Uploading supporting files now.');
      return saved.id;
    } catch (err) {
      const message = 'Failed to save evidence: ' + err.message;
      setSaveError(message);
      throw new Error(message);
    } finally {
      setSavingEvidence(false);
    }
  }

  async function handleDeleteEvidence(evId) {
    if (savingEvidence) return;
    if (!await confirm('Remove this evidence item?')) return;
    const home = getCurrentHome();
    setSavingEvidence(true);
    try {
      await deleteCqcEvidence(home, evId);
      await loadEvidence();
    } catch (err) {
      setSaveError('Failed to delete evidence: ' + err.message);
    } finally {
      setSavingEvidence(false);
    }
  }

  async function handleGeneratePDF() {
    setGenerating(true);
    setPdfError(null);
    try {
      await new Promise(r => setTimeout(r, 100));
      const { generateEvidencePackPDF } = await import('../lib/pdfReports.js');
      generateEvidencePackPDF(dataWithEvidence, dateRangeDays);
      logReportDownload('cqc-evidence', `${dateRangeDays} days`);
    } catch (err) {
      setPdfError('Failed to generate PDF: ' + err.message);
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
  const snapshotPdfAvailable = Boolean(viewingSnapshot?.result?.evidencePackData);

  return (
    <div className={PAGE.container}>
      {/* Header */}
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>CQC Compliance Evidence</h1>
          <p className={PAGE.subtitle}>Single Assessment Framework — staffing compliance scorecard and evidence pack</p>
        </div>
        <div className="flex w-full flex-wrap gap-2 lg:w-auto lg:justify-end">
          <button onClick={handleExportExcel} className={`${BTN.secondary} ${BTN.sm} flex-1 whitespace-nowrap sm:flex-none`}>Export Excel</button>
          {canEdit && <button onClick={handleCreateSnapshot} disabled={generating} className={`${BTN.secondary} ${BTN.sm} flex-1 whitespace-nowrap sm:flex-none`}>
            Save Snapshot
          </button>}
          <button onClick={handleGeneratePDF} disabled={generating} className={`${BTN.primary} flex-1 whitespace-nowrap sm:flex-none`}>
            {generating ? 'Generating...' : 'Generate Evidence Pack'}
          </button>
        </div>
      </div>

      {pdfError && <InlineNotice variant="error" className="mb-3" role="alert">{pdfError}</InlineNotice>}
      {snapshotNotice && <InlineNotice variant="warning" className="mb-3">{snapshotNotice}</InlineNotice>}
      {snapshotError && <InlineNotice variant="error" className="mb-3" role="alert">{snapshotError}</InlineNotice>}
      {narrativeNotice && <InlineNotice variant="success" className="mb-3">{narrativeNotice}</InlineNotice>}
      {narrativeError && <InlineNotice variant="error" className="mb-3" role="alert">{narrativeError}</InlineNotice>}
      {readinessError && !liveReadiness ? (
        <InlineNotice variant="warning" className="mb-3">
          Live readiness could not be loaded. Showing fallback readiness from the current page data.
        </InlineNotice>
      ) : null}

      {/* KPI Cards */}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {/* Overall Score */}
        <div className={scoreStyle.card}>
          <div className={scoreStyle.label}>Overall Score</div>
          <div className={scoreStyle.value}>{score.overallScore}%</div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className={BADGE[score.band.badgeKey]}>{score.band.label}</span>
            <span className="text-[10px] text-[var(--ink-4)]">{score.availableMetrics.length} of {METRIC_DEFINITIONS.length} metrics</span>
          </div>
        </div>

        {/* Training */}
        <div className="rounded-xl border border-[var(--info)] bg-[var(--info-soft)] p-3">
          <div className="text-xs font-medium text-[var(--info)]">Training Compliance</div>
          <div className="mt-0.5 text-2xl font-bold text-[var(--info)]">{score.metrics.trainingCompliance?.raw ?? '-'}%</div>
          <div className="text-[10px] text-[var(--info)]">Regulation 18 — 20% weight</div>
        </div>

        {/* Fill Rate */}
        <div className="rounded-xl border border-[var(--ok)] bg-[var(--ok-soft)] p-3">
          <div className="text-xs font-medium text-[var(--ok)]">Staffing Fill Rate</div>
          <div className="mt-0.5 text-2xl font-bold text-[var(--ok)]">{score.metrics.staffingFillRate?.raw ?? '-'}%</div>
          <div className="text-[10px] text-[var(--ok)]">{score.metrics.staffingFillRate?.detail?.shortfallDays || 0} shortfall days — 20% weight</div>
        </div>

        {/* Agency */}
        <div className={`rounded-xl border p-3 ${(score.metrics.agencyDependency?.raw || 0) > 10 ? 'border-[var(--alert)] bg-[var(--alert-soft)]' : 'border-[var(--line)] bg-[var(--paper-2)]'}`}>
          <div className={`text-xs font-medium ${(score.metrics.agencyDependency?.raw || 0) > 10 ? 'text-[var(--alert)]' : 'text-[var(--ink-2)]'}`}>Agency Dependency</div>
          <div className={`mt-0.5 text-2xl font-bold ${(score.metrics.agencyDependency?.raw || 0) > 10 ? 'text-[var(--alert)]' : 'text-[var(--ink)]'}`}>{score.metrics.agencyDependency?.raw ?? 0}%</div>
          <div className="text-[10px] text-[var(--ink-3)]">Target &lt;10% — 15% weight</div>
        </div>
      </div>

      <div className="mb-5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-3)]">Readiness</div>
            <p className="mt-1 text-xs text-[var(--ink-3)]">
              Server-authored gap analysis with per-category freshness thresholds. Raw counts stay visible so the team can judge the shape, not just the badge.
            </p>
          </div>
          {readinessLoading ? <span className={BADGE.gray}>Refreshing…</span> : null}
        </div>
        {readinessError ? (
          <p className="mb-3 text-xs text-[var(--caution)]">
            Live readiness could not be refreshed from the server, so this view is temporarily using the local fallback calculation.
          </p>
        ) : null}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          {categories.map((question) => {
            const summary = questionReadiness.find((entry) => entry.question === question) || {
              total: QUALITY_STATEMENTS.filter((entry) => entry.category === question).length,
              strong: 0,
              partial: 0,
              stale: 0,
              weak: 0,
              missing: 0,
            };
            return (
              <div key={question} className={CARD.padded}>
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-3)]">{CATEGORY_LABELS[question]}</p>
                <p className="mt-1 text-lg font-bold text-[var(--ink)]">{summary.strong}/{summary.total} strong</p>
                <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                  {summary.missing > 0 ? <span className={BADGE.red}>{summary.missing} missing</span> : null}
                  {summary.weak > 0 ? <span className={BADGE.red}>{summary.weak} weak</span> : null}
                  {summary.stale > 0 ? <span className={BADGE.amber}>{summary.stale} stale</span> : null}
                  {summary.partial > 0 ? <span className={BADGE.amber}>{summary.partial} partial</span> : null}
                  {summary.missing === 0 && summary.weak === 0 && summary.stale === 0 && summary.partial === 0 ? (
                    <span className={BADGE.green}>No open gaps</span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Date Range Toggle */}
      <div className="mb-5 flex flex-wrap gap-1 print:hidden">
        {RANGE_OPTIONS.map(opt => (
          <button key={opt.days} onClick={() => setDateRangeDays(opt.days)}
            className={`${dateRangeDays === opt.days ? BTN.primary : BTN.ghost} ${BTN.xs}`}>
            {opt.label}
          </button>
        ))}
        <span className="ml-2 self-center text-xs text-[var(--ink-4)]">
          {formatDate(dateRange.from)} to {formatDate(dateRange.to)}
        </span>
      </div>

      {readinessGaps.length > 0 && (
        <div className={`${CARD.padded} mb-5`}>
          <div className="flex items-center justify-between gap-3 mb-2">
            <div>
              <h2 className="text-sm font-semibold text-[var(--ink)]">Readiness Gaps</h2>
              <p className="text-xs text-[var(--ink-3)]">Statements that still need fresher, broader, or better-owned evidence.</p>
            </div>
            <span className={BADGE.amber}>{readinessGaps.length} open</span>
          </div>
          <div className="space-y-2">
            {readinessGaps.slice(0, 10).map((gap) => (
              <div key={gap.statementId} className="flex flex-col gap-1 rounded-lg border border-[var(--line)] bg-[var(--paper-2)] px-3 py-2 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-2">
                  <span className={readinessBadgeClass(gap.status)}>{readinessStatusLabel(gap.status)}</span>
                  <span className="text-sm font-medium text-[var(--ink)]">{gap.statementId} - {gap.statementName}</span>
                </div>
                <p className="text-xs text-[var(--ink-3)] md:text-right">{gap.summary}</p>
              </div>
            ))}
          </div>
        </div>
      )}

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
              const readiness = readinessEntries[qs.id];
              const autoCount = ev?.autoEvidence?.length || 0;
              const manualCount = ev?.manualEvidence?.length || 0;
              const narrativeDraft = getNarrativeDraft(qs.id);

              return (
                <div key={qs.id} className={CARD.padded}>
                  <div className="flex cursor-pointer flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
                    onClick={() => setExpandedStatement(isExpanded ? null : qs.id)}>
                    <div className="flex min-w-0 items-start gap-3">
                      <svg className="h-5 w-5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d={qs.icon} />
                      </svg>
                      <div className="min-w-0">
                        <span className="block font-medium text-gray-900">{qs.name}</span>
                        {autoCount + manualCount === 0 && (
                          <span className="ml-2 inline-flex h-2.5 w-2.5 rounded-full bg-red-500 align-middle" aria-label="No evidence attached" />
                        )}
                        <span className="mt-1 block text-xs text-gray-400">{qs.cqcRef}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      {readiness && <span className={readinessBadgeClass(readiness.status)}>{readinessStatusLabel(readiness.status)}</span>}
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
                      {readiness && (
                        <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={readinessBadgeClass(readiness.status)}>{readinessStatusLabel(readiness.status)}</span>
                            <span className="text-xs text-gray-500">
                              {readiness.evidenceCount} items · {readiness.categoriesCovered}/{readiness.categoriesExpected} expected categories covered
                            </span>
                            {readiness.staleCount > 0 && <span className={BADGE.amber}>{readiness.staleCount} stale</span>}
                            {readiness.reviewOverdue > 0 && <span className={BADGE.red}>{readiness.reviewOverdue} overdue</span>}
                            {!readiness.narrativePresent && <span className={BADGE.gray}>Narrative missing</span>}
                          </div>
                          <p className="mt-2 text-xs text-gray-500">{readiness.summary}</p>
                        </div>
                      )}

                      {/* Auto-computed metrics */}
                      {autoCount > 0 && (
                        <div className="mb-3">
                          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">System Metrics</div>
                          <div className="space-y-1">
                            {ev.autoEvidence.map((ae, i) => (
                              <div key={i} className="flex flex-col gap-1 py-1.5 px-2 rounded bg-gray-50 sm:flex-row sm:items-center sm:justify-between">
                                <span className="text-sm text-gray-700">{ae.label}</span>
                                <div className="flex flex-wrap items-center gap-2">
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
                              <div key={me.id} className="flex flex-col gap-2 py-1.5 px-2 rounded bg-gray-50 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0">
                                  <div className="text-sm font-medium text-gray-800">
                                    {me.title}
                                    {me.evidence_category && <span className={`${BADGE.gray} ml-1.5 text-[10px]`}>{getEvidenceCategoryLabel(me.evidence_category)}</span>}
                                    <span className={`${me.file_count > 0 ? BADGE.blue : BADGE.gray} ml-1.5 text-[10px]`}>
                                      {formatFileCount(me.file_count || 0)}
                                    </span>
                                  </div>
                                  {me.description && <div className="text-xs text-gray-500 mt-0.5">{me.description}</div>}
                                  <div className="text-[10px] text-gray-400 mt-0.5">
                                    {me.date_from}{me.date_to ? ` to ${me.date_to}` : ' — ongoing'}
                                    {me.added_by && ` | by ${me.added_by}`}
                                    {me.evidence_owner && ` | owner ${me.evidence_owner}`}
                                    {me.review_due && ` | review due ${me.review_due}`}
                                  </div>
                                </div>
                                {canEdit && (
                                  <div className="flex shrink-0 gap-2 sm:ml-2">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); openEditEvidence(me); }}
                                      disabled={savingEvidence}
                                      className="text-xs text-blue-500 hover:text-blue-700"
                                    >
                                      Edit
                                    </button>
                                    <button onClick={(e) => { e.stopPropagation(); handleDeleteEvidence(me.id); }}
                                      disabled={savingEvidence}
                                      className="text-xs text-red-400 hover:text-red-600">Remove</button>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="mb-3">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Self-Assessment</div>
                        <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-3">
                          <div>
                            <label className={INPUT.label}>What the evidence shows</label>
                            <textarea
                              aria-label="What the evidence shows"
                              className={`${INPUT.base} h-20`}
                              value={narrativeDraft.narrative}
                              onChange={(e) => updateNarrativeDraft(qs.id, { narrative: e.target.value })}
                              disabled={!canEdit}
                            />
                          </div>
                          <div>
                            <label className={INPUT.label}>Current risks</label>
                            <textarea
                              aria-label="Current risks"
                              className={`${INPUT.base} h-16`}
                              value={narrativeDraft.risks}
                              onChange={(e) => updateNarrativeDraft(qs.id, { risks: e.target.value })}
                              disabled={!canEdit}
                            />
                          </div>
                          <div>
                            <label className={INPUT.label}>Improvement actions</label>
                            <textarea
                              aria-label="Improvement actions"
                              className={`${INPUT.base} h-16`}
                              value={narrativeDraft.actions}
                              onChange={(e) => updateNarrativeDraft(qs.id, { actions: e.target.value })}
                              disabled={!canEdit}
                            />
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div>
                              <label className={INPUT.label}>Reviewed by</label>
                              <input
                                aria-label="Reviewed by"
                                type="text"
                                className={INPUT.base}
                                value={narrativeDraft.reviewed_by}
                                onChange={(e) => updateNarrativeDraft(qs.id, { reviewed_by: e.target.value })}
                                disabled={!canEdit}
                              />
                            </div>
                            <div>
                              <label className={INPUT.label}>Reviewed at</label>
                              <input
                                aria-label="Reviewed at"
                                type="datetime-local"
                                className={INPUT.base}
                                value={narrativeDraft.reviewed_at}
                                onChange={(e) => updateNarrativeDraft(qs.id, { reviewed_at: e.target.value })}
                                disabled={!canEdit}
                              />
                            </div>
                            <div>
                              <label className={INPUT.label}>Review due</label>
                              <input
                                aria-label="Review due"
                                type="date"
                                className={INPUT.base}
                                value={narrativeDraft.review_due}
                                onChange={(e) => updateNarrativeDraft(qs.id, { review_due: e.target.value })}
                                disabled={!canEdit}
                              />
                            </div>
                          </div>
                          {canEdit ? (
                            <div className="flex justify-end">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSaveNarrative(qs.id);
                                }}
                                disabled={savingNarrativeId === qs.id || narrativesLoading}
                                className={`${BTN.secondary} ${BTN.xs}`}
                              >
                                {savingNarrativeId === qs.id ? 'Saving...' : 'Save Self-Assessment'}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      {evidenceLoading ? (
                        <div className="min-w-[9rem]">
                          <LoadingState message="Loading evidence..." compact />
                        </div>
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

      {/* Snapshot History */}
      <div className="mt-6">
        <button onClick={() => setShowSnapshots(!showSnapshots)} className={`${BTN.ghost} ${BTN.sm} mb-2`}>
          {showSnapshots ? 'Hide' : 'Show'} Snapshot History ({snapshots.length})
        </button>
        {showSnapshots && (
          <div className={CARD.flush}>
            {snapshots.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="No snapshots saved yet"
                  description="Save a snapshot to freeze the current score, readiness summary, and evidence pack data."
                  actionLabel={canEdit ? 'Save Snapshot' : undefined}
                  onAction={canEdit ? handleCreateSnapshot : undefined}
                  compact
                />
              </div>
            ) : (
              <table className={TABLE.table}>
                <thead className={TABLE.thead}>
                  <tr>
                    <th className={TABLE.th}>Date</th>
                    <th className={TABLE.th}>Score</th>
                    <th className={TABLE.th}>Band</th>
                    <th className={TABLE.th}>Engine</th>
                    <th className={TABLE.th}>Computed By</th>
                    <th className={TABLE.th}>Sign-off</th>
                    <th className={TABLE.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map(s => (
                    <tr key={s.id} className={TABLE.tr}>
                      <td className={TABLE.td}>{s.computed_at?.slice(0, 10)}</td>
                      <td className={TABLE.td}>{s.overall_score}%</td>
                      <td className={TABLE.td}><span className={BADGE[s.band === 'Outstanding' ? 'green' : s.band === 'Good' ? 'blue' : s.band === 'Requires Improvement' ? 'amber' : 'red']}>{s.band}</span></td>
                      <td className={TABLE.td}><span className={BADGE.gray}>{s.engine_version}</span></td>
                      <td className={TABLE.td}>{s.computed_by}</td>
                      <td className={TABLE.td}>
                        {s.signed_off_by ? (
                          <span className={BADGE.green}>{s.signed_off_by}</span>
                        ) : (
                          <span className={BADGE.gray}>Pending</span>
                        )}
                      </td>
                      <td className={TABLE.td}>
                        <div className="flex gap-1">
                          <button className={`${BTN.ghost} ${BTN.xs}`} onClick={() => handleViewSnapshot(s.id)}>View</button>
                          {!s.signed_off_by && canEdit && (
                            <button className={`${BTN.ghost} ${BTN.xs}`} onClick={() => handleSignOff(s.id, '')}>Sign Off</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Snapshot Viewing Modal */}
      {viewingSnapshot && (
        <Modal isOpen={true} onClose={() => setViewingSnapshot(null)} title={`Snapshot — ${viewingSnapshot.computed_at?.slice(0, 10)}`} size="xl">
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className={CARD.padded}>
                <div className="text-xs text-gray-500">Score</div>
                <div className="text-2xl font-bold">{viewingSnapshot.overall_score}%</div>
              </div>
              <div className={CARD.padded}>
                <div className="text-xs text-gray-500">Band</div>
                <div className="text-lg font-semibold">{viewingSnapshot.band}</div>
              </div>
              <div className={CARD.padded}>
                <div className="text-xs text-gray-500">Engine Version</div>
                <div className="text-lg">{viewingSnapshot.engine_version}</div>
              </div>
              <div className={CARD.padded}>
                <div className="text-xs text-gray-500">Signed Off</div>
                <div className="text-lg">{viewingSnapshot.signed_off_by || 'Pending'}</div>
              </div>
            </div>
            {viewingSnapshot.result?.questionScores && (
              <div>
                <div className="text-sm font-semibold text-gray-600 mb-2">Per-Question Scores (Limiting Judgement)</div>
                <div className="grid grid-cols-5 gap-2">
                  {Object.entries(viewingSnapshot.result.questionScores).map(([q, qs]) => (
                    <div key={q} className={`${CARD.padded} text-center`}>
                      <div className="text-xs text-gray-500 capitalize">{q === 'well-led' ? 'Well-Led' : q}</div>
                      <div className="text-lg font-bold">{qs.score}%</div>
                      <span className={BADGE[qs.band?.badgeKey || 'gray']}>{qs.band?.label || '-'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {viewingSnapshot.result?.readiness && (
              <div>
                <div className="text-sm font-semibold text-gray-600 mb-2">Frozen Readiness</div>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                  {(viewingSnapshot.result.readiness.questionSummary || []).map((entry) => (
                    <div key={entry.question} className={CARD.padded}>
                      <div className="text-xs text-gray-500">{CATEGORY_LABELS[entry.question]}</div>
                      <div className="text-lg font-bold">{entry.strong}/{entry.total}</div>
                      <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                        {entry.missing > 0 ? <span className={BADGE.red}>{entry.missing} missing</span> : null}
                        {entry.weak > 0 ? <span className={BADGE.red}>{entry.weak} weak</span> : null}
                        {entry.stale > 0 ? <span className={BADGE.amber}>{entry.stale} stale</span> : null}
                        {entry.partial > 0 ? <span className={BADGE.amber}>{entry.partial} partial</span> : null}
                        {entry.missing === 0 && entry.weak === 0 && entry.stale === 0 && entry.partial === 0 ? (
                          <span className={BADGE.green}>Strong</span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  {viewingSnapshot.result.readiness.gaps?.length || 0} open readiness gaps at snapshot time.
                </p>
              </div>
            )}
            {viewingSnapshot.sign_off_notes && (
              <div className="text-sm text-gray-600">
                <span className="font-medium">Sign-off notes:</span> {viewingSnapshot.sign_off_notes}
              </div>
            )}
          </div>
          <div className={MODAL.footer}>
            {snapshotError && <p className="text-sm text-red-600 mr-auto">{snapshotError}</p>}
            <button className={BTN.secondary} onClick={() => setViewingSnapshot(null)}>Close</button>
            <button className={BTN.primary} onClick={async () => {
              setGenerating(true);
              setSnapshotError(null);
              try {
                const frozenData = viewingSnapshot?.result?.evidencePackData;
                if (!frozenData) {
                  throw new Error('This snapshot was created before frozen PDF exports were added. Create a new snapshot to export a signed-off evidence pack.');
                }
                const { generateEvidencePackPDF } = await import('../lib/pdfReports.js');
                generateEvidencePackPDF(
                  frozenData,
                  viewingSnapshot?.result?.evidencePackMeta?.date_range_days || dateRangeDays,
                  viewingSnapshot
                );
              } catch (e) { setSnapshotError(e.message); }
              finally { setGenerating(false); }
            }} disabled={generating || !snapshotPdfAvailable}>{generating ? 'Generating...' : 'Export PDF from Snapshot'}</button>
          </div>
        </Modal>
      )}

      {/* Add Evidence Modal */}
      <Modal isOpen={showAddEvidence} onClose={() => { setShowAddEvidence(false); setSaveError(null); setSaveNotice(null); }} title={evidenceForm.id ? 'Edit Evidence Item' : 'Add Evidence Item'} size="lg">

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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={INPUT.label}>Title</label>
                  <input type="text" className={INPUT.base} placeholder="Brief title..."
                    value={evidenceForm.title} onChange={e => setEvidenceForm({ ...evidenceForm, title: e.target.value })} />
                </div>
                <div>
                  <label className={INPUT.label}>Evidence Category</label>
                  <select className={INPUT.select} value={evidenceForm.evidence_category}
                    onChange={e => setEvidenceForm({ ...evidenceForm, evidence_category: e.target.value })}>
                    <option value="">— None —</option>
                    {EVIDENCE_CATEGORY_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                  </select>
                </div>
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={INPUT.label}>Evidence Owner</label>
                  <input
                    aria-label="Evidence Owner"
                    type="text"
                    className={INPUT.base}
                    placeholder="Who is responsible for keeping this current?"
                    value={evidenceForm.evidence_owner}
                    onChange={e => setEvidenceForm({ ...evidenceForm, evidence_owner: e.target.value })}
                  />
                </div>
                <div>
                  <label className={INPUT.label}>Review Due</label>
                  <input
                    aria-label="Review Due"
                    type="date"
                    className={INPUT.base}
                    value={evidenceForm.review_due}
                    onChange={e => setEvidenceForm({ ...evidenceForm, review_due: e.target.value })}
                  />
                </div>
              </div>

              <FileAttachments
                caseType="cqc_evidence"
                caseId={evidenceForm.id}
                readOnly={!canEdit}
                getFiles={getCqcEvidenceFiles}
                uploadFile={uploadCqcEvidenceFile}
                deleteFile={deleteCqcEvidenceFile}
                downloadFile={downloadCqcEvidenceFile}
                title="Supporting Files"
                emptyText="No supporting files uploaded yet."
                saveFirstMessage="You can upload on the first pass. We will save the evidence item automatically before the first file upload. Saving the evidence item alone does not attach the selected file — click Upload."
                ensureCaseId={canEdit ? ensureEvidenceForUploads : undefined}
              />
            </div>

            <div className={MODAL.footer}>
              {saveNotice && <p className="text-sm text-emerald-700 mr-auto">{saveNotice}</p>}
              {saveError && <p className="text-sm text-red-600 mr-auto">{saveError}</p>}
              <button onClick={() => { setShowAddEvidence(false); setSaveError(null); setSaveNotice(null); }} className={BTN.ghost}>Close</button>
              <button onClick={handleSaveEvidence}
                disabled={savingEvidence || !evidenceForm.quality_statement || !evidenceForm.title.trim()}
                className={BTN.primary}>{savingEvidence ? 'Saving...' : evidenceForm.id ? 'Save Changes' : 'Save Evidence'}</button>
            </div>
      </Modal>
      {ConfirmDialog}
    </div>
  );
}
