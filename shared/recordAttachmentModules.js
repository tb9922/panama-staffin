import { hasModuleAccess } from './roles.js';

export const RECORD_ATTACHMENT_MODULES = [
  { id: 'incident', label: 'Incident', permissionModule: 'compliance', pagePath: '/incidents' },
  { id: 'complaint', label: 'Complaint', permissionModule: 'compliance', pagePath: '/complaints' },
  { id: 'ipc_audit', label: 'IPC Audit', permissionModule: 'compliance', pagePath: '/ipc' },
  { id: 'maintenance', label: 'Maintenance', permissionModule: 'governance', pagePath: '/maintenance' },
  { id: 'bed', label: 'Bed', permissionModule: 'finance', pagePath: '/beds' },
  { id: 'budget_month', label: 'Budget', permissionModule: 'finance', pagePath: '/budget' },
  { id: 'handover_entry', label: 'Handover', permissionModule: 'scheduling', pagePath: '/handover' },
  { id: 'payroll_run', label: 'Payroll Run', permissionModule: 'payroll', pagePath: '/payroll' },
  { id: 'schedule_override', label: 'Schedule Override', permissionModule: 'scheduling', pagePath: '/day' },
  { id: 'investigation_meeting', label: 'Investigation Meeting', permissionModule: 'hr', pagePath: '/hr/disciplinary' },
  { id: 'supervision', label: 'Supervision', permissionModule: 'compliance', pagePath: '/training' },
  { id: 'appraisal', label: 'Appraisal', permissionModule: 'compliance', pagePath: '/training' },
  { id: 'fire_drill', label: 'Fire Drill', permissionModule: 'compliance', pagePath: '/training' },
  { id: 'policy_review', label: 'Policy Review', permissionModule: 'governance', pagePath: '/policies' },
  { id: 'risk', label: 'Risk', permissionModule: 'governance', pagePath: '/risks' },
  { id: 'whistleblowing', label: 'Whistleblowing', permissionModule: 'governance', pagePath: '/speak-up' },
  { id: 'dols', label: 'DoLS', permissionModule: 'compliance', pagePath: '/dols' },
  { id: 'mca_assessment', label: 'MCA Assessment', permissionModule: 'compliance', pagePath: '/dols' },
  { id: 'dpia', label: 'DPIA', permissionModule: 'gdpr', pagePath: '/dpia' },
  { id: 'ropa', label: 'ROPA', permissionModule: 'gdpr', pagePath: '/ropa' },
  { id: 'finance_expense', label: 'Expense', permissionModule: 'finance', pagePath: '/finance/expenses' },
  { id: 'finance_resident', label: 'Resident', permissionModule: 'finance', pagePath: '/residents' },
  { id: 'finance_invoice', label: 'Invoice', permissionModule: 'finance', pagePath: '/finance/income' },
  { id: 'finance_payment_schedule', label: 'Payment Schedule', permissionModule: 'finance', pagePath: '/finance/payables' },
  { id: 'payroll_rate_rule', label: 'Pay Rate', permissionModule: 'payroll', pagePath: '/payroll/rates' },
  { id: 'payroll_timesheet', label: 'Timesheet', permissionModule: 'payroll', pagePath: '/payroll/timesheets' },
  { id: 'payroll_tax_code', label: 'Tax Code', permissionModule: 'payroll', pagePath: '/payroll/tax-codes' },
  { id: 'payroll_pension', label: 'Pension', permissionModule: 'payroll', pagePath: '/payroll/pensions' },
  { id: 'payroll_sick_period', label: 'Sick Pay', permissionModule: 'payroll', pagePath: '/payroll/sick-pay' },
  { id: 'agency_provider', label: 'Agency Provider', permissionModule: 'payroll', pagePath: '/payroll/agency' },
  { id: 'agency_shift', label: 'Agency Shift', permissionModule: 'payroll', pagePath: '/payroll/agency' },
  { id: 'care_certificate', label: 'Care Certificate', permissionModule: 'compliance', pagePath: '/care-cert' },
  { id: 'staff_register', label: 'Staff Register', permissionModule: 'staff', pagePath: '/staff' },
];

export const RECORD_ATTACHMENT_MODULE_IDS = RECORD_ATTACHMENT_MODULES.map((entry) => entry.id);

const RECORD_ATTACHMENT_MODULE_MAP = Object.fromEntries(
  RECORD_ATTACHMENT_MODULES.map((entry) => [entry.id, entry])
);

export const RECORD_ATTACHMENT_PERMISSION_BY_MODULE = Object.fromEntries(
  RECORD_ATTACHMENT_MODULES.map((entry) => [entry.id, entry.permissionModule])
);

export function getRecordAttachmentModule(moduleId) {
  return RECORD_ATTACHMENT_MODULE_MAP[moduleId] || null;
}

export function getReadableRecordAttachmentModules(roleId) {
  return RECORD_ATTACHMENT_MODULES.filter((entry) => hasModuleAccess(roleId, entry.permissionModule, 'read'));
}

export function getWritableRecordAttachmentModules(roleId) {
  return RECORD_ATTACHMENT_MODULES.filter((entry) => hasModuleAccess(roleId, entry.permissionModule, 'write'));
}

export function canReadRecordAttachmentModule(roleId, moduleId) {
  const entry = getRecordAttachmentModule(moduleId);
  return Boolean(entry && hasModuleAccess(roleId, entry.permissionModule, 'read'));
}

export function canWriteRecordAttachmentModule(roleId, moduleId) {
  const entry = getRecordAttachmentModule(moduleId);
  return Boolean(entry && hasModuleAccess(roleId, entry.permissionModule, 'write'));
}
