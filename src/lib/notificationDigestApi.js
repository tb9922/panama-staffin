import { getCurrentHome } from './api.js';

const API_BASE = '/api';

function getCsrfToken() {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(/(?:^|;\s*)panama_csrf=([^;]+)/);
  return match ? match[1] : '';
}

function clearClientSession() {
  try {
    localStorage.removeItem('user');
    localStorage.removeItem('currentHome');
  } catch {
    /* ignore */
  }
}

function expireClientSession() {
  clearClientSession();
  try {
    window.dispatchEvent(new Event('panama:session-expired'));
  } catch {
    /* ignore */
  }
}

function authHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    'X-CSRF-Token': getCsrfToken(),
    ...extra,
  };
}

async function parseResponse(res) {
  if (res.status === 204) return null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json();
  return res.text();
}

async function digestFetch(url, options = {}) {
  const res = await fetch(url, { credentials: 'same-origin', ...options });
  if (res.status === 401) {
    expireClientSession();
    const err = new Error('Session expired - please log in again');
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const body = await parseResponse(res).catch(() => null);
    const err = new Error(typeof body === 'string' && body.trim() ? body : body?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return parseResponse(res);
}

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
  return digestFetch(`${API_BASE}/notifications/digest?${params.toString()}`, {
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
