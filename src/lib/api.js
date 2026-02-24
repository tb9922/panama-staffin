const API_BASE = '/api';

let currentHome = null;

export function setCurrentHome(homeId) {
  currentHome = homeId;
}

export function getCurrentHome() {
  return currentHome;
}

export async function loadHomes() {
  const res = await fetch(`${API_BASE}/homes`);
  if (!res.ok) throw new Error('Failed to load homes');
  return res.json();
}

export async function loadData(homeId) {
  const home = homeId || currentHome;
  const url = home ? `${API_BASE}/data?home=${encodeURIComponent(home)}` : `${API_BASE}/data`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to load data');
  return res.json();
}

export async function saveData(data, homeId) {
  const home = homeId || currentHome;
  const user = getLoggedInUser()?.username || 'unknown';
  const url = home ? `${API_BASE}/data?home=${encodeURIComponent(home)}&user=${encodeURIComponent(user)}` : `${API_BASE}/data?user=${encodeURIComponent(user)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to save data');
  return res.json();
}

export async function login(username, password) {
  const res = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error('Invalid credentials');
  const user = await res.json();
  sessionStorage.setItem('user', JSON.stringify(user));
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
}

export async function loadAuditLog() {
  const res = await fetch(`${API_BASE}/audit`);
  if (!res.ok) return [];
  return res.json();
}
