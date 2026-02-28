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

export async function saveData(data, homeId, clientUpdatedAt) {
  const home = homeId || currentHome;
  const url = home ? `${API_BASE}/data?home=${encodeURIComponent(home)}` : `${API_BASE}/data`;
  // Inject clientUpdatedAt separately from the data blob — it's server metadata used for
  // optimistic locking only. Sync functions on the server ignore unknown top-level keys.
  const body = clientUpdatedAt ? { ...data, _clientUpdatedAt: clientUpdatedAt } : data;
  const res = await fetch(url, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
  if (res.status === 401) {
    const err = new Error('Session expired — please log in again');
    err.status = 401;
    throw err;
  }
  if (res.status === 409) {
    const payload = await res.json().catch(() => ({}));
    const err = new Error(payload.message || 'Conflict: data was modified by another user');
    err.status = 409;
    err.serverUpdatedAt = payload.serverUpdatedAt;
    throw err;
  }
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed (${res.status})`);
  }
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
  sessionStorage.setItem('user', JSON.stringify({ username: user.username, role: user.role, displayName: user.displayName || '' }));
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

// ── Incidents ────────────────────────────────────────────────────────────────

export async function getIncidents(homeSlug) {
  return apiFetch(`${API_BASE}/incidents?home=${h(homeSlug)}`, { headers: authHeaders() });
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

export async function getComplaints(homeSlug) {
  return apiFetch(`${API_BASE}/complaints?home=${h(homeSlug)}`, { headers: authHeaders() });
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

export async function getMaintenance(homeSlug) {
  return apiFetch(`${API_BASE}/maintenance?home=${h(homeSlug)}`, { headers: authHeaders() });
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

export async function getIpcAudits(homeSlug) {
  return apiFetch(`${API_BASE}/ipc?home=${h(homeSlug)}`, { headers: authHeaders() });
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

export async function getRisks(homeSlug) {
  return apiFetch(`${API_BASE}/risk-register?home=${h(homeSlug)}`, { headers: authHeaders() });
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

export async function getPolicies(homeSlug) {
  return apiFetch(`${API_BASE}/policies?home=${h(homeSlug)}`, { headers: authHeaders() });
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

export async function getWhistleblowingConcerns(homeSlug) {
  return apiFetch(`${API_BASE}/whistleblowing?home=${h(homeSlug)}`, { headers: authHeaders() });
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

export async function getDols(homeSlug) {
  return apiFetch(`${API_BASE}/dols?home=${h(homeSlug)}`, { headers: authHeaders() });
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

export async function getCqcEvidence(homeSlug) {
  return apiFetch(`${API_BASE}/cqc-evidence?home=${h(homeSlug)}`, { headers: authHeaders() });
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

// ── Token Revocation ────────────────────────────────────────────────────────

export async function revokeUserTokens(username) {
  return apiFetch(`${API_BASE}/login/revoke`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ username }),
  });
}

// ── Payroll API ───────────────────────────────────────────────────────────────

const h = (homeSlug) => encodeURIComponent(homeSlug);

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
export async function getPensionConfig() {
  return apiFetch(`${API_BASE}/payroll/pension-config`, { headers: authHeaders() });
}

// ── Phase 2: SSP & Sick Periods ───────────────────────────────────────────────

export async function getSSPConfig() {
  return apiFetch(`${API_BASE}/payroll/ssp-config`, { headers: authHeaders() });
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
export async function getRetentionSchedule() {
  return apiFetch(`${API_BASE}/gdpr/retention`, { headers: authHeaders() });
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
  const params = new URLSearchParams({ home: homeSlug });
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
  const params = new URLSearchParams({ home: homeSlug });
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
  const params = new URLSearchParams({ home: homeSlug });
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
  const params = new URLSearchParams({ home: homeSlug });
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
  const params = new URLSearchParams({ home: homeSlug });
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
  const params = new URLSearchParams({ home: homeSlug });
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
  const params = new URLSearchParams({ home: homeSlug });
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
  const params = new URLSearchParams({ home: homeSlug });
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
  const params = new URLSearchParams({ home: homeSlug });
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
  const params = new URLSearchParams({ home: homeSlug });
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
  const params = new URLSearchParams({ home: homeSlug });
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
export async function getHrWarnings(homeSlug) {
  return apiFetch(`${API_BASE}/hr/warnings?home=${h(homeSlug)}`, { headers: authHeaders() });
}
export async function getHrStats(homeSlug) {
  return apiFetch(`${API_BASE}/hr/stats?home=${h(homeSlug)}`, { headers: authHeaders() });
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
export async function getHrStaffList(homeSlug) {
  const home = homeSlug || getCurrentHome();
  return apiFetch(`${API_BASE}/hr/staff?home=${encodeURIComponent(home)}`, { headers: authHeaders() });
}

// ── HR File Attachments ─────────────────────────────────────────────────────
export async function getHrAttachments(caseType, caseId) {
  const home = getCurrentHome();
  return apiFetch(`${API_BASE}/hr/attachments/${caseType}/${caseId}?home=${encodeURIComponent(home)}`, { headers: authHeaders() });
}

export async function uploadHrAttachment(caseType, caseId, file, description) {
  const home = getCurrentHome();
  const formData = new FormData();
  formData.append('file', file);
  if (description) formData.append('description', description);
  const token = sessionStorage.getItem('token') || '';
  const res = await fetch(`${API_BASE}/hr/attachments/${caseType}/${caseId}?home=${encodeURIComponent(home)}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData,
  });
  if (res.status === 401) {
    const err = new Error('Session expired — please log in again');
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Upload failed (${res.status})`);
  }
  return res.json();
}

export async function deleteHrAttachment(id) {
  const home = getCurrentHome();
  return apiFetch(`${API_BASE}/hr/attachments/${id}?home=${encodeURIComponent(home)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
}

export async function downloadHrAttachment(id, originalName) {
  const home = getCurrentHome();
  const token = sessionStorage.getItem('token') || '';
  const res = await fetch(`${API_BASE}/hr/attachments/download/${id}?home=${encodeURIComponent(home)}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = originalName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── HR Investigation Meetings ───────────────────────────────────────────────
export async function getHrMeetings(caseType, caseId) {
  const home = getCurrentHome();
  return apiFetch(`${API_BASE}/hr/meetings/${caseType}/${caseId}?home=${encodeURIComponent(home)}`, { headers: authHeaders() });
}

export async function createHrMeeting(caseType, caseId, data) {
  const home = getCurrentHome();
  return apiFetch(`${API_BASE}/hr/meetings/${caseType}/${caseId}?home=${encodeURIComponent(home)}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
}

export async function updateHrMeeting(id, data) {
  const home = getCurrentHome();
  return apiFetch(`${API_BASE}/hr/meetings/${id}?home=${encodeURIComponent(home)}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
}

// ── Finance ──────────────────────────────────────────────────────────────────

// Residents
export async function getFinanceResidents(homeSlug, filters = {}) {
  const params = new URLSearchParams({ home: homeSlug });
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

// Invoices
export async function getFinanceInvoices(homeSlug, filters = {}) {
  const params = new URLSearchParams({ home: homeSlug });
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
  const params = new URLSearchParams({ home: homeSlug });
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
export async function getFinanceAlerts(homeSlug) {
  return apiFetch(`${API_BASE}/finance/alerts?home=${h(homeSlug)}`, { headers: authHeaders() });
}
export async function getDashboardSummary(homeSlug) {
  return apiFetch(`${API_BASE}/dashboard/summary?home=${h(homeSlug)}`, { headers: authHeaders() });
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
  const params = new URLSearchParams({ home: homeSlug });
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
export async function processPaymentSchedule(homeSlug, id) {
  return apiFetch(`${API_BASE}/finance/payment-schedules/${id}/process?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(),
  });
}

// ─── Training ─────────────────────────────────────────────────────────────────

export async function getTrainingData(homeSlug) {
  return apiFetch(`${API_BASE}/training?home=${h(homeSlug)}`, { headers: authHeaders() });
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

export async function updateTrainingTypes(homeSlug, trainingTypes) {
  return apiFetch(`${API_BASE}/training/config/types?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify({ trainingTypes }),
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

export async function getCareCertData(homeSlug) {
  return apiFetch(`${API_BASE}/care-cert?home=${h(homeSlug)}`, { headers: authHeaders() });
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

// ─── Staff CRUD ───────────────────────────────────────────────────────────────

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

export async function saveConfig(homeSlug, config) {
  return apiFetch(`${API_BASE}/homes/config?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify({ config }),
  });
}

// ── Scheduling (Phase 2d) ─────────────────────────────────────────────────────

export async function getSchedulingData(homeSlug) {
  return apiFetch(`${API_BASE}/scheduling?home=${encodeURIComponent(homeSlug)}`, {
    headers: authHeaders(),
  });
}

export async function upsertOverride(homeSlug, { date, staffId, shift, reason, source, sleep_in }) {
  return apiFetch(`${API_BASE}/scheduling/overrides?home=${encodeURIComponent(homeSlug)}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ date, staffId, shift, reason, source, sleep_in }),
  });
}

export async function deleteOverride(homeSlug, date, staffId) {
  const params = new URLSearchParams({ home: homeSlug, date, staffId });
  return apiFetch(`${API_BASE}/scheduling/overrides?${params}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
}

export async function bulkUpsertOverrides(homeSlug, overrides) {
  return apiFetch(`${API_BASE}/scheduling/overrides/bulk?home=${encodeURIComponent(homeSlug)}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ overrides }),
  });
}

export async function revertMonthOverrides(homeSlug, fromDate, toDate) {
  const params = new URLSearchParams({ home: homeSlug, fromDate, toDate });
  return apiFetch(`${API_BASE}/scheduling/overrides/month?${params}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
}

export async function upsertDayNote(homeSlug, date, note) {
  return apiFetch(`${API_BASE}/scheduling/day-notes?home=${encodeURIComponent(homeSlug)}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ date, note }),
  });
}

// ── User Management API ──────────────────────────────────────────────────────

export async function listUsers() {
  return apiFetch(`${API_BASE}/users`, { headers: authHeaders() });
}

export async function createUser(data) {
  return apiFetch(`${API_BASE}/users`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function getUser(id) {
  return apiFetch(`${API_BASE}/users/${id}`, { headers: authHeaders() });
}

export async function updateUser(id, data) {
  return apiFetch(`${API_BASE}/users/${id}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function resetUserPassword(id, newPassword) {
  return apiFetch(`${API_BASE}/users/${id}/reset-password`, {
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
