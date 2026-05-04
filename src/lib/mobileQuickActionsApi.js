import { buildScanInboxHref } from './scanRouting.js';

export const MOBILE_QUICK_ACTIONS_ROUTE = '/mobile-quick-actions';

export const MOBILE_QUICK_ACTIONS = [
  {
    id: 'report-incident',
    label: 'Report Incident',
    shortLabel: 'Incident',
    module: 'compliance',
    intent: 'write',
    href: '/incidents?quick=incident&mode=new',
    badge: 'Compliance',
    tone: 'red',
    summary: 'Open the incident tracker with today as the working context.',
    cqcDomain: 'Safe',
    initials: 'IR',
  },
  {
    id: 'add-handover-note',
    label: 'Add Handover Note',
    shortLabel: 'Handover',
    module: 'scheduling',
    intent: 'write',
    href: '/handover?quick=handover&mode=new',
    badge: 'Scheduling',
    tone: 'blue',
    summary: 'Capture a shift note, safety update, or unresolved action.',
    cqcDomain: 'Well-led',
    initials: 'HN',
  },
  {
    id: 'log-maintenance-issue',
    label: 'Log Maintenance Issue',
    shortLabel: 'Maintenance',
    module: 'compliance',
    intent: 'write',
    href: '/maintenance?quick=maintenance&mode=new',
    badge: 'Premises',
    tone: 'amber',
    summary: 'Start a maintenance record without adding clinical advice.',
    cqcDomain: 'Safe',
    initials: 'MI',
  },
  {
    id: 'complete-manager-action',
    label: 'Complete or Verify Action',
    shortLabel: 'Actions',
    module: 'governance',
    intent: 'write',
    href: '/actions?quick=manager-action&status=open',
    badge: 'Governance',
    tone: 'green',
    summary: 'Jump to open actions for completion, evidence, or verification.',
    cqcDomain: 'Responsive',
    initials: 'AV',
  },
  {
    id: 'start-audit-task',
    label: 'Start Audit Task',
    shortLabel: 'Audit',
    module: 'governance',
    intent: 'write',
    href: '/audit-calendar?quick=audit-task&status=open',
    badge: 'Audit',
    tone: 'purple',
    summary: 'Open the audit calendar to start or sign off a task.',
    cqcDomain: 'Well-led',
    initials: 'AT',
  },
];

export function buildEvidenceUploadHref({ scanIntakeEnabled, scanIntakeTargets = [], returnTo = MOBILE_QUICK_ACTIONS_ROUTE } = {}) {
  if (scanIntakeEnabled && scanIntakeTargets.includes('cqc')) {
    return buildScanInboxHref({ target: 'cqc' }, returnTo);
  }
  if (scanIntakeEnabled && scanIntakeTargets.includes('maintenance')) {
    return buildScanInboxHref({ target: 'maintenance' }, returnTo);
  }
  if (scanIntakeEnabled && scanIntakeTargets.includes('handover')) {
    return buildScanInboxHref({ target: 'handover' }, returnTo);
  }
  return '/evidence?quick=evidence-upload';
}

export function getMobileQuickActions({ canRead, canWrite, scanIntakeEnabled = false, scanIntakeTargets = [] } = {}) {
  const canUse = (action) => {
    const checker = action.intent === 'write' ? canWrite : canRead;
    return typeof checker === 'function' && checker(action.module);
  };

  const actions = MOBILE_QUICK_ACTIONS
    .map((action) => ({ ...action, available: canUse(action) }))
    .filter((action) => action.available);

  const canAddEvidence = typeof canRead === 'function' && (
    canRead('compliance') || canRead('governance') || canRead('reports')
  );

  if (canAddEvidence) {
    actions.push({
      id: 'add-evidence',
      label: 'Add Evidence',
      shortLabel: 'Evidence',
      module: 'reports',
      intent: 'read',
      href: buildEvidenceUploadHref({ scanIntakeEnabled, scanIntakeTargets }),
      badge: scanIntakeEnabled ? 'Upload' : 'Evidence hub',
      tone: 'gray',
      summary: scanIntakeEnabled
        ? 'Upload or classify evidence through the scan inbox.'
        : 'Open the evidence hub and attach to the right record.',
      cqcDomain: 'Effective',
      initials: 'EV',
      available: true,
    });
  }

  return actions;
}
