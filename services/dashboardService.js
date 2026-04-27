import logger from '../logger.js';
import * as dashboardRepo from '../repositories/dashboardRepo.js';
import { todayLocalISO } from '../lib/dateOnly.js';
import { hasModuleAccess, isOwnDataOnly } from '../shared/roles.js';

export function invalidateDashboardCache(homeId) {
  void homeId;
}

const TYPE_ORDER = { error: 0, warning: 1, info: 2 };

const MODULE_PERMISSION = {
  incidents: 'compliance',
  complaints: 'compliance',
  maintenance: 'compliance',
  training: 'compliance',
  supervisions: 'compliance',
  appraisals: 'compliance',
  fireDrills: 'compliance',
  ipc: 'compliance',
  dols: 'compliance',
  careCertificate: 'compliance',
  risks: 'governance',
  policies: 'governance',
  whistleblowing: 'governance',
  beds: 'finance',
};

function pushIf(alerts, condition, id, type, module, message, link, priority = 1, dueDate = null) {
  if (condition) alerts.push({ id, type, module, message, link, priority, dueDate });
}

function canViewSummaryModule(homeRole, moduleKey) {
  if (!homeRole) return true;
  const permissionModule = MODULE_PERMISSION[moduleKey];
  if (!permissionModule) return false;
  if (isOwnDataOnly(homeRole, permissionModule)) return false;
  return hasModuleAccess(homeRole, permissionModule, 'read', { includeOwn: false });
}

function filterSummaryForRole(summary, homeRole) {
  if (!homeRole) return summary;
  const visibleModuleKeys = new Set(MODULE_KEYS.filter((key) => canViewSummaryModule(homeRole, key)));
  const modules = {};
  for (const key of visibleModuleKeys) {
    modules[key] = summary.modules[key];
  }
  const visibleAlerts = (summary.alerts || []).filter((alert) => visibleModuleKeys.has(alert.module));
  const highPrioritySource = Array.isArray(summary.highPriorityActions)
    ? summary.highPriorityActions
    : (summary.weekActions || []);
  const visibleHighPriorityActions = highPrioritySource
    .filter((alert) => visibleModuleKeys.has(alert.module));
  const failedModules = (summary._failedModules || []).filter((key) => visibleModuleKeys.has(key));
  return {
    ...summary,
    modules,
    alerts: visibleAlerts,
    highPriorityActions: visibleHighPriorityActions,
    weekActions: visibleHighPriorityActions,
    _degraded: failedModules.length > 0,
    _failedModules: failedModules,
  };
}

function buildAlerts(m, { excludedModules = [] } = {}) {
  const alerts = [];
  const excluded = new Set(excludedModules);
  const n = (obj, key) => (obj && typeof obj[key] === 'number') ? obj[key] : 0;
  const b = (obj, key) => !!(obj && obj[key]);

  pushIf(alerts, n(m.incidents, 'cqcOverdue') > 0, 'incidents.cqc_overdue', 'error', 'incidents',
    `${n(m.incidents, 'cqcOverdue')} CQC notification(s) overdue`, '/incidents', 5);
  pushIf(alerts, n(m.incidents, 'riddorOverdue') > 0, 'incidents.riddor_overdue', 'error', 'incidents',
    `${n(m.incidents, 'riddorOverdue')} RIDDOR report(s) overdue`, '/incidents', 5);

  pushIf(alerts, n(m.incidents, 'docOverdue') > 0, 'incidents.doc_overdue', 'error', 'incidents',
    `${n(m.incidents, 'docOverdue')} Duty of Candour notification(s) overdue`, '/incidents', 4);
  pushIf(alerts, n(m.risks, 'critical') > 0, 'risks.critical', 'error', 'risks',
    `${n(m.risks, 'critical')} critical risk(s) on register`, '/risks', 4);
  pushIf(alerts, n(m.whistleblowing, 'unacknowledged') > 0, 'whistleblowing.unacknowledged', 'error', 'whistleblowing',
    `${n(m.whistleblowing, 'unacknowledged')} unacknowledged whistleblowing concern(s)`, '/speak-up', 4);
  pushIf(alerts, m.beds?.occupancyRate < 80, 'beds.occupancy_below_80', 'error', 'beds',
    `Occupancy at ${n(m.beds, 'occupancyRate')}% - significant revenue risk`, '/beds', 4);

  pushIf(alerts, n(m.incidents, 'open') > 0, 'incidents.open', 'warning', 'incidents',
    `${n(m.incidents, 'open')} open investigation(s)`, '/incidents', 3);
  pushIf(alerts, n(m.incidents, 'overdueActions') > 0, 'incidents.overdue_actions', 'warning', 'incidents',
    `${n(m.incidents, 'overdueActions')} overdue corrective action(s)`, '/incidents', 3);
  pushIf(alerts, n(m.complaints, 'unacknowledged') > 0, 'complaints.unacknowledged', 'warning', 'complaints',
    `${n(m.complaints, 'unacknowledged')} unacknowledged complaint(s)`, '/complaints', 3);
  pushIf(alerts, n(m.complaints, 'overdueResponse') > 0, 'complaints.overdue_response', 'warning', 'complaints',
    `${n(m.complaints, 'overdueResponse')} overdue complaint response(s)`, '/complaints', 3);
  pushIf(alerts, n(m.maintenance, 'overdue') > 0, 'maintenance.overdue', 'warning', 'maintenance',
    `${n(m.maintenance, 'overdue')} overdue maintenance check(s)`, '/maintenance', 3);
  pushIf(alerts, n(m.maintenance, 'expiredCerts') > 0, 'maintenance.expired_certs', 'warning', 'maintenance',
    `${n(m.maintenance, 'expiredCerts')} expired certificate(s)`, '/maintenance', 3);
  pushIf(alerts, n(m.training, 'expired') > 0, 'training.expired', 'warning', 'training',
    `${n(m.training, 'expired')} expired training record(s)`, '/training', 3);
  pushIf(alerts, n(m.training, 'notStarted') > 0, 'training.not_started', 'warning', 'training',
    `${n(m.training, 'notStarted')} mandatory training record(s) not started`, '/training', 3);
  pushIf(alerts, n(m.supervisions, 'overdue') > 0, 'supervisions.overdue', 'warning', 'supervisions',
    `${n(m.supervisions, 'overdue')} overdue supervision(s)`, '/training', 3);
  pushIf(alerts, n(m.appraisals, 'overdue') > 0, 'appraisals.overdue', 'warning', 'appraisals',
    `${n(m.appraisals, 'overdue')} overdue appraisal(s)`, '/training', 3);
  pushIf(alerts, b(m.fireDrills, 'overdue'), 'fire_drills.overdue', 'warning', 'fireDrills',
    'Fire drill overdue', '/training', 3);
  pushIf(alerts, n(m.ipc, 'activeOutbreaks') > 0, 'ipc.active_outbreaks', 'warning', 'ipc',
    `${n(m.ipc, 'activeOutbreaks')} active IPC outbreak(s)`, '/ipc', 3);
  pushIf(alerts, n(m.ipc, 'overdueActions') > 0, 'ipc.overdue_actions', 'warning', 'ipc',
    `${n(m.ipc, 'overdueActions')} overdue IPC corrective action(s)`, '/ipc', 3);
  pushIf(alerts, n(m.risks, 'overdueReviews') > 0, 'risks.overdue_reviews', 'warning', 'risks',
    `${n(m.risks, 'overdueReviews')} overdue risk review(s)`, '/risks', 3);
  pushIf(alerts, n(m.risks, 'overdueActions') > 0, 'risks.overdue_actions', 'warning', 'risks',
    `${n(m.risks, 'overdueActions')} overdue risk action(s)`, '/risks', 3);
  pushIf(alerts, n(m.policies, 'overdue') > 0, 'policies.overdue', 'warning', 'policies',
    `${n(m.policies, 'overdue')} overdue policy review(s)`, '/policies', 3);
  pushIf(alerts, n(m.dols, 'expiringSoon') > 0, 'dols.expiring_soon', 'warning', 'dols',
    `${n(m.dols, 'expiringSoon')} DoLS authorisation(s) expiring within 90 days`, '/dols', 3);
  pushIf(alerts, n(m.dols, 'overdueReviews') > 0, 'dols.overdue_reviews', 'warning', 'dols',
    `${n(m.dols, 'overdueReviews')} overdue DoLS/MCA review(s)`, '/dols', 3);
  pushIf(alerts, n(m.careCertificate, 'overdue') > 0, 'care_certificate.overdue', 'warning', 'careCertificate',
    `${n(m.careCertificate, 'overdue')} overdue Care Certificate(s)`, '/care-cert', 3);
  pushIf(alerts, n(m.beds, 'residentBedMismatch') > 0, 'beds.resident_bed_mismatch', 'warning', 'beds',
    `${n(m.beds, 'residentBedMismatch')} bed(s) show occupied but resident discharged/deceased`, '/beds', 3);
  pushIf(alerts, n(m.beds, 'hospitalHoldExpiring') > 0, 'beds.hospital_hold_expiring', 'warning', 'beds',
    `${n(m.beds, 'hospitalHoldExpiring')} hospital hold(s) expiring within 7 days`, '/beds', 3);
  pushIf(alerts, n(m.beds, 'staleReservations') > 0, 'beds.stale_reservations', 'warning', 'beds',
    `${n(m.beds, 'staleReservations')} stale reservation(s) past expiry`, '/beds', 3);
  pushIf(alerts, n(m.supervisions, 'noRecord') > 0, 'supervisions.no_record', 'warning', 'supervisions',
    `${n(m.supervisions, 'noRecord')} staff with no supervision record`, '/training', 3);
  pushIf(alerts, n(m.appraisals, 'noRecord') > 0, 'appraisals.no_record', 'warning', 'appraisals',
    `${n(m.appraisals, 'noRecord')} staff with no appraisal record`, '/training', 3);
  pushIf(alerts, n(m.whistleblowing, 'open') > 0, 'whistleblowing.open', 'warning', 'whistleblowing',
    `${n(m.whistleblowing, 'open')} open whistleblowing concern(s)`, '/speak-up', 3);
  pushIf(alerts, m.ipc?.latestScore != null && m.ipc.latestScore < 70, 'ipc.latest_score_below_70', 'warning', 'ipc',
    `Latest IPC audit score is ${m.ipc.latestScore}% - below 70% threshold`, '/ipc', 3);

  pushIf(alerts, m.beds?.occupancyRate >= 80 && m.beds?.occupancyRate < 90, 'beds.occupancy_below_90', 'warning', 'beds',
    `Occupancy at ${n(m.beds, 'occupancyRate')}% - below 90% target`, '/beds', 2);
  pushIf(alerts, n(m.training, 'expiringSoon') > 0, 'training.expiring_soon', 'info', 'training',
    `${n(m.training, 'expiringSoon')} training record(s) expiring in 30 days`, '/training', 2);
  pushIf(alerts, n(m.maintenance, 'dueSoon') > 0, 'maintenance.due_soon', 'info', 'maintenance',
    `${n(m.maintenance, 'dueSoon')} maintenance check(s) due in 30 days`, '/maintenance', 2);
  pushIf(alerts, n(m.supervisions, 'dueSoon') > 0, 'supervisions.due_soon', 'info', 'supervisions',
    `${n(m.supervisions, 'dueSoon')} supervision(s) due soon`, '/training', 2);
  pushIf(alerts, n(m.policies, 'dueSoon') > 0, 'policies.due_soon', 'info', 'policies',
    `${n(m.policies, 'dueSoon')} policy review(s) due soon`, '/policies', 2);

  pushIf(alerts, n(m.fireDrills, 'drillsThisYear') < 4 && !b(m.fireDrills, 'overdue'), 'fire_drills.low_yearly_count', 'info', 'fireDrills',
    `Only ${n(m.fireDrills, 'drillsThisYear')} fire drill(s) this year - 4 required`, '/training', 1);
  pushIf(alerts, n(m.beds, 'available') > 0 && m.beds?.occupancyRate >= 90, 'beds.available', 'info', 'beds',
    `${n(m.beds, 'available')} bed(s) available`, '/beds', 1);

  alerts.sort((a, b) => (b.priority - a.priority) || (TYPE_ORDER[a.type] - TYPE_ORDER[b.type]));
  return alerts.filter((alert) => !excluded.has(alert.module));
}

export { buildAlerts as _buildAlerts, filterSummaryForRole as _filterSummaryForRole, MODULE_PERMISSION as _MODULE_PERMISSION };

const DEFAULTS = {
  incidents:       { open: 0, cqcOverdue: 0, riddorOverdue: 0, docOverdue: 0, overdueActions: 0 },
  complaints:      { open: 0, unacknowledged: 0, overdueResponse: 0 },
  maintenance:     { total: 0, overdue: 0, dueSoon: 0, expiredCerts: 0, compliancePct: 100 },
  training:        { totalRequired: 0, compliant: 0, compliancePct: 100, expired: 0, expiringSoon: 0, notStarted: 0 },
  supervisions:    { overdue: 0, dueSoon: 0, noRecord: 0 },
  appraisals:      { overdue: 0, dueSoon: 0, noRecord: 0 },
  fireDrills:      { lastDate: null, drillsThisYear: 0, overdue: false },
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

export async function getDashboardSummary(homeId, { homeRole = null } = {}) {
  const today = todayLocalISO();

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
  const failedModules = [];
  MODULE_KEYS.forEach((key, i) => {
    if (results[i].status === 'fulfilled') {
      modules[key] = results[i].value;
    } else {
      logger.error({ homeId, module: key, err: results[i].reason?.message }, 'Dashboard query failed');
      modules[key] = DEFAULTS[key];
      failedModules.push(key);
    }
  });

  const alerts = buildAlerts(modules, { excludedModules: failedModules });
  const highPriorityActions = alerts.filter((alert) => alert.priority >= 3);

  logger.info(
    { homeId, alertCount: alerts.length, highPriorityActionCount: highPriorityActions.length, bedOccupancy: modules.beds?.occupancyRate },
    'Dashboard summary generated',
  );

  return filterSummaryForRole(
    {
      modules,
      alerts,
      highPriorityActions,
      // Back-compat for existing clients; semantically this is not time-bound.
      weekActions: highPriorityActions,
      _degraded: failedModules.length > 0,
      _failedModules: failedModules,
    },
    homeRole,
  );
}
