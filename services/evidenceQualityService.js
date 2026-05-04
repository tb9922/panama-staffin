import * as cqcEvidenceRepo from '../repositories/cqcEvidenceRepo.js';
import * as cqcEvidenceFileRepo from '../repositories/cqcEvidenceFileRepo.js';
import { QUALITY_STATEMENTS } from '../src/lib/cqc.js';
import { normalizeEvidenceCategory } from '../src/lib/cqcEvidenceCategories.js';

const PAGE_SIZE = 500;
const FILE_PAGE_SIZE = 2000;
const DOMAIN_LABELS = {
  safe: 'Safe',
  effective: 'Effective',
  caring: 'Caring',
  responsive: 'Responsive',
  'well-led': 'Well-Led',
};
const DOMAIN_ORDER = ['safe', 'effective', 'caring', 'responsive', 'well-led'];
const URL_RE = /\bhttps?:\/\/[^\s<>"']+/i;

function asDate(value) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(a, b) {
  return Math.floor((a.getTime() - b.getTime()) / 86400000);
}

function ragForScore(score) {
  if (score >= 80) return 'green';
  if (score >= 55) return 'amber';
  return 'red';
}

function capScore(score) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

async function loadAllEvidence(homeId) {
  const rows = [];
  let offset = 0;
  let total = null;
  while (total == null || rows.length < total) {
    const page = await cqcEvidenceRepo.findByHome(homeId, { limit: PAGE_SIZE, offset });
    rows.push(...page.rows);
    total = page.total;
    if (!page.rows.length) break;
    offset += page.rows.length;
  }
  return rows;
}

async function loadAllEvidenceFiles(homeId) {
  const rows = [];
  let offset = 0;
  while (true) {
    const page = await cqcEvidenceFileRepo.findByHome(homeId, { limit: FILE_PAGE_SIZE, offset });
    rows.push(...page);
    if (page.length < FILE_PAGE_SIZE) break;
    offset += page.length;
  }
  return rows;
}

function getStatementMeta(statementId) {
  return QUALITY_STATEMENTS.find((statement) => statement.id === statementId) || null;
}

function getFreshness(item, asOf) {
  const evidenceDate = asDate(item.date_to) || asDate(item.date_from) || asDate(item.added_at);
  if (!evidenceDate) return { points: 0, reason: 'No evidence date recorded', daysOld: null, date: null };

  const daysOld = daysBetween(asOf, evidenceDate);
  if (daysOld <= 365) return { points: 25, reason: null, daysOld, date: evidenceDate.toISOString().slice(0, 10) };
  if (daysOld <= 730) return { points: 14, reason: 'Evidence is over 12 months old', daysOld, date: evidenceDate.toISOString().slice(0, 10) };
  return { points: 5, reason: 'Evidence is over 24 months old', daysOld, date: evidenceDate.toISOString().slice(0, 10) };
}

export function scoreEvidenceItem(item, fileCount = 0, asOf = new Date()) {
  const reasons = [];
  let score = 0;
  const statement = getStatementMeta(item.quality_statement);
  const category = normalizeEvidenceCategory(item.evidence_category);
  const hasAttachment = fileCount > 0 || Number(item.file_count || 0) > 0;
  const hasLink = URL_RE.test(`${item.title || ''} ${item.description || ''}`);
  const freshness = getFreshness(item, asOf);
  const reviewDue = asDate(item.review_due);
  const reviewDays = reviewDue ? daysBetween(reviewDue, asOf) : null;

  if (statement) score += 15;
  else reasons.push('Not mapped to a recognised CQC quality statement');

  if (statement?.category) score += 10;
  else reasons.push('No CQC domain mapping');

  if (category) score += 10;
  else reasons.push('No evidence category');

  score += freshness.points;
  if (freshness.reason) reasons.push(freshness.reason);

  if (hasAttachment || hasLink) score += 20;
  else reasons.push('No attachment or source link');

  if (String(item.evidence_owner || '').trim()) score += 10;
  else reasons.push('No evidence owner');

  if (reviewDue) {
    if (reviewDue < asOf) {
      score += 3;
      reasons.push('Review date is overdue');
    } else {
      score += reviewDays <= 30 ? 7 : 10;
      if (reviewDays <= 30) reasons.push('Review due within 30 days');
    }
  } else {
    reasons.push('No review due date');
  }

  if (String(item.type || '').trim()) score += 10;
  else reasons.push('No evidence status/type');

  const finalScore = capScore(score);
  return {
    id: item.id,
    title: item.title || 'Untitled evidence',
    quality_statement: item.quality_statement || null,
    statement_name: statement?.name || 'Unmapped',
    domain: statement?.category || 'unmapped',
    domain_label: DOMAIN_LABELS[statement?.category] || 'Unmapped',
    evidence_category: category,
    score: finalScore,
    rag: ragForScore(finalScore),
    reasons,
    has_attachment: hasAttachment,
    has_link: hasLink,
    attachment_count: fileCount || Number(item.file_count || 0),
    evidence_owner: item.evidence_owner || null,
    review_due: item.review_due || null,
    freshness_days: freshness.daysOld,
    evidence_date: freshness.date,
    source_status: item.type || null,
  };
}

function buildStatementScore(statement, items) {
  if (!items.length) {
    return {
      statement_id: statement.id,
      statement_name: statement.name,
      domain: statement.category,
      domain_label: DOMAIN_LABELS[statement.category],
      score: 0,
      rag: 'red',
      evidence_count: 0,
      weakest_reasons: ['No mapped evidence'],
      weakest_evidence: [],
    };
  }

  const average = capScore(items.reduce((sum, item) => sum + item.score, 0) / items.length);
  const reasonCounts = new Map();
  for (const item of items) {
    for (const reason of item.reasons) reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
  }
  const weakestReasons = [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([reason]) => reason);

  return {
    statement_id: statement.id,
    statement_name: statement.name,
    domain: statement.category,
    domain_label: DOMAIN_LABELS[statement.category],
    score: average,
    rag: ragForScore(average),
    evidence_count: items.length,
    weakest_reasons: weakestReasons,
    weakest_evidence: [...items].sort((a, b) => a.score - b.score).slice(0, 3),
  };
}

function buildDomainScore(domain, statements) {
  const average = capScore(statements.reduce((sum, item) => sum + item.score, 0) / Math.max(1, statements.length));
  return {
    domain,
    domain_label: DOMAIN_LABELS[domain],
    score: average,
    rag: ragForScore(average),
    statement_count: statements.length,
    red_count: statements.filter((statement) => statement.rag === 'red').length,
    amber_count: statements.filter((statement) => statement.rag === 'amber').length,
    weakest_statements: [...statements].sort((a, b) => a.score - b.score).slice(0, 5),
  };
}

export function buildEvidenceQualityPayload(evidenceRows, fileRows, { domain, statement, asOf = new Date() } = {}) {
  const filesByEvidence = new Map();
  for (const file of fileRows || []) {
    filesByEvidence.set(file.evidence_id, (filesByEvidence.get(file.evidence_id) || 0) + 1);
  }

  const scoredEvidence = evidenceRows.map((item) => scoreEvidenceItem(item, filesByEvidence.get(item.id) || 0, asOf));
  const evidenceByStatement = new Map();
  for (const item of scoredEvidence) {
    if (!item.quality_statement) continue;
    const bucket = evidenceByStatement.get(item.quality_statement) || [];
    bucket.push(item);
    evidenceByStatement.set(item.quality_statement, bucket);
  }

  const allStatements = QUALITY_STATEMENTS.filter((entry) => (!domain || entry.category === domain) && (!statement || entry.id === statement));
  const statements = allStatements.map((entry) => buildStatementScore(entry, evidenceByStatement.get(entry.id) || []));
  const domains = DOMAIN_ORDER
    .filter((entry) => !domain || entry === domain)
    .map((entry) => buildDomainScore(entry, statements.filter((statementScore) => statementScore.domain === entry)));
  const overallScore = capScore(statements.reduce((sum, item) => sum + item.score, 0) / Math.max(1, statements.length));
  const practicalGaps = statements
    .filter((entry) => entry.rag !== 'green')
    .flatMap((entry) => (entry.weakest_reasons.length ? entry.weakest_reasons : ['No mapped evidence']).map((reason) => ({
      statement_id: entry.statement_id,
      statement_name: entry.statement_name,
      domain: entry.domain,
      domain_label: entry.domain_label,
      score: entry.score,
      rag: entry.rag,
      reason,
    })))
    .sort((a, b) => a.score - b.score || a.statement_id.localeCompare(b.statement_id))
    .slice(0, 20);

  return {
    generated_at: asOf.toISOString(),
    heuristic: {
      version: 'evidence-quality-v1',
      label: 'Deterministic evidence quality heuristic',
      note: 'Scores reflect freshness, source attachment/link, owner, review due date, type/status and CQC mapping only.',
    },
    filters: { domain: domain || null, statement: statement || null },
    summary: {
      score: overallScore,
      rag: ragForScore(overallScore),
      evidence_count: scoredEvidence.length,
      statement_count: statements.length,
      red_statement_count: statements.filter((entry) => entry.rag === 'red').length,
      amber_statement_count: statements.filter((entry) => entry.rag === 'amber').length,
      green_statement_count: statements.filter((entry) => entry.rag === 'green').length,
    },
    domains,
    statements,
    weakest_statements: [...statements].sort((a, b) => a.score - b.score).slice(0, 10),
    practical_gaps: practicalGaps,
    evidence: scoredEvidence
      .filter((item) => (!domain || item.domain === domain) && (!statement || item.quality_statement === statement))
      .sort((a, b) => a.score - b.score),
  };
}

export async function getEvidenceQuality(homeId, filters = {}) {
  const [evidenceRows, fileRows] = await Promise.all([
    loadAllEvidence(homeId),
    loadAllEvidenceFiles(homeId),
  ]);
  return buildEvidenceQualityPayload(evidenceRows, fileRows, filters);
}

export const _test = { DOMAIN_ORDER, DOMAIN_LABELS, ragForScore };
