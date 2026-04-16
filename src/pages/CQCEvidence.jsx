import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useConfirm } from '../hooks/useConfirm.jsx';
import { CARD, BTN, BADGE, INPUT, MODAL, PAGE, TABLE } from '../lib/design.js';
import { formatDate } from '../lib/rotation.js';
import { useLiveDate } from '../hooks/useLiveDate.js';
import { downloadXLSX } from '../lib/excel.js';
import Modal from '../components/Modal.jsx';
import FileAttachments from '../components/FileAttachments.jsx';
import ScanDocumentLink from '../components/ScanDocumentLink.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import {
  getCurrentHome, getSchedulingData, getTrainingData,
  getIncidents, getComplaints, getMaintenance, getIpcAudits,
  getRisks, getPolicies, getWhistleblowingConcerns, getDols, getCareCertData,
  getCqcEvidence, getCqcReadiness, createCqcEvidence, updateCqcEvidence,
  getCqcEvidenceFiles, uploadCqcEvidenceFile, deleteCqcEvidenceFile, downloadCqcEvidenceFile,
  deleteCqcEvidence, getLoggedInUser, logReportDownload,
  createSnapshot, getSnapshots, getSnapshot, signOffSnapshot,
  getCqcNarratives, upsertCqcNarrative,
  getCqcPartnerFeedback, createCqcPartnerFeedback, updateCqcPartnerFeedback, deleteCqcPartnerFeedback,
  getCqcObservations, createCqcObservation, updateCqcObservation, deleteCqcObservation,
  getCqcEvidenceLinks, confirmCqcEvidenceLink, confirmBulkCqcEvidenceLinks,
} from '../lib/api.js';
import {
  QUALITY_STATEMENTS, METRIC_DEFINITIONS,
  calculateComplianceScore, getDateRange, getEvidenceForStatement,
} from '../lib/cqc.js';
import { buildReadinessMatrix, getOverallReadiness, getQuestionReadiness, getReadinessGaps } from '../lib/cqcReadiness.js';
import { getAllEvidenceCategories, getEvidenceCategoryLabel } from '../lib/cqcEvidenceCategories.js';
import {
  buildStructuredFallbackEvidenceLinks,
  filterKnownActiveEvidenceLinks,
  getEvidenceLinkDate,
  getEvidenceLinkSourceLabel,
} from '../lib/cqcEvidenceLinkHelpers.js';
import { useData } from '../contexts/DataContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { addDaysLocalISO, todayLocalISO } from '../lib/localDates.js';

const CATEGORY_LABELS = { safe: 'Safe', effective: 'Effective', caring: 'Caring', responsive: 'Responsive', 'well-led': 'Well-Led' };
const CATEGORY_COLORS = {
  safe: 'text-blue-700 bg-blue-50 border-blue-200',
  effective: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  caring: 'text-pink-700 bg-pink-50 border-pink-200',
  responsive: 'text-amber-700 bg-amber-50 border-amber-200',
  'well-led': 'text-purple-700 bg-purple-50 border-purple-200',
};

const EVIDENCE_CATEGORY_OPTIONS = getAllEvidenceCategories();

const RANGE_OPTIONS = [
  { days: 28, label: '28 Days' },
  { days: 90, label: '90 Days' },
  { days: 365, label: '1 Year' },
];

const SCORE_STYLES = {
  emerald: { card: 'rounded-xl p-3 bg-emerald-50 border border-emerald-200', label: 'text-xs font-medium text-emerald-600', value: 'text-3xl font-bold text-emerald-700 mt-0.5' },
  amber:   { card: 'rounded-xl p-3 bg-amber-50 border border-amber-200',     label: 'text-xs font-medium text-amber-600',   value: 'text-3xl font-bold text-amber-700 mt-0.5' },
  red:     { card: 'rounded-xl p-3 bg-red-50 border border-red-200',         label: 'text-xs font-medium text-red-600',     value: 'text-3xl font-bold text-red-700 mt-0.5' },
};
const ALL_STATEMENT_IDS = QUALITY_STATEMENTS.map((statement) => statement.id);

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

function getEvidenceDateRangeError(form) {
  if (form?.date_from && form?.date_to && form.date_to < form.date_from) {
    return 'Evidence To cannot be before Evidence From.';
  }
  return null;
}

function formatFileCount(count) {
  return `${count} file${count === 1 ? '' : 's'}`;
}

function blankPartnerFeedbackForm(statementId = '', existing = null) {
  return {
    id: existing?.id || null,
    version: existing?.version,
    quality_statement: statementId || existing?.quality_statement || '',
    feedback_date: existing?.feedback_date || todayLocalISO(),
    title: existing?.title || '',
    partner_name: existing?.partner_name || '',
    partner_role: existing?.partner_role || '',
    relationship: existing?.relationship || '',
    summary: existing?.summary || '',
    response_action: existing?.response_action || '',
    evidence_owner: existing?.evidence_owner || '',
    review_due: existing?.review_due || '',
  };
}

function buildPartnerFeedbackPayload(form) {
  return {
    quality_statement: form.quality_statement,
    feedback_date: form.feedback_date || null,
    title: form.title.trim(),
    partner_name: form.partner_name.trim() || null,
    partner_role: form.partner_role.trim() || null,
    relationship: form.relationship.trim() || null,
    summary: form.summary.trim() || null,
    response_action: form.response_action.trim() || null,
    evidence_owner: form.evidence_owner.trim() || null,
    review_due: form.review_due || null,
  };
}

function blankObservationForm(statementId = '', existing = null) {
  return {
    id: existing?.id || null,
    version: existing?.version,
    quality_statement: statementId || existing?.quality_statement || '',
    observed_at: existing?.observed_at ? String(existing.observed_at).slice(0, 16) : `${todayLocalISO()}T09:00`,
    title: existing?.title || '',
    area: existing?.area || '',
    observer: existing?.observer || '',
    notes: existing?.notes || '',
    actions: existing?.actions || '',
    evidence_owner: existing?.evidence_owner || '',
    review_due: existing?.review_due || '',
  };
}

function buildObservationPayload(form) {
  return {
    quality_statement: form.quality_statement,
    observed_at: form.observed_at ? new Date(form.observed_at).toISOString() : null,
    title: form.title.trim(),
    area: form.area.trim() || null,
    observer: form.observer.trim() || null,
    notes: form.notes.trim() || null,
    actions: form.actions.trim() || null,
    evidence_owner: form.evidence_owner.trim() || null,
    review_due: form.review_due || null,
  };
}

function metricColor(value, lowerIsBetter) {
  if (lowerIsBetter) return value <= 5 ? 'text-emerald-600' : value <= 15 ? 'text-amber-600' : 'text-red-600';
  return value >= 90 ? 'text-emerald-600' : value >= 70 ? 'text-amber-600' : 'text-red-600';
}

function formatDateTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatLinkedEvidenceDate(link) {
  const isoDate = getEvidenceLinkDate(link);
  return isoDate ? formatDate(new Date(`${isoDate}T00:00:00Z`)) : '-';
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
      setError(null);
    }).catch((e) => {
      if (!cancelled) setError(e.message || 'Failed to load CQC data');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [homeSlug, refreshKey]);

  if (loading) {
    return (
      <div className={PAGE.container}>
        <LoadingState message="Loading CQC data..." />
      </div>
    );
  }
  if (error || !moduleData) {
    return (
      <div className={PAGE.container}>
        <ErrorState
          title="Unable to load CQC evidence"
          message={error || 'Failed to load CQC data'}
          onRetry={() => {
            setLoading(true);
            setRefreshKey((value) => value + 1);
          }}
        />
      </div>
    );
  }

  return <CQCEvidenceInner data={moduleData} />;
}

function CQCEvidenceInner({ data }) {
  const { canWrite, isScanTargetEnabled } = useData();
  const canEdit = canWrite('compliance');
  const { confirm, ConfirmDialog } = useConfirm();
  const { showToast } = useToast();
  const isMounted = useRef(true);
  useEffect(() => { isMounted.current = true; return () => { isMounted.current = false; }; }, []);
  const [evidence, setEvidence] = useState([]);
  const [narratives, setNarratives] = useState([]);
  const [partnerFeedback, setPartnerFeedback] = useState([]);
  const [observations, setObservations] = useState([]);
  const [narrativeDrafts, setNarrativeDrafts] = useState({});
  const [evidenceLoading, setEvidenceLoading] = useState(true);
  const [narrativesLoading, setNarrativesLoading] = useState(true);
  const [structuredLoading, setStructuredLoading] = useState(true);
  const [liveReadiness, setLiveReadiness] = useState(null);
  const [readinessLoading, setReadinessLoading] = useState(true);
  const [readinessError, setReadinessError] = useState(null);
  const [statementLinks, setStatementLinks] = useState({});
  const [dateRangeDays, setDateRangeDays] = useState(28);
  const [expandedStatements, setExpandedStatements] = useState([]);
  const [confirmingLinkIds, setConfirmingLinkIds] = useState([]);
  const [confirmingStatements, setConfirmingStatements] = useState([]);
  const [showAllReadinessGaps, setShowAllReadinessGaps] = useState(false);
  const [showAddEvidence, setShowAddEvidence] = useState(false);
  const [evidenceForm, setEvidenceForm] = useState(blankEvidenceForm());
  const [showPartnerFeedbackModal, setShowPartnerFeedbackModal] = useState(false);
  const [partnerFeedbackForm, setPartnerFeedbackForm] = useState(blankPartnerFeedbackForm());
  const [showObservationModal, setShowObservationModal] = useState(false);
  const [observationForm, setObservationForm] = useState(blankObservationForm());
  const [generating, setGenerating] = useState(false);
  const [savingEvidence, setSavingEvidence] = useState(false);
  const [savingNarrativeId, setSavingNarrativeId] = useState(null);
  const [savingPartnerFeedback, setSavingPartnerFeedback] = useState(false);
  const [savingObservation, setSavingObservation] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveNotice, setSaveNotice] = useState(null);
  const [narrativeError, setNarrativeError] = useState(null);
  const [narrativeNotice, setNarrativeNotice] = useState(null);
  const [structuredError, setStructuredError] = useState(null);
  const [structuredNotice, setStructuredNotice] = useState(null);
  const [snapshotError, setSnapshotError] = useState(null);
  const [snapshotNotice, setSnapshotNotice] = useState(null);
  const [pdfError, setPdfError] = useState(null);

  // Snapshot state
  const [snapshots, setSnapshots] = useState([]);
  const [_snapshotLoading, setSnapshotLoading] = useState(false);
  const [viewingSnapshot, setViewingSnapshot] = useState(null);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [signOffDraft, setSignOffDraft] = useState(null);

  useDirtyGuard(showAddEvidence || showPartnerFeedbackModal || showObservationModal || Boolean(signOffDraft));

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

  const loadStructuredEvidence = useCallback(async () => {
    try {
      const home = getCurrentHome();
      const [feedbackRows, observationRows] = await Promise.all([
        getCqcPartnerFeedback(home),
        getCqcObservations(home),
      ]);
      if (!isMounted.current) return;
      setPartnerFeedback(Array.isArray(feedbackRows) ? feedbackRows : []);
      setObservations(Array.isArray(observationRows) ? observationRows : []);
    } catch (err) {
      if (isMounted.current) console.error('Failed to load structured CQC evidence:', err);
    } finally {
      if (isMounted.current) setStructuredLoading(false);
    }
  }, []);

  useEffect(() => { loadStructuredEvidence(); }, [loadStructuredEvidence]);

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
  }, [loadReadiness, evidence, narratives, partnerFeedback, observations]);

  const loadSnapshots = useCallback(async () => {
    const home = getCurrentHome();
    if (!home) return;
    if (isMounted.current) setSnapshotLoading(true);
    try {
      const result = await getSnapshots(home, 'cqc');
      if (isMounted.current) setSnapshots(Array.isArray(result) ? result : []);
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
      showToast({
        title: 'Snapshot saved',
        message: 'The current CQC evidence and readiness state has been frozen for review.',
      });
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
      showToast({
        title: 'Snapshot signed off',
        message: 'The selected CQC snapshot is now independently signed off.',
      });
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
      cqc_partner_feedback: partnerFeedback,
      cqc_observations: observations,
    };
  }, [data, evidence, narratives, partnerFeedback, observations]);

  const loadStatementLinks = useCallback(async (statementId, { force = false } = {}) => {
    const home = getCurrentHome();
    if (!home || !statementId || !dataWithEvidence) return;
    const rangeKey = `${statementId}:${formatDate(dateRange.from)}:${formatDate(dateRange.to)}`;
    const cached = statementLinks[statementId];
    if (!force && cached?.rangeKey === rangeKey && (cached.loading || Array.isArray(cached.rows))) return;

    setStatementLinks((prev) => ({
      ...prev,
      [statementId]: {
        rows: prev[statementId]?.rows || [],
        loading: true,
        error: null,
        rangeKey,
      },
    }));

    try {
      const result = await getCqcEvidenceLinks(home, {
        statement: statementId,
        dateFrom: formatDate(dateRange.from),
        dateTo: formatDate(dateRange.to),
        limit: 500,
      });
      if (!isMounted.current) return;
      const filteredRows = filterKnownActiveEvidenceLinks(result?.rows || [], dataWithEvidence);
      const fallbackRows = buildStructuredFallbackEvidenceLinks(dataWithEvidence, filteredRows)
        .filter((entry) => (
          entry.qualityStatement === statementId &&
          (!getEvidenceLinkDate(entry) || (
            getEvidenceLinkDate(entry) >= formatDate(dateRange.from) &&
            getEvidenceLinkDate(entry) <= formatDate(dateRange.to)
          ))
        ));
      const rows = [...filteredRows, ...fallbackRows].sort((a, b) => {
        const aDate = getEvidenceLinkDate(a) || '';
        const bDate = getEvidenceLinkDate(b) || '';
        return String(bDate).localeCompare(String(aDate));
      });
      setStatementLinks((prev) => ({
        ...prev,
        [statementId]: {
          rows,
          loading: false,
          error: null,
          rangeKey,
          total: rows.length,
        },
      }));
    } catch (err) {
      if (!isMounted.current) return;
      setStatementLinks((prev) => ({
        ...prev,
        [statementId]: {
          rows: prev[statementId]?.rows || [],
          loading: false,
          error: err.message || 'Failed to load linked evidence',
          rangeKey,
        },
      }));
    }
  }, [dataWithEvidence, dateRange, statementLinks]);

  useEffect(() => {
    setStatementLinks({});
  }, [dataWithEvidence, dateRangeDays]);

  useEffect(() => {
    expandedStatements.forEach((statementId) => {
      loadStatementLinks(statementId).catch(() => {});
    });
  }, [expandedStatements, loadStatementLinks]);

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

  const partnerFeedbackByStatement = useMemo(() => {
    const grouped = {};
    for (const entry of partnerFeedback) {
      (grouped[entry.quality_statement] ||= []).push(entry);
    }
    for (const values of Object.values(grouped)) {
      values.sort((a, b) => String(b.feedback_date || '').localeCompare(String(a.feedback_date || '')));
    }
    return grouped;
  }, [partnerFeedback]);

  const observationsByStatement = useMemo(() => {
    const grouped = {};
    for (const entry of observations) {
      (grouped[entry.quality_statement] ||= []).push(entry);
    }
    for (const values of Object.values(grouped)) {
      values.sort((a, b) => String(b.observed_at || '').localeCompare(String(a.observed_at || '')));
    }
    return grouped;
  }, [observations]);

  if (!data?.config || !score) {
    return (
      <div className={PAGE.container}>
        <LoadingState message="Preparing the CQC evidence workspace..." />
      </div>
    );
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

  function openAddPartnerFeedback(statementId) {
    setPartnerFeedbackForm(blankPartnerFeedbackForm(statementId));
    setStructuredError(null);
    setStructuredNotice(null);
    setShowPartnerFeedbackModal(true);
  }

  function openEditPartnerFeedback(item) {
    setPartnerFeedbackForm(blankPartnerFeedbackForm(item.quality_statement, item));
    setStructuredError(null);
    setStructuredNotice(null);
    setShowPartnerFeedbackModal(true);
  }

  function openAddObservation(statementId) {
    setObservationForm(blankObservationForm(statementId));
    setStructuredError(null);
    setStructuredNotice(null);
    setShowObservationModal(true);
  }

  function openEditObservation(item) {
    setObservationForm(blankObservationForm(item.quality_statement, item));
    setStructuredError(null);
    setStructuredNotice(null);
    setShowObservationModal(true);
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

  function toggleExpandedStatement(statementId) {
    setExpandedStatements((prev) => {
      if (prev.includes(statementId)) return prev.filter((entry) => entry !== statementId);
      loadStatementLinks(statementId).catch(() => {});
      return [...prev, statementId];
    });
  }

  async function handleConfirmEvidenceLink(statementId, linkId) {
    if (!linkId || confirmingLinkIds.includes(linkId)) return;
    const home = getCurrentHome();
    setConfirmingLinkIds((prev) => [...prev, linkId]);
    setStructuredError(null);
    setStructuredNotice(null);
    try {
      await confirmCqcEvidenceLink(home, linkId);
      await Promise.all([
        loadStatementLinks(statementId, { force: true }),
        loadReadiness(),
      ]);
      showToast({
        title: 'Linked evidence confirmed',
        message: `${statementId} no longer counts this item as awaiting review.`,
      });
    } catch (err) {
      setStructuredError(`Failed to confirm linked evidence: ${err.message}`);
    } finally {
      setConfirmingLinkIds((prev) => prev.filter((entry) => entry !== linkId));
    }
  }

  async function handleConfirmAllEvidenceLinks(statementId) {
    if (confirmingStatements.includes(statementId)) return;
    const home = getCurrentHome();
    const pendingIds = (statementLinks[statementId]?.rows || [])
      .filter((entry) => entry.requiresReview && entry.id)
      .map((entry) => entry.id);
    if (pendingIds.length === 0) return;

    setConfirmingStatements((prev) => [...prev, statementId]);
    setStructuredError(null);
    setStructuredNotice(null);
    try {
      await confirmBulkCqcEvidenceLinks(home, pendingIds);
      await Promise.all([
        loadStatementLinks(statementId, { force: true }),
        loadReadiness(),
      ]);
      showToast({
        title: 'Linked evidence confirmed',
        message: `${pendingIds.length} pending link${pendingIds.length === 1 ? '' : 's'} were confirmed for ${statementId}.`,
      });
    } catch (err) {
      setStructuredError(`Failed to confirm linked evidence: ${err.message}`);
    } finally {
      setConfirmingStatements((prev) => prev.filter((entry) => entry !== statementId));
    }
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
      showToast({
        title: 'Self-assessment saved',
        message: `${statementId} has been updated with the latest narrative and review details.`,
      });
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
      showToast({
        title: 'Evidence removed',
        message: 'The evidence item was deleted from this statement.',
      });
    } catch (err) {
      setSaveError('Failed to delete evidence: ' + err.message);
    } finally {
      setSavingEvidence(false);
    }
  }

  async function handleSavePartnerFeedback() {
    if (savingPartnerFeedback) return;
    if (!partnerFeedbackForm.quality_statement || !partnerFeedbackForm.title.trim() || !partnerFeedbackForm.feedback_date) return;
    const home = getCurrentHome();
    setSavingPartnerFeedback(true);
    setStructuredError(null);
    setStructuredNotice(null);
    try {
      const payload = buildPartnerFeedbackPayload(partnerFeedbackForm);
      const saved = partnerFeedbackForm.id
        ? await updateCqcPartnerFeedback(home, partnerFeedbackForm.id, { ...payload, _version: partnerFeedbackForm.version })
        : await createCqcPartnerFeedback(home, payload);
      await loadStructuredEvidence();
      setPartnerFeedbackForm(blankPartnerFeedbackForm(saved.quality_statement, saved));
      setStructuredNotice(partnerFeedbackForm.id ? 'Partner feedback updated.' : 'Partner feedback saved.');
      setShowPartnerFeedbackModal(false);
    } catch (err) {
      setStructuredError(`Failed to save partner feedback: ${err.message}`);
    } finally {
      setSavingPartnerFeedback(false);
    }
  }

  async function handleDeletePartnerFeedback(id) {
    if (!await confirm('Remove this partner feedback entry?')) return;
    const home = getCurrentHome();
    setStructuredError(null);
    setStructuredNotice(null);
    try {
      await deleteCqcPartnerFeedback(home, id);
      await loadStructuredEvidence();
      showToast({
        title: 'Partner feedback removed',
        message: 'The partner feedback entry was deleted.',
      });
    } catch (err) {
      setStructuredError(`Failed to remove partner feedback: ${err.message}`);
    }
  }

  async function handleSaveObservation() {
    if (savingObservation) return;
    if (!observationForm.quality_statement || !observationForm.title.trim() || !observationForm.observed_at) return;
    const home = getCurrentHome();
    setSavingObservation(true);
    setStructuredError(null);
    setStructuredNotice(null);
    try {
      const payload = buildObservationPayload(observationForm);
      const saved = observationForm.id
        ? await updateCqcObservation(home, observationForm.id, { ...payload, _version: observationForm.version })
        : await createCqcObservation(home, payload);
      await loadStructuredEvidence();
      setObservationForm(blankObservationForm(saved.quality_statement, saved));
      setStructuredNotice(observationForm.id ? 'Observation updated.' : 'Observation saved.');
      setShowObservationModal(false);
    } catch (err) {
      setStructuredError(`Failed to save observation: ${err.message}`);
    } finally {
      setSavingObservation(false);
    }
  }

  async function handleDeleteObservation(id) {
    if (!await confirm('Remove this observation entry?')) return;
    const home = getCurrentHome();
    setStructuredError(null);
    setStructuredNotice(null);
    try {
      await deleteCqcObservation(home, id);
      await loadStructuredEvidence();
      showToast({
        title: 'Observation removed',
        message: 'The observation entry was deleted.',
      });
    } catch (err) {
      setStructuredError(`Failed to remove observation: ${err.message}`);
    }
  }

  async function handleGeneratePDF() {
    setGenerating(true);
    setPdfError(null);
    try {
      await new Promise(r => setTimeout(r, 100));
      const { generateEvidencePackPDF } = await import('../lib/pdfReports.js');
      generateEvidencePackPDF(dataWithEvidence, dateRangeDays, null, readinessPayload);
      logReportDownload('cqc-evidence', `${dateRangeDays} days`);
      showToast({
        title: 'Evidence pack export started',
        message: 'The live CQC evidence pack PDF is being generated.',
      });
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
    showToast({
      title: 'Excel export started',
      message: 'The CQC evidence workbook is downloading.',
    });
  }

  const categories = ['safe', 'effective', 'caring', 'responsive', 'well-led'];
  const snapshotPdfAvailable = Boolean(viewingSnapshot?.result?.evidencePackData);
  const visibleReadinessGaps = showAllReadinessGaps ? readinessGaps : readinessGaps.slice(0, 10);

  return (
    <div className={PAGE.container}>
      {/* Header */}
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>CQC Compliance Evidence</h1>
          <p className={PAGE.subtitle}>Single Assessment Framework — staffing compliance scorecard and evidence pack</p>
        </div>
        <div className="flex gap-2">
          {canEdit && isScanTargetEnabled('cqc') && <ScanDocumentLink context={{ target: 'cqc' }} label="Scan evidence" />}
          <button type="button" onClick={handleExportExcel} className={`${BTN.secondary} ${BTN.sm}`}>Export Excel</button>
          {canEdit && <button type="button" onClick={handleCreateSnapshot} disabled={generating} title="Freeze the current evidence, readiness, and score so you can review this exact state later." className={`${BTN.secondary} ${BTN.sm}`}>
            Save Snapshot
          </button>}
          <button type="button" onClick={handleGeneratePDF} disabled={generating} title={`Generate a PDF evidence pack using the current ${dateRangeDays}-day readiness window.`} className={BTN.primary}>
            {generating ? 'Generating...' : 'Generate Evidence Pack'}
          </button>
        </div>
      </div>

      {pdfError && <InlineNotice variant="error" className="mb-3">{pdfError}</InlineNotice>}
      {snapshotNotice && <InlineNotice variant="warning" className="mb-3">{snapshotNotice}</InlineNotice>}
      {snapshotError && <InlineNotice variant="error" className="mb-3">{snapshotError}</InlineNotice>}
      {narrativeNotice && <InlineNotice variant="success" className="mb-3">{narrativeNotice}</InlineNotice>}
      {narrativeError && <InlineNotice variant="error" className="mb-3">{narrativeError}</InlineNotice>}
      {structuredNotice && <InlineNotice variant="success" className="mb-3">{structuredNotice}</InlineNotice>}
      {structuredError && <InlineNotice variant="error" className="mb-3">{structuredError}</InlineNotice>}

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

      <div className="mb-5">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-900">Readiness</h2>
          {readinessLoading ? (
            <span className={`${BADGE.gray} gap-1.5`}>
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />
              Refreshing...
            </span>
          ) : null}
        </div>
        {readinessError ? (
          <InlineNotice variant="warning" className="mb-3" role="status">
            Live readiness could not be refreshed from the server, so this view is temporarily using the local fallback calculation.
          </InlineNotice>
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
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{CATEGORY_LABELS[question]}</p>
                <p className="text-lg font-bold text-gray-900 mt-1">{summary.strong}/{summary.total} strong</p>
                <div className="mt-2 flex flex-wrap gap-1">
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
      <div className="mb-5 print:hidden">
        <div className="mb-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Readiness evidence window</p>
          <p className="text-xs text-gray-500">Choose which evidence period is included in the readiness scoring and evidence pack.</p>
        </div>
        <div className="flex flex-wrap gap-1">
          {RANGE_OPTIONS.map(opt => (
            <button key={opt.days} type="button" onClick={() => setDateRangeDays(opt.days)}
              className={`${dateRangeDays === opt.days ? BTN.primary : BTN.ghost} ${BTN.xs}`}>
              {opt.label}
            </button>
          ))}
          <span className="text-xs text-gray-400 self-center ml-2">
            {formatDate(dateRange.from)} to {formatDate(dateRange.to)}
          </span>
        </div>
      </div>

      {readinessGaps.length > 0 && (
        <div className={`${CARD.padded} mb-5`}>
          <div className="flex items-center justify-between gap-3 mb-2">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Readiness Gaps</h2>
              <p className="text-xs text-gray-500">Statements that still need fresher, broader, or better-owned evidence.</p>
            </div>
            <span className={BADGE.amber}>{readinessGaps.length} open</span>
          </div>
          <div className="space-y-2">
            {visibleReadinessGaps.map((gap) => (
              <div key={gap.statementId} className="flex flex-col gap-1 rounded-lg border border-gray-200 px-3 py-2 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-2">
                  <span className={readinessBadgeClass(gap.status)}>{readinessStatusLabel(gap.status)}</span>
                  <span className="text-sm font-medium text-gray-900">{gap.statementId} - {gap.statementName}</span>
                </div>
                <p className="text-xs text-gray-500 md:text-right">{gap.summary}</p>
              </div>
            ))}
          </div>
          {readinessGaps.length > 10 && (
            <div className="mt-3 flex justify-end">
              <button type="button" className={`${BTN.ghost} ${BTN.xs}`} onClick={() => setShowAllReadinessGaps((prev) => !prev)}>
                {showAllReadinessGaps ? 'Show fewer gaps' : `Show all ${readinessGaps.length} gaps`}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="mb-4 flex items-center justify-end gap-2">
        <button
          type="button"
          className={`${BTN.ghost} ${BTN.sm}`}
          onClick={() => {
            setExpandedStatements(ALL_STATEMENT_IDS);
            ALL_STATEMENT_IDS.forEach((statementId) => {
              loadStatementLinks(statementId).catch(() => {});
            });
          }}
        >
          Expand all
        </button>
        <button type="button" className={`${BTN.ghost} ${BTN.sm}`} onClick={() => setExpandedStatements([])}>
          Collapse all
        </button>
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
              const isExpanded = expandedStatements.includes(qs.id);
              const ev = evidenceByStatement[qs.id];
              const readiness = readinessEntries[qs.id];
              const autoCount = ev?.autoEvidence?.length || 0;
              const directManualEvidence = (ev?.manualEvidence || []).filter((entry) => (entry?.source_kind || 'manual_evidence') === 'manual_evidence');
              const manualCount = directManualEvidence.length;
              const statementLinkState = statementLinks[qs.id] || { rows: [], loading: false, error: null, total: 0 };
              const pendingLinkIds = statementLinkState.rows.filter((entry) => entry.requiresReview && entry.id).map((entry) => entry.id);
              const feedbackItems = partnerFeedbackByStatement[qs.id] || [];
              const observationItems = observationsByStatement[qs.id] || [];
              const narrativeDraft = getNarrativeDraft(qs.id);

              return (
                <div key={qs.id} className={CARD.padded}>
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      className="flex items-center gap-3 rounded-lg text-left transition-colors hover:bg-gray-50"
                      onClick={() => toggleExpandedStatement(qs.id)}
                      aria-expanded={isExpanded}
                    >
                      <svg className="h-5 w-5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d={qs.icon} />
                      </svg>
                      <div>
                        <span className="font-medium text-gray-900">{qs.name}</span>
                        <span className="text-xs text-gray-400 ml-2">{qs.cqcRef}</span>
                      </div>
                    </button>
                    <div className="flex items-center gap-3">
                      {readiness && <span className={readinessBadgeClass(readiness.status)}>{readinessStatusLabel(readiness.status)}</span>}
                      <span className="text-xs text-gray-500">
                        {readiness?.linkedEvidenceCount ?? manualCount} linked item{(readiness?.linkedEvidenceCount ?? manualCount) === 1 ? '' : 's'}
                      </span>
                      {readiness?.requiresReviewCount > 0 ? <span className={BADGE.amber}>{readiness.requiresReviewCount} to review</span> : null}
                      {ev?.autoEvidence?.map((ae, i) => (
                        <span key={i} className={`text-sm font-bold ${metricColor(ae.value, ae.lowerIsBetter)}`}>
                          {ae.value}{ae.unit}
                        </span>
                      ))}
                      <button type="button" className={`${BTN.ghost} ${BTN.xs}`} onClick={() => toggleExpandedStatement(qs.id)} aria-expanded={isExpanded}>
                        {isExpanded ? 'Collapse' : 'Expand'}
                      </button>
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
                              {readiness.linkedEvidenceCount ?? readiness.evidenceCount} linked items | {readiness.categoriesCovered}/{readiness.categoriesExpected} expected categories covered
                            </span>
                            {readiness.autoLinkedCount > 0 && <span className={BADGE.blue}>{readiness.autoLinkedCount} auto-linked</span>}
                            {readiness.requiresReviewCount > 0 && <span className={BADGE.amber}>{readiness.requiresReviewCount} awaiting review</span>}
                            {readiness.staleCount > 0 && <span className={BADGE.amber}>{readiness.staleCount} stale</span>}
                            {readiness.reviewOverdue > 0 && <span className={BADGE.red}>{readiness.reviewOverdue} overdue</span>}
                            {!readiness.narrativePresent && <span className={BADGE.gray}>Narrative missing</span>}
                          </div>
                          <p className="mt-2 text-xs text-gray-500">{readiness.summary}</p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {Object.entries(readiness.evidenceByCategory || {})
                              .filter(([, count]) => count > 0)
                              .map(([category, count]) => (
                                <span key={category} className={BADGE.gray}>
                                  {getEvidenceCategoryLabel(category)}: {count}
                                </span>
                              ))}
                          </div>
                        </div>
                      )}

                      <div className="mb-3">
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Linked Evidence</div>
                            <p className="text-[11px] text-gray-500">This is the evidence the readiness engine is counting for this statement.</p>
                          </div>
                          {canEdit && pendingLinkIds.length > 1 ? (
                            <button
                              type="button"
                              className={`${BTN.secondary} ${BTN.xs}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleConfirmAllEvidenceLinks(qs.id);
                              }}
                              disabled={confirmingStatements.includes(qs.id)}
                            >
                              {confirmingStatements.includes(qs.id) ? 'Confirming...' : `Confirm all ${pendingLinkIds.length}`}
                            </button>
                          ) : null}
                        </div>
                        {statementLinkState.loading ? (
                          <LoadingState compact message="Loading linked evidence..." />
                        ) : statementLinkState.error ? (
                          <InlineNotice variant="warning" role="status">
                            {statementLinkState.error}
                          </InlineNotice>
                        ) : statementLinkState.rows.length === 0 ? (
                          <EmptyState
                            compact
                            title="No linked evidence yet"
                            description="This statement will grow stronger once operational records or manual evidence are linked into the readiness layer."
                          />
                        ) : (
                          <div className="space-y-1.5">
                            {statementLinkState.rows.map((entry) => (
                              <div
                                key={`${entry.id || 'derived'}-${entry.sourceModule}-${entry.sourceId}-${entry.qualityStatement}-${entry.evidenceCategory}`}
                                className="rounded bg-gray-50 px-2 py-2"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <div className="text-sm font-medium text-gray-800">
                                      {getEvidenceLinkSourceLabel(entry.sourceModule)} {entry.sourceId}
                                      <span className={`${BADGE.gray} ml-1.5 text-[10px]`}>{getEvidenceCategoryLabel(entry.evidenceCategory)}</span>
                                      {entry.autoLinked ? <span className={`${BADGE.blue} ml-1.5 text-[10px]`}>Auto-linked</span> : <span className={`${BADGE.gray} ml-1.5 text-[10px]`}>Direct</span>}
                                      {entry.requiresReview ? <span className={`${BADGE.amber} ml-1.5 text-[10px]`}>Needs review</span> : null}
                                    </div>
                                    <div className="mt-0.5 text-[10px] text-gray-400">
                                      {formatLinkedEvidenceDate(entry)}
                                      {entry.linkedBy ? ` | linked by ${entry.linkedBy}` : ''}
                                    </div>
                                    {entry.rationale ? <div className="mt-1 text-xs text-gray-500">{entry.rationale}</div> : null}
                                  </div>
                                  {canEdit && entry.requiresReview && entry.id ? (
                                    <button
                                      type="button"
                                      className={`${BTN.secondary} ${BTN.xs}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleConfirmEvidenceLink(qs.id, entry.id);
                                      }}
                                      disabled={confirmingLinkIds.includes(entry.id)}
                                    >
                                      {confirmingLinkIds.includes(entry.id) ? 'Confirming...' : 'Confirm'}
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Auto-computed metrics */}
                      {autoCount > 0 && (
                        <div className="mb-3">
                          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">System Metrics</div>
                          <div className="space-y-1">
                            {ev.autoEvidence.map((ae, i) => (
                              <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded bg-gray-50">
                                <span className="text-sm text-gray-700">{ae.label}</span>
                                <div className="flex items-center gap-2">
                                  <span className={`text-sm font-bold ${metricColor(ae.value, ae.lowerIsBetter)}`}>
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
                            {directManualEvidence.map(me => (
                              <div key={me.id} className="flex items-start justify-between py-1.5 px-2 rounded bg-gray-50">
                                <div>
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
                                  <div className="ml-2 flex shrink-0 gap-2">
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
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Partner Feedback</div>
                          {canEdit && (
                            <button
                              type="button"
                              className={`${BTN.secondary} ${BTN.xs}`}
                              onClick={(e) => { e.stopPropagation(); openAddPartnerFeedback(qs.id); }}
                            >
                              + Add Partner Feedback
                            </button>
                          )}
                        </div>
                        {structuredLoading ? (
                          <LoadingState compact message="Loading partner feedback..." />
                        ) : feedbackItems.length === 0 ? (
                          <EmptyState
                            compact
                            title="No partner feedback recorded yet"
                            description="Capture family, professional, or stakeholder feedback here when it supports this statement."
                          />
                        ) : (
                          <div className="space-y-1.5">
                            {feedbackItems.map((entry) => (
                              <div key={entry.id} className="rounded bg-gray-50 px-2 py-2">
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <div className="text-sm font-medium text-gray-800">{entry.title}</div>
                                    <div className="text-[10px] text-gray-400 mt-0.5">
                                      {entry.feedback_date}
                                      {entry.partner_name ? ` | ${entry.partner_name}` : ''}
                                      {entry.partner_role ? ` | ${entry.partner_role}` : ''}
                                      {entry.evidence_owner ? ` | owner ${entry.evidence_owner}` : ''}
                                      {entry.review_due ? ` | review due ${entry.review_due}` : ''}
                                    </div>
                                    {entry.summary && <div className="text-xs text-gray-500 mt-1">{entry.summary}</div>}
                                    {entry.response_action && <div className="text-xs text-gray-500 mt-1">Action: {entry.response_action}</div>}
                                  </div>
                                  {canEdit && (
                                    <div className="ml-2 flex shrink-0 gap-2">
                                      <button
                                        type="button"
                                        className="text-xs text-blue-500 hover:text-blue-700"
                                        onClick={(e) => { e.stopPropagation(); openEditPartnerFeedback(entry); }}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        className="text-xs text-red-400 hover:text-red-600"
                                        onClick={(e) => { e.stopPropagation(); handleDeletePartnerFeedback(entry.id); }}
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="mb-3">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Observation Notes</div>
                          {canEdit && (
                            <button
                              type="button"
                              className={`${BTN.secondary} ${BTN.xs}`}
                              onClick={(e) => { e.stopPropagation(); openAddObservation(qs.id); }}
                            >
                              + Add Observation
                            </button>
                          )}
                        </div>
                        {structuredLoading ? (
                          <LoadingState compact message="Loading observations..." />
                        ) : observationItems.length === 0 ? (
                          <EmptyState
                            compact
                            title="No structured observations yet"
                            description="Use observation notes when this statement needs a direct practice example rather than a document."
                          />
                        ) : (
                          <div className="space-y-1.5">
                            {observationItems.map((entry) => (
                              <div key={entry.id} className="rounded bg-gray-50 px-2 py-2">
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <div className="text-sm font-medium text-gray-800">{entry.title}</div>
                                    <div className="text-[10px] text-gray-400 mt-0.5">
                                      {formatDateTime(entry.observed_at)}
                                      {entry.area ? ` | ${entry.area}` : ''}
                                      {entry.observer ? ` | ${entry.observer}` : ''}
                                      {entry.evidence_owner ? ` | owner ${entry.evidence_owner}` : ''}
                                      {entry.review_due ? ` | review due ${entry.review_due}` : ''}
                                    </div>
                                    {entry.notes && <div className="text-xs text-gray-500 mt-1">{entry.notes}</div>}
                                    {entry.actions && <div className="text-xs text-gray-500 mt-1">Action: {entry.actions}</div>}
                                  </div>
                                  {canEdit && (
                                    <div className="ml-2 flex shrink-0 gap-2">
                                      <button
                                        type="button"
                                        className="text-xs text-blue-500 hover:text-blue-700"
                                        onClick={(e) => { e.stopPropagation(); openEditObservation(entry); }}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        className="text-xs text-red-400 hover:text-red-600"
                                        onClick={(e) => { e.stopPropagation(); handleDeleteObservation(entry.id); }}
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="mb-3">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Self-Assessment</div>
                        <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-3">
                          <div>
                            <label className={INPUT.label}>What the evidence shows</label>
                            <textarea
                              aria-label="What the evidence shows"
                              className={`${INPUT.base} h-28`}
                              value={narrativeDraft.narrative}
                              onChange={(e) => updateNarrativeDraft(qs.id, { narrative: e.target.value })}
                              disabled={!canEdit}
                            />
                          </div>
                          <div>
                            <label className={INPUT.label}>Current risks</label>
                            <textarea
                              aria-label="Current risks"
                              className={`${INPUT.base} h-24`}
                              value={narrativeDraft.risks}
                              onChange={(e) => updateNarrativeDraft(qs.id, { risks: e.target.value })}
                              disabled={!canEdit}
                            />
                          </div>
                          <div>
                            <label className={INPUT.label}>Improvement actions</label>
                            <textarea
                              aria-label="Improvement actions"
                              className={`${INPUT.base} h-24`}
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
                                type="button"
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
                        <span className="text-xs text-gray-400">Refreshing evidence…</span>
                      ) : canEdit ? (
                        <div className="flex flex-wrap gap-2">
                          {isScanTargetEnabled('cqc') && (
                            <span onClick={(e) => e.stopPropagation()}>
                              <ScanDocumentLink context={{ target: 'cqc', qualityStatement: qs.id }} label="Scan evidence" className={BTN.xs} />
                            </span>
                          )}
                          <button type="button" onClick={(e) => { e.stopPropagation(); openAddEvidence(qs.id); }}
                            className={`${BTN.secondary} ${BTN.xs}`}>
                            + Add Evidence
                          </button>
                        </div>
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
        <button type="button" onClick={() => setShowSnapshots(!showSnapshots)} className={`${BTN.ghost} ${BTN.sm} mb-2`}>
          {showSnapshots ? 'Hide' : 'Show'} Snapshot History ({snapshots.length})
        </button>
        {showSnapshots && (
          <div className={CARD.flush}>
            {snapshots.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  compact
                  title="No snapshots saved yet"
                  description="Save a snapshot when you want to freeze today’s readiness and evidence pack for review."
                  actionLabel={canEdit ? 'Save Snapshot' : undefined}
                  onAction={canEdit ? handleCreateSnapshot : undefined}
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
                          <button type="button" className={`${BTN.ghost} ${BTN.xs}`} onClick={() => handleViewSnapshot(s.id)}>View</button>
                          {!s.signed_off_by && canEdit && (
                            <button type="button" className={`${BTN.ghost} ${BTN.xs}`} onClick={() => setSignOffDraft({ id: s.id, notes: '' })}>Sign Off</button>
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
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              You are viewing a frozen snapshot. This data does not update with the live system until a new snapshot is created.
            </div>
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
                <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
                  {(viewingSnapshot.result.readiness.questionSummary || []).map((entry) => (
                    <div key={entry.question} className={CARD.padded}>
                      <div className="text-xs text-gray-500">
                        {entry.question === 'well-led' ? 'Well-Led' : entry.question.replace(/^\w/, (value) => value.toUpperCase())}
                      </div>
                      <div className="text-sm font-semibold text-gray-900">{entry.strong}/{entry.total} strong</div>
                      <div className="text-[10px] text-gray-500">
                        {entry.missing} missing · {entry.weak} weak · {entry.stale} stale · {entry.partial} partial
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
            <button type="button" className={BTN.secondary} onClick={() => setViewingSnapshot(null)}>Close</button>
            <button type="button" className={BTN.primary} onClick={async () => {
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
                <label className={INPUT.label}>Quality Statement *</label>
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
                  <label className={INPUT.label}>Title *</label>
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
      <Modal
        isOpen={showPartnerFeedbackModal}
        onClose={() => { setShowPartnerFeedbackModal(false); setStructuredError(null); setStructuredNotice(null); }}
        title={partnerFeedbackForm.id ? 'Edit Partner Feedback' : 'Add Partner Feedback'}
        size="lg"
      >
        <div className="space-y-3">
          <div>
            <label className={INPUT.label}>Quality Statement</label>
            <select
              className={INPUT.select}
              value={partnerFeedbackForm.quality_statement}
              onChange={(e) => setPartnerFeedbackForm({ ...partnerFeedbackForm, quality_statement: e.target.value })}
            >
              <option value="">Select statement...</option>
              {QUALITY_STATEMENTS.map((qs) => (
                <option key={qs.id} value={qs.id}>{qs.cqcRef} — {qs.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={INPUT.label}>Feedback Date</label>
              <input
                type="date"
                aria-label="Feedback Date"
                className={INPUT.base}
                value={partnerFeedbackForm.feedback_date}
                onChange={(e) => setPartnerFeedbackForm({ ...partnerFeedbackForm, feedback_date: e.target.value })}
              />
            </div>
            <div>
              <label className={INPUT.label}>Title</label>
              <input
                type="text"
                aria-label="Title"
                className={INPUT.base}
                value={partnerFeedbackForm.title}
                onChange={(e) => setPartnerFeedbackForm({ ...partnerFeedbackForm, title: e.target.value })}
                placeholder="What was the feedback about?"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={INPUT.label}>Partner Name</label>
              <input
                type="text"
                aria-label="Partner Name"
                className={INPUT.base}
                value={partnerFeedbackForm.partner_name}
                onChange={(e) => setPartnerFeedbackForm({ ...partnerFeedbackForm, partner_name: e.target.value })}
              />
            </div>
            <div>
              <label className={INPUT.label}>Partner Role</label>
              <input
                type="text"
                aria-label="Partner Role"
                className={INPUT.base}
                value={partnerFeedbackForm.partner_role}
                onChange={(e) => setPartnerFeedbackForm({ ...partnerFeedbackForm, partner_role: e.target.value })}
                placeholder="Family / GP / Social worker"
              />
            </div>
            <div>
              <label className={INPUT.label}>Relationship</label>
              <input
                type="text"
                aria-label="Relationship"
                className={INPUT.base}
                value={partnerFeedbackForm.relationship}
                onChange={(e) => setPartnerFeedbackForm({ ...partnerFeedbackForm, relationship: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className={INPUT.label}>Feedback Summary</label>
            <textarea
              aria-label="Feedback Summary"
              className={`${INPUT.base} h-20`}
              value={partnerFeedbackForm.summary}
              onChange={(e) => setPartnerFeedbackForm({ ...partnerFeedbackForm, summary: e.target.value })}
            />
          </div>
          <div>
            <label className={INPUT.label}>Response / Follow-up</label>
            <textarea
              aria-label="Response / Follow-up"
              className={`${INPUT.base} h-20`}
              value={partnerFeedbackForm.response_action}
              onChange={(e) => setPartnerFeedbackForm({ ...partnerFeedbackForm, response_action: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={INPUT.label}>Evidence Owner</label>
              <input
                type="text"
                aria-label="Evidence Owner"
                className={INPUT.base}
                value={partnerFeedbackForm.evidence_owner}
                onChange={(e) => setPartnerFeedbackForm({ ...partnerFeedbackForm, evidence_owner: e.target.value })}
              />
            </div>
            <div>
              <label className={INPUT.label}>Review Due</label>
              <input
                type="date"
                aria-label="Review Due"
                className={INPUT.base}
                value={partnerFeedbackForm.review_due}
                onChange={(e) => setPartnerFeedbackForm({ ...partnerFeedbackForm, review_due: e.target.value })}
              />
            </div>
          </div>
        </div>
        <div className={MODAL.footer}>
          {structuredNotice && <p className="text-sm text-emerald-700 mr-auto">{structuredNotice}</p>}
          {structuredError && <p className="text-sm text-red-600 mr-auto">{structuredError}</p>}
          <button onClick={() => { setShowPartnerFeedbackModal(false); setStructuredError(null); setStructuredNotice(null); }} className={BTN.ghost}>Close</button>
          <button
            onClick={handleSavePartnerFeedback}
            disabled={savingPartnerFeedback || !partnerFeedbackForm.quality_statement || !partnerFeedbackForm.feedback_date || !partnerFeedbackForm.title.trim()}
            className={BTN.primary}
          >
            {savingPartnerFeedback ? 'Saving...' : partnerFeedbackForm.id ? 'Save Changes' : 'Save Partner Feedback'}
          </button>
        </div>
      </Modal>
      <Modal
        isOpen={showObservationModal}
        onClose={() => { setShowObservationModal(false); setStructuredError(null); setStructuredNotice(null); }}
        title={observationForm.id ? 'Edit Observation' : 'Add Observation'}
        size="lg"
      >
        <div className="space-y-3">
          <div>
            <label className={INPUT.label}>Quality Statement</label>
            <select
              className={INPUT.select}
              value={observationForm.quality_statement}
              onChange={(e) => setObservationForm({ ...observationForm, quality_statement: e.target.value })}
            >
              <option value="">Select statement...</option>
              {QUALITY_STATEMENTS.map((qs) => (
                <option key={qs.id} value={qs.id}>{qs.cqcRef} — {qs.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={INPUT.label}>Observed At</label>
              <input
                type="datetime-local"
                aria-label="Observed At"
                className={INPUT.base}
                value={observationForm.observed_at}
                onChange={(e) => setObservationForm({ ...observationForm, observed_at: e.target.value })}
              />
            </div>
            <div>
              <label className={INPUT.label}>Title</label>
              <input
                type="text"
                aria-label="Title"
                className={INPUT.base}
                value={observationForm.title}
                onChange={(e) => setObservationForm({ ...observationForm, title: e.target.value })}
                placeholder="What was observed?"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={INPUT.label}>Area</label>
              <input
                type="text"
                aria-label="Area"
                className={INPUT.base}
                value={observationForm.area}
                onChange={(e) => setObservationForm({ ...observationForm, area: e.target.value })}
                placeholder="Dining room / med round / handover"
              />
            </div>
            <div>
              <label className={INPUT.label}>Observer</label>
              <input
                type="text"
                aria-label="Observer"
                className={INPUT.base}
                value={observationForm.observer}
                onChange={(e) => setObservationForm({ ...observationForm, observer: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className={INPUT.label}>Observation Notes</label>
            <textarea
              aria-label="Observation Notes"
              className={`${INPUT.base} h-24`}
              value={observationForm.notes}
              onChange={(e) => setObservationForm({ ...observationForm, notes: e.target.value })}
            />
          </div>
          <div>
            <label className={INPUT.label}>Actions / Learning</label>
            <textarea
              aria-label="Actions / Learning"
              className={`${INPUT.base} h-20`}
              value={observationForm.actions}
              onChange={(e) => setObservationForm({ ...observationForm, actions: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={INPUT.label}>Evidence Owner</label>
              <input
                type="text"
                aria-label="Evidence Owner"
                className={INPUT.base}
                value={observationForm.evidence_owner}
                onChange={(e) => setObservationForm({ ...observationForm, evidence_owner: e.target.value })}
              />
            </div>
            <div>
              <label className={INPUT.label}>Review Due</label>
              <input
                type="date"
                aria-label="Review Due"
                className={INPUT.base}
                value={observationForm.review_due}
                onChange={(e) => setObservationForm({ ...observationForm, review_due: e.target.value })}
              />
            </div>
          </div>
        </div>
        <div className={MODAL.footer}>
          {structuredNotice && <p className="text-sm text-emerald-700 mr-auto">{structuredNotice}</p>}
          {structuredError && <p className="text-sm text-red-600 mr-auto">{structuredError}</p>}
          <button onClick={() => { setShowObservationModal(false); setStructuredError(null); setStructuredNotice(null); }} className={BTN.ghost}>Close</button>
          <button
            onClick={handleSaveObservation}
            disabled={savingObservation || !observationForm.quality_statement || !observationForm.observed_at || !observationForm.title.trim()}
            className={BTN.primary}
          >
            {savingObservation ? 'Saving...' : observationForm.id ? 'Save Changes' : 'Save Observation'}
          </button>
        </div>
      </Modal>
      <Modal isOpen={Boolean(signOffDraft)} onClose={() => setSignOffDraft(null)} title="Sign Off Snapshot" size="sm">
        <div className="space-y-3">
          <p className="text-sm text-gray-600">Add a short sign-off note so the audit trail records what was reviewed and approved.</p>
          <div>
            <label className={INPUT.label}>Sign-off notes</label>
            <textarea
              className={`${INPUT.base} h-24`}
              value={signOffDraft?.notes || ''}
              onChange={(e) => setSignOffDraft((current) => current ? { ...current, notes: e.target.value } : current)}
              placeholder="What was reviewed, any caveats, and who approved it..."
            />
          </div>
        </div>
        <div className={MODAL.footer}>
          <button type="button" className={BTN.ghost} onClick={() => setSignOffDraft(null)}>Cancel</button>
          <button
            type="button"
            className={BTN.primary}
            disabled={!signOffDraft?.notes?.trim()}
            onClick={async () => {
              if (!signOffDraft?.id || !signOffDraft.notes.trim()) return;
              await handleSignOff(signOffDraft.id, signOffDraft.notes.trim());
              setSignOffDraft(null);
            }}
          >
            Sign Off
          </button>
        </div>
      </Modal>
      {ConfirmDialog}
    </div>
  );
}
