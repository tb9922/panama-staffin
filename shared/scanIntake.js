export const SCAN_INTAKE_TARGETS = [
  { id: 'maintenance', label: 'Maintenance', permissionModule: 'compliance' },
  { id: 'finance_ap', label: 'Finance AP', permissionModule: 'finance' },
  { id: 'onboarding', label: 'Onboarding', permissionModule: 'compliance' },
  { id: 'cqc', label: 'CQC', permissionModule: 'compliance' },
  { id: 'record_attachment', label: 'Current Record', permissionModule: null, contextualOnly: true },
  { id: 'hr_attachment', label: 'HR Case', permissionModule: 'hr', contextualOnly: true },
  { id: 'training', label: 'Training Record', permissionModule: 'compliance', contextualOnly: true },
];

export const SCAN_INTAKE_TARGET_IDS = SCAN_INTAKE_TARGETS.map((entry) => entry.id);

export const SCAN_INTAKE_ACCESS_MODULES = [
  'finance',
  'compliance',
  'hr',
  'scheduling',
  'governance',
  'gdpr',
  'payroll',
  'staff',
];

export const SCAN_INTAKE_STATUSES = [
  'uploaded',
  'extracted',
  'ready_for_review',
  'confirmed',
  'failed',
  'rejected',
];

export const SCAN_INTAKE_STATUS_LABELS = {
  uploaded: 'Uploaded',
  extracted: 'Extracted',
  ready_for_review: 'Ready for review',
  confirmed: 'Filed',
  failed: 'Failed',
  rejected: 'Rejected',
};

export const SCAN_OCR_ENGINES = ['paddleocr'];

export function getScanTarget(id) {
  return SCAN_INTAKE_TARGETS.find((entry) => entry.id === id) || null;
}
