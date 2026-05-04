import { createHash } from 'node:crypto';
import { addDaysLocalISO, diffLocalISODays, todayLocalISO } from '../lib/dateOnly.js';
import * as actionItemRepo from '../repositories/actionItemRepo.js';
import * as agencyAttemptRepo from '../repositories/agencyAttemptRepo.js';
import * as auditTaskRepo from '../repositories/auditTaskRepo.js';
import * as trainingRepo from '../repositories/trainingRepo.js';
import logger from '../logger.js';
import { hasModuleAccess, isOwnDataOnly } from '../shared/roles.js';
import { getTrainingTypes } from '../shared/training.js';
import { PORTFOLIO_RAG_THRESHOLDS } from '../shared/portfolioRag.js';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 250;
const REPOSITORY_LIMIT = 500;

const PERIODS = {
  daily: {
    dueLookaheadDays: 0,
    trainingLookaheadDays: 7,
  },
  weekly: {
    dueLookaheadDays: 7,
    trainingLookaheadDays: 30,
  },
};

const MODULES = {
  action_items: 'governance',
  audit_tasks: 'governance',
  training: 'compliance',
  agency: 'payroll',
};

const SEVERITY_SCORE = {
  error: 3,
  warning: 2,
  info: 1,
};

const ACTION_PRIORITY_SCORE = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const CLOSED_STATUSES = new Set(['completed', 'verified', 'cancelled']);

const DEFAULT_REPOS = {
  actionItemRepo,
  agencyAttemptRepo,
  auditTaskRepo,
  trainingRepo,
};

function capLimit(limit) {
  const parsed = Number.parseInt(limit, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function normalizePeriod(period) {
  return PERIODS[period] ? period : 'daily';
}

function sameHome(row, homeId) {
  if (!row || row.home_id == null) return false;
  return Number(row.home_id) === Number(homeId);
}

function canReadModule(homeRole, moduleId) {
  if (!homeRole) return true;
  if (isOwnDataOnly(homeRole, moduleId)) return false;
  return hasModuleAccess(homeRole, moduleId, 'read', { includeOwn: false });
}

function digestKey(parts) {
  return createHash('sha1')
    .update(parts.map(part => String(part ?? '')).join('|'))
    .digest('hex')
    .slice(0, 20);
}

function plural(count, singular, pluralWord = `${singular}s`) {
  return Number(count) === 1 ? singular : pluralWord;
}

function daysAgoText(days) {
  const overdueDays = Math.abs(days);
  if (overdueDays === 0) return 'today';
  return `${overdueDays} ${plural(overdueDays, 'day')} ago`;
}

function dueText(days) {
  if (days < 0) return `overdue by ${Math.abs(days)} ${plural(Math.abs(days), 'day')}`;
  if (days === 0) return 'due today';
  return `due in ${days} ${plural(days, 'day')}`;
}

function sourceVisible(source, homeRole) {
  return canReadModule(homeRole, MODULES[source]);
}

function sortDigestItems(items) {
  return [...items].sort((a, b) => (
    (SEVERITY_SCORE[b.severity] || 0) - (SEVERITY_SCORE[a.severity] || 0)
    || (b.priority || 0) - (a.priority || 0)
    || String(a.dueDate || a.expiryDate || '').localeCompare(String(b.dueDate || b.expiryDate || ''))
    || String(a.title || '').localeCompare(String(b.title || ''))
  ));
}

function buildCounts(items) {
  const bySeverity = { error: 0, warning: 0, info: 0 };
  const byType = {};
  for (const item of items) {
    bySeverity[item.severity] = (bySeverity[item.severity] || 0) + 1;
    byType[item.type] = (byType[item.type] || 0) + 1;
  }
  return {
    total: items.length,
    bySeverity,
    byType,
  };
}

function actionItemToDigestItem(action, context) {
  if (!sameHome(action, context.homeId)) return null;
  if (CLOSED_STATUSES.has(action.status)) return null;
  const days = diffLocalISODays(action.due_date, context.todayIso);
  if (days >= 0) return null;

  const escalationLevel = Number(action.escalation_level || 0);
  const actionPriority = ACTION_PRIORITY_SCORE[action.priority] || 1;
  const overdueDays = Math.abs(days);
  const severity = action.priority === 'critical' || escalationLevel >= 3 || overdueDays >= 7
    ? 'error'
    : 'warning';

  return {
    key: digestKey(['action_item', context.homeId, action.id, action.due_date, escalationLevel]),
    type: 'action_item',
    module: MODULES.action_items,
    severity,
    priority: 500 + (escalationLevel * 20) + (actionPriority * 10) + Math.min(overdueDays, 30),
    title: action.title || 'Overdue action item',
    message: `${action.title || 'Action item'} is ${dueText(days)}.`,
    link: '/actions',
    dueDate: action.due_date || null,
    homeId: context.homeId,
    homeSlug: context.homeSlug,
    source: { table: 'action_items', id: action.id },
    metadata: {
      category: action.category || null,
      ownerName: action.owner_name || null,
      ownerRole: action.owner_role || null,
      priority: action.priority || null,
      escalationLevel,
    },
  };
}

function auditTaskToDigestItem(task, context) {
  if (!sameHome(task, context.homeId)) return null;
  if (CLOSED_STATUSES.has(task.status)) return null;
  const days = diffLocalISODays(task.due_date, context.todayIso);
  if (days > context.dueLookaheadDays) return null;

  const overdueDays = Math.max(0, Math.abs(days));
  const severity = days < 0 && overdueDays >= 7 ? 'error' : (days < 0 ? 'warning' : 'info');
  const label = days < 0 ? 'Audit task overdue' : 'Audit task due';

  return {
    key: digestKey(['audit_task', context.homeId, task.id, task.due_date, task.status]),
    type: 'audit_task',
    module: MODULES.audit_tasks,
    severity,
    priority: 300 + (days < 0 ? 50 : 0) + Math.min(overdueDays, 30),
    title: label,
    message: `${task.title || 'Audit task'} is ${dueText(days)}.`,
    link: '/audit-calendar',
    dueDate: task.due_date || null,
    homeId: context.homeId,
    homeSlug: context.homeSlug,
    source: { table: 'audit_tasks', id: task.id },
    metadata: {
      category: task.category || null,
      frequency: task.frequency || null,
      evidenceRequired: task.evidence_required === true,
    },
  };
}

function trainingRecordToDigestItem({ staffId, typeId, record, trainingType }, context) {
  if (!record?.expiry) return null;
  const days = diffLocalISODays(record.expiry, context.todayIso);
  if (days > context.trainingLookaheadDays) return null;

  const expired = days < 0;
  const severity = expired ? 'error' : (days <= 7 ? 'warning' : 'info');
  const trainingName = trainingType?.name || typeId;
  const priority = expired
    ? 450 + Math.min(Math.abs(days), 30)
    : 250 + Math.max(0, context.trainingLookaheadDays - days);

  return {
    key: digestKey(['training', context.homeId, staffId, typeId, record.expiry]),
    type: 'training',
    module: MODULES.training,
    severity,
    priority,
    title: expired ? 'Training expired' : 'Training expiring',
    message: `${trainingName} for staff ${staffId} ${expired ? `expired ${daysAgoText(days)}` : dueText(days)}.`,
    link: '/training',
    expiryDate: record.expiry,
    homeId: context.homeId,
    homeSlug: context.homeSlug,
    source: { table: 'training_records', staffId, trainingTypeId: typeId },
    metadata: {
      trainingTypeName: trainingName,
      category: trainingType?.category || null,
      completed: record.completed || null,
    },
  };
}

function agencyOverrideToDigestItem(row, context) {
  if (!sameHome(row, context.homeId)) return null;
  const attempts = Number(row.attempts_7d || 0);
  const emergencyOverrides = Number(row.emergency_overrides_7d || 0);
  if (attempts <= 0 || emergencyOverrides <= 0) return null;

  const percent = Math.round((emergencyOverrides / attempts) * 100);
  if (percent <= context.agencyOverrideThresholdPct) return null;

  return {
    key: digestKey(['agency_emergency_override', context.homeId, attempts, emergencyOverrides]),
    type: 'agency_emergency_override',
    module: MODULES.agency,
    severity: 'error',
    priority: 650 + percent,
    title: 'Emergency agency override above threshold',
    message: `${percent}% emergency agency override in the last 7 days (${emergencyOverrides}/${attempts}), above the ${context.agencyOverrideThresholdPct}% red threshold.`,
    link: '/payroll/agency',
    homeId: context.homeId,
    homeSlug: context.homeSlug,
    source: { table: 'agency_approval_attempts' },
    metadata: {
      attempts7d: attempts,
      emergencyOverrides7d: emergencyOverrides,
      emergencyOverridePct: percent,
      thresholdPct: context.agencyOverrideThresholdPct,
    },
  };
}

async function loadActionItems(context, repos) {
  const result = await repos.actionItemRepo.findByHome(context.homeId, {
    overdue: true,
    limit: REPOSITORY_LIMIT,
    offset: 0,
  });
  return (result.rows || [])
    .map(row => actionItemToDigestItem(row, context))
    .filter(Boolean);
}

async function loadAuditTasks(context, repos) {
  const result = await repos.auditTaskRepo.findByHome(context.homeId, {
    status: 'open',
    to: context.dueWindowTo,
    limit: REPOSITORY_LIMIT,
    offset: 0,
  });
  return (result.rows || [])
    .map(row => auditTaskToDigestItem(row, context))
    .filter(Boolean);
}

async function loadTrainingItems(context, repos) {
  const result = await repos.trainingRepo.findByHome(context.homeId, {
    limit: 10000,
    offset: 0,
  });
  const recordsByStaff = result.rows || {};
  const trainingTypes = new Map(getTrainingTypes(context.homeConfig).map(type => [type.id, type]));
  const items = [];

  for (const [staffId, recordsByType] of Object.entries(recordsByStaff)) {
    for (const [typeId, record] of Object.entries(recordsByType || {})) {
      const item = trainingRecordToDigestItem({
        staffId,
        typeId,
        record,
        trainingType: trainingTypes.get(typeId),
      }, context);
      if (item) items.push(item);
    }
  }

  return items;
}

async function loadAgencyItems(context, repos) {
  if (typeof repos.agencyAttemptRepo.countEmergencyOverridesByHome !== 'function') return [];
  const rows = await repos.agencyAttemptRepo.countEmergencyOverridesByHome([context.homeId]);
  return (rows || [])
    .map(row => agencyOverrideToDigestItem(row, context))
    .filter(Boolean);
}

function sourceLoaders(homeRole) {
  const loaders = [];
  if (sourceVisible('action_items', homeRole)) loaders.push({ source: 'action_items', load: loadActionItems });
  if (sourceVisible('audit_tasks', homeRole)) loaders.push({ source: 'audit_tasks', load: loadAuditTasks });
  if (sourceVisible('training', homeRole)) loaders.push({ source: 'training', load: loadTrainingItems });
  if (sourceVisible('agency', homeRole)) loaders.push({ source: 'agency', load: loadAgencyItems });
  return loaders;
}

export async function buildNotificationDigest({
  homeId,
  homeSlug = null,
  homeName = null,
  homeRole = null,
  homeConfig = null,
  period = 'daily',
  today = new Date(),
  limit = DEFAULT_LIMIT,
  repos = DEFAULT_REPOS,
} = {}) {
  if (!homeId) throw new Error('homeId is required');

  const normalizedPeriod = normalizePeriod(period);
  const periodConfig = PERIODS[normalizedPeriod];
  const todayIso = todayLocalISO(today);
  const dueWindowTo = addDaysLocalISO(todayIso, periodConfig.dueLookaheadDays);
  const trainingWindowTo = addDaysLocalISO(todayIso, periodConfig.trainingLookaheadDays);
  const agencyOverrideThresholdPct = PORTFOLIO_RAG_THRESHOLDS.agencyEmergencyOverridePct.amberAtMost;
  const context = {
    homeId,
    homeSlug,
    homeConfig,
    todayIso,
    dueLookaheadDays: periodConfig.dueLookaheadDays,
    trainingLookaheadDays: periodConfig.trainingLookaheadDays,
    dueWindowTo,
    trainingWindowTo,
    agencyOverrideThresholdPct,
  };

  const loaders = sourceLoaders(homeRole);
  const results = await Promise.allSettled(loaders.map(loader => loader.load(context, repos)));
  const failedSources = [];
  const items = [];

  results.forEach((result, index) => {
    const source = loaders[index].source;
    if (result.status === 'fulfilled') {
      items.push(...result.value);
      return;
    }
    failedSources.push(source);
    logger.warn({
      homeId,
      source,
      err: result.reason?.message,
    }, 'Notification digest source failed');
  });

  const limitedItems = sortDigestItems(items).slice(0, capLimit(limit));
  const counts = buildCounts(limitedItems);

  return {
    period: normalizedPeriod,
    generatedAt: new Date().toISOString(),
    home: {
      id: homeId,
      slug: homeSlug,
      name: homeName,
    },
    window: {
      today: todayIso,
      dueTo: dueWindowTo,
      trainingExpiryTo: trainingWindowTo,
      agencyLookbackDays: 7,
    },
    delivery: {
      channels: ['in_app'],
      email: {
        enabled: false,
        reason: 'External email credentials are not required for this digest slice',
      },
    },
    degraded: failedSources.length > 0,
    failedSources,
    empty: limitedItems.length === 0,
    counts,
    items: limitedItems,
  };
}

export {
  MODULES as _DIGEST_MODULES,
  digestKey as _digestKey,
  sortDigestItems as _sortDigestItems,
};
