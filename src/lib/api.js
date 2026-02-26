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
export async function getTimesheetPeriod(homeSlug, start, end, status) {
  const statusQ = status ? `&status=${status}` : '';
  return apiFetch(`${API_BASE}/payroll/timesheets/period?home=${h(homeSlug)}&start=${start}&end=${end}${statusQ}`, { headers: authHeaders() });
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
export async function bulkApproveTimesheets(homeSlug, date) {
  return apiFetch(`${API_BASE}/payroll/timesheets/bulk-approve?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ date }),
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
export async function updateDataRequest(id, data) {
  return apiFetch(`${API_BASE}/gdpr/requests/${id}`, {
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
export async function updateDataBreach(id, data) {
  return apiFetch(`${API_BASE}/gdpr/breaches/${id}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function assessBreach(id) {
  return apiFetch(`${API_BASE}/gdpr/breaches/${id}/assess`, {
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
export async function updateConsentRecord(id, data) {
  return apiFetch(`${API_BASE}/gdpr/consent/${id}`, {
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
export async function updateDPComplaint(id, data) {
  return apiFetch(`${API_BASE}/gdpr/complaints/${id}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

// Access log (global — not per-home)
export async function getAccessLog(limit = 100) {
  return apiFetch(`${API_BASE}/gdpr/access-log?limit=${limit}`, { headers: authHeaders() });
}
