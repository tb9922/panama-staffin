import { hasModuleAccess } from './roles.js';
import {
  canWriteRecordAttachmentModule,
  getReadableRecordAttachmentModules,
  getWritableRecordAttachmentModules,
} from './recordAttachmentModules.js';

export const EVIDENCE_SOURCE_IDS = ['hr', 'cqc_evidence', 'onboarding', 'training', 'record'];

const BASE_EVIDENCE_SOURCES = [
  { id: 'hr', label: 'HR Cases', module: 'hr' },
  { id: 'cqc_evidence', label: 'CQC Evidence', module: 'compliance' },
  { id: 'onboarding', label: 'Onboarding', module: 'compliance' },
  { id: 'training', label: 'Training', module: 'compliance' },
];

const RECORD_SOURCE = { id: 'record', label: 'Operational Records', module: null };

export function getEvidenceSource(sourceId) {
  if (sourceId === 'record') return RECORD_SOURCE;
  return BASE_EVIDENCE_SOURCES.find((source) => source.id === sourceId) || null;
}

export function getReadableEvidenceSources(roleId) {
  const readable = BASE_EVIDENCE_SOURCES.filter((source) => hasModuleAccess(roleId, source.module, 'read'));
  if (getReadableRecordAttachmentModules(roleId).length > 0) {
    readable.push(RECORD_SOURCE);
  }
  return readable;
}

export function getWritableEvidenceSources(roleId) {
  const writable = BASE_EVIDENCE_SOURCES.filter((source) => hasModuleAccess(roleId, source.module, 'write'));
  if (getWritableRecordAttachmentModules(roleId).length > 0) {
    writable.push(RECORD_SOURCE);
  }
  return writable;
}

export function canAccessEvidenceHub(roleId) {
  return getReadableEvidenceSources(roleId).length > 0;
}

export function canDeleteEvidenceSource(roleId, sourceId, sourceSubType = null) {
  if (sourceId === 'record') {
    return Boolean(sourceSubType) && canWriteRecordAttachmentModule(roleId, sourceSubType);
  }
  const source = getEvidenceSource(sourceId);
  return Boolean(source?.module && hasModuleAccess(roleId, source.module, 'write'));
}

export function getEvidenceSourceLabel(sourceId) {
  return getEvidenceSource(sourceId)?.label || sourceId;
}
