export const MOCK_CONFIG = {
  home_name: 'Test Care Home',
  registered_beds: 30,
  care_type: 'residential',
  cycle_start_date: '2025-01-06',
  shifts: {
    E: { start: '07:00', end: '15:00', hours: 8 },
    L: { start: '14:00', end: '22:00', hours: 8 },
    EL: { start: '07:00', end: '19:00', hours: 12 },
    N: { start: '21:00', end: '07:00', hours: 10 },
  },
  minimum_staffing: {
    early: { heads: 4, skill_points: 2 },
    late: { heads: 4, skill_points: 2 },
    night: { heads: 2, skill_points: 1 },
  },
  agency_rate_day: 25,
  agency_rate_night: 30,
  ot_premium: 2,
  bh_premium_multiplier: 2,
  max_consecutive_days: 6,
  max_al_same_day: 2,
  leave_year_start: '04-01',
  al_carryover_max: 8,
  bank_holidays: [],
  nlw_rate: 12.21,
  training_types: [],
  incident_types: [],
  complaint_categories: [],
  supervision_frequency_probation: 30,
  supervision_frequency_standard: 49,
  supervision_probation_months: 6,
};

export const MOCK_STAFF = [
  {
    id: 'S001', name: 'Alice Smith', role: 'Senior Carer', team: 'Day A',
    pref: 'EL', skill: 1.5, hourly_rate: 14.50, active: true,
    start_date: '2023-04-01', contract_hours: 36, wtr_opt_out: false,
    al_entitlement: null, al_carryover: 0, leaving_date: null,
  },
  {
    id: 'S002', name: 'Bob Jones', role: 'Carer', team: 'Day B',
    pref: 'EL', skill: 0.5, hourly_rate: 12.50, active: true,
    start_date: '2024-01-15', contract_hours: 36, wtr_opt_out: false,
    al_entitlement: null, al_carryover: 0, leaving_date: null,
  },
  {
    id: 'S003', name: 'Carol Davis', role: 'Night Carer', team: 'Night A',
    pref: 'N', skill: 0.5, hourly_rate: 13.00, active: true,
    start_date: '2022-09-01', contract_hours: 40, wtr_opt_out: false,
    al_entitlement: null, al_carryover: 0, leaving_date: null,
  },
  {
    id: 'S004', name: 'Dan Wilson', role: 'Float Carer', team: 'Float',
    pref: 'ANY', skill: 0.5, hourly_rate: 12.50, active: false,
    start_date: '2024-06-01', contract_hours: 24, wtr_opt_out: false,
    al_entitlement: null, al_carryover: 0, leaving_date: '2025-12-01',
  },
];

export const MOCK_OVERRIDES = {};

export const MOCK_SCHEDULING_DATA = {
  config: MOCK_CONFIG,
  staff: MOCK_STAFF,
  overrides: MOCK_OVERRIDES,
  training: {},
  supervisions: {},
  appraisals: {},
  fire_drills: [],
  day_notes: {},
};

export const MOCK_INCIDENTS = [
  {
    id: 'INC-001', date: '2026-03-01', time: '14:30', location: 'Lounge',
    type: 'fall', severity: 'moderate', description: 'Resident slipped on wet floor',
    person_affected: 'resident', person_affected_name: 'Jane Doe',
    staff_involved: ['S001'], immediate_action: 'First aid administered',
    medical_attention: true, hospital_attendance: false,
    cqc_notifiable: false, riddor_reportable: false, safeguarding_referral: false,
    investigation_status: 'open', corrective_actions: [],
    reported_by: 'admin', reported_at: '2026-03-01T15:00:00Z',
    updated_at: '2026-03-01T15:00:00Z',
  },
];

export const MOCK_COMPLAINTS = [
  {
    id: 'CMP-001', date: '2026-02-15', raised_by: 'family',
    raised_by_name: 'John Family', category: 'care_quality',
    title: 'Medication timing', description: 'Medication given late',
    status: 'investigating', reported_by: 'admin',
    reported_at: '2026-02-15T10:00:00Z', updated_at: '2026-02-15T10:00:00Z',
  },
];
