import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../repositories/notificationRepo.js', () => ({
  listReadKeys: vi.fn(),
  markManyRead: vi.fn(),
  pruneReadKeys: vi.fn(),
}));

vi.mock('../../shared/roles.js', () => ({
  hasModuleAccess: vi.fn(() => true),
  isOwnDataOnly: vi.fn(() => false),
}));

vi.mock('../../logger.js', () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../services/dashboardService.js', async () => {
  const actual = await vi.importActual('../../services/dashboardService.js');
  return {
    ...actual,
    getDashboardSummary: vi.fn(),
  };
});

import logger from '../../logger.js';
import * as notificationRepo from '../../repositories/notificationRepo.js';
import * as dashboardService from '../../services/dashboardService.js';
import {
  _ALERT_MODULE_TO_PERMISSION,
  _buildLegacyNotificationKey,
  _buildNotificationKey,
  listNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
} from '../../services/notificationService.js';

const CLEAN_MODULES = {
  incidents: { open: 0, cqcOverdue: 0, riddorOverdue: 0, docOverdue: 0, overdueActions: 0 },
  complaints: { open: 0, unacknowledged: 0, overdueResponse: 0 },
  maintenance: { total: 0, overdue: 0, dueSoon: 0, expiredCerts: 0, compliancePct: 100 },
  training: { expired: 0, expiringSoon: 0 },
  supervisions: { overdue: 0, dueSoon: 0, noRecord: 0 },
  appraisals: { overdue: 0, dueSoon: 0, noRecord: 0 },
  fireDrills: { lastDate: null, drillsThisYear: 4, overdue: false },
  ipc: { activeOutbreaks: 0, overdueActions: 0, latestScore: null },
  risks: { total: 0, critical: 0, overdueReviews: 0, overdueActions: 0 },
  policies: { total: 0, overdue: 0, dueSoon: 0, compliancePct: 100 },
  whistleblowing: { open: 0, unacknowledged: 0 },
  dols: { active: 0, expiringSoon: 0, overdueReviews: 0 },
  careCertificate: { inProgress: 0, overdue: 0 },
  beds: { total: 30, occupied: 28, available: 2, hospitalHold: 0, occupancyRate: 93, hospitalHoldExpiring: 0, staleReservations: 0, residentBedMismatch: 0 },
};

describe('notificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationRepo.listReadKeys.mockResolvedValue([]);
    notificationRepo.markManyRead.mockResolvedValue();
    notificationRepo.pruneReadKeys.mockResolvedValue();
  });

  it('treats legacy read keys as read after stable alert ids are introduced', async () => {
    const alert = {
      id: 'care_certificate.overdue',
      module: 'careCertificate',
      message: '2 overdue Care Certificate(s)',
      link: '/care-cert',
      type: 'warning',
      priority: 3,
    };
    dashboardService.getDashboardSummary.mockResolvedValue({ alerts: [alert], _degraded: false });
    notificationRepo.listReadKeys.mockResolvedValue([
      { notification_key: _buildLegacyNotificationKey(alert), read_at: '2026-04-20T09:00:00Z' },
    ]);

    const result = await listNotifications({ homeId: 1, homeRole: 'home_manager', userId: 5 });

    expect(result.unreadCount).toBe(0);
    expect(result.items[0]).toMatchObject({
      key: _buildNotificationKey(alert),
      title: 'Care Certificate',
      isRead: true,
    });
  });

  it('marks all currently unread visible notifications as read and prunes old rows', async () => {
    const alerts = [
      { id: 'training.expired', module: 'training', message: '2 expired training record(s)', link: '/training', type: 'warning', priority: 3 },
      { id: 'incidents.open', module: 'incidents', message: '1 open investigation(s)', link: '/incidents', type: 'warning', priority: 3 },
    ];
    dashboardService.getDashboardSummary.mockResolvedValue({ alerts, _degraded: false });
    notificationRepo.listReadKeys.mockResolvedValue([
      { notification_key: _buildNotificationKey(alerts[0]), read_at: '2026-04-20T09:00:00Z' },
    ]);

    await markAllNotificationsRead({ homeId: 1, homeRole: 'home_manager', userId: 7 });

    expect(notificationRepo.markManyRead).toHaveBeenCalledWith(7, 1, [_buildNotificationKey(alerts[1])]);
    expect(notificationRepo.pruneReadKeys).toHaveBeenCalledWith(7, 1);
  });

  it('prunes old rows after marking explicit notifications as read', async () => {
    await markNotificationsRead({ homeId: 3, userId: 9, keys: ['0123456789abcdefabcd'] });

    expect(notificationRepo.markManyRead).toHaveBeenCalledWith(9, 3, ['0123456789abcdefabcd']);
    expect(notificationRepo.pruneReadKeys).toHaveBeenCalledWith(9, 3);
  });

  it('falls back to an empty degraded feed when dashboard summary generation fails', async () => {
    dashboardService.getDashboardSummary.mockRejectedValue(new Error('dashboard down'));

    const result = await listNotifications({ homeId: 1, homeRole: 'home_manager', userId: 5 });

    expect(result).toMatchObject({ items: [], unreadCount: 0, degraded: true });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('covers every current dashboard alert module in the permission allowlist', async () => {
    const { _buildAlerts: buildAlerts } = await vi.importActual('../../services/dashboardService.js');
    const alerts = buildAlerts({
      ...CLEAN_MODULES,
      incidents: { open: 1, cqcOverdue: 1, riddorOverdue: 1, docOverdue: 1, overdueActions: 1 },
      complaints: { open: 0, unacknowledged: 1, overdueResponse: 1 },
      maintenance: { total: 0, overdue: 1, dueSoon: 1, expiredCerts: 1, compliancePct: 50 },
      training: { expired: 1, expiringSoon: 1 },
      supervisions: { overdue: 1, dueSoon: 1, noRecord: 1 },
      appraisals: { overdue: 1, dueSoon: 1, noRecord: 1 },
      fireDrills: { lastDate: null, drillsThisYear: 1, overdue: true },
      ipc: { activeOutbreaks: 1, overdueActions: 1, latestScore: 60 },
      risks: { total: 0, critical: 1, overdueReviews: 1, overdueActions: 1 },
      policies: { total: 0, overdue: 1, dueSoon: 1, compliancePct: 90 },
      whistleblowing: { open: 1, unacknowledged: 1 },
      dols: { active: 0, expiringSoon: 1, overdueReviews: 1 },
      careCertificate: { inProgress: 0, overdue: 1 },
      beds: { total: 30, occupied: 20, available: 10, hospitalHold: 0, occupancyRate: 75, hospitalHoldExpiring: 1, staleReservations: 1, residentBedMismatch: 1 },
    });

    for (const alert of alerts) {
      expect(_ALERT_MODULE_TO_PERMISSION[alert.module]).toBeTruthy();
    }
  });
});
