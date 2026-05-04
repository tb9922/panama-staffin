const API_BASE = '/api';

function getCurrentHome() {
  try {
    return localStorage.getItem('currentHome') || null;
  } catch {
    return null;
  }
}

function getCsrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)panama_csrf=([^;]+)/);
  return match ? match[1] : '';
}

function expireClientSession() {
  try {
    localStorage.removeItem('user');
    localStorage.removeItem('currentHome');
    window.dispatchEvent(new Event('panama:session-expired'));
  } catch {
    /* ignore */
  }
}

async function parseResponse(res) {
  if (res.status === 204) return null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json();
  return res.text();
}

async function apiFetch(url, options = {}) {
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

export async function getEvidenceQuality(filters = {}, { signal } = {}) {
  const home = filters.home || getCurrentHome();
  if (!home) throw new Error('No home selected');
  const params = new URLSearchParams({ home });
  if (filters.domain) params.set('domain', filters.domain);
  if (filters.statement) params.set('statement', filters.statement);
  return apiFetch(`${API_BASE}/evidence-quality?${params.toString()}`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRF-Token': getCsrfToken(),
    },
    signal,
  });
}
