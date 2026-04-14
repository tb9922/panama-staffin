import { normalizeEvidenceCategory } from './cqcEvidenceCategories.js';

const SOURCE_LABELS = {
  incident: 'Incident',
  complaint: 'Complaint',
  training_record: 'Training record',
  supervision: 'Supervision',
  appraisal: 'Appraisal',
  fire_drill: 'Fire drill',
  ipc_audit: 'IPC audit',
  maintenance: 'Maintenance check',
  risk: 'Risk entry',
  policy_review: 'Policy review',
  whistleblowing: 'Whistleblowing concern',
  dols: 'DoLS record',
  mca_assessment: 'MCA assessment',
  cqc_evidence: 'Manual evidence',
  cqc_partner_feedback: 'Partner feedback',
  cqc_observation: 'Observation',
  handover: 'Handover note',
  onboarding: 'Onboarding record',
  care_certificate: 'Care Certificate',
  hr_disciplinary: 'Disciplinary case',
  hr_grievance: 'Grievance case',
  hr_performance: 'Performance case',
};

function asIsoDate(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return null;
}

function sourceModuleOf(link) {
  return link?.sourceModule || link?.source_module || null;
}

function sourceIdOf(link) {
  const value = link?.sourceId ?? link?.source_id;
  return value == null ? null : String(value);
}

function statementOf(link) {
  return link?.qualityStatement || link?.quality_statement || null;
}

function categoryOf(link) {
  return normalizeEvidenceCategory(link?.evidenceCategory || link?.evidence_category || null);
}

function linkDateOf(link) {
  return (
    asIsoDate(link?.sourceRecordedAt) ||
    asIsoDate(link?.source_recorded_at) ||
    asIsoDate(link?.createdAt) ||
    asIsoDate(link?.created_at) ||
    null
  );
}

function reviewDueOf(link) {
  return asIsoDate(link?.reviewDue || link?.review_due || null);
}

function rationaleOf(link) {
  return link?.rationale || null;
}

function linkedByOf(link) {
  return link?.linkedBy || link?.linked_by || null;
}

function sourceKey(module, id) {
  return `${module}::${String(id)}`;
}

function evidenceKey(module, id, statementId, category) {
  return `${sourceKey(module, id)}::${statementId}::${category}`;
}

function addActiveSource(sources, knownModules, module, id) {
  knownModules.add(module);
  if (id == null) return;
  sources.add(sourceKey(module, id));
}

function flattenNestedArrays(value) {
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap((entry) => (Array.isArray(entry) ? entry : []));
}

function registerRecordArray(sources, knownModules, module, rows) {
  knownModules.add(module);
  for (const row of rows || []) addActiveSource(sources, knownModules, module, row?.id);
}

function registerTrainingRecords(sources, knownModules, training) {
  if (!training || typeof training !== 'object') return;
  knownModules.add('training_record');
  for (const [staffId, records] of Object.entries(training)) {
    for (const typeId of Object.keys(records || {})) {
      addActiveSource(sources, knownModules, 'training_record', `${staffId}:${typeId}`);
    }
  }
}

export function getEvidenceLinkSourceLabel(sourceModule) {
  return SOURCE_LABELS[sourceModule] || sourceModule || 'Linked record';
}

export function normaliseEvidenceLink(link) {
  const sourceModule = sourceModuleOf(link);
  const sourceId = sourceIdOf(link);
  const qualityStatement = statementOf(link);
  const evidenceCategory = categoryOf(link);
  if (!sourceModule || !sourceId || !qualityStatement || !evidenceCategory) return null;

  return {
    id: link?.id ?? null,
    sourceModule,
    sourceId,
    qualityStatement,
    evidenceCategory,
    rationale: rationaleOf(link),
    autoLinked: Boolean(link?.autoLinked ?? link?.auto_linked),
    requiresReview: Boolean(link?.requiresReview ?? link?.requires_review),
    linkedBy: linkedByOf(link),
    sourceRecordedAt: asIsoDate(link?.sourceRecordedAt || link?.source_recorded_at || null),
    createdAt: asIsoDate(link?.createdAt || link?.created_at || null),
    reviewDue: reviewDueOf(link),
  };
}

export function getEvidenceLinkDate(link) {
  return linkDateOf(link);
}

export function buildKnownActiveEvidenceSources(data) {
  const activeSources = new Set();
  const knownModules = new Set();

  registerRecordArray(activeSources, knownModules, 'incident', data?.incidents || []);
  registerRecordArray(activeSources, knownModules, 'complaint', data?.complaints || []);
  registerRecordArray(activeSources, knownModules, 'fire_drill', data?.fire_drills || []);
  registerRecordArray(activeSources, knownModules, 'maintenance', data?.maintenance || []);
  registerRecordArray(activeSources, knownModules, 'ipc_audit', data?.ipc_audits || []);
  registerRecordArray(activeSources, knownModules, 'policy_review', data?.policy_reviews || []);
  registerRecordArray(activeSources, knownModules, 'whistleblowing', data?.whistleblowing_concerns || []);
  registerRecordArray(activeSources, knownModules, 'risk', data?.risk_register || []);
  registerRecordArray(activeSources, knownModules, 'dols', data?.dols || []);
  registerRecordArray(activeSources, knownModules, 'mca_assessment', data?.mca_assessments || []);
  registerRecordArray(activeSources, knownModules, 'cqc_evidence', data?.cqc_evidence || []);
  registerRecordArray(activeSources, knownModules, 'cqc_partner_feedback', data?.cqc_partner_feedback || []);
  registerRecordArray(activeSources, knownModules, 'cqc_observation', data?.cqc_observations || []);
  registerRecordArray(activeSources, knownModules, 'supervision', flattenNestedArrays(data?.supervisions));
  registerRecordArray(activeSources, knownModules, 'appraisal', flattenNestedArrays(data?.appraisals));
  registerTrainingRecords(activeSources, knownModules, data?.training);

  return { activeSources, knownModules };
}

export function filterKnownActiveEvidenceLinks(links = [], data) {
  const { activeSources, knownModules } = buildKnownActiveEvidenceSources(data);
  return links
    .map(normaliseEvidenceLink)
    .filter(Boolean)
    .filter((link) => !knownModules.has(link.sourceModule) || activeSources.has(sourceKey(link.sourceModule, link.sourceId)));
}

export function buildStructuredFallbackEvidenceLinks(data, existingLinks = []) {
  const existingKeys = new Set(
    existingLinks
      .map(normaliseEvidenceLink)
      .filter(Boolean)
      .map((link) => evidenceKey(link.sourceModule, link.sourceId, link.qualityStatement, link.evidenceCategory))
  );

  const derived = [];

  for (const row of data?.cqc_evidence || []) {
    const evidenceCategory = normalizeEvidenceCategory(row?.evidence_category);
    if (!row?.id || !row?.quality_statement || !evidenceCategory) continue;
    const key = evidenceKey('cqc_evidence', row.id, row.quality_statement, evidenceCategory);
    if (existingKeys.has(key)) continue;
    derived.push({
      id: null,
      sourceModule: 'cqc_evidence',
      sourceId: String(row.id),
      qualityStatement: row.quality_statement,
      evidenceCategory,
      rationale: row.title || 'Manual evidence',
      autoLinked: false,
      requiresReview: false,
      linkedBy: row.added_by || null,
      sourceRecordedAt: asIsoDate(row.date_to) || asIsoDate(row.date_from) || asIsoDate(row.added_at) || asIsoDate(row.created_at),
      createdAt: asIsoDate(row.added_at) || asIsoDate(row.created_at),
      reviewDue: asIsoDate(row.review_due),
    });
  }

  for (const row of data?.cqc_partner_feedback || []) {
    const key = evidenceKey('cqc_partner_feedback', row.id, row.quality_statement, 'partner_feedback');
    if (!row?.id || !row?.quality_statement || existingKeys.has(key)) continue;
    derived.push({
      id: null,
      sourceModule: 'cqc_partner_feedback',
      sourceId: String(row.id),
      qualityStatement: row.quality_statement,
      evidenceCategory: 'partner_feedback',
      rationale: row.summary || row.title || 'Partner feedback',
      autoLinked: false,
      requiresReview: false,
      linkedBy: row.added_by || null,
      sourceRecordedAt: asIsoDate(row.feedback_date) || asIsoDate(row.added_at) || asIsoDate(row.created_at),
      createdAt: asIsoDate(row.added_at) || asIsoDate(row.created_at),
      reviewDue: asIsoDate(row.review_due),
    });
  }

  for (const row of data?.cqc_observations || []) {
    const key = evidenceKey('cqc_observation', row.id, row.quality_statement, 'observation');
    if (!row?.id || !row?.quality_statement || existingKeys.has(key)) continue;
    derived.push({
      id: null,
      sourceModule: 'cqc_observation',
      sourceId: String(row.id),
      qualityStatement: row.quality_statement,
      evidenceCategory: 'observation',
      rationale: row.notes || row.title || 'Observation',
      autoLinked: false,
      requiresReview: false,
      linkedBy: row.added_by || null,
      sourceRecordedAt: asIsoDate(row.observed_at) || asIsoDate(row.added_at) || asIsoDate(row.created_at),
      createdAt: asIsoDate(row.added_at) || asIsoDate(row.created_at),
      reviewDue: asIsoDate(row.review_due),
    });
  }

  return derived;
}

export function collectReadinessEvidenceLinks(data) {
  const storedLinks = filterKnownActiveEvidenceLinks(data?.cqc_evidence_links || [], data);
  const fallbackLinks = buildStructuredFallbackEvidenceLinks(data, storedLinks);
  return [...storedLinks, ...fallbackLinks].sort((a, b) => {
    const aDate = getEvidenceLinkDate(a) || '';
    const bDate = getEvidenceLinkDate(b) || '';
    return String(bDate).localeCompare(String(aDate)) || a.qualityStatement.localeCompare(b.qualityStatement);
  });
}
