/**
 * Unit tests for validationService.
 *
 * These are pure functions operating on in-memory data objects —
 * no database required. Tests the 17 domain validators that run
 * on every save to catch compliance issues.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateAll } from '../../services/validationService.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Minimal valid data object — no warnings expected */
function baseData() {
  return {
    config: {
      max_al_same_day: 2,
      al_entitlement_days: 28,
      leave_year_start: '04-01',
      nlw_rate: 12.71,
      training_types: [],
    },
    staff: [],
    overrides: {},
  };
}

function makeStaff(overrides = {}) {
  return {
    id: 'S001', name: 'Test Staff', role: 'Carer', team: 'Day A',
    active: true, hourly_rate: 13.00, start_date: '2024-01-01',
    al_entitlement: null, al_carryover: 0,
    ...overrides,
  };
}

// Fix "today" so date-sensitive tests are deterministic
const FIXED_NOW = new Date('2025-06-15T12:00:00Z');
let dateSpy;

beforeEach(() => {
  dateSpy = vi.spyOn(globalThis, 'Date').mockImplementation(function (...args) {
    if (args.length === 0) return FIXED_NOW;
    // Allow new Date('2025-01-01') to work normally
    return new (Object.getPrototypeOf(FIXED_NOW).constructor)(...args);
  });
  // Preserve static methods
  dateSpy.UTC = Date.UTC;
  dateSpy.now = () => FIXED_NOW.getTime();
});

afterEach(() => {
  dateSpy.mockRestore();
});

// ── validateAll basics ──────────────────────────────────────────────────────

describe('validateAll', () => {
  it('returns empty array for clean data', () => {
    const data = baseData();
    // Supply enough fire drills to avoid the quarterly warning
    data.fire_drills = [
      { date: '2025-06-01' }, { date: '2025-03-01' },
      { date: '2024-12-01' }, { date: '2024-09-01' },
    ];
    const warnings = validateAll(data);
    expect(warnings).toEqual([]);
  });

  it('returns empty array if overrides/config/staff missing', () => {
    expect(validateAll({})).toEqual([]);
    expect(validateAll({ config: {} })).toEqual([]);
    expect(validateAll({ config: {}, staff: [] })).toEqual([]);
  });
});

// ── AL per day ──────────────────────────────────────────────────────────────

describe('validateALPerDay', () => {
  it('warns when AL bookings exceed max_al_same_day', () => {
    const data = baseData();
    data.config.max_al_same_day = 1;
    data.overrides = {
      '2025-06-20': {
        S001: { shift: 'AL' },
        S002: { shift: 'AL' },
      },
    };
    const warnings = validateAll(data);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('2025-06-20')])
    );
  });

  it('no warning when within limit', () => {
    const data = baseData();
    data.config.max_al_same_day = 2;
    data.overrides = {
      '2025-06-20': {
        S001: { shift: 'AL' },
        S002: { shift: 'AL' },
      },
    };
    const warnings = validateAll(data);
    expect(warnings.filter(w => w.includes('AL bookings'))).toHaveLength(0);
  });
});

// ── AL entitlement ──────────────────────────────────────────────────────────

describe('validateALEntitlement', () => {
  it('warns when staff exceeds annual entitlement (hours)', () => {
    const data = baseData();
    // al_entitlement is now in hours (not days)
    data.staff = [makeStaff({ al_entitlement: 20, al_carryover: 0, contract_hours: 36 })];
    // 3 AL bookings with stored al_hours totalling 30h > 20h entitlement
    data.overrides = {
      '2025-04-10': { S001: { shift: 'AL', al_hours: 12 } },
      '2025-04-11': { S001: { shift: 'AL', al_hours: 10 } },
      '2025-04-12': { S001: { shift: 'AL', al_hours: 8 } },
    };
    const warnings = validateAll(data);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('exceeds')])
    );
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('entitlement')])
    );
  });

  it('includes carryover in entitlement calculation', () => {
    const data = baseData();
    // 20h entitlement + 16h carryover = 36h total
    data.staff = [makeStaff({ al_entitlement: 20, al_carryover: 16, contract_hours: 36 })];
    // 3 AL bookings totalling 36h — exactly at entitlement (no warning)
    data.overrides = {
      '2025-04-10': { S001: { shift: 'AL', al_hours: 12 } },
      '2025-04-11': { S001: { shift: 'AL', al_hours: 12 } },
      '2025-04-12': { S001: { shift: 'AL', al_hours: 12 } },
    };
    const warnings = validateAll(data);
    expect(warnings.filter(w => w.includes('exceeds') && w.includes('entitlement'))).toHaveLength(0);
  });
});

// ── NLW ─────────────────────────────────────────────────────────────────────

describe('validateNLW', () => {
  it('warns for staff below NLW (21+)', () => {
    const data = baseData();
    data.config.nlw_rate = 12.71;
    data.staff = [makeStaff({ hourly_rate: 10.50, date_of_birth: '1990-01-01' })];
    const warnings = validateAll(data);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('below NLW')])
    );
  });

  it('no warning for staff at or above NLW', () => {
    const data = baseData();
    data.config.nlw_rate = 12.71;
    data.staff = [makeStaff({ hourly_rate: 12.71, date_of_birth: '1990-01-01' })];
    const warnings = validateAll(data);
    expect(warnings.filter(w => w.includes('NLW') || w.includes('NMW'))).toHaveLength(0);
  });

  it('skips inactive staff', () => {
    const data = baseData();
    data.staff = [makeStaff({ hourly_rate: 5.00, active: false })];
    const warnings = validateAll(data);
    expect(warnings.filter(w => w.includes('NLW') || w.includes('NMW'))).toHaveLength(0);
  });

  it('uses 18-20 rate for staff aged 18-20', () => {
    const data = baseData();
    data.config.nlw_rate = 12.71;
    data.config.nmw_rate_18_20 = 10.85;
    // Born 19 years ago from FIXED_NOW (2025-06-15)
    data.staff = [makeStaff({ hourly_rate: 10.85, date_of_birth: '2006-06-16' })];
    const warnings = validateAll(data);
    expect(warnings.filter(w => w.includes('NLW') || w.includes('NMW'))).toHaveLength(0);
  });

  it('warns 18-20 staff below NMW 18-20 rate', () => {
    const data = baseData();
    data.config.nlw_rate = 12.71;
    data.config.nmw_rate_18_20 = 10.85;
    data.staff = [makeStaff({ hourly_rate: 9.50, date_of_birth: '2006-06-16' })];
    const warnings = validateAll(data);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('below NMW (18-20)')])
    );
  });

  it('uses under-18 rate for staff under 18', () => {
    const data = baseData();
    data.config.nlw_rate = 12.71;
    data.config.nmw_rate_under_18 = 8.00;
    // Born 17 years ago from FIXED_NOW (2025-06-15)
    data.staff = [makeStaff({ hourly_rate: 8.00, date_of_birth: '2008-01-01' })];
    const warnings = validateAll(data);
    expect(warnings.filter(w => w.includes('NLW') || w.includes('NMW'))).toHaveLength(0);
  });

  it('defaults to NLW rate when no DOB provided', () => {
    const data = baseData();
    data.config.nlw_rate = 12.71;
    data.staff = [makeStaff({ hourly_rate: 10.85 })]; // no date_of_birth
    const warnings = validateAll(data);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('below NLW')])
    );
  });
});

// ── Training ────────────────────────────────────────────────────────────────

describe('validateTraining', () => {
  it('warns about expired training', () => {
    const data = baseData();
    data.config.training_types = [
      { id: 'fire-safety', name: 'Fire Safety', active: true, roles: null },
    ];
    data.staff = [makeStaff()];
    data.training = {
      S001: {
        'fire-safety': { completed: '2024-01-01', expiry: '2025-01-01' },
      },
    };
    const warnings = validateAll(data);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('expired training')])
    );
  });

  it('warns about not-started required training', () => {
    const data = baseData();
    data.config.training_types = [
      { id: 'fire-safety', name: 'Fire Safety', active: true, roles: null },
    ];
    data.staff = [makeStaff()];
    data.training = { S001: {} };
    const warnings = validateAll(data);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('not started')])
    );
  });

  it('respects role filtering', () => {
    const data = baseData();
    data.config.training_types = [
      { id: 'manager-only', name: 'Manager Training', active: true, roles: ['Manager'] },
    ];
    data.staff = [makeStaff({ role: 'Carer' })];
    data.training = { S001: {} };
    const warnings = validateAll(data);
    expect(warnings.filter(w => w.includes('Training'))).toHaveLength(0);
  });
});

// ── Fire drills ─────────────────────────────────────────────────────────────

describe('validateFireDrills', () => {
  it('warns when no drills recorded', () => {
    const data = baseData();
    data.fire_drills = [];
    const warnings = validateAll(data);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('no drills recorded')])
    );
  });

  it('warns when last drill is overdue (>91 days)', () => {
    const data = baseData();
    data.fire_drills = [{ date: '2025-01-01' }]; // >91 days before June 15
    const warnings = validateAll(data);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('overdue')])
    );
  });

  it('warns when fewer than 4 drills in last 12 months', () => {
    const data = baseData();
    data.fire_drills = [
      { date: '2025-06-01' },
      { date: '2025-03-01' },
    ];
    const warnings = validateAll(data);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('minimum 4 required')])
    );
  });
});

// ── Incidents ───────────────────────────────────────────────────────────────

describe('validateIncidents', () => {
  it('warns about overdue CQC notifications', () => {
    const data = baseData();
    data.incidents = [{
      date: '2025-06-01', time: '08:00',
      cqc_notifiable: true, cqc_notified: false,
      cqc_notification_deadline: 'immediate', // 24h
    }];
    const warnings = validateAll(data);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('CQC notification')])
    );
  });

  it('warns about overdue RIDDOR reports', () => {
    const data = baseData();
    data.incidents = [{
      date: '2025-06-01',
      riddor_reportable: true, riddor_reported: false,
      riddor_category: 'death', // immediate
    }];
    const warnings = validateAll(data);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('RIDDOR')])
    );
  });

  it('warns about overdue corrective actions', () => {
    const data = baseData();
    data.incidents = [{
      date: '2025-06-01',
      corrective_actions: [
        { status: 'pending', due_date: '2025-06-10' },
      ],
    }];
    const warnings = validateAll(data);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('corrective action')])
    );
  });

  it('no warnings for clean incidents', () => {
    const data = baseData();
    data.incidents = [{
      date: '2025-06-14',
      cqc_notifiable: false, riddor_reportable: false,
      investigation_status: 'closed',
      corrective_actions: [],
    }];
    const warnings = validateAll(data);
    expect(warnings.filter(w => w.includes('Incident'))).toHaveLength(0);
  });
});

// ── Complaints ──────────────────────────────────────────────────────────────

describe('validateComplaints', () => {
  it('warns about unacknowledged complaints (>2 days)', () => {
    const data = baseData();
    data.complaints = [{
      date: '2025-06-01', status: 'open',
      acknowledged_date: null,
    }];
    const warnings = validateAll(data);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('not acknowledged')])
    );
  });

  it('warns about overdue response deadlines', () => {
    const data = baseData();
    data.complaints = [{
      date: '2025-05-01', status: 'open',
      acknowledged_date: '2025-05-02',
      response_deadline: '2025-06-01',
    }];
    const warnings = validateAll(data);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('response deadline')])
    );
  });

  it('skips resolved/closed complaints', () => {
    const data = baseData();
    data.complaints = [{
      date: '2025-01-01', status: 'resolved',
      acknowledged_date: null,
    }];
    const warnings = validateAll(data);
    expect(warnings.filter(w => w.includes('Complaint'))).toHaveLength(0);
  });
});

// ── Maintenance ─────────────────────────────────────────────────────────────

describe('validateMaintenance', () => {
  it('warns about overdue checks', () => {
    const data = baseData();
    data.maintenance = [{ next_due: '2025-06-01' }];
    const warnings = validateAll(data);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('check')])
    );
  });

  it('warns about expired certificates', () => {
    const data = baseData();
    data.maintenance = [{ certificate_expiry: '2025-06-01' }];
    const warnings = validateAll(data);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('certificate')])
    );
  });
});

// ── Policies ────────────────────────────────────────────────────────────────

describe('validatePolicies', () => {
  it('warns about overdue policy reviews', () => {
    const data = baseData();
    data.policy_reviews = [{ next_review_due: '2025-05-01' }];
    const warnings = validateAll(data);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('policy review')])
    );
  });

  it('warns about policies never reviewed', () => {
    const data = baseData();
    data.policy_reviews = [{ last_reviewed: null, next_review_due: null }];
    const warnings = validateAll(data);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('policy review')])
    );
  });
});

// ── Whistleblowing ──────────────────────────────────────────────────────────

describe('validateWhistleblowing', () => {
  it('warns about unacknowledged concerns (>3 days)', () => {
    const data = baseData();
    data.whistleblowing_concerns = [{
      date_raised: '2025-06-01', status: 'open',
      acknowledgement_date: null,
    }];
    const warnings = validateAll(data);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('Whistleblowing')])
    );
  });

  it('warns about long investigations (>30 days)', () => {
    const data = baseData();
    data.whistleblowing_concerns = [{
      date_raised: '2025-04-01', status: 'investigating',
      acknowledgement_date: '2025-04-02',
      investigation_start_date: '2025-04-05',
    }];
    const warnings = validateAll(data);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('exceeding 30 days')])
    );
  });
});

// ── DoLS ────────────────────────────────────────────────────────────────────

describe('validateDoLS', () => {
  it('warns about expired DoLS authorisations', () => {
    const data = baseData();
    data.dols = [{ authorised: true, expiry_date: '2025-06-01' }];
    const warnings = validateAll(data);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('expired authorisation')])
    );
  });

  it('warns about overdue MCA reviews', () => {
    const data = baseData();
    data.mca_assessments = [{ next_review_date: '2025-05-01' }];
    const warnings = validateAll(data);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('MCA')])
    );
  });
});

// ── Care Certificate ────────────────────────────────────────────────────────

describe('validateCareCertificate', () => {
  it('warns when staff exceeds 12-week target', () => {
    const data = baseData();
    data.care_certificate = {
      S001: { status: 'in_progress', start_date: '2025-01-01' },
    };
    const warnings = validateAll(data);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('12-week')])
    );
  });

  it('skips completed staff', () => {
    const data = baseData();
    data.care_certificate = {
      S001: { status: 'completed', start_date: '2024-01-01' },
    };
    const warnings = validateAll(data);
    expect(warnings.filter(w => w.includes('Care Certificate'))).toHaveLength(0);
  });
});

// ── Supervisions ────────────────────────────────────────────────────────────

describe('validateSupervisions', () => {
  it('warns about overdue supervisions', () => {
    const data = baseData();
    data.config.supervision_frequency_standard = 49;
    data.config.supervision_probation_months = 6;
    data.staff = [makeStaff({ start_date: '2024-01-01' })]; // not in probation
    data.supervisions = {
      S001: [{ date: '2025-01-01' }], // 165 days ago — well past 49-day frequency
    };
    const warnings = validateAll(data);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('overdue supervision')])
    );
  });

  it('warns about staff with no supervision records', () => {
    const data = baseData();
    data.staff = [makeStaff()];
    data.supervisions = {};
    const warnings = validateAll(data);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('no supervision records')])
    );
  });
});

// ── Risks ───────────────────────────────────────────────────────────────────

describe('validateRisks', () => {
  it('warns about critical risks (score >= 16)', () => {
    const data = baseData();
    data.risk_register = [{ likelihood: 4, impact: 4, status: 'open' }];
    const warnings = validateAll(data);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('critical risk')])
    );
  });

  it('warns about overdue risk reviews', () => {
    const data = baseData();
    data.risk_register = [{
      likelihood: 2, impact: 2, status: 'open',
      next_review: '2025-05-01',
    }];
    const warnings = validateAll(data);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('overdue risk review')])
    );
  });

  it('warns about overdue risk actions', () => {
    const data = baseData();
    data.risk_register = [{
      likelihood: 2, impact: 2, status: 'open',
      actions: [{ status: 'pending', due_date: '2025-06-01' }],
    }];
    const warnings = validateAll(data);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('overdue risk action')])
    );
  });

  it('skips closed risks', () => {
    const data = baseData();
    data.risk_register = [{ likelihood: 5, impact: 5, status: 'closed' }];
    const warnings = validateAll(data);
    expect(warnings.filter(w => w.includes('Risk'))).toHaveLength(0);
  });
});

// ── IPC ─────────────────────────────────────────────────────────────────────

describe('validateIPC', () => {
  it('warns about active outbreaks', () => {
    const data = baseData();
    data.ipc_audits = [{
      outbreak: { status: 'confirmed' },
    }];
    const warnings = validateAll(data);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('active outbreak')])
    );
  });

  it('warns about overdue corrective actions', () => {
    const data = baseData();
    data.ipc_audits = [{
      corrective_actions: [
        { status: 'pending', due_date: '2025-06-01' },
      ],
    }];
    const warnings = validateAll(data);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('corrective action')])
    );
  });
});

// ── Appraisals ──────────────────────────────────────────────────────────────

describe('validateAppraisals', () => {
  it('warns about overdue appraisals', () => {
    const data = baseData();
    data.staff = [makeStaff()];
    data.appraisals = {
      S001: [{ date: '2024-01-01', next_due: '2025-01-01' }],
    };
    const warnings = validateAll(data);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('overdue annual appraisal')])
    );
  });
});
