const API_BASE = '/api';

let currentHome = null;

export function setCurrentHome(homeId) {
  currentHome = homeId;
}

export function getCurrentHome() {
  return currentHome;
}

function getToken() {
  try { return sessionStorage.getItem('token') || ''; } catch { return ''; }
}

function authHeaders(extra = {}) {
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}`, ...extra };
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    const err = new Error('Session expired — please log in again');
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export async function loadHomes() {
  return apiFetch(`${API_BASE}/homes`, { headers: authHeaders() });
}

export async function loadData(homeId) {
  const home = homeId || currentHome;
  const url = home ? `${API_BASE}/data?home=${encodeURIComponent(home)}` : `${API_BASE}/data`;
  return apiFetch(url, { headers: authHeaders() });
}

export async function saveData(data, homeId) {
  const home = homeId || currentHome;
  const url = home ? `${API_BASE}/data?home=${encodeURIComponent(home)}` : `${API_BASE}/data`;
  return apiFetch(url, { method: 'POST', headers: authHeaders(), body: JSON.stringify(data) });
}

export async function login(username, password) {
  const res = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error('Invalid credentials');
  const user = await res.json();
  sessionStorage.setItem('user', JSON.stringify({ username: user.username, role: user.role }));
  sessionStorage.setItem('token', user.token);
  return user;
}

export function getLoggedInUser() {
  try {
    const stored = sessionStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export function logout() {
  sessionStorage.removeItem('user');
  sessionStorage.removeItem('token');
}

export async function loadAuditLog(limit = 100) {
  return apiFetch(`${API_BASE}/audit?limit=${limit}`, { headers: authHeaders() });
}

export async function getHandoverEntries(homeSlug, date) {
  return apiFetch(`${API_BASE}/handover?home=${encodeURIComponent(homeSlug)}&date=${date}`, { headers: authHeaders() });
}

export async function createHandoverEntry(homeSlug, entry) {
  return apiFetch(`${API_BASE}/handover?home=${encodeURIComponent(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(entry),
  });
}

export async function updateHandoverEntry(homeSlug, id, updates) {
  return apiFetch(`${API_BASE}/handover/${encodeURIComponent(id)}?home=${encodeURIComponent(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(updates),
  });
}

export async function deleteHandoverEntry(homeSlug, id) {
  return apiFetch(`${API_BASE}/handover/${encodeURIComponent(id)}?home=${encodeURIComponent(homeSlug)}`, {
    method: 'DELETE', headers: authHeaders(),
  });
}

export async function acknowledgeHandoverEntry(homeSlug, id) {
  return apiFetch(`${API_BASE}/handover/${encodeURIComponent(id)}/acknowledge?home=${encodeURIComponent(homeSlug)}`, {
    method: 'POST', headers: authHeaders(),
  });
}
