const DEFAULT_EXPECTATIONS = ['processes', 'observation', 'outcomes'];

export const STATEMENT_EXPECTATIONS = {
  S1: ['staff_leader_feedback', 'observation', 'processes', 'outcomes'],
  S2: ['peoples_experience', 'observation', 'processes', 'outcomes'],
  S3: ['peoples_experience', 'staff_leader_feedback', 'processes', 'outcomes'],
  S4: ['peoples_experience', 'observation', 'processes', 'outcomes'],
  S5: ['peoples_experience', 'processes', 'outcomes'],
  S6: ['staff_leader_feedback', 'processes', 'outcomes'],
  S7: ['peoples_experience', 'observation', 'processes'],
  S8: ['partner_feedback', 'processes', 'outcomes'],
  E1: ['peoples_experience', 'observation', 'processes', 'outcomes'],
  E2: ['peoples_experience', 'processes', 'outcomes'],
  E3: ['processes', 'outcomes'],
  E4: ['staff_leader_feedback', 'processes', 'outcomes'],
  E5: ['partner_feedback', 'processes', 'outcomes'],
  E6: ['peoples_experience', 'processes', 'outcomes'],
  C1: ['peoples_experience', 'observation', 'processes'],
  C2: ['peoples_experience', 'partner_feedback', 'processes'],
  C3: ['peoples_experience', 'staff_leader_feedback', 'observation'],
  C4: ['peoples_experience', 'partner_feedback', 'outcomes'],
  C5: ['peoples_experience', 'staff_leader_feedback', 'outcomes'],
  R1: ['peoples_experience', 'processes', 'outcomes'],
  R2: ['partner_feedback', 'processes', 'outcomes'],
  R3: ['peoples_experience', 'processes', 'outcomes'],
  R4: ['staff_leader_feedback', 'processes', 'outcomes'],
  R5: ['peoples_experience', 'partner_feedback', 'processes'],
  WL1: ['staff_leader_feedback', 'processes', 'outcomes'],
  WL2: ['staff_leader_feedback', 'processes'],
  WL3: ['staff_leader_feedback', 'outcomes'],
  WL4: ['staff_leader_feedback', 'processes', 'outcomes'],
  WL5: ['peoples_experience', 'staff_leader_feedback', 'outcomes'],
  WL6: ['partner_feedback', 'peoples_experience', 'outcomes'],
  WL7: ['partner_feedback', 'staff_leader_feedback', 'processes'],
  WL8: ['staff_leader_feedback', 'processes', 'outcomes'],
  WL9: ['partner_feedback', 'processes', 'outcomes'],
  WL10: ['partner_feedback', 'staff_leader_feedback', 'outcomes'],
};

export function getExpectedEvidenceCategories(statementId) {
  return STATEMENT_EXPECTATIONS[statementId] || DEFAULT_EXPECTATIONS;
}
