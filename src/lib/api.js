import { clearSchedulingEditLockState } from './schedulingEditLock.js'

const API_BASE = '/api';

let currentHome = null;

export function setCurrentHome(homeId) {
  currentHome = homeId;
}

export function getCurrentHome() {
  return currentHome;
}

function clearClientSession() {
  currentHome = null;
  try {
    localStorage.removeItem('user');
    localStorage.removeItem('currentHome');
  } catch {
    /* ignore */
  }
  clearSchedulingEditLockState();
}

function expireClientSession() {
  clearClientSession();
  if (typeof window !== 'undefined') {
    window.location.assign('/');
  }
}

function getCsrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)panama_csrf=([^;]+)/);
  return match ? match[1] : '';
}

function authHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest', // Defense-in-depth: blocks simple cross-site requests
    'X-CSRF-Token': getCsrfToken(),       // Double-submit CSRF token from cookie
    ...extra,
  };
}

function requireHomeSlug(homeSlug) {
  if (homeSlug == null || String(homeSlug).trim() === '') {
    throw new Error('No home selected');
  }
  return String(homeSlug);
}

const h = (homeSlug) => encodeURIComponent(requireHomeSlug(homeSlug));

function homeQueryParams(homeSlug, extra = {}) {
  const params = new URLSearchParams({ home: requireHomeSlug(homeSlug) });
  for (const [key, value] of Object.entries(extra)) {
    if (value == null || value === '') continue;
    params.set(key, String(value));
  }
  return params;
}

async function readResponseBody(res) {
  if (res.status === 204) return null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function readErrorBody(res) {
  const body = await readResponseBody(res);
  if (body && typeof body === 'object') return body;
  if (typeof body === 'string' && body.trim()) return { error: body.trim() };
  return {};
}

async function uploadMultipart(url, formData) {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRF-Token': getCsrfToken(),
    },
    body: formData,
  });
  if (res.status === 401) {
    expireClientSession();
    const err = new Error('Session expired - please log in again');
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const body = await readErrorBody(res);
    const err = new Error(body.error || `Upload failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return readResponseBody(res);
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, { credentials: 'same-origin', ...options });
  if (res.status === 401) {
    const err = new Error('Session expired — please log in again');
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const body = await readErrorBody(res);
    const err = new Error(body.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return readResponseBody(res);
}

async function downloadBinary(url, originalName) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRF-Token': getCsrfToken(),
    },
  });
  if (res.status === 401) {
    const err = new Error('Session expired — please log in again');
    err.status = 401;
    throw err;
  }
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = originalName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(objectUrl);
}

export async function downloadAuthenticatedFile(url, originalName) {
  return downloadBinary(url, originalName);
}

export function isAbortLikeError(err, signal) {
  if (signal?.aborted) return true;
  if (!err) return false;
  if (err.name === 'AbortError') return true;
  if (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') return true;
  return false;
}

export async function loadHomes() {
  return apiFetch(`${API_BASE}/homes`, { headers: authHeaders() });
}

export async function login(username, password) {
  const res = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error('Invalid credentials');
  const user = await res.json();
  // JWT is now in HttpOnly cookie (set by server) — only store display info
  localStorage.setItem('user', JSON.stringify({ username: user.username, role: user.role, displayName: user.displayName || '', isPlatformAdmin: user.isPlatformAdmin || false }));
  return user;
}

export function getLoggedInUser() {
  try {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export async function logout(options = {}) {
  const { forceLocal = false } = options;
  try {
    await apiFetch(`${API_BASE}/login/logout`, {
      method: 'POST',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-Token': getCsrfToken(),
      },
    });
    clearClientSession();
    return { ok: true };
  } catch (err) {
    if (forceLocal || err.status === 401) {
      clearClientSession();
      return { ok: false, localOnly: true };
    }
    throw err;
  }
}

export async function loadAuditLog(options = 100) {
  const legacyLimit = typeof options === 'number' ? options : null;
  const params = new URLSearchParams();
  params.set('limit', String(legacyLimit ?? options.limit ?? 100));
  params.set('offset', String(options.offset ?? 0));
  if (options.home) params.set('home', options.home);
  if (options.action) params.set('action', options.action);
  if (options.user) params.set('user', options.user);
  if (options.dateFrom) params.set('dateFrom', options.dateFrom);
  if (options.dateTo) params.set('dateTo', options.dateTo);
  return apiFetch(`${API_BASE}/audit?${params.toString()}`, { headers: authHeaders() });
}

export async function listNotifications() {
  const home = getCurrentHome();
  return apiFetch(`${API_BASE}/notifications?home=${h(home)}`, { headers: authHeaders() });
}

export async function markNotificationsRead(keys) {
  const home = getCurrentHome();
  return apiFetch(`${API_BASE}/notifications/read?home=${h(home)}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ keys }),
  });
}

export async function markAllNotificationsRead(keys) {
  const home = getCurrentHome();
  return apiFetch(`${API_BASE}/notifications/read-all?home=${h(home)}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ keys }),
  });
}

export async function searchEvidenceHub({ q, uploadedBy, dateFrom, dateTo, modules, limit = 50, offset = 0 } = {}) {
  const home = getCurrentHome();
  const params = homeQueryParams(home, { limit, offset });
  if (q) params.set('q', q);
  if (uploadedBy) params.set('uploadedBy', uploadedBy);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  if (modules?.length) params.set('modules', modules.join(','));
  return apiFetch(`${API_BASE}/evidence-hub/search?${params.toString()}`, { headers: authHeaders() });
}

export async function listEvidenceHubUploaders() {
  const home = getCurrentHome();
  return apiFetch(`${API_BASE}/evidence-hub/uploaders?home=${h(home)}`, {
    headers: authHeaders(),
  });
}

export function getEvidenceHubDownloadUrl(sourceModule, attachmentId) {
  const home = getCurrentHome();
  switch (sourceModule) {
    case 'hr':
      return `${API_BASE}/hr/attachments/download/${attachmentId}?home=${h(home)}`;
    case 'cqc_evidence':
      return `${API_BASE}/cqc-evidence/files/${attachmentId}/download?home=${h(home)}`;
    case 'onboarding':
      return `${API_BASE}/onboarding/files/${attachmentId}/download?home=${h(home)}`;
    case 'training':
      return `${API_BASE}/training/files/${attachmentId}/download?home=${h(home)}`;
    case 'record':
      return `${API_BASE}/record-attachments/download/${attachmentId}?home=${h(home)}`;
    default:
      throw new Error(`Unsupported evidence source: ${sourceModule}`);
  }
}

function getEvidenceHubDeleteUrl(sourceModule, attachmentId) {
  const home = getCurrentHome();
  switch (sourceModule) {
    case 'hr':
      return `${API_BASE}/hr/attachments/${attachmentId}?home=${h(home)}`;
    case 'cqc_evidence':
      return `${API_BASE}/cqc-evidence/files/${attachmentId}?home=${h(home)}`;
    case 'onboarding':
      return `${API_BASE}/onboarding/files/${attachmentId}?home=${h(home)}`;
    case 'training':
      return `${API_BASE}/training/files/${attachmentId}?home=${h(home)}`;
    case 'record':
      return `${API_BASE}/record-attachments/${attachmentId}?home=${h(home)}`;
    default:
      throw new Error(`Unsupported evidence source: ${sourceModule}`);
  }
}

export async function deleteEvidenceHubAttachment(sourceModule, attachmentId) {
  return apiFetch(getEvidenceHubDeleteUrl(sourceModule, attachmentId), {
    method: 'DELETE',
    headers: authHeaders(),
  });
}

export async function getHandoverEntries(homeSlug, date) {
  return apiFetch(`${API_BASE}/handover?home=${h(homeSlug)}&date=${date}`, { headers: authHeaders() });
}

export async function getHandoverEntriesByRange(homeSlug, { fromDate, toDate, limit = 100, offset = 0 } = {}) {
  const params = new URLSearchParams({
    home: h(homeSlug),
    from: fromDate,
    to: toDate,
    limit: String(limit),
    offset: String(offset),
  });
  return apiFetch(`${API_BASE}/handover/range?${params.toString()}`, { headers: authHeaders() });
}

export async function createHandoverEntry(homeSlug, entry) {
  return apiFetch(`${API_BASE}/handover?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(entry),
  });
}

export async function updateHandoverEntry(homeSlug, id, updates) {
  return apiFetch(`${API_BASE}/handover/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(updates),
  });
}

export async function deleteHandoverEntry(homeSlug, id, version) {
  return apiFetch(`${API_BASE}/handover/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'DELETE', headers: authHeaders(), body: JSON.stringify({ _version: version }),
  });
}

export async function acknowledgeHandoverEntry(homeSlug, id) {
  return apiFetch(`${API_BASE}/handover/${encodeURIComponent(id)}/acknowledge?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(),
  });
}

// ── Incidents ────────────────────────────────────────────────────────────────

export async function getIncidents(homeSlug, options = {}) {
  return apiFetch(`${API_BASE}/incidents?home=${h(homeSlug)}`, { headers: authHeaders(), ...options });
}

export async function createIncident(homeSlug, data) {
  return apiFetch(`${API_BASE}/incidents?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function updateIncident(homeSlug, id, data) {
  return apiFetch(`${API_BASE}/incidents/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function deleteIncident(homeSlug, id) {
  return apiFetch(`${API_BASE}/incidents/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'DELETE', headers: authHeaders(),
  });
}

export async function freezeIncident(homeSlug, incidentId) {
  return apiFetch(`${API_BASE}/incidents/${encodeURIComponent(incidentId)}/freeze?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(),
  });
}

export async function getIncidentAddenda(homeSlug, incidentId) {
  return apiFetch(`${API_BASE}/incidents/${encodeURIComponent(incidentId)}/addenda?home=${h(homeSlug)}`, {
    headers: authHeaders(),
  });
}

export async function addIncidentAddendum(homeSlug, incidentId, content) {
  return apiFetch(`${API_BASE}/incidents/${encodeURIComponent(incidentId)}/addenda?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ content }),
  });
}

// ── Complaints ───────────────────────────────────────────────────────────────

export async function getComplaints(homeSlug, options = {}) {
  return apiFetch(`${API_BASE}/complaints?home=${h(homeSlug)}`, { headers: authHeaders(), ...options });
}

export async function createComplaint(homeSlug, data) {
  return apiFetch(`${API_BASE}/complaints?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function updateComplaint(homeSlug, id, data) {
  return apiFetch(`${API_BASE}/complaints/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function deleteComplaint(homeSlug, id) {
  return apiFetch(`${API_BASE}/complaints/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'DELETE', headers: authHeaders(),
  });
}

export async function createComplaintSurvey(homeSlug, data) {
  return apiFetch(`${API_BASE}/complaints/surveys?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function updateComplaintSurvey(homeSlug, id, data) {
  return apiFetch(`${API_BASE}/complaints/surveys/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function deleteComplaintSurvey(homeSlug, id) {
  return apiFetch(`${API_BASE}/complaints/surveys/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'DELETE', headers: authHeaders(),
  });
}

// ── Maintenance ──────────────────────────────────────────────────────────────

export async function getMaintenance(homeSlug, options = {}) {
  return apiFetch(`${API_BASE}/maintenance?home=${h(homeSlug)}`, { headers: authHeaders(), ...options });
}

export async function createMaintenanceCheck(homeSlug, data) {
  return apiFetch(`${API_BASE}/maintenance?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function updateMaintenanceCheck(homeSlug, id, data) {
  return apiFetch(`${API_BASE}/maintenance/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function deleteMaintenanceCheck(homeSlug, id) {
  return apiFetch(`${API_BASE}/maintenance/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'DELETE', headers: authHeaders(),
  });
}

// ── IPC Audits ───────────────────────────────────────────────────────────────

export async function getIpcAudits(homeSlug, options = {}) {
  return apiFetch(`${API_BASE}/ipc?home=${h(homeSlug)}`, { headers: authHeaders(), ...options });
}

export async function createIpcAudit(homeSlug, data) {
  return apiFetch(`${API_BASE}/ipc?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function updateIpcAudit(homeSlug, id, data) {
  return apiFetch(`${API_BASE}/ipc/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function deleteIpcAudit(homeSlug, id) {
  return apiFetch(`${API_BASE}/ipc/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'DELETE', headers: authHeaders(),
  });
}

// ── Risk Register ─────────────────────────────────────────────────────────────

export async function getRisks(homeSlug, options = {}) {
  return apiFetch(`${API_BASE}/risk-register?home=${h(homeSlug)}`, { headers: authHeaders(), ...options });
}

export async function createRisk(homeSlug, data) {
  return apiFetch(`${API_BASE}/risk-register?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function updateRisk(homeSlug, id, data) {
  return apiFetch(`${API_BASE}/risk-register/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function deleteRisk(homeSlug, id) {
  return apiFetch(`${API_BASE}/risk-register/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'DELETE', headers: authHeaders(),
  });
}

// ── Policies ─────────────────────────────────────────────────────────────────

export async function getPolicies(homeSlug, options = {}) {
  return apiFetch(`${API_BASE}/policies?home=${h(homeSlug)}`, { headers: authHeaders(), ...options });
}

export async function createPolicy(homeSlug, data) {
  return apiFetch(`${API_BASE}/policies?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function updatePolicy(homeSlug, id, data) {
  return apiFetch(`${API_BASE}/policies/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function deletePolicy(homeSlug, id) {
  return apiFetch(`${API_BASE}/policies/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'DELETE', headers: authHeaders(),
  });
}

// ── Whistleblowing ───────────────────────────────────────────────────────────

export async function getWhistleblowingConcerns(homeSlug, options = {}) {
  return apiFetch(`${API_BASE}/whistleblowing?home=${h(homeSlug)}`, { headers: authHeaders(), ...options });
}

export async function createWhistleblowingConcern(homeSlug, data) {
  return apiFetch(`${API_BASE}/whistleblowing?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function updateWhistleblowingConcern(homeSlug, id, data) {
  return apiFetch(`${API_BASE}/whistleblowing/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function deleteWhistleblowingConcern(homeSlug, id) {
  return apiFetch(`${API_BASE}/whistleblowing/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'DELETE', headers: authHeaders(),
  });
}

// ── DoLS & MCA ───────────────────────────────────────────────────────────────

export async function getDols(homeSlug, options = {}) {
  return apiFetch(`${API_BASE}/dols?home=${h(homeSlug)}`, { headers: authHeaders(), ...options });
}

export async function createDols(homeSlug, data) {
  return apiFetch(`${API_BASE}/dols?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function updateDols(homeSlug, id, data) {
  return apiFetch(`${API_BASE}/dols/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function deleteDols(homeSlug, id) {
  return apiFetch(`${API_BASE}/dols/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'DELETE', headers: authHeaders(),
  });
}

export async function createMcaAssessment(homeSlug, data) {
  return apiFetch(`${API_BASE}/dols/mca?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function updateMcaAssessment(homeSlug, id, data) {
  return apiFetch(`${API_BASE}/dols/mca/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function deleteMcaAssessment(homeSlug, id) {
  return apiFetch(`${API_BASE}/dols/mca/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'DELETE', headers: authHeaders(),
  });
}

// ── CQC Evidence ─────────────────────────────────────────────────────────────

export async function getCqcEvidence(homeSlug, options = {}) {
  return apiFetch(`${API_BASE}/cqc-evidence?home=${h(homeSlug)}`, { headers: authHeaders(), ...options });
}

export async function createCqcEvidence(homeSlug, data) {
  return apiFetch(`${API_BASE}/cqc-evidence?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function updateCqcEvidence(homeSlug, id, data) {
  return apiFetch(`${API_BASE}/cqc-evidence/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function deleteCqcEvidence(homeSlug, id) {
  return apiFetch(`${API_BASE}/cqc-evidence/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'DELETE', headers: authHeaders(),
  });
}

export async function getCqcNarratives(homeSlug) {
  return apiFetch(`${API_BASE}/cqc-evidence/narratives?home=${h(homeSlug)}`, { headers: authHeaders() });
}

export async function getCqcReadiness(homeSlug, dateRange = 28, signal) {
  return apiFetch(`${API_BASE}/cqc-evidence/readiness?home=${h(homeSlug)}&dateRange=${encodeURIComponent(dateRange)}`, {
    headers: authHeaders(),
    signal,
  });
}

export async function upsertCqcNarrative(homeSlug, statementId, data) {
  return apiFetch(`${API_BASE}/cqc-evidence/narratives/${encodeURIComponent(statementId)}?home=${h(homeSlug)}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
}

// ── Token Revocation ────────────────────────────────────────────────────────

export async function getCqcPartnerFeedback(homeSlug) {
  return apiFetch(`${API_BASE}/cqc-evidence/partner-feedback?home=${h(homeSlug)}`, { headers: authHeaders() });
}

export async function createCqcPartnerFeedback(homeSlug, data) {
  return apiFetch(`${API_BASE}/cqc-evidence/partner-feedback?home=${h(homeSlug)}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
}

export async function updateCqcPartnerFeedback(homeSlug, id, data) {
  return apiFetch(`${API_BASE}/cqc-evidence/partner-feedback/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
}

export async function deleteCqcPartnerFeedback(homeSlug, id) {
  return apiFetch(`${API_BASE}/cqc-evidence/partner-feedback/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
}

export async function getCqcObservations(homeSlug) {
  return apiFetch(`${API_BASE}/cqc-evidence/observations?home=${h(homeSlug)}`, { headers: authHeaders() });
}

export async function createCqcObservation(homeSlug, data) {
  return apiFetch(`${API_BASE}/cqc-evidence/observations?home=${h(homeSlug)}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
}

export async function updateCqcObservation(homeSlug, id, data) {
  return apiFetch(`${API_BASE}/cqc-evidence/observations/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
}

export async function deleteCqcObservation(homeSlug, id) {
  return apiFetch(`${API_BASE}/cqc-evidence/observations/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
}

export async function getCqcEvidenceLinks(homeSlug, { statement, dateFrom, dateTo, limit = 50, offset = 0 } = {}) {
  const params = homeQueryParams(homeSlug, { limit, offset });
  if (statement) params.set('statement', statement);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  return apiFetch(`${API_BASE}/cqc-evidence-links?${params.toString()}`, { headers: authHeaders() });
}

export async function getCqcEvidenceLinksBySource(homeSlug, sourceModule, sourceId) {
  return apiFetch(
    `${API_BASE}/cqc-evidence-links/source/${encodeURIComponent(sourceModule)}/${encodeURIComponent(sourceId)}?home=${h(homeSlug)}`,
    { headers: authHeaders() }
  );
}

export async function getCqcEvidenceLinkCounts(homeSlug, { dateFrom, dateTo } = {}) {
  const params = homeQueryParams(homeSlug);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  return apiFetch(`${API_BASE}/cqc-evidence-links/counts?${params.toString()}`, { headers: authHeaders() });
}

export async function createCqcEvidenceLink(homeSlug, data) {
  return apiFetch(`${API_BASE}/cqc-evidence-links?home=${h(homeSlug)}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
}

export async function createBulkCqcEvidenceLinks(homeSlug, links) {
  return apiFetch(`${API_BASE}/cqc-evidence-links/bulk?home=${h(homeSlug)}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ links }),
  });
}

export async function updateCqcEvidenceLink(homeSlug, id, data) {
  return apiFetch(`${API_BASE}/cqc-evidence-links/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
}

export async function deleteCqcEvidenceLink(homeSlug, id) {
  return apiFetch(`${API_BASE}/cqc-evidence-links/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
}

export async function confirmCqcEvidenceLink(homeSlug, id) {
  return apiFetch(`${API_BASE}/cqc-evidence-links/${encodeURIComponent(id)}/confirm?home=${h(homeSlug)}`, {
    method: 'POST',
    headers: authHeaders(),
  });
}

export async function confirmBulkCqcEvidenceLinks(homeSlug, ids) {
  return apiFetch(`${API_BASE}/cqc-evidence-links/confirm-bulk?home=${h(homeSlug)}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ ids }),
  });
}

export async function getCqcEvidenceFiles(_caseType, evidenceId) {
  const home = getCurrentHome();
  return apiFetch(`${API_BASE}/cqc-evidence/${encodeURIComponent(evidenceId)}/files?home=${h(home)}`, {
    headers: authHeaders(),
  });
}

export async function uploadCqcEvidenceFile(_caseType, evidenceId, file, description) {
  const home = getCurrentHome();
  const formData = new FormData();
  formData.append('file', file);
  if (description) formData.append('description', description);
  return uploadMultipart(`${API_BASE}/cqc-evidence/${encodeURIComponent(evidenceId)}/files?home=${h(home)}`, formData);
}

export async function deleteCqcEvidenceFile(id) {
  const home = getCurrentHome();
  return apiFetch(`${API_BASE}/cqc-evidence/files/${id}?home=${h(home)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
}

export async function downloadCqcEvidenceFile(id, originalName) {
  const home = getCurrentHome();
  return downloadBinary(`${API_BASE}/cqc-evidence/files/${id}/download?home=${h(home)}`, originalName);
}

export async function revokeUserTokens(username) {
  return apiFetch(`${API_BASE}/login/revoke`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ username }),
  });
}

// ── Payroll API ───────────────────────────────────────────────────────────────

// Pay rate rules
export async function getPayRateRules(homeSlug) {
  return apiFetch(`${API_BASE}/payroll/rates?home=${h(homeSlug)}`, { headers: authHeaders() });
}
export async function createPayRateRule(homeSlug, rule) {
  return apiFetch(`${API_BASE}/payroll/rates?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(rule),
  });
}
export async function updatePayRateRule(homeSlug, ruleId, rule) {
  return apiFetch(`${API_BASE}/payroll/rates/${ruleId}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(rule),
  });
}
export async function deletePayRateRule(homeSlug, ruleId) {
  return apiFetch(`${API_BASE}/payroll/rates/${ruleId}?home=${h(homeSlug)}`, {
    method: 'DELETE', headers: authHeaders(),
  });
}
export async function getNMWRates() {
  return apiFetch(`${API_BASE}/payroll/nmw`, { headers: authHeaders() });
}

// Timesheets
export async function getTimesheets(homeSlug, date) {
  return apiFetch(`${API_BASE}/payroll/timesheets?home=${h(homeSlug)}&date=${date}`, { headers: authHeaders() });
}
export async function getTimesheetPeriod(homeSlug, start, end, status, staffId) {
  const statusQ = status ? `&status=${status}` : '';
  const staffQ = staffId ? `&staff_id=${staffId}` : '';
  return apiFetch(`${API_BASE}/payroll/timesheets/period?home=${h(homeSlug)}&start=${start}&end=${end}${statusQ}${staffQ}`, { headers: authHeaders() });
}
export async function upsertTimesheet(homeSlug, entry) {
  return apiFetch(`${API_BASE}/payroll/timesheets?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(entry),
  });
}
export async function approveTimesheet(homeSlug, id) {
  return apiFetch(`${API_BASE}/payroll/timesheets/${id}/approve?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(),
  });
}
export async function disputeTimesheet(homeSlug, id, reason) {
  return apiFetch(`${API_BASE}/payroll/timesheets/${id}/dispute?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ reason }),
  });
}
export async function bulkApproveTimesheets(homeSlug, date) {
  return apiFetch(`${API_BASE}/payroll/timesheets/bulk-approve?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ date }),
  });
}
export async function batchUpsertTimesheets(homeSlug, entries) {
  return apiFetch(`${API_BASE}/payroll/timesheets/batch-upsert?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ entries }),
  });
}
export async function approveTimesheetRange(homeSlug, staffId, start, end) {
  return apiFetch(`${API_BASE}/payroll/timesheets/approve-range?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ staff_id: staffId, start, end }),
  });
}

// Payroll runs
export async function getPayrollRuns(homeSlug) {
  return apiFetch(`${API_BASE}/payroll/runs?home=${h(homeSlug)}`, { headers: authHeaders() });
}
export async function createPayrollRun(homeSlug, run) {
  return apiFetch(`${API_BASE}/payroll/runs?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(run),
  });
}
export async function getPayrollRun(homeSlug, runId) {
  return apiFetch(`${API_BASE}/payroll/runs/${runId}?home=${h(homeSlug)}`, { headers: authHeaders() });
}
export async function calculatePayrollRun(homeSlug, runId) {
  return apiFetch(`${API_BASE}/payroll/runs/${runId}/calculate?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(),
  });
}
export async function approvePayrollRun(homeSlug, runId) {
  return apiFetch(`${API_BASE}/payroll/runs/${runId}/approve?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(),
  });
}
export async function voidPayrollRun(homeSlug, runId) {
  return apiFetch(`${API_BASE}/payroll/runs/${runId}/void?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(),
  });
}
export function getPayrollExportUrl(homeSlug, runId, format) {
  return `${API_BASE}/payroll/runs/${runId}/export?home=${h(homeSlug)}&format=${format}`;
}
export function getPayrollSummaryPdfUrl(homeSlug, runId) {
  return `${API_BASE}/payroll/runs/${runId}/summary-pdf?home=${h(homeSlug)}`;
}
export async function getPayslips(homeSlug, runId) {
  return apiFetch(`${API_BASE}/payroll/runs/${runId}/payslips?home=${h(homeSlug)}`, { headers: authHeaders() });
}

// Agency
export async function getAgencyProviders(homeSlug) {
  return apiFetch(`${API_BASE}/payroll/agency/providers?home=${h(homeSlug)}`, { headers: authHeaders() });
}
export async function createAgencyProvider(homeSlug, provider) {
  return apiFetch(`${API_BASE}/payroll/agency/providers?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(provider),
  });
}
export async function updateAgencyProvider(homeSlug, id, provider) {
  return apiFetch(`${API_BASE}/payroll/agency/providers/${id}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(provider),
  });
}
export async function getAgencyShifts(homeSlug, start, end) {
  return apiFetch(`${API_BASE}/payroll/agency/shifts?home=${h(homeSlug)}&start=${start}&end=${end}`, { headers: authHeaders() });
}
export async function createAgencyShift(homeSlug, shift) {
  return apiFetch(`${API_BASE}/payroll/agency/shifts?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(shift),
  });
}
export async function updateAgencyShift(homeSlug, id, shift) {
  return apiFetch(`${API_BASE}/payroll/agency/shifts/${id}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(shift),
  });
}
export async function getAgencyMetrics(homeSlug, weeks = 12) {
  return apiFetch(`${API_BASE}/payroll/agency/metrics?home=${h(homeSlug)}&weeks=${weeks}`, { headers: authHeaders() });
}

// ── Phase 2: Tax Codes ────────────────────────────────────────────────────────

export async function getTaxCodes(homeSlug) {
  return apiFetch(`${API_BASE}/payroll/tax-codes?home=${h(homeSlug)}`, { headers: authHeaders() });
}
export async function upsertTaxCode(homeSlug, data) {
  return apiFetch(`${API_BASE}/payroll/tax-codes?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function getYTD(homeSlug, staffId, year) {
  return apiFetch(`${API_BASE}/payroll/ytd?home=${h(homeSlug)}&staffId=${staffId}&year=${year}`, { headers: authHeaders() });
}

// ── Phase 2: Pensions ─────────────────────────────────────────────────────────

export async function getPensionEnrolments(homeSlug) {
  return apiFetch(`${API_BASE}/payroll/pensions?home=${h(homeSlug)}`, { headers: authHeaders() });
}
export async function upsertPensionEnrolment(homeSlug, data) {
  return apiFetch(`${API_BASE}/payroll/pensions?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function getPensionConfig(homeSlug = getCurrentHome()) {
  return apiFetch(`${API_BASE}/payroll/pension-config?home=${h(homeSlug)}`, { headers: authHeaders() });
}

// ── Phase 2: SSP & Sick Periods ───────────────────────────────────────────────

export async function getSSPConfig(homeSlug = getCurrentHome()) {
  return apiFetch(`${API_BASE}/payroll/ssp-config?home=${h(homeSlug)}`, { headers: authHeaders() });
}
export async function getSickPeriods(homeSlug, staffId) {
  const q = staffId ? `&staffId=${staffId}` : '';
  return apiFetch(`${API_BASE}/payroll/sick-periods?home=${h(homeSlug)}${q}`, { headers: authHeaders() });
}
export async function createSickPeriod(homeSlug, data) {
  return apiFetch(`${API_BASE}/payroll/sick-periods?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function updateSickPeriod(homeSlug, id, data) {
  return apiFetch(`${API_BASE}/payroll/sick-periods/${id}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

// ── Phase 2: HMRC Tracker ─────────────────────────────────────────────────────

export async function getHMRCLiabilities(homeSlug, year) {
  return apiFetch(`${API_BASE}/payroll/hmrc?home=${h(homeSlug)}&year=${year}`, { headers: authHeaders() });
}
export async function markHMRCPaid(homeSlug, id, data) {
  return apiFetch(`${API_BASE}/payroll/hmrc/${id}/paid?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

// ── GDPR & Data Protection ──────────────────────────────────────────────────

// Data requests (SAR, erasure, etc.)
export async function getDataRequests(homeSlug) {
  return apiFetch(`${API_BASE}/gdpr/requests?home=${h(homeSlug)}`, { headers: authHeaders() });
}
export async function createDataRequest(homeSlug, data) {
  return apiFetch(`${API_BASE}/gdpr/requests?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function updateDataRequest(homeSlug, id, data) {
  return apiFetch(`${API_BASE}/gdpr/requests/${id}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function gatherRequestData(homeSlug, id) {
  return apiFetch(`${API_BASE}/gdpr/requests/${id}/gather?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(),
  });
}
export async function executeErasure(homeSlug, id) {
  return apiFetch(`${API_BASE}/gdpr/requests/${id}/execute?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(),
  });
}

// Data breaches
export async function getDataBreaches(homeSlug) {
  return apiFetch(`${API_BASE}/gdpr/breaches?home=${h(homeSlug)}`, { headers: authHeaders() });
}
export async function createDataBreach(homeSlug, data) {
  return apiFetch(`${API_BASE}/gdpr/breaches?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function updateDataBreach(homeSlug, id, data) {
  return apiFetch(`${API_BASE}/gdpr/breaches/${id}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function assessBreach(homeSlug, id) {
  return apiFetch(`${API_BASE}/gdpr/breaches/${id}/assess?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(),
  });
}

// Retention
export async function getRetentionSchedule(homeSlug) {
  const home = homeSlug || getCurrentHome();
  return apiFetch(`${API_BASE}/gdpr/retention?home=${h(home)}`, { headers: authHeaders() });
}
export async function scanRetention(homeSlug) {
  return apiFetch(`${API_BASE}/gdpr/retention?scan=true&home=${h(homeSlug)}`, { headers: authHeaders() });
}

// Consent
export async function getConsentRecords(homeSlug) {
  return apiFetch(`${API_BASE}/gdpr/consent?home=${h(homeSlug)}`, { headers: authHeaders() });
}
export async function createConsentRecord(homeSlug, data) {
  return apiFetch(`${API_BASE}/gdpr/consent?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function updateConsentRecord(homeSlug, id, data) {
  return apiFetch(`${API_BASE}/gdpr/consent/${id}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

// DP complaints
export async function getDPComplaints(homeSlug) {
  return apiFetch(`${API_BASE}/gdpr/complaints?home=${h(homeSlug)}`, { headers: authHeaders() });
}
export async function createDPComplaint(homeSlug, data) {
  return apiFetch(`${API_BASE}/gdpr/complaints?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function updateDPComplaint(homeSlug, id, data) {
  return apiFetch(`${API_BASE}/gdpr/complaints/${id}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

// Access log (global — not per-home)
export async function getAccessLog(limit = 100) {
  return apiFetch(`${API_BASE}/gdpr/access-log?limit=${limit}`, { headers: authHeaders() });
}

// ── HR & People ──────────────────────────────────────────────────────────────

// Disciplinary
export async function getHrDisciplinary(homeSlug, filters = {}) {
  const params = homeQueryParams(homeSlug);
  if (filters.staffId) params.set('staff_id', filters.staffId);
  if (filters.status) params.set('status', filters.status);
  if (filters.limit) params.set('limit', filters.limit);
  if (filters.offset) params.set('offset', filters.offset);
  return apiFetch(`${API_BASE}/hr/cases/disciplinary?${params}`, { headers: authHeaders() });
}
export async function createHrDisciplinary(homeSlug, data) {
  return apiFetch(`${API_BASE}/hr/cases/disciplinary?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function getHrDisciplinaryById(homeSlug, id) {
  return apiFetch(`${API_BASE}/hr/cases/disciplinary/${id}?home=${h(homeSlug)}`, { headers: authHeaders() });
}
export async function updateHrDisciplinary(id, data) {
  return apiFetch(`${API_BASE}/hr/cases/disciplinary/${id}?home=${h(getCurrentHome())}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

// Grievance
export async function getHrGrievance(homeSlug, filters = {}) {
  const params = homeQueryParams(homeSlug);
  if (filters.staffId) params.set('staff_id', filters.staffId);
  if (filters.status) params.set('status', filters.status);
  if (filters.limit) params.set('limit', filters.limit);
  if (filters.offset) params.set('offset', filters.offset);
  return apiFetch(`${API_BASE}/hr/cases/grievance?${params}`, { headers: authHeaders() });
}
export async function createHrGrievance(homeSlug, data) {
  return apiFetch(`${API_BASE}/hr/cases/grievance?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function getHrGrievanceById(homeSlug, id) {
  return apiFetch(`${API_BASE}/hr/cases/grievance/${id}?home=${h(homeSlug)}`, { headers: authHeaders() });
}
export async function updateHrGrievance(id, data) {
  return apiFetch(`${API_BASE}/hr/cases/grievance/${id}?home=${h(getCurrentHome())}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function getGrievanceActions(id) {
  return apiFetch(`${API_BASE}/hr/cases/grievance/${id}/actions?home=${h(getCurrentHome())}`, { headers: authHeaders() });
}
export async function createGrievanceAction(id, data) {
  return apiFetch(`${API_BASE}/hr/cases/grievance/${id}/actions?home=${h(getCurrentHome())}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function updateGrievanceAction(id, data) {
  return apiFetch(`${API_BASE}/hr/grievance-actions/${id}?home=${h(getCurrentHome())}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

// Performance
export async function getHrPerformance(homeSlug, filters = {}) {
  const params = homeQueryParams(homeSlug);
  if (filters.staffId) params.set('staff_id', filters.staffId);
  if (filters.status) params.set('status', filters.status);
  if (filters.type) params.set('type', filters.type);
  if (filters.limit) params.set('limit', filters.limit);
  if (filters.offset) params.set('offset', filters.offset);
  return apiFetch(`${API_BASE}/hr/cases/performance?${params}`, { headers: authHeaders() });
}
export async function createHrPerformance(homeSlug, data) {
  return apiFetch(`${API_BASE}/hr/cases/performance?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function getHrPerformanceById(homeSlug, id) {
  return apiFetch(`${API_BASE}/hr/cases/performance/${id}?home=${h(homeSlug)}`, { headers: authHeaders() });
}
export async function updateHrPerformance(id, data) {
  return apiFetch(`${API_BASE}/hr/cases/performance/${id}?home=${h(getCurrentHome())}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

// Absence
export async function getAbsenceSummary(homeSlug) {
  return apiFetch(`${API_BASE}/hr/absence/summary?home=${h(homeSlug)}`, { headers: authHeaders() });
}
export async function getStaffAbsence(homeSlug, staffId) {
  return apiFetch(`${API_BASE}/hr/absence/staff/${staffId}?home=${h(homeSlug)}`, { headers: authHeaders() });
}

// RTW Interviews
export async function getHrRtwInterviews(homeSlug, filters = {}) {
  const params = homeQueryParams(homeSlug);
  if (filters.staffId) params.set('staff_id', filters.staffId);
  if (filters.limit) params.set('limit', filters.limit);
  if (filters.offset) params.set('offset', filters.offset);
  return apiFetch(`${API_BASE}/hr/rtw-interviews?${params}`, { headers: authHeaders() });
}
export async function createHrRtwInterview(homeSlug, data) {
  return apiFetch(`${API_BASE}/hr/rtw-interviews?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function updateHrRtwInterview(id, data) {
  return apiFetch(`${API_BASE}/hr/rtw-interviews/${id}?home=${h(getCurrentHome())}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

// OH Referrals
export async function getHrOhReferrals(homeSlug, filters = {}) {
  const params = homeQueryParams(homeSlug);
  if (filters.staffId) params.set('staff_id', filters.staffId);
  if (filters.limit) params.set('limit', filters.limit);
  if (filters.offset) params.set('offset', filters.offset);
  return apiFetch(`${API_BASE}/hr/oh-referrals?${params}`, { headers: authHeaders() });
}
export async function createHrOhReferral(homeSlug, data) {
  return apiFetch(`${API_BASE}/hr/oh-referrals?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function updateHrOhReferral(id, data) {
  return apiFetch(`${API_BASE}/hr/oh-referrals/${id}?home=${h(getCurrentHome())}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

// Contracts
export async function getHrContracts(homeSlug, filters = {}) {
  const params = homeQueryParams(homeSlug);
  if (filters.staffId) params.set('staff_id', filters.staffId);
  if (filters.status) params.set('status', filters.status);
  if (filters.limit) params.set('limit', filters.limit);
  if (filters.offset) params.set('offset', filters.offset);
  return apiFetch(`${API_BASE}/hr/contracts?${params}`, { headers: authHeaders() });
}
export async function createHrContract(homeSlug, data) {
  return apiFetch(`${API_BASE}/hr/contracts?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function updateHrContract(id, data) {
  return apiFetch(`${API_BASE}/hr/contracts/${id}?home=${h(getCurrentHome())}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

// Family Leave
export async function getHrFamilyLeave(homeSlug, filters = {}) {
  const params = homeQueryParams(homeSlug);
  if (filters.staffId) params.set('staff_id', filters.staffId);
  if (filters.type) params.set('type', filters.type);
  if (filters.limit) params.set('limit', filters.limit);
  if (filters.offset) params.set('offset', filters.offset);
  return apiFetch(`${API_BASE}/hr/family-leave?${params}`, { headers: authHeaders() });
}
export async function createHrFamilyLeave(homeSlug, data) {
  return apiFetch(`${API_BASE}/hr/family-leave?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function updateHrFamilyLeave(id, data) {
  return apiFetch(`${API_BASE}/hr/family-leave/${id}?home=${h(getCurrentHome())}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

// Flexible Working
export async function getHrFlexWorking(homeSlug, filters = {}) {
  const params = homeQueryParams(homeSlug);
  if (filters.staffId) params.set('staff_id', filters.staffId);
  if (filters.status) params.set('status', filters.status);
  if (filters.limit) params.set('limit', filters.limit);
  if (filters.offset) params.set('offset', filters.offset);
  return apiFetch(`${API_BASE}/hr/flexible-working?${params}`, { headers: authHeaders() });
}
export async function createHrFlexWorking(homeSlug, data) {
  return apiFetch(`${API_BASE}/hr/flexible-working?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function updateHrFlexWorking(id, data) {
  return apiFetch(`${API_BASE}/hr/flexible-working/${id}?home=${h(getCurrentHome())}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

// EDI
export async function getHrEdi(homeSlug, filters = {}) {
  const params = homeQueryParams(homeSlug);
  if (filters.recordType) params.set('record_type', filters.recordType);
  if (filters.staffId) params.set('staff_id', filters.staffId);
  if (filters.limit) params.set('limit', filters.limit);
  if (filters.offset) params.set('offset', filters.offset);
  return apiFetch(`${API_BASE}/hr/edi?${params}`, { headers: authHeaders() });
}
export async function createHrEdi(homeSlug, data) {
  return apiFetch(`${API_BASE}/hr/edi?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function updateHrEdi(id, data) {
  return apiFetch(`${API_BASE}/hr/edi/${id}?home=${h(getCurrentHome())}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

// TUPE
export async function getHrTupe(homeSlug, filters = {}) {
  const params = homeQueryParams(homeSlug);
  if (filters.limit) params.set('limit', filters.limit);
  if (filters.offset) params.set('offset', filters.offset);
  return apiFetch(`${API_BASE}/hr/tupe?${params}`, { headers: authHeaders() });
}
export async function createHrTupe(homeSlug, data) {
  return apiFetch(`${API_BASE}/hr/tupe?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function updateHrTupe(id, data) {
  return apiFetch(`${API_BASE}/hr/tupe/${id}?home=${h(getCurrentHome())}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

// Renewals
export async function getHrRenewals(homeSlug, filters = {}) {
  const params = homeQueryParams(homeSlug);
  if (filters.staffId) params.set('staff_id', filters.staffId);
  if (filters.checkType) params.set('check_type', filters.checkType);
  if (filters.status) params.set('status', filters.status);
  if (filters.limit) params.set('limit', filters.limit);
  if (filters.offset) params.set('offset', filters.offset);
  return apiFetch(`${API_BASE}/hr/renewals?${params}`, { headers: authHeaders() });
}
export async function createHrRenewal(homeSlug, data) {
  return apiFetch(`${API_BASE}/hr/renewals?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function updateHrRenewal(id, data) {
  return apiFetch(`${API_BASE}/hr/renewals/${id}?home=${h(getCurrentHome())}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

// Cross-cutting
export async function getHrWarnings(homeSlug, options = {}) {
  return apiFetch(`${API_BASE}/hr/warnings?home=${h(homeSlug)}`, { headers: authHeaders(), ...options });
}
export async function getHrStats(homeSlug, options = {}) {
  return apiFetch(`${API_BASE}/hr/stats?home=${h(homeSlug)}`, { headers: authHeaders(), ...options });
}
export async function getHrCaseNotes(homeSlug, caseType, caseId) {
  return apiFetch(`${API_BASE}/hr/case-notes/${caseType}/${caseId}?home=${h(homeSlug)}`, { headers: authHeaders() });
}
export async function createHrCaseNote(homeSlug, caseType, caseId, data) {
  return apiFetch(`${API_BASE}/hr/case-notes/${caseType}/${caseId}?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}

// ── HR Staff List ───────────────────────────────────────────────────────────
export async function getHrStaffList(homeSlug, options = {}) {
  const home = homeSlug || getCurrentHome();
  return apiFetch(`${API_BASE}/hr/staff?home=${h(home)}`, { headers: authHeaders(), ...options });
}

// ── HR File Attachments ─────────────────────────────────────────────────────
export async function getHrAttachments(caseType, caseId) {
  const home = getCurrentHome();
  return apiFetch(`${API_BASE}/hr/attachments/${caseType}/${caseId}?home=${h(home)}`, { headers: authHeaders() });
}

export async function uploadHrAttachment(caseType, caseId, file, description) {
  const home = getCurrentHome();
  const formData = new FormData();
  formData.append('file', file);
  if (description) formData.append('description', description);
  return uploadMultipart(`${API_BASE}/hr/attachments/${caseType}/${caseId}?home=${h(home)}`, formData);
}

export async function deleteHrAttachment(id) {
  const home = getCurrentHome();
  return apiFetch(`${API_BASE}/hr/attachments/${id}?home=${h(home)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
}

export async function downloadHrAttachment(id, originalName) {
  const home = getCurrentHome();
  return downloadBinary(`${API_BASE}/hr/attachments/download/${id}?home=${h(home)}`, originalName);
}

// ── HR Investigation Meetings ───────────────────────────────────────────────
export async function getRecordAttachments(moduleId, recordId) {
  const home = getCurrentHome();
  return apiFetch(`${API_BASE}/record-attachments/${encodeURIComponent(moduleId)}/${encodeURIComponent(recordId)}?home=${h(home)}`, {
    headers: authHeaders(),
  });
}

export async function uploadRecordAttachment(moduleId, recordId, file, description) {
  const home = getCurrentHome();
  const formData = new FormData();
  formData.append('file', file);
  if (description) formData.append('description', description);
  return uploadMultipart(`${API_BASE}/record-attachments/${encodeURIComponent(moduleId)}/${encodeURIComponent(recordId)}?home=${h(home)}`, formData);
}

export async function deleteRecordAttachment(id) {
  const home = getCurrentHome();
  return apiFetch(`${API_BASE}/record-attachments/${encodeURIComponent(id)}?home=${h(home)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
}

export async function downloadRecordAttachment(id, originalName) {
  const home = getCurrentHome();
  return downloadBinary(`${API_BASE}/record-attachments/download/${encodeURIComponent(id)}?home=${h(home)}`, originalName);
}

export async function getHrMeetings(caseType, caseId) {
  const home = getCurrentHome();
  return apiFetch(`${API_BASE}/hr/meetings/${caseType}/${caseId}?home=${h(home)}`, { headers: authHeaders() });
}

export async function createHrMeeting(caseType, caseId, data) {
  const home = getCurrentHome();
  return apiFetch(`${API_BASE}/hr/meetings/${caseType}/${caseId}?home=${h(home)}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
}

export async function updateHrMeeting(id, data) {
  const home = getCurrentHome();
  return apiFetch(`${API_BASE}/hr/meetings/${id}?home=${h(home)}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
}

// ── Finance ──────────────────────────────────────────────────────────────────

// Residents
export async function getFinanceResidents(homeSlug, filters = {}) {
  const params = homeQueryParams(homeSlug);
  if (filters.status) params.set('status', filters.status);
  if (filters.funding_type) params.set('funding_type', filters.funding_type);
  if (filters.limit) params.set('limit', filters.limit);
  if (filters.offset) params.set('offset', filters.offset);
  return apiFetch(`${API_BASE}/finance/residents?${params}`, { headers: authHeaders() });
}
export async function createFinanceResident(homeSlug, data) {
  return apiFetch(`${API_BASE}/finance/residents?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function getFinanceResident(homeSlug, id) {
  return apiFetch(`${API_BASE}/finance/residents/${id}?home=${h(homeSlug)}`, { headers: authHeaders() });
}
export async function updateFinanceResident(homeSlug, id, data) {
  return apiFetch(`${API_BASE}/finance/residents/${id}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function getFinanceFeeHistory(homeSlug, residentId) {
  return apiFetch(`${API_BASE}/finance/residents/${residentId}/fee-history?home=${h(homeSlug)}`, { headers: authHeaders() });
}

// Residents with beds (standalone Residents page)
export async function getResidentsWithBeds(homeSlug, filters = {}) {
  const params = homeQueryParams(homeSlug);
  if (filters.status) params.set('status', filters.status);
  if (filters.funding_type) params.set('funding_type', filters.funding_type);
  if (filters.search) params.set('search', filters.search);
  return apiFetch(`${API_BASE}/finance/residents/with-beds?${params}`, { headers: authHeaders() });
}
export async function deleteFinanceResident(homeSlug, id) {
  return apiFetch(`${API_BASE}/finance/residents/${id}?home=${h(homeSlug)}`, {
    method: 'DELETE', headers: authHeaders(),
  });
}

// Invoices
export async function getFinanceInvoices(homeSlug, filters = {}) {
  const params = homeQueryParams(homeSlug);
  if (filters.status) params.set('status', filters.status);
  if (filters.payer_type) params.set('payer_type', filters.payer_type);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.limit) params.set('limit', filters.limit);
  if (filters.offset) params.set('offset', filters.offset);
  return apiFetch(`${API_BASE}/finance/invoices?${params}`, { headers: authHeaders() });
}
export async function createFinanceInvoice(homeSlug, data) {
  return apiFetch(`${API_BASE}/finance/invoices?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function getFinanceInvoice(homeSlug, id) {
  return apiFetch(`${API_BASE}/finance/invoices/${id}?home=${h(homeSlug)}`, { headers: authHeaders() });
}
export async function updateFinanceInvoice(homeSlug, id, data) {
  return apiFetch(`${API_BASE}/finance/invoices/${id}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function recordFinancePayment(homeSlug, invoiceId, data) {
  return apiFetch(`${API_BASE}/finance/invoices/${invoiceId}/payment?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}

// Expenses
export async function getFinanceExpenses(homeSlug, filters = {}) {
  const params = homeQueryParams(homeSlug);
  if (filters.category) params.set('category', filters.category);
  if (filters.status) params.set('status', filters.status);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.limit) params.set('limit', filters.limit);
  if (filters.offset) params.set('offset', filters.offset);
  return apiFetch(`${API_BASE}/finance/expenses?${params}`, { headers: authHeaders() });
}
export async function createFinanceExpense(homeSlug, data) {
  return apiFetch(`${API_BASE}/finance/expenses?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function getFinanceExpense(homeSlug, id) {
  return apiFetch(`${API_BASE}/finance/expenses/${id}?home=${h(homeSlug)}`, { headers: authHeaders() });
}
export async function updateFinanceExpense(homeSlug, id, data) {
  return apiFetch(`${API_BASE}/finance/expenses/${id}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function approveFinanceExpense(homeSlug, id) {
  return apiFetch(`${API_BASE}/finance/expenses/${id}/approve?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(),
  });
}

// Dashboard & Alerts
export async function getFinanceDashboard(homeSlug, from, to) {
  return apiFetch(`${API_BASE}/finance/dashboard?home=${h(homeSlug)}&from=${from}&to=${to}`, { headers: authHeaders() });
}
export async function getFinanceAlerts(homeSlug, options = {}) {
  return apiFetch(`${API_BASE}/finance/alerts?home=${h(homeSlug)}`, { headers: authHeaders(), ...options });
}
export async function getDashboardSummary(homeSlug, options = {}) {
  return apiFetch(`${API_BASE}/dashboard/summary?home=${h(homeSlug)}`, { headers: authHeaders(), ...options });
}

// Chase log
export async function getInvoiceChases(homeSlug, invoiceId) {
  return apiFetch(`${API_BASE}/finance/invoices/${invoiceId}/chases?home=${h(homeSlug)}`, { headers: authHeaders() });
}
export async function createInvoiceChase(homeSlug, invoiceId, data) {
  return apiFetch(`${API_BASE}/finance/invoices/${invoiceId}/chases?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}

// Receivables detail
export async function getReceivablesDetail(homeSlug) {
  return apiFetch(`${API_BASE}/finance/receivables?home=${h(homeSlug)}`, { headers: authHeaders() });
}

// Payment schedules
export async function getPaymentSchedules(homeSlug, filters = {}) {
  const params = homeQueryParams(homeSlug);
  if (filters.on_hold !== undefined) params.set('on_hold', filters.on_hold);
  if (filters.limit) params.set('limit', filters.limit);
  if (filters.offset) params.set('offset', filters.offset);
  return apiFetch(`${API_BASE}/finance/payment-schedules?${params}`, { headers: authHeaders() });
}
export async function createPaymentSchedule(homeSlug, data) {
  return apiFetch(`${API_BASE}/finance/payment-schedules?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function updatePaymentSchedule(homeSlug, id, data) {
  return apiFetch(`${API_BASE}/finance/payment-schedules/${id}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function processPaymentSchedule(homeSlug, id, version) {
  return apiFetch(`${API_BASE}/finance/payment-schedules/${id}/process?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ _version: version }),
  });
}

// ─── Training ─────────────────────────────────────────────────────────────────

export async function getTrainingData(homeSlug, options = {}) {
  return apiFetch(`${API_BASE}/training?home=${h(homeSlug)}`, { headers: authHeaders(), ...options });
}

export async function upsertTrainingRecord(homeSlug, staffId, typeId, data) {
  return apiFetch(`${API_BASE}/training/${encodeURIComponent(staffId)}/${encodeURIComponent(typeId)}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function deleteTrainingRecord(homeSlug, staffId, typeId) {
  return apiFetch(`${API_BASE}/training/${encodeURIComponent(staffId)}/${encodeURIComponent(typeId)}?home=${h(homeSlug)}`, {
    method: 'DELETE', headers: authHeaders(),
  });
}

export async function updateTrainingTypes(homeSlug, trainingTypes, clientUpdatedAt) {
  return apiFetch(`${API_BASE}/training/config/types?home=${h(homeSlug)}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({
      trainingTypes,
      ...(clientUpdatedAt ? { _clientUpdatedAt: clientUpdatedAt } : {}),
    }),
  });
}

export async function createSupervision(homeSlug, data) {
  return apiFetch(`${API_BASE}/training/supervisions?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function updateSupervision(homeSlug, id, data) {
  return apiFetch(`${API_BASE}/training/supervisions/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function deleteSupervision(homeSlug, id) {
  return apiFetch(`${API_BASE}/training/supervisions/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'DELETE', headers: authHeaders(),
  });
}

export async function createAppraisal(homeSlug, data) {
  return apiFetch(`${API_BASE}/training/appraisals?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function updateAppraisal(homeSlug, id, data) {
  return apiFetch(`${API_BASE}/training/appraisals/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function deleteAppraisal(homeSlug, id) {
  return apiFetch(`${API_BASE}/training/appraisals/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'DELETE', headers: authHeaders(),
  });
}

export async function createFireDrill(homeSlug, data) {
  return apiFetch(`${API_BASE}/training/fire-drills?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function updateFireDrill(homeSlug, id, data) {
  return apiFetch(`${API_BASE}/training/fire-drills/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function deleteFireDrill(homeSlug, id) {
  return apiFetch(`${API_BASE}/training/fire-drills/${encodeURIComponent(id)}?home=${h(homeSlug)}`, {
    method: 'DELETE', headers: authHeaders(),
  });
}

// ─── Care Certificate ─────────────────────────────────────────────────────────

export async function getCareCertData(homeSlug, options = {}) {
  return apiFetch(`${API_BASE}/care-cert?home=${h(homeSlug)}`, { headers: authHeaders(), ...options });
}

export async function startCareCert(homeSlug, data) {
  return apiFetch(`${API_BASE}/care-cert?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function updateCareCert(homeSlug, staffId, data) {
  return apiFetch(`${API_BASE}/care-cert/${encodeURIComponent(staffId)}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function deleteCareCert(homeSlug, staffId) {
  return apiFetch(`${API_BASE}/care-cert/${encodeURIComponent(staffId)}?home=${h(homeSlug)}`, {
    method: 'DELETE', headers: authHeaders(),
  });
}

// ─── Onboarding ───────────────────────────────────────────────────────────────

export async function getOnboardingData(homeSlug) {
  return apiFetch(`${API_BASE}/onboarding?home=${h(homeSlug)}`, { headers: authHeaders() });
}

export async function upsertOnboardingSection(homeSlug, staffId, section, data) {
  return apiFetch(`${API_BASE}/onboarding/${encodeURIComponent(staffId)}/${encodeURIComponent(section)}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function clearOnboardingSection(homeSlug, staffId, section) {
  return apiFetch(`${API_BASE}/onboarding/${encodeURIComponent(staffId)}/${encodeURIComponent(section)}?home=${h(homeSlug)}`, {
    method: 'DELETE', headers: authHeaders(),
  });
}

export async function getOnboardingHistory(homeSlug, staffId, section) {
  return apiFetch(`${API_BASE}/onboarding/${encodeURIComponent(staffId)}/${encodeURIComponent(section)}/history?home=${h(homeSlug)}`, {
    headers: authHeaders(),
  });
}

export async function getOnboardingFiles(_caseType, staffIdAndSection) {
  const [staffId, section] = String(staffIdAndSection).split('::');
  const home = getCurrentHome();
  return apiFetch(`${API_BASE}/onboarding/${encodeURIComponent(staffId)}/${encodeURIComponent(section)}/files?home=${h(home)}`, {
    headers: authHeaders(),
  });
}

export async function uploadOnboardingFile(_caseType, staffIdAndSection, file, description) {
  const [staffId, section] = String(staffIdAndSection).split('::');
  const home = getCurrentHome();
  const formData = new FormData();
  formData.append('file', file);
  if (description) formData.append('description', description);
  return uploadMultipart(`${API_BASE}/onboarding/${encodeURIComponent(staffId)}/${encodeURIComponent(section)}/files?home=${h(home)}`, formData);
}

export async function deleteOnboardingFile(id) {
  const home = getCurrentHome();
  return apiFetch(`${API_BASE}/onboarding/files/${encodeURIComponent(id)}?home=${h(home)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
}

export async function downloadOnboardingFile(id, originalName) {
  const home = getCurrentHome();
  return downloadBinary(`${API_BASE}/onboarding/files/${encodeURIComponent(id)}/download?home=${h(home)}`, originalName);
}

// ─── Staff CRUD ───────────────────────────────────────────────────────────────

export async function getTrainingFiles(_caseType, staffIdAndType) {
  const [staffId, typeId] = String(staffIdAndType).split('::');
  const home = getCurrentHome();
  return apiFetch(`${API_BASE}/training/${encodeURIComponent(staffId)}/${encodeURIComponent(typeId)}/files?home=${h(home)}`, {
    headers: authHeaders(),
  });
}

export async function uploadTrainingFile(_caseType, staffIdAndType, file, description) {
  const [staffId, typeId] = String(staffIdAndType).split('::');
  const home = getCurrentHome();
  const formData = new FormData();
  formData.append('file', file);
  if (description) formData.append('description', description);
  return uploadMultipart(`${API_BASE}/training/${encodeURIComponent(staffId)}/${encodeURIComponent(typeId)}/files?home=${h(home)}`, formData);
}

export async function deleteTrainingFile(id) {
  const home = getCurrentHome();
  return apiFetch(`${API_BASE}/training/files/${encodeURIComponent(id)}?home=${h(home)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
}

export async function downloadTrainingFile(id, originalName) {
  const home = getCurrentHome();
  return downloadBinary(`${API_BASE}/training/files/${encodeURIComponent(id)}/download?home=${h(home)}`, originalName);
}

export async function createStaff(homeSlug, staffData) {
  return apiFetch(`${API_BASE}/staff?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(staffData),
  });
}

export async function updateStaffMember(homeSlug, staffId, staffData) {
  return apiFetch(`${API_BASE}/staff/${encodeURIComponent(staffId)}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(staffData),
  });
}

export async function deleteStaffMember(homeSlug, staffId) {
  return apiFetch(`${API_BASE}/staff/${encodeURIComponent(staffId)}?home=${h(homeSlug)}`, {
    method: 'DELETE', headers: authHeaders(),
  });
}

// ─── Config ───────────────────────────────────────────────────────────────────

export async function saveConfig(homeSlug, config, { clientUpdatedAt } = {}) {
  return apiFetch(`${API_BASE}/homes/config?home=${h(homeSlug)}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({
      config,
      ...(clientUpdatedAt ? { _clientUpdatedAt: clientUpdatedAt } : {}),
    }),
  });
}

// ── Scheduling (Phase 2d) ─────────────────────────────────────────────────────

export async function getSchedulingData(homeSlug, { from, to, ...options } = {}) {
  let url = `${API_BASE}/scheduling?home=${h(homeSlug)}`;
  if (from) url += `&from=${encodeURIComponent(from)}`;
  if (to) url += `&to=${encodeURIComponent(to)}`;
  return apiFetch(url, { headers: authHeaders(), ...options });
}

function schedulingHeaders(editLockPin) {
  return authHeaders(editLockPin ? { 'X-Edit-Lock-Pin': String(editLockPin) } : {});
}

export async function upsertOverride(homeSlug, { date, staffId, shift, reason, source, sleep_in, replaces_staff_id, override_hours, al_hours }, { editLockPin } = {}) {
  return apiFetch(`${API_BASE}/scheduling/overrides?home=${h(homeSlug)}`, {
    method: 'PUT',
    headers: schedulingHeaders(editLockPin),
    body: JSON.stringify({ date, staffId, shift, reason, source, sleep_in, replaces_staff_id, override_hours, al_hours }),
  });
}

export async function deleteOverride(homeSlug, date, staffId, { editLockPin } = {}) {
  const params = homeQueryParams(homeSlug, { date, staffId });
  return apiFetch(`${API_BASE}/scheduling/overrides?${params}`, {
    method: 'DELETE',
    headers: schedulingHeaders(editLockPin),
  });
}

export async function bulkUpsertOverrides(homeSlug, overrides, { editLockPin } = {}) {
  return apiFetch(`${API_BASE}/scheduling/overrides/bulk?home=${h(homeSlug)}`, {
    method: 'POST',
    headers: schedulingHeaders(editLockPin),
    body: JSON.stringify({ overrides }),
  });
}

export async function revertMonthOverrides(homeSlug, fromDate, toDate, { editLockPin } = {}) {
  const params = homeQueryParams(homeSlug, { fromDate, toDate });
  return apiFetch(`${API_BASE}/scheduling/overrides/month?${params}`, {
    method: 'DELETE',
    headers: schedulingHeaders(editLockPin),
  });
}

export async function upsertDayNote(homeSlug, date, note, { editLockPin } = {}) {
  return apiFetch(`${API_BASE}/scheduling/day-notes?home=${h(homeSlug)}`, {
    method: 'PUT',
    headers: schedulingHeaders(editLockPin),
    body: JSON.stringify({ date, note }),
  });
}

// ── User Management API ──────────────────────────────────────────────────────

export async function listUsersForHome(homeSlug) {
  return apiFetch(`${API_BASE}/users?home=${h(homeSlug)}`, { headers: authHeaders() });
}

export async function createUser(homeSlug, data) {
  return apiFetch(`${API_BASE}/users?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function getUser(homeSlug, id) {
  return apiFetch(`${API_BASE}/users/${id}?home=${h(homeSlug)}`, { headers: authHeaders() });
}

export async function updateUser(homeSlug, id, data) {
  return apiFetch(`${API_BASE}/users/${id}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function resetUserPassword(homeSlug, id, newPassword) {
  return apiFetch(`${API_BASE}/users/${id}/reset-password?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ newPassword }),
  });
}

export async function changeOwnPassword(currentPassword, newPassword) {
  return apiFetch(`${API_BASE}/users/change-password`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export async function getUserHomes(id) {
  return apiFetch(`${API_BASE}/users/${id}/homes`, { headers: authHeaders() });
}

export async function setUserHomes(id, homeIds) {
  return apiFetch(`${API_BASE}/users/${id}/homes`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify({ homeIds }),
  });
}

export async function listAllHomesForAccess() {
  return apiFetch(`${API_BASE}/users/all-homes`, { headers: authHeaders() });
}

export async function getUserHomeRole(homeSlug, id) {
  return apiFetch(`${API_BASE}/users/${id}/roles?home=${h(homeSlug)}`, { headers: authHeaders() });
}

export async function setUserHomeRole(homeSlug, id, roleId) {
  return apiFetch(`${API_BASE}/users/${id}/roles?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify({ roleId }),
  });
}

export async function getUserAllRoles(id) {
  return apiFetch(`${API_BASE}/users/all-roles/${id}`, { headers: authHeaders() });
}

export async function setUserRolesBulk(id, roles) {
  return apiFetch(`${API_BASE}/users/${id}/roles-bulk`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify({ roles }),
  });
}

// ── Beds & Occupancy ────────────────────────────────────────────────────────

export async function getBeds(homeSlug) {
  return apiFetch(`${API_BASE}/beds?home=${h(homeSlug)}`, { headers: authHeaders() });
}

export async function getBedSummary(homeSlug) {
  return apiFetch(`${API_BASE}/beds/summary?home=${h(homeSlug)}`, { headers: authHeaders() });
}

export async function getBed(homeSlug, bedId) {
  return apiFetch(`${API_BASE}/beds/${bedId}?home=${h(homeSlug)}`, { headers: authHeaders() });
}

export async function getBedHistory(homeSlug, bedId) {
  return apiFetch(`${API_BASE}/beds/${bedId}/history?home=${h(homeSlug)}`, { headers: authHeaders() });
}

export async function createBed(homeSlug, data) {
  return apiFetch(`${API_BASE}/beds?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function updateBed(homeSlug, bedId, data) {
  return apiFetch(`${API_BASE}/beds/${bedId}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function setupBeds(homeSlug, beds) {
  return apiFetch(`${API_BASE}/beds/setup?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(beds),
  });
}

export async function transitionBedStatus(homeSlug, bedId, data) {
  return apiFetch(`${API_BASE}/beds/${bedId}/status?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function revertBedTransition(homeSlug, bedId, reason) {
  return apiFetch(`${API_BASE}/beds/${bedId}/revert?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify({ reason }),
  });
}

export async function moveBedResident(homeSlug, fromBedId, toBedId, fromClientUpdatedAt, toClientUpdatedAt) {
  return apiFetch(`${API_BASE}/beds/move?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify({ fromBedId, toBedId, fromClientUpdatedAt, toClientUpdatedAt }),
  });
}

export async function deleteBed(homeSlug, bedId, clientUpdatedAt) {
  return apiFetch(`${API_BASE}/beds/${bedId}?home=${h(homeSlug)}`, {
    method: 'DELETE', headers: authHeaders(), body: JSON.stringify({ clientUpdatedAt }),
  });
}

// ── Platform Admin ──────────────────────────────────────────────────────────

export async function listPlatformHomes() {
  return apiFetch(`${API_BASE}/platform/homes`, { headers: authHeaders() });
}

export async function createPlatformHome(data) {
  return apiFetch(`${API_BASE}/platform/homes`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function updatePlatformHome(id, data) {
  return apiFetch(`${API_BASE}/platform/homes/${id}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function deletePlatformHome(id) {
  return apiFetch(`${API_BASE}/platform/homes/${id}`, {
    method: 'DELETE', headers: authHeaders(),
  });
}

// Fire-and-forget audit log for report downloads
export function logReportDownload(reportType, dateRange) {
  const home = getCurrentHome();
  if (!home) return;
  apiFetch(`${API_BASE}/audit/report-download?home=${h(home)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ reportType, dateRange }),
  }).catch(e => console.warn('Audit log failed:', e.message)); // fire-and-forget
}

// ── ROPA (Record of Processing Activities) ──────────────────────────────────

export async function getRopaActivities(homeSlug, filters = {}) {
  const params = homeQueryParams(homeSlug);
  if (filters.status) params.set('status', filters.status);
  if (filters.limit) params.set('limit', filters.limit);
  if (filters.offset) params.set('offset', filters.offset);
  return apiFetch(`${API_BASE}/ropa?${params}`, { headers: authHeaders() });
}

export async function createRopaActivity(homeSlug, data) {
  return apiFetch(`${API_BASE}/ropa?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function updateRopaActivity(homeSlug, id, data) {
  return apiFetch(`${API_BASE}/ropa/${id}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function deleteRopaActivity(homeSlug, id) {
  return apiFetch(`${API_BASE}/ropa/${id}?home=${h(homeSlug)}`, {
    method: 'DELETE', headers: authHeaders(),
  });
}

// ── DPIA (Data Protection Impact Assessments) ───────────────────────────────

export async function getDpiaAssessments(homeSlug, filters = {}) {
  const params = homeQueryParams(homeSlug);
  if (filters.status) params.set('status', filters.status);
  if (filters.limit) params.set('limit', filters.limit);
  if (filters.offset) params.set('offset', filters.offset);
  return apiFetch(`${API_BASE}/dpia?${params}`, { headers: authHeaders() });
}

export async function createDpiaAssessment(homeSlug, data) {
  return apiFetch(`${API_BASE}/dpia?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function updateDpiaAssessment(homeSlug, id, data) {
  return apiFetch(`${API_BASE}/dpia/${id}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function deleteDpiaAssessment(homeSlug, id) {
  return apiFetch(`${API_BASE}/dpia/${id}?home=${h(homeSlug)}`, {
    method: 'DELETE', headers: authHeaders(),
  });
}

// ── Assessment Snapshots ────────────────────────────────────────────────────

export async function createSnapshot(homeSlug, engine, windowFrom, windowTo) {
  const body = { engine };
  if (windowFrom) body.window_from = windowFrom;
  if (windowTo) body.window_to = windowTo;
  return apiFetch(`${API_BASE}/assessment/snapshot?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(body),
  });
}

export async function getSnapshots(homeSlug, engine, options = {}) {
  return apiFetch(`${API_BASE}/assessment/snapshots?home=${h(homeSlug)}&engine=${engine}`, { headers: authHeaders(), ...options });
}

export async function getSnapshot(homeSlug, id) {
  return apiFetch(`${API_BASE}/assessment/snapshots/${id}?home=${h(homeSlug)}`, { headers: authHeaders() });
}

export async function signOffSnapshot(homeSlug, id, notes) {
  return apiFetch(`${API_BASE}/assessment/snapshots/${id}/sign-off?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify({ notes }),
  });
}

// ── Webhooks ──────────────────────────────────────────────────────────────────

export async function getWebhooks(homeSlug) {
  return apiFetch(`${API_BASE}/webhooks?home=${h(homeSlug)}`, { headers: authHeaders() });
}

export async function createWebhook(homeSlug, data) {
  return apiFetch(`${API_BASE}/webhooks?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function updateWebhook(homeSlug, id, data) {
  return apiFetch(`${API_BASE}/webhooks/${id}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function deleteWebhook(homeSlug, id) {
  return apiFetch(`${API_BASE}/webhooks/${id}?home=${h(homeSlug)}`, {
    method: 'DELETE', headers: authHeaders(),
  });
}

export async function getWebhookDeliveries(homeSlug, id) {
  return apiFetch(`${API_BASE}/webhooks/${id}/deliveries?home=${h(homeSlug)}`, { headers: authHeaders() });
}
