const API_BASE = '/api';

function getCsrfToken() {
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

export async function getOperationalReviews(filters = {}, { signal } = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return apiFetch(`${API_BASE}/operational-reviews${qs ? `?${qs}` : ''}`, {
    headers: authHeaders(),
    signal,
  });
}
