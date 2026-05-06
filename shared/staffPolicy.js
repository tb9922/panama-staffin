export const STAFF_SENSITIVE_ROLE_IDS = ['home_manager', 'deputy_manager', 'hr_officer'];

export const STAFF_SENSITIVE_FIELDS = [
  'hourly_rate',
  'contract_hours',
  'date_of_birth',
  'ni_number',
  'active',
  'al_entitlement',
  'al_carryover',
  'phone',
  'address',
  'emergency_contact',
  'wtr_opt_out',
  'leaving_date',
  'willing_extras',
  'willing_other_homes',
  'max_weekly_hours_topup',
  'max_travel_radius_km',
  'home_postcode',
  'internal_bank_status',
  'internal_bank_notes',
  'notes',
];

export const SENSITIVE_ONBOARDING_SECTIONS = [
  'dbs_check',
  'right_to_work',
  'references',
  'identity_check',
  'health_declaration',
  'contract',
  'employment_history',
];

const SENSITIVE_STAFF_FIELD_SET = new Set(STAFF_SENSITIVE_FIELDS);
const SENSITIVE_STAFF_ROLE_SET = new Set(STAFF_SENSITIVE_ROLE_IDS);
const SENSITIVE_ONBOARDING_SECTION_SET = new Set(SENSITIVE_ONBOARDING_SECTIONS);

function sectionKey(section) {
  return typeof section === 'string' ? section : section?.id;
}

function sameValue(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function canManageSensitiveStaffFields(roleId, { isPlatformAdmin = false } = {}) {
  return isPlatformAdmin || SENSITIVE_STAFF_ROLE_SET.has(roleId);
}

export function isSensitiveStaffField(field) {
  return SENSITIVE_STAFF_FIELD_SET.has(field);
}

export function listChangedSensitiveStaffFields(payload = {}, existing = null) {
  return Object.keys(payload || {}).filter((key) => {
    if (!isSensitiveStaffField(key)) return false;
    if (!existing) return true;
    return !sameValue(payload[key], existing[key]);
  });
}

export function redactStaffForBroadReader(staff) {
  const list = Array.isArray(staff) ? staff : [];
  return list.map(({ id, name, role, team, pref, skill, active, start_date, version }) => ({
    id,
    name,
    role,
    team,
    pref,
    skill,
    active,
    start_date,
    version,
  }));
}

export function isSensitiveOnboardingSection(section) {
  return SENSITIVE_ONBOARDING_SECTION_SET.has(sectionKey(section));
}

export function canAccessSensitiveOnboarding(roleId, options = {}) {
  return canManageSensitiveStaffFields(roleId, options);
}

export function visibleOnboardingSectionsForRole(sections, roleId, options = {}) {
  if (canAccessSensitiveOnboarding(roleId, options)) return sections;
  return sections.filter((section) => !isSensitiveOnboardingSection(section));
}
