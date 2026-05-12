import { apiFetch, authHeaders, getCurrentHome } from './api.js';

const API_BASE = '/api/acquisition';

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
