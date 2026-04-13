import { createHash } from 'node:crypto';
import * as dashboardService from './dashboardService.js';
import * as notificationRepo from '../repositories/notificationRepo.js';
import { hasModuleAccess, isOwnDataOnly } from '../shared/roles.js';

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

function buildNotificationKey(alert) {
  return createHash('sha1')
    .update([alert.module, alert.message, alert.link || ''].join('|'))
    .digest('hex')
    .slice(0, 20);
}

function isAlertVisibleToRole(alert, homeRole) {
  const moduleId = ALERT_MODULE_TO_PERMISSION[alert.module];
  if (!moduleId) return false;
  if (!hasModuleAccess(homeRole, moduleId, 'read')) return false;
  if (isOwnDataOnly(homeRole, moduleId)) return false;
  return true;
}

export async function listNotifications({ homeId, homeRole, userId }) {
  const summary = await dashboardService.getDashboardSummary(homeId);
  const readRows = await notificationRepo.listReadKeys(userId, homeId);
  const readMap = new Map(readRows.map(row => [row.notification_key, row.read_at]));

  const items = (summary.alerts || [])
    .filter(alert => isAlertVisibleToRole(alert, homeRole))
    .map(alert => {
      const key = buildNotificationKey(alert);
      return {
        key,
        title: alert.module === 'beds' ? 'Home alert' : alert.module.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()),
        message: alert.message,
        severity: alert.type,
        link: alert.link || null,
        module: alert.module,
        priority: alert.priority || 1,
        readAt: readMap.get(key) || null,
        isRead: readMap.has(key),
      };
    })
    .sort((a, b) => (b.priority - a.priority) || a.message.localeCompare(b.message));

  return {
    items,
    unreadCount: items.filter(item => !item.isRead).length,
    generatedAt: new Date().toISOString(),
  };
}

export async function markNotificationsRead({ homeId, userId, keys }) {
  await notificationRepo.markManyRead(userId, homeId, keys);
}
