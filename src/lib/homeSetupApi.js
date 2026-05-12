import { apiFetch, authHeaders } from './api.js';

const API_BASE = '/api';

export async function getHomeSetupCompleteness() {
  return apiFetch(`${API_BASE}/home-setup`, { headers: authHeaders() });
}
