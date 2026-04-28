import { getTrainingTypes } from '../shared/training.js';

export const INTERNAL_BANK_BLOCKING_TRAINING_TYPE_IDS = [
  'fire-safety',
  'moving-handling',
  'safeguarding-adults',
  'medication-awareness',
];

function appliesToRole(trainingType, role) {
  if (!Array.isArray(trainingType?.roles) || trainingType.roles.length === 0) return true;
  return trainingType.roles.includes(role);
}

export function evaluateInternalBankTrainingEligibility({
  staff,
  recordsByType = new Map(),
  effectiveDate,
} = {}) {
  const trainingTypes = getTrainingTypes(staff?.home_config || {});
  const blockers = [];

  for (const typeId of INTERNAL_BANK_BLOCKING_TRAINING_TYPE_IDS) {
    const trainingType = trainingTypes.find(type => type.id === typeId && type.active !== false);
    if (!trainingType || !appliesToRole(trainingType, staff?.role)) continue;

    const expiry = recordsByType.get(typeId);
    if (!expiry || expiry < effectiveDate) {
      blockers.push(`Training expired or missing: ${trainingType.name || typeId}`);
    }
  }

  return {
    status: blockers.length > 0 ? 'blocked' : 'ok',
    blockers,
  };
}
