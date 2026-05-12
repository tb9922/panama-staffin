import { apiFetch, authHeaders } from './api.js';

const API_BASE = '/api';

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
