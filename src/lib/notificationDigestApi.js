import { apiFetch, authHeaders, getCurrentHome } from './api.js';

const API_BASE = '/api';

function resolveHome(homeSlug) {
  const home = homeSlug || getCurrentHome();
  if (!home) throw new Error('No home selected');
  return home;
}

export async function getNotificationDigest({ homeSlug, period = 'daily', limit = 100, signal } = {}) {
  const home = resolveHome(homeSlug);
  const params = new URLSearchParams({
    home,
    period,
    limit: String(limit),
  });
  return apiFetch(`${API_BASE}/notifications/digest?${params.toString()}`, {
    headers: authHeaders(),
    signal,
  });
}

export async function getDailyNotificationDigest(options = {}) {
  return getNotificationDigest({ ...options, period: 'daily' });
}

export async function getWeeklyNotificationDigest(options = {}) {
  return getNotificationDigest({ ...options, period: 'weekly' });
}
