// DoLS/LPS & MCA — Constants, Helpers, CQC Metric Calculators
// Maps to QS3/QS14 (Consent & Liberty) — CQC Regulation 11/13

import { formatDate, parseDate, addDays } from './rotation.js';

// ── Application Types ────────────────────────────────────────────────────────

export const APPLICATION_TYPES = [
  { id: 'dols', name: 'DoLS', description: 'Deprivation of Liberty Safeguards' },
  { id: 'lps',  name: 'LPS',  description: 'Liberty Protection Safeguards' },
];

// ── DoLS/LPS Statuses ────────────────────────────────────────────────────────

export const DOLS_STATUSES = [
  { id: 'applied',    name: 'Applied',    badgeKey: 'blue' },
  { id: 'authorised', name: 'Authorised', badgeKey: 'green' },
  { id: 'expired',    name: 'Expired',    badgeKey: 'red' },
  { id: 'review_due', name: 'Review Due', badgeKey: 'amber' },
];

// ── MCA Assessment Statuses ──────────────────────────────────────────────────

export const MCA_STATUSES = [
  { id: 'completed',  name: 'Completed',  badgeKey: 'green' },
  { id: 'review_due', name: 'Review Due', badgeKey: 'amber' },
  { id: 'overdue',    name: 'Overdue',    badgeKey: 'red' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

export function ensureDolsDefaults(data) {
  let changed = false;
  let result = data;
  if (!data.dols) {
    result = { ...result, dols: [] };
    changed = true;
  }
  if (!data.mca_assessments) {
    result = { ...result, mca_assessments: [] };
    changed = true;
  }
  return changed ? result : null;
}

// ── DoLS/LPS Status Calculator ───────────────────────────────────────────────

export function getDolsStatus(dol, asOfDate) {
  const today = typeof asOfDate === 'string' ? asOfDate : formatDate(asOfDate || new Date());

  // Not yet authorised
  if (!dol.authorised) {
    return { status: 'applied', daysUntilExpiry: null, isExpired: false, isReviewDue: false };
  }

  // Authorised but no expiry date set
  if (!dol.expiry_date) {
    return { status: 'authorised', daysUntilExpiry: null, isExpired: false, isReviewDue: false };
  }

  // Check expiry
  const todayDate = parseDate(today);
  const expiryDate = parseDate(dol.expiry_date);
  const diffMs = expiryDate - todayDate;
  const daysUntilExpiry = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (daysUntilExpiry < 0) {
    return { status: 'expired', daysUntilExpiry, isExpired: true, isReviewDue: false };
  }

  if (daysUntilExpiry <= 90) {
    return { status: 'review_due', daysUntilExpiry, isExpired: false, isReviewDue: true };
  }

  return { status: 'authorised', daysUntilExpiry, isExpired: false, isReviewDue: false };
}

// ── MCA Assessment Status Calculator ─────────────────────────────────────────

export function getMcaStatus(mca, asOfDate) {
  const today = typeof asOfDate === 'string' ? asOfDate : formatDate(asOfDate || new Date());

  if (!mca.next_review_date) {
    return { status: 'completed', daysUntilReview: null, isOverdue: false };
  }

  const todayDate = parseDate(today);
  const reviewDate = parseDate(mca.next_review_date);
  const diffMs = reviewDate - todayDate;
  const daysUntilReview = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (daysUntilReview < 0) {
    return { status: 'overdue', daysUntilReview, isOverdue: true };
  }

  if (daysUntilReview <= 30) {
    return { status: 'review_due', daysUntilReview, isOverdue: false };
  }

  return { status: 'completed', daysUntilReview, isOverdue: false };
}

// ── Stats ────────────────────────────────────────────────────────────────────

export function getDolsStats(dols, mcaAssessments, asOfDate) {
  const today = typeof asOfDate === 'string' ? asOfDate : formatDate(asOfDate || new Date());

  let activeCount = 0;
  let expiringSoon = 0;
  let expired = 0;
  let reviewsOverdue = 0;

  for (const dol of (dols || [])) {
    const st = getDolsStatus(dol, today);
    if (st.status === 'authorised') activeCount++;
    if (st.status === 'review_due') {
      activeCount++; // Still active, just needs review
      expiringSoon++;
      // Check if next_review_date is overdue
      if (dol.next_review_date && dol.next_review_date < today) reviewsOverdue++;
    }
    if (st.isExpired) expired++;
  }

  const mcas = mcaAssessments || [];
  const mcaTotal = mcas.length;
  let mcaOverdue = 0;
  for (const mca of mcas) {
    if (mca.next_review_date && mca.next_review_date < today) mcaOverdue++;
  }

  return { activeCount, expiringSoon, expired, mcaTotal, mcaOverdue, reviewsOverdue };
}

// ── Dashboard Alerts ─────────────────────────────────────────────────────────

export function getDolsAlerts(dols, mcaAssessments, asOfDate) {
  const today = typeof asOfDate === 'string' ? asOfDate : formatDate(asOfDate || new Date());
  const alerts = [];

  for (const dol of (dols || [])) {
    const st = getDolsStatus(dol, today);
    const typeLabel = APPLICATION_TYPES.find(t => t.id === dol.application_type)?.name || 'DoLS';

    if (st.isExpired) {
      alerts.push({
        type: 'error',
        msg: `${typeLabel} EXPIRED for ${dol.resident_name} — expired ${Math.abs(st.daysUntilExpiry)} days ago`,
      });
    } else if (st.isReviewDue) {
      alerts.push({
        type: 'warning',
        msg: `${typeLabel} expiring in ${st.daysUntilExpiry} days for ${dol.resident_name} — review needed`,
      });
    }
  }

  for (const mca of (mcaAssessments || [])) {
    const st = getMcaStatus(mca, today);
    if (st.isOverdue) {
      alerts.push({
        type: 'warning',
        msg: `MCA review overdue for ${mca.resident_name} — "${mca.decision_area}" overdue by ${Math.abs(st.daysUntilReview)} days`,
      });
    }
  }

  return alerts;
}

// ── CQC Metric: DoLS/LPS Compliance % ───────────────────────────────────────

export function calculateDolsCompliancePct(data, asOfDate) {
  const today = typeof asOfDate === 'string' ? asOfDate : formatDate(asOfDate || new Date());
  const dols = data.dols || [];

  if (dols.length === 0) return { score: 100, active: 0, expired: 0, applied: 0, total: 0 };

  let active = 0;
  let expired = 0;
  let applied = 0;

  for (const dol of dols) {
    const st = getDolsStatus(dol, today);
    if (st.status === 'authorised' || st.status === 'review_due') active++;
    else if (st.status === 'applied') applied++;
    if (st.isExpired) expired++;
  }

  const total = dols.length;
  const decided = total - applied;
  const score = decided > 0 ? Math.round((active / decided) * 100) : 100;

  return { score, active, expired, applied, total };
}
