const API_BASE = '/api';

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

function getCsrfToken() {
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

async function homeSetupFetch(url, options = {}) {
  const res = await fetch(url, { credentials: 'same-origin', ...options });
  if (res.status === 401) {
    expireClientSession();
    const err = new Error('Session expired - please log in again');
    err.status = 401;
    throw err;
  }
  const contentType = res.headers.get('content-type') || '';
  const body = async () => {
    if (res.status === 204) return null;
    if (contentType.includes('application/json')) return res.json();
    return res.text();
  };
  if (!res.ok) {
    const parsed = await body().catch(() => null);
    const err = new Error(typeof parsed === 'string' && parsed.trim() ? parsed : parsed?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body();
}

export async function getHomeSetupCompleteness() {
  return homeSetupFetch(`${API_BASE}/home-setup`, { headers: authHeaders() });
}
