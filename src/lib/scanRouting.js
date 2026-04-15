import { getRecordAttachmentModule, RECORD_ATTACHMENT_MODULE_IDS } from '../../shared/recordAttachmentModules.js';

export const HR_ATTACHMENT_CASE_TYPES = [
  'disciplinary',
  'grievance',
  'performance',
  'rtw_interview',
  'oh_referral',
  'contract',
  'family_leave',
  'flexible_working',
  'edi',
  'tupe',
  'renewal',
];

function parseCompositeCaseId(caseId) {
  const [left = '', right = ''] = String(caseId || '').split('::');
  return [left, right];
}

export function getScanLaunchContext({ caseType, caseId } = {}) {
  if (!caseType) return null;

  if (RECORD_ATTACHMENT_MODULE_IDS.includes(caseType) && caseId) {
    return {
      target: 'record_attachment',
      moduleId: caseType,
      recordId: String(caseId),
      label: getRecordAttachmentModule(caseType)?.label || caseType,
    };
  }

  if (HR_ATTACHMENT_CASE_TYPES.includes(caseType) && caseId) {
    return {
      target: 'hr_attachment',
      caseType,
      caseId: String(caseId),
      label: caseType.replace(/_/g, ' '),
    };
  }

  if (caseType === 'training' && caseId) {
    const [staffId, typeId] = parseCompositeCaseId(caseId);
    if (!staffId || !typeId) return null;
    return {
      target: 'training',
      staffId,
      typeId,
      label: 'training record',
    };
  }

  if (caseType === 'onboarding' && caseId) {
    const [staffId, section] = parseCompositeCaseId(caseId);
    if (!staffId || !section) return { target: 'onboarding', label: 'onboarding' };
    return {
      target: 'onboarding',
      staffId,
      section,
      label: 'onboarding',
    };
  }

  if (caseType === 'cqc_evidence' && caseId) {
    return {
      target: 'cqc',
      evidenceId: String(caseId),
      label: 'CQC evidence',
    };
  }

  return null;
}

export function buildScanInboxHref(context = {}, returnTo) {
  const params = new URLSearchParams();
  if (context.target) params.set('launchTarget', context.target);
  if (context.moduleId) params.set('moduleId', context.moduleId);
  if (context.recordId) params.set('recordId', context.recordId);
  if (context.caseType) params.set('caseType', context.caseType);
  if (context.caseId) params.set('caseId', context.caseId);
  if (context.staffId) params.set('staffId', context.staffId);
  if (context.typeId) params.set('typeId', context.typeId);
  if (context.section) params.set('section', context.section);
  if (context.evidenceId) params.set('evidenceId', context.evidenceId);
  if (returnTo) params.set('returnTo', returnTo);
  const query = params.toString();
  return query ? `/scan-inbox?${query}` : '/scan-inbox';
}

export function parseScanLaunchParams(searchParams) {
  if (!searchParams) return null;
  const launchTarget = searchParams.get('launchTarget');
  if (!launchTarget) return null;
  return {
    target: launchTarget,
    moduleId: searchParams.get('moduleId') || '',
    recordId: searchParams.get('recordId') || '',
    caseType: searchParams.get('caseType') || '',
    caseId: searchParams.get('caseId') || '',
    staffId: searchParams.get('staffId') || '',
    typeId: searchParams.get('typeId') || '',
    section: searchParams.get('section') || '',
    evidenceId: searchParams.get('evidenceId') || '',
    returnTo: searchParams.get('returnTo') || '',
  };
}

export function describeScanLaunchContext(context) {
  if (!context?.target) return '';
  if (context.target === 'record_attachment') {
    const label = getRecordAttachmentModule(context.moduleId)?.label || context.moduleId || 'record';
    return `${label} ${context.recordId}`.trim();
  }
  if (context.target === 'hr_attachment') {
    return `${String(context.caseType || 'HR case').replace(/_/g, ' ')} ${context.caseId}`.trim();
  }
  if (context.target === 'training') {
    return `training ${context.staffId}:${context.typeId}`.trim();
  }
  if (context.target === 'onboarding') {
    return context.staffId && context.section
      ? `onboarding ${context.staffId}:${context.section}`
      : 'onboarding';
  }
  if (context.target === 'cqc') {
    return context.evidenceId ? `CQC evidence ${context.evidenceId}` : 'CQC evidence';
  }
  if (context.target === 'finance_ap') return 'Finance AP';
  if (context.target === 'maintenance') return 'Maintenance';
  return context.target;
}
