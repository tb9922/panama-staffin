import logger from '../logger.js';
import * as dashboardRepo from '../repositories/dashboardRepo.js';

// ── Alert priority ordering ─────────────────────────────────────────────────

const TYPE_ORDER = { error: 0, warning: 1, info: 2 };

// ── Alert builders ──────────────────────────────────────────────────────────

function pushIf(alerts, condition, type, module, message, link, priority = 1, dueDate = null) {
  if (condition) alerts.push({ type, module, message, link, priority, dueDate });
}

function buildAlerts(m) {
  const alerts = [];
  const n = (obj, key) => (obj && typeof obj[key] === 'number') ? obj[key] : 0;
  const b = (obj, key) => !!(obj && obj[key]);

  // Priority 5 — Regulatory deadline breach (CQC enforcement risk)
  pushIf(alerts, n(m.incidents, 'cqcOverdue') > 0, 'error', 'incidents',
    `${n(m.incidents, 'cqcOverdue')} CQC notification(s) overdue`, '/incidents', 5);
  pushIf(alerts, n(m.incidents, 'riddorOverdue') > 0, 'error', 'incidents',
    `${n(m.incidents, 'riddorOverdue')} RIDDOR report(s) overdue`, '/incidents', 5);

  // Priority 4 — Serious compliance/safety concern
  pushIf(alerts, n(m.incidents, 'docOverdue') > 0, 'error', 'incidents',
    `${n(m.incidents, 'docOverdue')} Duty of Candour notification(s) overdue`, '/incidents', 4);
  pushIf(alerts, n(m.risks, 'critical') > 0, 'error', 'risks',
    `${n(m.risks, 'critical')} critical risk(s) on register`, '/risks', 4);
  pushIf(alerts, n(m.whistleblowing, 'unacknowledged') > 0, 'error', 'whistleblowing',
    `${n(m.whistleblowing, 'unacknowledged')} unacknowledged whistleblowing concern(s)`, '/speak-up', 4);
  pushIf(alerts, m.beds?.occupancyRate < 80, 'error', 'beds',
    `Occupancy at ${n(m.beds, 'occupancyRate')}% — significant revenue risk`, '/beds', 4);

  // Priority 3 — Overdue actions requiring attention
  pushIf(alerts, n(m.incidents, 'open') > 0, 'warning', 'incidents',
    `${n(m.incidents, 'open')} open investigation(s)`, '/incidents', 3);
  pushIf(alerts, n(m.incidents, 'overdueActions') > 0, 'warning', 'incidents',
    `${n(m.incidents, 'overdueActions')} overdue corrective action(s)`, '/incidents', 3);
  pushIf(alerts, n(m.complaints, 'unacknowledged') > 0, 'warning', 'complaints',
    `${n(m.complaints, 'unacknowledged')} unacknowledged complaint(s)`, '/complaints', 3);
  pushIf(alerts, n(m.complaints, 'overdueResponse') > 0, 'warning', 'complaints',
    `${n(m.complaints, 'overdueResponse')} overdue complaint response(s)`, '/complaints', 3);
  pushIf(alerts, n(m.maintenance, 'overdue') > 0, 'warning', 'maintenance',
    `${n(m.maintenance, 'overdue')} overdue maintenance check(s)`, '/maintenance', 3);
  pushIf(alerts, n(m.maintenance, 'expiredCerts') > 0, 'warning', 'maintenance',
    `${n(m.maintenance, 'expiredCerts')} expired certificate(s)`, '/maintenance', 3);
  pushIf(alerts, n(m.training, 'expired') > 0, 'warning', 'training',
    `${n(m.training, 'expired')} expired training record(s)`, '/training', 3);
  pushIf(alerts, n(m.supervisions, 'overdue') > 0, 'warning', 'supervisions',
    `${n(m.supervisions, 'overdue')} overdue supervision(s)`, '/training', 3);
  pushIf(alerts, n(m.appraisals, 'overdue') > 0, 'warning', 'appraisals',
    `${n(m.appraisals, 'overdue')} overdue appraisal(s)`, '/training', 3);
  pushIf(alerts, b(m.fireDrills, 'overdue'), 'warning', 'fireDrills',
    'Fire drill overdue', '/training', 3);
  pushIf(alerts, n(m.ipc, 'activeOutbreaks') > 0, 'warning', 'ipc',
    `${n(m.ipc, 'activeOutbreaks')} active IPC outbreak(s)`, '/ipc', 3);
  pushIf(alerts, n(m.ipc, 'overdueActions') > 0, 'warning', 'ipc',
    `${n(m.ipc, 'overdueActions')} overdue IPC corrective action(s)`, '/ipc', 3);
  pushIf(alerts, n(m.risks, 'overdueReviews') > 0, 'warning', 'risks',
    `${n(m.risks, 'overdueReviews')} overdue risk review(s)`, '/risks', 3);
  pushIf(alerts, n(m.risks, 'overdueActions') > 0, 'warning', 'risks',
    `${n(m.risks, 'overdueActions')} overdue risk action(s)`, '/risks', 3);
  pushIf(alerts, n(m.policies, 'overdue') > 0, 'warning', 'policies',
    `${n(m.policies, 'overdue')} overdue policy review(s)`, '/policies', 3);
  pushIf(alerts, n(m.dols, 'expiringSoon') > 0, 'warning', 'dols',
    `${n(m.dols, 'expiringSoon')} DoLS authorisation(s) expiring within 90 days`, '/dols', 3);
  pushIf(alerts, n(m.dols, 'overdueReviews') > 0, 'warning', 'dols',
    `${n(m.dols, 'overdueReviews')} overdue DoLS/MCA review(s)`, '/dols', 3);
  pushIf(alerts, n(m.careCertificate, 'overdue') > 0, 'warning', 'careCertificate',
    `${n(m.careCertificate, 'overdue')} overdue Care Certificate(s)`, '/care-cert', 3);
  pushIf(alerts, n(m.beds, 'residentBedMismatch') > 0, 'warning', 'beds',
    `${n(m.beds, 'residentBedMismatch')} bed(s) show occupied but resident discharged/deceased`, '/beds', 3);
  pushIf(alerts, n(m.beds, 'hospitalHoldExpiring') > 0, 'warning', 'beds',
    `${n(m.beds, 'hospitalHoldExpiring')} hospital hold(s) expiring within 7 days`, '/beds', 3);
  pushIf(alerts, n(m.beds, 'staleReservations') > 0, 'warning', 'beds',
    `${n(m.beds, 'staleReservations')} stale reservation(s) past expiry`, '/beds', 3);
  pushIf(alerts, n(m.supervisions, 'noRecord') > 0, 'warning', 'supervisions',
    `${n(m.supervisions, 'noRecord')} staff with no supervision record`, '/training', 3);
  pushIf(alerts, n(m.appraisals, 'noRecord') > 0, 'warning', 'appraisals',
    `${n(m.appraisals, 'noRecord')} staff with no appraisal record`, '/training', 3);
  pushIf(alerts, n(m.whistleblowing, 'open') > 0, 'warning', 'whistleblowing',
    `${n(m.whistleblowing, 'open')} open whistleblowing concern(s)`, '/speak-up', 3);
  pushIf(alerts, m.ipc?.latestScore != null && m.ipc.latestScore < 70, 'warning', 'ipc',
    `Latest IPC audit score is ${m.ipc.latestScore}% — below 70% threshold`, '/ipc', 3);

  // Priority 2 — Approaching deadlines (not yet overdue)
  pushIf(alerts, m.beds?.occupancyRate >= 80 && m.beds?.occupancyRate < 90, 'warning', 'beds',
    `Occupancy at ${n(m.beds, 'occupancyRate')}% — below 90% target`, '/beds', 2);
  pushIf(alerts, n(m.training, 'expiringSoon') > 0, 'info', 'training',
    `${n(m.training, 'expiringSoon')} training record(s) expiring in 30 days`, '/training', 2);
  pushIf(alerts, n(m.maintenance, 'dueSoon') > 0, 'info', 'maintenance',
    `${n(m.maintenance, 'dueSoon')} maintenance check(s) due in 30 days`, '/maintenance', 2);
  pushIf(alerts, n(m.supervisions, 'dueSoon') > 0, 'info', 'supervisions',
    `${n(m.supervisions, 'dueSoon')} supervision(s) due soon`, '/training', 2);
  pushIf(alerts, n(m.policies, 'dueSoon') > 0, 'info', 'policies',
    `${n(m.policies, 'dueSoon')} policy review(s) due soon`, '/policies', 2);

  // Priority 1 — Informational
  pushIf(alerts, n(m.fireDrills, 'drillsThisYear') < 4 && !b(m.fireDrills, 'overdue'), 'info', 'fireDrills',
    `Only ${n(m.fireDrills, 'drillsThisYear')} fire drill(s) this year — 4 required`, '/training', 1);
  pushIf(alerts, n(m.beds, 'available') > 0 && m.beds?.occupancyRate >= 90, 'info', 'beds',
    `${n(m.beds, 'available')} bed(s) available`, '/beds', 1);

  // Stable sort: highest priority first, then errors before warnings before info
  alerts.sort((a, b) => (b.priority - a.priority) || (TYPE_ORDER[a.type] - TYPE_ORDER[b.type]));

  return alerts;
}

// Exported for unit testing (pure function — no DB, no side effects)
export { buildAlerts as _buildAlerts };

// ── Default zero-value objects per module ──────────────────────────────────

const DEFAULTS = {
  incidents:       { open: 0, cqcOverdue: 0, riddorOverdue: 0, docOverdue: 0, overdueActions: 0 },
  complaints:      { open: 0, unacknowledged: 0, overdueResponse: 0 },
  maintenance:     { total: 0, overdue: 0, dueSoon: 0, expiredCerts: 0, compliancePct: 100 },
  training:        { expired: 0, expiringSoon: 0 },
  supervisions:    { overdue: 0, dueSoon: 0, noRecord: 0 },
  appraisals:      { overdue: 0, dueSoon: 0, noRecord: 0 },
  fireDrills:      { lastDate: null, drillsThisYear: 0, overdue: true },
  ipc:             { activeOutbreaks: 0, overdueActions: 0, latestScore: null },
  risks:           { total: 0, critical: 0, overdueReviews: 0, overdueActions: 0 },
  policies:        { total: 0, overdue: 0, dueSoon: 0, compliancePct: 100 },
  whistleblowing:  { open: 0, unacknowledged: 0 },
  dols:            { active: 0, expiringSoon: 0, overdueReviews: 0 },
  careCertificate: { inProgress: 0, overdue: 0 },
  beds:            { total: 0, occupied: 0, available: 0, hospitalHold: 0, occupancyRate: 100,
                     vacantBeds: 0, floorWeeklyLoss: 0, avgWeeklyLoss: 0,
                     hospitalHoldExpiring: 0, staleReservations: 0, residentBedMismatch: 0 },
};

const MODULE_KEYS = Object.keys(DEFAULTS);

// ── Main export ─────────────────────────────────────────────────────────────

export async function getDashboardSummary(homeId) {
  const today = new Date().toISOString().slice(0, 10);

  const results = await Promise.allSettled([
    dashboardRepo.getIncidentCounts(homeId),
    dashboardRepo.getComplaintCounts(homeId),
    dashboardRepo.getMaintenanceCounts(homeId, today),
    dashboardRepo.getTrainingCounts(homeId, today),
    dashboardRepo.getSupervisionCounts(homeId, today),
    dashboardRepo.getAppraisalCounts(homeId, today),
    dashboardRepo.getFireDrillCounts(homeId, today),
    dashboardRepo.getIpcCounts(homeId),
    dashboardRepo.getRiskCounts(homeId, today),
    dashboardRepo.getPolicyCounts(homeId, today),
    dashboardRepo.getWhistleblowingCounts(homeId),
    dashboardRepo.getDolsCounts(homeId, today),
    dashboardRepo.getCareCertCounts(homeId, today),
    dashboardRepo.getBedSummary(homeId, today),
  ]);

  const modules = {};
  MODULE_KEYS.forEach((key, i) => {
    if (results[i].status === 'fulfilled') {
      modules[key] = results[i].value;
    } else {
      logger.error({ homeId, module: key, err: results[i].reason?.message }, 'Dashboard query failed');
      modules[key] = DEFAULTS[key];
    }
  });

  const alerts = buildAlerts(modules);

  // "Action This Week" — priority 3+ items (all are currently overdue/actionable)
  const weekActions = alerts.filter(a => a.priority >= 3);

  logger.info({ homeId, alertCount: alerts.length, weekActionCount: weekActions.length, bedOccupancy: modules.beds?.occupancyRate }, 'Dashboard summary generated');

  return { modules, alerts, weekActions };
}
