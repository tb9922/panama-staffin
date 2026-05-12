import { apiFetch, authHeaders } from './api.js';

const API_BASE = '/api';

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
