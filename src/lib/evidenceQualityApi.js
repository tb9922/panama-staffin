import { apiFetch, authHeaders } from './api.js';

const API_BASE = '/api';

function getCurrentHome() {
  try {
    return localStorage.getItem('currentHome') || null;
  } catch {
    return null;
  }
}

export async function getEvidenceQuality(filters = {}, { signal } = {}) {
  const home = filters.home || getCurrentHome();
  if (!home) throw new Error('No home selected');
  const params = new URLSearchParams({ home });
  if (filters.domain) params.set('domain', filters.domain);
  if (filters.statement) params.set('statement', filters.statement);
  return apiFetch(`${API_BASE}/evidence-quality?${params.toString()}`, {
    headers: authHeaders(),
    signal,
  });
}
