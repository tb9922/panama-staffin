import logger from '../logger.js';
import * as dashboardRepo from '../repositories/dashboardRepo.js';

// ── Alert priority ordering ─────────────────────────────────────────────────

const TYPE_ORDER = { error: 0, warning: 1, info: 2 };

// ── Alert builders ──────────────────────────────────────────────────────────

function pushIf(alerts, condition, type, module, message, link) {
  if (condition) alerts.push({ type, module, message, link });
}

function buildAlerts(m) {
  const alerts = [];
  const n = (obj, key) => (obj && typeof obj[key] === 'number') ? obj[key] : 0;
  const b = (obj, key) => !!(obj && obj[key]);

  // Error alerts — regulatory/safety risk
  pushIf(alerts, n(m.incidents, 'cqcOverdue') > 0, 'error', 'incidents',
    `${n(m.incidents, 'cqcOverdue')} CQC notification(s) overdue`, '/incidents');
  pushIf(alerts, n(m.incidents, 'riddorOverdue') > 0, 'error', 'incidents',
    `${n(m.incidents, 'riddorOverdue')} RIDDOR report(s) overdue`, '/incidents');
  pushIf(alerts, n(m.incidents, 'docOverdue') > 0, 'error', 'incidents',
    `${n(m.incidents, 'docOverdue')} Duty of Candour notification(s) overdue`, '/incidents');
  pushIf(alerts, n(m.risks, 'critical') > 0, 'error', 'risks',
    `${n(m.risks, 'critical')} critical risk(s) on register`, '/risks');
  pushIf(alerts, n(m.whistleblowing, 'unacknowledged') > 0, 'error', 'whistleblowing',
    `${n(m.whistleblowing, 'unacknowledged')} unacknowledged whistleblowing concern(s)`, '/speak-up');

  // Warning alerts — action needed
  pushIf(alerts, n(m.incidents, 'open') > 0, 'warning', 'incidents',
    `${n(m.incidents, 'open')} open investigation(s)`, '/incidents');
  pushIf(alerts, n(m.incidents, 'overdueActions') > 0, 'warning', 'incidents',
    `${n(m.incidents, 'overdueActions')} overdue corrective action(s)`, '/incidents');
  pushIf(alerts, n(m.complaints, 'unacknowledged') > 0, 'warning', 'complaints',
    `${n(m.complaints, 'unacknowledged')} unacknowledged complaint(s)`, '/complaints');
  pushIf(alerts, n(m.complaints, 'overdueResponse') > 0, 'warning', 'complaints',
    `${n(m.complaints, 'overdueResponse')} overdue complaint response(s)`, '/complaints');
  pushIf(alerts, n(m.maintenance, 'overdue') > 0, 'warning', 'maintenance',
    `${n(m.maintenance, 'overdue')} overdue maintenance check(s)`, '/maintenance');
  pushIf(alerts, n(m.maintenance, 'expiredCerts') > 0, 'warning', 'maintenance',
    `${n(m.maintenance, 'expiredCerts')} expired certificate(s)`, '/maintenance');
  pushIf(alerts, n(m.training, 'expired') > 0, 'warning', 'training',
    `${n(m.training, 'expired')} expired training record(s)`, '/training');
  pushIf(alerts, n(m.supervisions, 'overdue') > 0, 'warning', 'supervisions',
    `${n(m.supervisions, 'overdue')} overdue supervision(s)`, '/training');
  pushIf(alerts, n(m.appraisals, 'overdue') > 0, 'warning', 'appraisals',
    `${n(m.appraisals, 'overdue')} overdue appraisal(s)`, '/training');
  pushIf(alerts, b(m.fireDrills, 'overdue'), 'warning', 'fireDrills',
    'Fire drill overdue', '/training');
  pushIf(alerts, n(m.ipc, 'activeOutbreaks') > 0, 'warning', 'ipc',
    `${n(m.ipc, 'activeOutbreaks')} active IPC outbreak(s)`, '/ipc');
  pushIf(alerts, n(m.ipc, 'overdueActions') > 0, 'warning', 'ipc',
    `${n(m.ipc, 'overdueActions')} overdue IPC corrective action(s)`, '/ipc');
  pushIf(alerts, n(m.risks, 'overdueReviews') > 0, 'warning', 'risks',
    `${n(m.risks, 'overdueReviews')} overdue risk review(s)`, '/risks');
  pushIf(alerts, n(m.risks, 'overdueActions') > 0, 'warning', 'risks',
    `${n(m.risks, 'overdueActions')} overdue risk action(s)`, '/risks');
  pushIf(alerts, n(m.policies, 'overdue') > 0, 'warning', 'policies',
    `${n(m.policies, 'overdue')} overdue policy review(s)`, '/policies');
  pushIf(alerts, n(m.dols, 'expiringSoon') > 0, 'warning', 'dols',
    `${n(m.dols, 'expiringSoon')} DoLS authorisation(s) expiring within 90 days`, '/dols');
  pushIf(alerts, n(m.dols, 'overdueReviews') > 0, 'warning', 'dols',
    `${n(m.dols, 'overdueReviews')} overdue DoLS/MCA review(s)`, '/dols');
  pushIf(alerts, n(m.careCertificate, 'overdue') > 0, 'warning', 'careCertificate',
    `${n(m.careCertificate, 'overdue')} overdue Care Certificate(s)`, '/care-cert');
  pushIf(alerts, n(m.supervisions, 'noRecord') > 0, 'warning', 'supervisions',
    `${n(m.supervisions, 'noRecord')} staff with no supervision record`, '/training');
  pushIf(alerts, n(m.appraisals, 'noRecord') > 0, 'warning', 'appraisals',
    `${n(m.appraisals, 'noRecord')} staff with no appraisal record`, '/training');
  pushIf(alerts, n(m.whistleblowing, 'open') > 0, 'warning', 'whistleblowing',
    `${n(m.whistleblowing, 'open')} open whistleblowing concern(s)`, '/speak-up');
  pushIf(alerts, m.ipc?.latestScore != null && m.ipc.latestScore < 70, 'warning', 'ipc',
    `Latest IPC audit score is ${m.ipc.latestScore}% — below 70% threshold`, '/ipc');

  // Info alerts — awareness
  pushIf(alerts, n(m.training, 'expiringSoon') > 0, 'info', 'training',
    `${n(m.training, 'expiringSoon')} training record(s) expiring in 30 days`, '/training');
  pushIf(alerts, n(m.maintenance, 'dueSoon') > 0, 'info', 'maintenance',
    `${n(m.maintenance, 'dueSoon')} maintenance check(s) due in 30 days`, '/maintenance');
  pushIf(alerts, n(m.supervisions, 'dueSoon') > 0, 'info', 'supervisions',
    `${n(m.supervisions, 'dueSoon')} supervision(s) due soon`, '/training');
  pushIf(alerts, n(m.policies, 'dueSoon') > 0, 'info', 'policies',
    `${n(m.policies, 'dueSoon')} policy review(s) due soon`, '/policies');
  pushIf(alerts, n(m.fireDrills, 'drillsThisYear') < 4 && !b(m.fireDrills, 'overdue'), 'info', 'fireDrills',
    `Only ${n(m.fireDrills, 'drillsThisYear')} fire drill(s) this year — 4 required`, '/training');

  // Stable sort: errors first, then warnings, then info
  alerts.sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type]);

  return alerts;
}

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

  logger.info({ homeId, alertCount: alerts.length }, 'Dashboard summary generated');

  return { modules, alerts };
}
