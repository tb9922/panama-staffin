import { calculateComplianceScore, getEvidenceForStatement, QUALITY_STATEMENTS } from './cqc.js';
import { getExpectedEvidenceCategories } from './cqcStatementExpectations.js';
import { normalizeEvidenceCategory } from './cqcEvidenceCategories.js';

function asIsoDate(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return null;
}

function daysBetween(a, b) {
  const aDate = new Date(`${a}T00:00:00Z`);
  const bDate = new Date(`${b}T00:00:00Z`);
  return Math.round((bDate - aDate) / (1000 * 60 * 60 * 24));
}

function sortBySeverity(a, b) {
  const order = { missing: 0, weak: 1, partial: 2, covered: 3 };
  return (order[a.status] ?? 99) - (order[b.status] ?? 99) || a.statementId.localeCompare(b.statementId);
}

function getEvidenceDate(entry) {
  return (
    asIsoDate(entry.review_due) ||
    asIsoDate(entry.date_to) ||
    asIsoDate(entry.date_from) ||
    asIsoDate(entry.added_at) ||
    asIsoDate(entry.created_at)
  );
}

function computeStatus({
  manualEvidenceCount,
  metricCoverageCount,
  expectedCategories,
  coveredCategories,
  staleCount,
  reviewOverdue,
  narrativePresent,
}) {
  const totalCoverage = manualEvidenceCount + metricCoverageCount;
  if (totalCoverage === 0) return 'missing';
  if (manualEvidenceCount === 0 && metricCoverageCount > 0) return 'weak';

  const expectedCount = expectedCategories.length || 1;
  const coverageRatio = coveredCategories.size / expectedCount;
  const mostlyStale = manualEvidenceCount > 0 && staleCount > manualEvidenceCount / 2;
  if (coverageRatio >= 0.75 && reviewOverdue === 0 && !mostlyStale && narrativePresent) return 'covered';
  return 'partial';
}

function buildReasonParts(expectedCategories, coveredCategories, metricsMissing, staleCount, reviewOverdue, narrativePresent) {
  const reasons = [];
  const missingCategories = expectedCategories.filter((category) => !coveredCategories.has(category));
  if (missingCategories.length) reasons.push(`Missing ${missingCategories.join(', ')}`);
  if (metricsMissing.length) reasons.push(`Missing metrics: ${metricsMissing.join(', ')}`);
  if (staleCount > 0) reasons.push(`${staleCount} stale evidence item${staleCount === 1 ? '' : 's'}`);
  if (reviewOverdue > 0) reasons.push(`${reviewOverdue} review overdue`);
  if (!narrativePresent) reasons.push('No self-assessment narrative');
  return reasons;
}

export function buildReadinessMatrix(data, dateRange, asOfDate, staleDays = 365) {
  const score = calculateComplianceScore(data, dateRange, asOfDate);
  const asOf = asIsoDate(asOfDate) || asIsoDate(new Date());
  const narratives = new Map(
    (data?.cqc_statement_narratives || []).map((entry) => [entry.quality_statement, entry])
  );
  const matrix = new Map();

  for (const statement of QUALITY_STATEMENTS) {
    const evidence = getEvidenceForStatement(statement.id, data, dateRange, asOfDate) || { manualEvidence: [], autoEvidence: [] };
    const manualEvidence = evidence.manualEvidence || [];
    const autoEvidence = evidence.autoEvidence || [];
    const expectedCategories = getExpectedEvidenceCategories(statement.id);
    const evidenceByCategory = Object.fromEntries(expectedCategories.map((category) => [category, 0]));
    const coveredCategories = new Set();
    let staleCount = 0;
    let reviewOverdue = 0;
    let reviewDueSoon = 0;
    let oldestEvidenceDate = null;
    let newestEvidenceDate = null;

    for (const item of manualEvidence) {
      const category = normalizeEvidenceCategory(item.evidence_category);
      if (category) {
        evidenceByCategory[category] = (evidenceByCategory[category] || 0) + 1;
        coveredCategories.add(category);
      }
      const evidenceDate = getEvidenceDate(item);
      if (evidenceDate) {
        if (!oldestEvidenceDate || evidenceDate < oldestEvidenceDate) oldestEvidenceDate = evidenceDate;
        if (!newestEvidenceDate || evidenceDate > newestEvidenceDate) newestEvidenceDate = evidenceDate;
        if (daysBetween(evidenceDate, asOf) > staleDays) staleCount += 1;
      }
      const reviewDue = asIsoDate(item.review_due);
      if (reviewDue) {
        const diff = daysBetween(asOf, reviewDue);
        if (diff < 0) reviewOverdue += 1;
        else if (diff <= 30) reviewDueSoon += 1;
      }
    }

    const metricScores = {};
    const metricsMissing = [];
    for (const metricId of statement.autoMetrics || []) {
      const metric = score.metrics?.[metricId];
      if (!metric || metric.score == null) {
        metricsMissing.push(metricId);
        continue;
      }
      metricScores[metricId] = metric.score;
      const metricCategory = normalizeEvidenceCategory(metric.evidence_category);
      if (metricCategory) coveredCategories.add(metricCategory);
    }

    const narrative = narratives.get(statement.id) || null;
    const narrativePresent = !!(
      narrative &&
      [narrative.narrative, narrative.risks, narrative.actions].some((value) => !!String(value || '').trim())
    );

    const status = computeStatus({
      manualEvidenceCount: manualEvidence.length,
      metricCoverageCount: Object.keys(metricScores).length,
      expectedCategories,
      coveredCategories,
      staleCount,
      reviewOverdue,
      narrativePresent,
    });

    const reasons = buildReasonParts(expectedCategories, coveredCategories, metricsMissing, staleCount, reviewOverdue, narrativePresent);
    matrix.set(statement.id, {
      statementId: statement.id,
      statementName: statement.name,
      category: statement.category,
      cqcRef: statement.cqcRef,
      evidenceCount: manualEvidence.length,
      evidenceByCategory,
      expectedCategories,
      categoriesCovered: coveredCategories.size,
      categoriesMissing: expectedCategories.filter((category) => !coveredCategories.has(category)),
      oldestEvidenceDate,
      newestEvidenceDate,
      staleCount,
      freshCount: Math.max(0, manualEvidence.length - staleCount),
      metricScores,
      metricsMissing,
      reviewOverdue,
      reviewDueSoon,
      narrative,
      narrativePresent,
      status,
      reasons,
      statusReason: reasons.join('; ') || 'Readiness evidence looks healthy',
    });
  }

  return matrix;
}

export function getReadinessGaps(matrix) {
  return [...matrix.values()]
    .filter((entry) => entry.status !== 'covered')
    .sort(sortBySeverity);
}

export function getOverallReadiness(matrix) {
  const entries = [...matrix.values()];
  const total = entries.length || 1;
  const covered = entries.filter((entry) => entry.status === 'covered').length;
  const missing = entries.filter((entry) => entry.status === 'missing').length;
  const weak = entries.filter((entry) => entry.status === 'weak').length;
  const partial = entries.filter((entry) => entry.status === 'partial').length;

  if (missing > 5 || weak > 4) return { band: 'not_ready', label: 'Not Ready', badge: 'red', covered, partial, weak, missing, total };
  if (missing > 0 || weak > 0 || partial > 10) return { band: 'gaps', label: 'Significant Gaps', badge: 'amber', covered, partial, weak, missing, total };
  if (partial > 5) return { band: 'progressing', label: 'Progressing', badge: 'amber', covered, partial, weak, missing, total };
  if (covered >= total * 0.8) return { band: 'strong', label: 'Strong', badge: 'green', covered, partial, weak, missing, total };
  return { band: 'progressing', label: 'Progressing', badge: 'amber', covered, partial, weak, missing, total };
}

export function serialiseReadinessMatrix(matrix) {
  return [...matrix.values()];
}

export function deserialiseReadinessMatrix(entries = []) {
  return new Map(entries.map((entry) => [entry.statementId, entry]));
}
