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

// ── HR & People ──────────────────────────────────────────────────────────────

// Disciplinary
export async function getHrDisciplinary(homeSlug, filters = {}) {
  const params = new URLSearchParams({ home: homeSlug });
  if (filters.staffId) params.set('staff_id', filters.staffId);
  if (filters.status) params.set('status', filters.status);
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
  return apiFetch(`${API_BASE}/hr/cases/disciplinary/${id}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

// Grievance
export async function getHrGrievance(homeSlug, filters = {}) {
  const params = new URLSearchParams({ home: homeSlug });
  if (filters.staffId) params.set('staff_id', filters.staffId);
  if (filters.status) params.set('status', filters.status);
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
  return apiFetch(`${API_BASE}/hr/cases/grievance/${id}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function getGrievanceActions(id) {
  return apiFetch(`${API_BASE}/hr/cases/grievance/${id}/actions`, { headers: authHeaders() });
}
export async function createGrievanceAction(id, data) {
  return apiFetch(`${API_BASE}/hr/cases/grievance/${id}/actions`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function updateGrievanceAction(id, data) {
  return apiFetch(`${API_BASE}/hr/grievance-actions/${id}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

// Performance
export async function getHrPerformance(homeSlug, filters = {}) {
  const params = new URLSearchParams({ home: homeSlug });
  if (filters.staffId) params.set('staff_id', filters.staffId);
  if (filters.status) params.set('status', filters.status);
  if (filters.type) params.set('type', filters.type);
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
  return apiFetch(`${API_BASE}/hr/cases/performance/${id}`, {
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
  return apiFetch(`${API_BASE}/hr/rtw-interviews?${params}`, { headers: authHeaders() });
}
export async function createHrRtwInterview(homeSlug, data) {
  return apiFetch(`${API_BASE}/hr/rtw-interviews?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function updateHrRtwInterview(id, data) {
  return apiFetch(`${API_BASE}/hr/rtw-interviews/${id}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

// OH Referrals
export async function getHrOhReferrals(homeSlug, filters = {}) {
  const params = new URLSearchParams({ home: homeSlug });
  if (filters.staffId) params.set('staff_id', filters.staffId);
  return apiFetch(`${API_BASE}/hr/oh-referrals?${params}`, { headers: authHeaders() });
}
export async function createHrOhReferral(homeSlug, data) {
  return apiFetch(`${API_BASE}/hr/oh-referrals?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function updateHrOhReferral(id, data) {
  return apiFetch(`${API_BASE}/hr/oh-referrals/${id}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

// Contracts
export async function getHrContracts(homeSlug, filters = {}) {
  const params = new URLSearchParams({ home: homeSlug });
  if (filters.staffId) params.set('staff_id', filters.staffId);
  if (filters.status) params.set('status', filters.status);
  return apiFetch(`${API_BASE}/hr/contracts?${params}`, { headers: authHeaders() });
}
export async function createHrContract(homeSlug, data) {
  return apiFetch(`${API_BASE}/hr/contracts?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function updateHrContract(id, data) {
  return apiFetch(`${API_BASE}/hr/contracts/${id}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

// Family Leave
export async function getHrFamilyLeave(homeSlug, filters = {}) {
  const params = new URLSearchParams({ home: homeSlug });
  if (filters.staffId) params.set('staff_id', filters.staffId);
  if (filters.type) params.set('type', filters.type);
  return apiFetch(`${API_BASE}/hr/family-leave?${params}`, { headers: authHeaders() });
}
export async function createHrFamilyLeave(homeSlug, data) {
  return apiFetch(`${API_BASE}/hr/family-leave?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function updateHrFamilyLeave(id, data) {
  return apiFetch(`${API_BASE}/hr/family-leave/${id}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

// Flexible Working
export async function getHrFlexWorking(homeSlug, filters = {}) {
  const params = new URLSearchParams({ home: homeSlug });
  if (filters.staffId) params.set('staff_id', filters.staffId);
  if (filters.status) params.set('status', filters.status);
  return apiFetch(`${API_BASE}/hr/flexible-working?${params}`, { headers: authHeaders() });
}
export async function createHrFlexWorking(homeSlug, data) {
  return apiFetch(`${API_BASE}/hr/flexible-working?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function updateHrFlexWorking(id, data) {
  return apiFetch(`${API_BASE}/hr/flexible-working/${id}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

// EDI
export async function getHrEdi(homeSlug, filters = {}) {
  const params = new URLSearchParams({ home: homeSlug });
  if (filters.recordType) params.set('record_type', filters.recordType);
  if (filters.staffId) params.set('staff_id', filters.staffId);
  return apiFetch(`${API_BASE}/hr/edi?${params}`, { headers: authHeaders() });
}
export async function createHrEdi(homeSlug, data) {
  return apiFetch(`${API_BASE}/hr/edi?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function updateHrEdi(id, data) {
  return apiFetch(`${API_BASE}/hr/edi/${id}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

// TUPE
export async function getHrTupe(homeSlug) {
  return apiFetch(`${API_BASE}/hr/tupe?home=${h(homeSlug)}`, { headers: authHeaders() });
}
export async function createHrTupe(homeSlug, data) {
  return apiFetch(`${API_BASE}/hr/tupe?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function updateHrTupe(id, data) {
  return apiFetch(`${API_BASE}/hr/tupe/${id}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

// Renewals
export async function getHrRenewals(homeSlug, filters = {}) {
  const params = new URLSearchParams({ home: homeSlug });
  if (filters.staffId) params.set('staff_id', filters.staffId);
  if (filters.checkType) params.set('check_type', filters.checkType);
  if (filters.status) params.set('status', filters.status);
  return apiFetch(`${API_BASE}/hr/renewals?${params}`, { headers: authHeaders() });
}
export async function createHrRenewal(homeSlug, data) {
  return apiFetch(`${API_BASE}/hr/renewals?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}
export async function updateHrRenewal(id, data) {
  return apiFetch(`${API_BASE}/hr/renewals/${id}`, {
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
export async function getHrCaseNotes(caseType, caseId) {
  return apiFetch(`${API_BASE}/hr/case-notes/${caseType}/${caseId}`, { headers: authHeaders() });
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
