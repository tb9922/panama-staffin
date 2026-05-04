import { getCurrentHome } from './api.js';

const API_BASE = '/api/acquisition';

function getCsrfToken() {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(/(?:^|;\s*)panama_csrf=([^;]+)/);
  return match ? match[1] : '';
}

function authHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    'X-CSRF-Token': getCsrfToken(),
    ...extra,
  };
}

function expireClientSession() {
  try {
    localStorage.removeItem('user');
    localStorage.removeItem('currentHome');
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event('panama:session-expired'));
  } catch {
    /* ignore */
  }
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, { credentials: 'same-origin', ...options });
  if (res.status === 401) {
    expireClientSession();
    const err = new Error('Session expired - please log in again');
    err.status = 401;
    throw err;
  }
  const contentType = res.headers.get('content-type') || '';
  const parseBody = async () => {
    if (res.status === 204) return null;
    if (contentType.includes('application/json')) return res.json();
    return res.text();
  };
  if (!res.ok) {
    const body = await parseBody().catch(() => null);
    const err = new Error(typeof body === 'string' && body.trim() ? body : body?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return parseBody();
}

const h = homeSlug => encodeURIComponent(homeSlug);

export async function getAcquisitionChecklist(homeSlug = getCurrentHome(), filters = {}) {
  const params = new URLSearchParams({ home: homeSlug });
  if (filters.status) params.set('status', filters.status);
  if (filters.item_key) params.set('item_key', filters.item_key);
  return apiFetch(`${API_BASE}?${params.toString()}`, { headers: authHeaders() });
}

export async function getAcquisitionItem(homeSlug = getCurrentHome(), id) {
  return apiFetch(`${API_BASE}/${encodeURIComponent(id)}?home=${h(homeSlug)}`, { headers: authHeaders() });
}

export async function initializeAcquisitionChecklist(homeSlug = getCurrentHome()) {
  return apiFetch(`${API_BASE}/initialize?home=${h(homeSlug)}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({}),
  });
}

export async function createAcquisitionItem(homeSlug = getCurrentHome(), payload) {
  return apiFetch(`${API_BASE}?home=${h(homeSlug)}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function updateAcquisitionItem(homeSlug = getCurrentHome(), id, payload) {
  return apiFetch(`${API_BASE}/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function deleteAcquisitionItem(homeSlug = getCurrentHome(), id, payload = {}) {
  return apiFetch(`${API_BASE}/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'DELETE',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
}
