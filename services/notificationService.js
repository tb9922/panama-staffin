import { createHash } from 'node:crypto';
import * as dashboardService from './dashboardService.js';
import * as notificationRepo from '../repositories/notificationRepo.js';
import { hasModuleAccess, isOwnDataOnly } from '../shared/roles.js';
import logger from '../logger.js';

const ALERT_MODULE_TO_PERMISSION = {
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

const MODULE_LABELS = {
  appraisals: 'Appraisals',
  beds: 'Home Alerts',
  careCertificate: 'Care Certificate',
  complaints: 'Complaints',
  dols: 'DoLS',
  fireDrills: 'Fire Drills',
  incidents: 'Incidents',
  ipc: 'IPC',
  maintenance: 'Maintenance',
  policies: 'Policies',
  risks: 'Risks',
  supervisions: 'Supervisions',
  training: 'Training',
  whistleblowing: 'Whistleblowing',
};

function buildLegacyNotificationKey(alert) {
  return createHash('sha1')
    .update([alert.module, alert.message, alert.link || ''].join('|'))
    .digest('hex')
    .slice(0, 20);
}

function buildNotificationKey(alert) {
  return createHash('sha1')
    .update([alert.id || '', alert.module, alert.link || ''].join('|'))
    .digest('hex')
    .slice(0, 20);
}

function getModuleLabel(moduleId) {
  return MODULE_LABELS[moduleId]
    || String(moduleId || '')
      .replace(/([A-Z])/g, ' $1')
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase());
}

function isAlertVisibleToRole(alert, homeRole) {
  const moduleId = ALERT_MODULE_TO_PERMISSION[alert.module];
  if (!moduleId) return false;
  if (!hasModuleAccess(homeRole, moduleId, 'read')) return false;
  if (isOwnDataOnly(homeRole, moduleId)) return false;
  return true;
}

export async function listNotifications({ homeId, homeRole, userId }) {
  let summary;
  try {
    summary = await dashboardService.getDashboardSummary(homeId);
  } catch (err) {
    logger.warn({ homeId, userId, err: err?.message }, 'Notification feed fell back to empty state');
    return {
      items: [],
      unreadCount: 0,
      degraded: true,
      generatedAt: new Date().toISOString(),
    };
  }
  const readRows = await notificationRepo.listReadKeys(userId, homeId);
  const readMap = new Map(readRows.map(row => [row.notification_key, row.read_at]));

  const items = (summary.alerts || [])
    .filter(alert => isAlertVisibleToRole(alert, homeRole))
    .map(alert => {
      const key = buildNotificationKey(alert);
      const legacyKey = buildLegacyNotificationKey(alert);
      const readAt = readMap.get(key) || readMap.get(legacyKey) || null;
      return {
        key,
        title: getModuleLabel(alert.module),
        message: alert.message,
        severity: alert.type,
        link: alert.link || null,
        module: alert.module,
        priority: alert.priority || 1,
        readAt,
        isRead: Boolean(readAt),
      };
    })
    .sort((a, b) => (b.priority - a.priority) || a.message.localeCompare(b.message));

  return {
    items,
    unreadCount: items.filter(item => !item.isRead).length,
    degraded: summary._degraded === true,
    generatedAt: new Date().toISOString(),
  };
}

export async function markNotificationsRead({ homeId, userId, keys }) {
  await notificationRepo.markManyRead(userId, homeId, keys);
  await notificationRepo.pruneReadKeys(userId, homeId);
}

export async function markAllNotificationsRead({ homeId, homeRole, userId }) {
  const { items } = await listNotifications({ homeId, homeRole, userId });
  const unreadKeys = items.filter((item) => !item.isRead).map((item) => item.key);
  if (!unreadKeys.length) return;
  await notificationRepo.markManyRead(userId, homeId, unreadKeys);
  await notificationRepo.pruneReadKeys(userId, homeId);
}

export { ALERT_MODULE_TO_PERMISSION as _ALERT_MODULE_TO_PERMISSION, buildLegacyNotificationKey as _buildLegacyNotificationKey, buildNotificationKey as _buildNotificationKey };
