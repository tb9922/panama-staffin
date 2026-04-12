import { calculateComplianceScore, getEvidenceForStatement, QUALITY_STATEMENTS } from './cqc.js';
import { getExpectedEvidenceCategories } from './cqcStatementExpectations.js';
import { normalizeEvidenceCategory } from './cqcEvidenceCategories.js';

export const FRESHNESS_THRESHOLDS_DAYS = {
  peoples_experience: 180,
  staff_leader_feedback: 180,
  partner_feedback: 180,
  observation: 90,
  processes: 365,
  outcomes: 180,
};

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
  const order = { missing: 0, weak: 1, stale: 2, partial: 3, strong: 4 };
  return (order[a.status] ?? 99) - (order[b.status] ?? 99) || a.statementId.localeCompare(b.statementId);
}

function getEvidenceDate(entry) {
  return (
    asIsoDate(entry.date_to) ||
    asIsoDate(entry.date_from) ||
    asIsoDate(entry.added_at) ||
    asIsoDate(entry.created_at)
  );
}

function getFreshnessThreshold(category) {
  return FRESHNESS_THRESHOLDS_DAYS[category] || 365;
}

function buildReasonParts({
  categoriesMissing,
  metricsMissing,
  staleCount,
  reviewOverdue,
  narrativePresent,
}) {
  const reasons = [];
  if (categoriesMissing.length) reasons.push(`Missing ${categoriesMissing.join(', ')}`);
  if (metricsMissing.length) reasons.push(`Missing metrics: ${metricsMissing.join(', ')}`);
  if (staleCount > 0) reasons.push(`${staleCount} stale evidence item${staleCount === 1 ? '' : 's'}`);
  if (reviewOverdue > 0) reasons.push(`${reviewOverdue} review overdue`);
  if (!narrativePresent) reasons.push('No self-assessment narrative');
  return reasons;
}

function computeStatus({
  evidenceCount,
  metricCoverageCount,
  categoriesCovered,
  categoriesExpected,
  staleCount,
  reviewOverdue,
}) {
  if (evidenceCount === 0 && metricCoverageCount === 0) return 'missing';
  if (evidenceCount === 0) return 'weak';
  if (staleCount > 0 && staleCount >= evidenceCount * 0.5) return 'stale';
  if (categoriesCovered < Math.max(1, categoriesExpected * 0.5)) return 'partial';
  if (categoriesCovered >= Math.ceil(categoriesExpected * 0.75) && staleCount === 0 && reviewOverdue === 0) return 'strong';
  return 'partial';
}

function buildSummary({
  evidenceCount,
  categoriesCovered,
  categoriesExpected,
  staleCount,
  reviewOverdue,
  categoriesMissing,
  metricsMissing,
  narrativePresent,
}) {
  const parts = [
    `${evidenceCount} evidence item${evidenceCount === 1 ? '' : 's'}`,
    `across ${categoriesCovered} of ${categoriesExpected} expected categor${categoriesExpected === 1 ? 'y' : 'ies'}`,
  ];
  if (staleCount > 0) parts.push(`${staleCount} stale`);
  if (reviewOverdue > 0) parts.push(`${reviewOverdue} review overdue`);
  if (categoriesMissing.length) parts.push(`Missing: ${categoriesMissing.join(', ')}`);
  if (metricsMissing.length) parts.push(`Metrics missing: ${metricsMissing.join(', ')}`);
  if (!narrativePresent) parts.push('Narrative missing');
  return parts.join('. ') + '.';
}

export function buildReadinessMatrix(data, dateRange, asOfDate) {
  const score = calculateComplianceScore(data, dateRange, asOfDate);
  const asOf = asIsoDate(asOfDate) || asIsoDate(new Date());
  const narratives = new Map(
    (data?.cqc_statement_narratives || []).map((entry) => [entry.quality_statement, entry])
  );
  const matrix = new Map();

  for (const statement of QUALITY_STATEMENTS) {
    const evidence = getEvidenceForStatement(statement.id, data, dateRange, asOfDate) || { manualEvidence: [], autoEvidence: [] };
    const manualEvidence = evidence.manualEvidence || [];
    const expectedCategories = [...new Set(getExpectedEvidenceCategories(statement.id).map(normalizeEvidenceCategory).filter(Boolean))];
    const expectedCategorySet = new Set(expectedCategories);
    const evidenceByCategory = Object.fromEntries(expectedCategories.map((category) => [category, 0]));
    const coveredCategories = new Set();
    const staleItems = [];
    let reviewOverdue = 0;
    let reviewDueSoon = 0;
    let oldestEvidenceDate = null;
    let newestEvidenceDate = null;

    for (const item of manualEvidence) {
      const category = normalizeEvidenceCategory(item.evidence_category);
      const isExpectedCategory = !!(category && expectedCategorySet.has(category));
      if (isExpectedCategory) {
        evidenceByCategory[category] = (evidenceByCategory[category] || 0) + 1;
        coveredCategories.add(category);
      }

      const evidenceDate = getEvidenceDate(item);
      if (evidenceDate) {
        if (!oldestEvidenceDate || evidenceDate < oldestEvidenceDate) oldestEvidenceDate = evidenceDate;
        if (!newestEvidenceDate || evidenceDate > newestEvidenceDate) newestEvidenceDate = evidenceDate;
        if (isExpectedCategory) {
          const daysOld = daysBetween(evidenceDate, asOf);
          const staleDays = getFreshnessThreshold(category);
          if (daysOld > staleDays) {
            staleItems.push({
              id: item.id,
              title: item.title,
              category,
              addedAt: evidenceDate,
              staleDays,
              daysOld,
            });
          }
        }
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
      if (metricCategory && expectedCategorySet.has(metricCategory)) coveredCategories.add(metricCategory);
    }

    const categoriesMissing = expectedCategories.filter((category) => !coveredCategories.has(category));
    const narrative = narratives.get(statement.id) || null;
    const narrativePresent = !!(
      narrative &&
      [narrative.narrative, narrative.risks, narrative.actions].some((value) => !!String(value || '').trim())
    );

    const entry = {
      statementId: statement.id,
      statementName: statement.name,
      category: statement.category,
      cqcRef: statement.cqcRef,
      evidenceCount: manualEvidence.length,
      evidenceByCategory,
      expectedCategories,
      categoriesCovered: coveredCategories.size,
      categoriesExpected: expectedCategories.length,
      categoriesMissing,
      staleItems,
      staleCount: staleItems.length,
      freshCount: Math.max(0, manualEvidence.length - staleItems.length),
      oldestEvidenceDate,
      newestEvidenceDate,
      metricCoverageCount: Object.keys(metricScores).length,
      metricScores,
      metricsMissing,
      reviewOverdue,
      reviewDueSoon,
      narrative,
      narrativePresent,
    };

    entry.status = computeStatus(entry);
    entry.reasons = buildReasonParts({
      categoriesMissing,
      metricsMissing,
      staleCount: entry.staleCount,
      reviewOverdue,
      narrativePresent,
    });
    entry.summary = buildSummary({
      evidenceCount: entry.evidenceCount,
      categoriesCovered: entry.categoriesCovered,
      categoriesExpected: entry.categoriesExpected,
      staleCount: entry.staleCount,
      reviewOverdue,
      categoriesMissing,
      metricsMissing,
      narrativePresent,
    });
    entry.statusReason = entry.summary;

    matrix.set(statement.id, entry);
  }

  return matrix;
}

export function getQuestionReadiness(matrix) {
  const questions = new Map([
    ['safe', []],
    ['effective', []],
    ['caring', []],
    ['responsive', []],
    ['well-led', []],
  ]);

  for (const entry of matrix.values()) {
    const bucket = questions.get(entry.category);
    if (bucket) bucket.push(entry);
  }

  return [...questions.entries()].map(([question, entries]) => ({
    question,
    total: entries.length,
    strong: entries.filter((entry) => entry.status === 'strong').length,
    partial: entries.filter((entry) => entry.status === 'partial').length,
    stale: entries.filter((entry) => entry.status === 'stale').length,
    weak: entries.filter((entry) => entry.status === 'weak').length,
    missing: entries.filter((entry) => entry.status === 'missing').length,
  }));
}

export function getReadinessGaps(matrix) {
  return [...matrix.values()]
    .filter((entry) => entry.status !== 'strong')
    .sort(sortBySeverity);
}

export function getOverallReadiness(matrix) {
  const entries = [...matrix.values()];
  const total = entries.length || 1;
  const strong = entries.filter((entry) => entry.status === 'strong').length;
  const partial = entries.filter((entry) => entry.status === 'partial').length;
  const stale = entries.filter((entry) => entry.status === 'stale').length;
  const weak = entries.filter((entry) => entry.status === 'weak').length;
  const missing = entries.filter((entry) => entry.status === 'missing').length;

  if (missing > 5 || weak > 4) return { band: 'not_ready', label: 'Heuristic: Significant Gaps', badge: 'red', strong, partial, stale, weak, missing, total };
  if (missing > 0 || weak > 0 || stale > 4) return { band: 'gaps', label: 'Heuristic: Gaps', badge: 'amber', strong, partial, stale, weak, missing, total };
  if (partial > 5 || stale > 0) return { band: 'progressing', label: 'Heuristic: Progressing', badge: 'amber', strong, partial, stale, weak, missing, total };
  if (strong >= total * 0.8) return { band: 'strong', label: 'Heuristic: Strong', badge: 'green', strong, partial, stale, weak, missing, total };
  return { band: 'progressing', label: 'Heuristic: Progressing', badge: 'amber', strong, partial, stale, weak, missing, total };
}

export function serialiseReadinessMatrix(matrix) {
  return [...matrix.values()];
}

export function deserialiseReadinessMatrix(entries = []) {
  return new Map(entries.map((entry) => [entry.statementId, entry]));
}
