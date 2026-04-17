const OFFICIAL_CQC_EVIDENCE_CATEGORIES = [
  { id: 'peoples_experience', label: "People's Experience" },
  { id: 'staff_leader_feedback', label: 'Feedback from Staff and Leaders' },
  { id: 'partner_feedback', label: 'Feedback from Partners' },
  { id: 'observation', label: 'Observation' },
  { id: 'processes', label: 'Processes' },
  { id: 'outcomes', label: 'Outcomes' },
];

const LEGACY_CATEGORY_ALIASES = {
  feedback: 'staff_leader_feedback',
  management_info: 'processes',
};

const CATEGORY_LABELS = Object.fromEntries(
  OFFICIAL_CQC_EVIDENCE_CATEGORIES.map((category) => [category.id, category.label])
);

export const ALLOWED_CQC_EVIDENCE_CATEGORY_VALUES = [
  ...OFFICIAL_CQC_EVIDENCE_CATEGORIES.map((category) => category.id),
  ...Object.keys(LEGACY_CATEGORY_ALIASES),
];

export function normalizeEvidenceCategory(value) {
  if (!value) return null;
  if (CATEGORY_LABELS[value]) return value;
  return LEGACY_CATEGORY_ALIASES[value] || null;
}

export function getEvidenceCategoryLabel(value) {
  const normalized = normalizeEvidenceCategory(value);
  return normalized ? CATEGORY_LABELS[normalized] : value || '';
}

export function getAllEvidenceCategories() {
  return OFFICIAL_CQC_EVIDENCE_CATEGORIES.slice();
}
