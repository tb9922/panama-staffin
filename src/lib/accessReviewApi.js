const API_BASE = '/api';

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

async function parseResponse(res) {
  if (res.status === 204) return null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json();
  return res.text();
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, { credentials: 'same-origin', ...options });
  if (!res.ok) {
    const body = await parseResponse(res).catch(() => null);
    throw new Error(typeof body === 'string' && body.trim() ? body : body?.error || `Request failed (${res.status})`);
  }
  return parseResponse(res);
}

function queryString(filters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function listAccessReviews(filters = {}, { signal } = {}) {
  return apiFetch(`${API_BASE}/access-reviews${queryString(filters)}`, {
    headers: authHeaders(),
    signal,
  });
}

export function startAccessReview(payload, { signal } = {}) {
  return apiFetch(`${API_BASE}/access-reviews`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload || {}),
    signal,
  });
}

export function getAccessReview(reviewId, filters = {}, { signal } = {}) {
  return apiFetch(`${API_BASE}/access-reviews/${reviewId}${queryString(filters)}`, {
    headers: authHeaders(),
    signal,
  });
}

export function updateAccessReviewAssignment(reviewId, assignmentId, payload, { signal } = {}) {
  return apiFetch(`${API_BASE}/access-reviews/${reviewId}/assignments/${assignmentId}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify(payload || {}),
    signal,
  });
}

export function completeAccessReview(reviewId, { signal } = {}) {
  return apiFetch(`${API_BASE}/access-reviews/${reviewId}/complete`, {
    method: 'POST',
    headers: authHeaders(),
    signal,
  });
}
