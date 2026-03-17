import { describe, it, expect } from 'vitest';
import {
  calculateAge,
  getNMWBracket,
  getApplicableNMWRate,
  checkNMWCompliance,
  classifyShiftEnhancements,
  calculateEnhancement,
  calculateShiftPay,
  snapToShift,
  calculatePayableHours,
  suggestNextPeriod,
  buildSageCSV,
} from '../payroll.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NMW_RATES = [
  { effective_from: '2025-04-01', age_bracket: '21+',        hourly_rate: 12.21 },
  { effective_from: '2025-04-01', age_bracket: '18-20',      hourly_rate: 10.00 },
  { effective_from: '2025-04-01', age_bracket: '16-17',      hourly_rate: 7.55  },
  { effective_from: '2025-04-01', age_bracket: 'apprentice', hourly_rate: 7.55  },
  { effective_from: '2026-04-01', age_bracket: '21+',        hourly_rate: 12.71 },
  { effective_from: '2026-04-01', age_bracket: '18-20',      hourly_rate: 10.85 },
  { effective_from: '2026-04-01', age_bracket: '16-17',      hourly_rate: 8.00  },
  { effective_from: '2026-04-01', age_bracket: 'apprentice', hourly_rate: 8.00  },
];

const BASE_CONFIG = {
  shifts: { E: { hours: 6 }, L: { hours: 6 }, EL: { hours: 12 }, N: { hours: 12 } },
};

const RATE_RULES = [
  { applies_to: 'night',       rate_type: 'percentage',    amount: 15,   name: 'Night Enhancement'     },
  { applies_to: 'weekend_sat', rate_type: 'percentage',    amount: 10,   name: 'Saturday Enhancement'  },
  { applies_to: 'weekend_sun', rate_type: 'percentage',    amount: 20,   name: 'Sunday Enhancement'    },
  { applies_to: 'bank_holiday',rate_type: 'percentage',    amount: 50,   name: 'Bank Holiday Premium'  },
  { applies_to: 'sleep_in',    rate_type: 'flat_per_shift',amount: 50,   name: 'Sleep-in Flat Rate'    },
  { applies_to: 'on_call',     rate_type: 'fixed_hourly',  amount: 2.00, name: 'Extra Shift Premium'   },
];

function makeStaff(overrides = {}) {
  return {
    id: 'S001',
    name: 'Jane Smith',
    hourly_rate: 12.00,
    date_of_birth: '1990-06-15',
    ...overrides,
  };
}

// ── calculateAge ──────────────────────────────────────────────────────────────

describe('calculateAge', () => {
  it('returns exact completed years', () => {
    expect(calculateAge('1990-06-15', '2025-06-15')).toBe(35);
  });

  it('does not count birthday as turned when one day before', () => {
    expect(calculateAge('1990-06-15', '2025-06-14')).toBe(34);
  });

  it('counts birthday correctly on the day', () => {
    expect(calculateAge('2004-04-01', '2025-04-01')).toBe(21);
  });

  it('handles year boundary crossing', () => {
    expect(calculateAge('1990-12-31', '2025-01-01')).toBe(34);
  });

  it('accepts string dates', () => {
    expect(calculateAge('2007-01-01', '2025-07-01')).toBe(18);
  });
});

// ── getNMWBracket ─────────────────────────────────────────────────────────────

describe('getNMWBracket', () => {
  it('maps 16 → 16-17', () => expect(getNMWBracket(16)).toBe('16-17'));
  it('maps 17 → 16-17', () => expect(getNMWBracket(17)).toBe('16-17'));
  it('maps 18 → 18-20', () => expect(getNMWBracket(18)).toBe('18-20'));
  it('maps 20 → 18-20', () => expect(getNMWBracket(20)).toBe('18-20'));
  it('maps 21 → 21+',   () => expect(getNMWBracket(21)).toBe('21+'));
  it('maps 35 → 21+',   () => expect(getNMWBracket(35)).toBe('21+'));
  it('maps 65 → 21+',   () => expect(getNMWBracket(65)).toBe('21+'));
});

// ── getApplicableNMWRate ──────────────────────────────────────────────────────

describe('getApplicableNMWRate', () => {
  it('returns 2025 rate on 2025-04-01', () => {
    expect(getApplicableNMWRate('21+', '2025-04-01', NMW_RATES)).toBe(12.21);
  });

  it('returns 2025 rate on 2025-12-31 (before 2026 increase)', () => {
    expect(getApplicableNMWRate('21+', '2025-12-31', NMW_RATES)).toBe(12.21);
  });

  it('returns 2026 rate on 2026-04-01', () => {
    expect(getApplicableNMWRate('21+', '2026-04-01', NMW_RATES)).toBe(12.71);
  });

  it('returns 18-20 rate correctly', () => {
    expect(getApplicableNMWRate('18-20', '2025-06-01', NMW_RATES)).toBe(10.00);
    expect(getApplicableNMWRate('18-20', '2026-06-01', NMW_RATES)).toBe(10.85);
  });

  it('returns null before any rates exist', () => {
    expect(getApplicableNMWRate('21+', '2024-01-01', NMW_RATES)).toBeNull();
  });
});

// ── checkNMWCompliance ────────────────────────────────────────────────────────

describe('checkNMWCompliance', () => {
  const staff = makeStaff({ date_of_birth: '1990-01-01' }); // 35 in 2025 → 21+

  it('returns compliant when effective rate >= NMW', () => {
    // £13.00/hr on 6hr shift = £78 total → £13.00 effective vs £12.21 NMW
    const result = checkNMWCompliance(staff, '2025-06-01', 78, 6, NMW_RATES);
    expect(result.compliant).toBe(true);
    expect(result.effectiveRate).toBe(13.00);
    expect(result.nmwRate).toBe(12.21);
    expect(result.shortfall).toBe(0);
  });

  it('returns non-compliant when effective rate < NMW', () => {
    // £11.00/hr on 6hr shift = £66 total → £11.00 effective vs £12.21 NMW
    const result = checkNMWCompliance(staff, '2025-06-01', 66, 6, NMW_RATES);
    expect(result.compliant).toBe(false);
    expect(result.effectiveRate).toBe(11.00);
    expect(result.shortfall).toBe(1.21);
  });

  it('defaults to 21+ bracket when DOB is null', () => {
    const staffNoDob = makeStaff({ date_of_birth: null });
    const result = checkNMWCompliance(staffNoDob, '2025-06-01', 78, 6, NMW_RATES);
    expect(result.bracket).toBe('21+');
    expect(result.warning).toBeTruthy();
  });

  it('uses 2026 NMW rates on 2026-04-01', () => {
    const result = checkNMWCompliance(staff, '2026-04-01', 78, 6, NMW_RATES);
    expect(result.nmwRate).toBe(12.71);
    // £78 / 6hrs = £13.00 → still compliant
    expect(result.compliant).toBe(true);
  });

  it('handles zero hours gracefully', () => {
    const result = checkNMWCompliance(staff, '2025-06-01', 0, 0, NMW_RATES);
    expect(result.compliant).toBe(true);
  });
});

// ── classifyShiftEnhancements ─────────────────────────────────────────────────

describe('classifyShiftEnhancements', () => {
  it('plain E on Tuesday → no enhancements', () => {
    // 2025-06-03 is a Tuesday
    const types = classifyShiftEnhancements('E', '2025-06-03', false, false);
    expect(types).toEqual([]);
  });

  it('N shift on weekday → night only', () => {
    // 2025-06-04 is a Wednesday
    const types = classifyShiftEnhancements('N', '2025-06-04', false, false);
    expect(types).toEqual(['night']);
  });

  it('E shift on Saturday → weekend_sat', () => {
    // 2025-06-07 is a Saturday
    const types = classifyShiftEnhancements('E', '2025-06-07', false, false);
    expect(types).toEqual(['weekend_sat']);
  });

  it('E shift on Sunday → weekend_sun', () => {
    // 2025-06-08 is a Sunday
    const types = classifyShiftEnhancements('E', '2025-06-08', false, false);
    expect(types).toEqual(['weekend_sun']);
  });

  it('N shift on Sunday + BH + sleep_in → stacks all four', () => {
    const types = classifyShiftEnhancements('N', '2025-06-08', true, true);
    expect(types).toContain('night');
    expect(types).toContain('weekend_sun');
    expect(types).toContain('bank_holiday');
    expect(types).toContain('sleep_in');
    expect(types.length).toBe(4);
  });

  it('BH-N gets both night and bank_holiday', () => {
    // BH-N is in NIGHT_SHIFTS
    const types = classifyShiftEnhancements('BH-N', '2025-06-04', true, false);
    expect(types).toContain('night');
    expect(types).toContain('bank_holiday');
  });

  it('OC-E on Tuesday → on_call only', () => {
    const types = classifyShiftEnhancements('OC-E', '2025-06-03', false, false);
    expect(types).toEqual(['on_call']);
  });

  it('sleep_in adds to existing enhancements', () => {
    const types = classifyShiftEnhancements('E', '2025-06-03', false, true);
    expect(types).toEqual(['sleep_in']);
  });
});

// ── calculateEnhancement ──────────────────────────────────────────────────────

describe('calculateEnhancement', () => {
  it('percentage: 15% night on 12hrs at £12.00/hr', () => {
    const rule = { rate_type: 'percentage', amount: 15 };
    // 12 × (12.00 × 0.15) = 12 × 1.80 = £21.60
    expect(calculateEnhancement(rule, 12, 12.00)).toBe(21.60);
  });

  it('fixed_hourly: +£2.00/hr on-call on 6hrs', () => {
    const rule = { rate_type: 'fixed_hourly', amount: 2.00 };
    expect(calculateEnhancement(rule, 6, 12.00)).toBe(12.00);
  });

  it('flat_per_shift: £50 sleep-in regardless of hours', () => {
    const rule = { rate_type: 'flat_per_shift', amount: 50 };
    expect(calculateEnhancement(rule, 12, 12.00)).toBe(50.00);
    expect(calculateEnhancement(rule, 6, 12.00)).toBe(50.00);
  });

  it('returns 0 for unknown rate_type', () => {
    const rule = { rate_type: 'unknown', amount: 10 };
    expect(calculateEnhancement(rule, 6, 12.00)).toBe(0);
  });
});

// ── calculateShiftPay ─────────────────────────────────────────────────────────

describe('calculateShiftPay', () => {
  const staff = makeStaff({ hourly_rate: 12.00 });

  it('plain E shift on Tuesday — base pay only, no enhancements', () => {
    // 2025-06-03 is a Tuesday
    const result = calculateShiftPay('E', '2025-06-03', staff, RATE_RULES, BASE_CONFIG, false, false);
    expect(result.hours).toBe(6);
    expect(result.basePay).toBe(72.00);     // 6 × £12.00
    expect(result.totalEnhancement).toBe(0);
    expect(result.total).toBe(72.00);
    expect(result.enhancements.length).toBe(0);
  });

  it('N shift on Sunday BH with sleep-in — all four enhancements additive', () => {
    // 2025-06-08 is a Sunday
    // base: 12 × £12.00 = £144.00
    // night (15%): 12 × (£12.00 × 0.15) = £21.60
    // weekend_sun (20%): 12 × (£12.00 × 0.20) = £28.80
    // bank_holiday (50%): 12 × (£12.00 × 0.50) = £72.00
    // sleep_in (flat): £50.00
    // total enhancement = £21.60 + £28.80 + £72.00 + £50.00 = £172.40
    // total = £144.00 + £172.40 = £316.40
    const result = calculateShiftPay('N', '2025-06-08', staff, RATE_RULES, BASE_CONFIG, true, true);
    expect(result.hours).toBe(12);
    expect(result.basePay).toBe(144.00);
    expect(result.enhancements.length).toBe(4);
    expect(result.totalEnhancement).toBe(172.40);
    expect(result.total).toBe(316.40);
  });

  it('BH-N shift on weekday — night + bank_holiday enhancements', () => {
    // 2025-06-04 is Wednesday
    // base: 12 × £12.00 = £144.00
    // night (15%): £21.60
    // bank_holiday (50%): £72.00
    // total: £144.00 + £21.60 + £72.00 = £237.60
    const result = calculateShiftPay('BH-N', '2025-06-04', staff, RATE_RULES, BASE_CONFIG, false, true);
    expect(result.enhancements.map(e => e.type)).toContain('night');
    expect(result.enhancements.map(e => e.type)).toContain('bank_holiday');
    expect(result.total).toBe(237.60);
  });

  it('OC-E on Tuesday — on_call enhancement only', () => {
    // 6hrs × £2.00 on-call = £12.00 enhancement
    const result = calculateShiftPay('OC-E', '2025-06-03', staff, RATE_RULES, BASE_CONFIG, false, false);
    expect(result.enhancements.length).toBe(1);
    expect(result.enhancements[0].type).toBe('on_call');
    expect(result.totalEnhancement).toBe(12.00);
    expect(result.total).toBe(84.00); // £72 + £12
  });

  it('handles missing rules gracefully — no enhancement if rule not found', () => {
    const result = calculateShiftPay('E', '2025-06-07', staff, [], BASE_CONFIG, false, false);
    // Saturday but no rules → no enhancement
    expect(result.totalEnhancement).toBe(0);
  });

  it('picks lowest-priority rule even when array is reversed', () => {
    // Two night rules: priority 0 = 15%, priority 10 = 50%
    // Reversed array order — .find() without sort would pick priority 10 (wrong)
    const rulesReversed = [
      { applies_to: 'night', rate_type: 'percentage', amount: 50, name: 'High Priority Night', priority: 10 },
      { applies_to: 'night', rate_type: 'percentage', amount: 15, name: 'Normal Night',       priority: 0 },
    ];
    // 2025-06-03 is a Tuesday — night shift
    const result = calculateShiftPay('N', '2025-06-03', staff, rulesReversed, BASE_CONFIG, false, false);
    expect(result.enhancements.length).toBe(1);
    expect(result.enhancements[0].ruleName).toBe('Normal Night');
    expect(result.enhancements[0].amount).toBe(15);
  });
});

// ── snapToShift ───────────────────────────────────────────────────────────────

describe('snapToShift', () => {
  it('snaps early clock-in within window', () => {
    // Scheduled 07:00, actual 06:53 → 7 minutes early, within 15-min window
    const r = snapToShift('07:00', '06:53', 15, true);
    expect(r.snapped).toBe('07:00');
    expect(r.savedMinutes).toBe(7);
    expect(r.applied).toBe(true);
  });

  it('does not snap early clock-in outside window', () => {
    // Scheduled 07:00, actual 06:30 → 30 minutes early, outside 15-min window
    const r = snapToShift('07:00', '06:30', 15, true);
    expect(r.snapped).toBe('06:30');
    expect(r.savedMinutes).toBe(0);
    expect(r.applied).toBe(false);
  });

  it('does not snap late clock-in', () => {
    // Scheduled 07:00, actual 07:05 → late
    const r = snapToShift('07:00', '07:05', 15, true);
    expect(r.snapped).toBe('07:05');
    expect(r.savedMinutes).toBe(0);
    expect(r.applied).toBe(false);
  });

  it('exactly on time — no snap needed, uses scheduled', () => {
    const r = snapToShift('07:00', '07:00', 15, true);
    expect(r.snapped).toBe('07:00');
    expect(r.applied).toBe(false);
  });

  it('snap disabled — always uses actual time', () => {
    const r = snapToShift('07:00', '06:55', 15, false);
    expect(r.snapped).toBe('06:55');
    expect(r.applied).toBe(false);
  });

  it('at window boundary (exactly 15 minutes early) — snaps', () => {
    const r = snapToShift('07:00', '06:45', 15, true);
    expect(r.snapped).toBe('07:00');
    expect(r.applied).toBe(true);
    expect(r.savedMinutes).toBe(15);
  });
});

// ── calculatePayableHours ─────────────────────────────────────────────────────

describe('calculatePayableHours', () => {
  it('standard day shift with 30-min break', () => {
    // 07:00-19:00 = 12hrs, minus 30min = 11.5hrs
    expect(calculatePayableHours('07:00', '19:00', 30)).toBe(11.5);
  });

  it('no break', () => {
    expect(calculatePayableHours('08:00', '14:00', 0)).toBe(6);
  });

  it('cross-midnight night shift without break', () => {
    // 19:30-08:30 = 13 hours
    expect(calculatePayableHours('19:30', '08:30', 0)).toBe(13);
  });

  it('cross-midnight night shift with 30-min break', () => {
    // 19:30-08:30 = 13 hours minus 30min = 12.5hrs
    expect(calculatePayableHours('19:30', '08:30', 30)).toBe(12.5);
  });

  it('returns 0 for missing inputs', () => {
    expect(calculatePayableHours(null, '19:00', 0)).toBe(0);
    expect(calculatePayableHours('07:00', null, 0)).toBe(0);
  });

  it('same clock-in/out returns 0, not 24', () => {
    expect(calculatePayableHours('07:00', '07:00', 0)).toBe(0);
    expect(calculatePayableHours('21:00', '21:00', 0)).toBe(0);
  });

  it('DST-aware: normal night shift with date (no DST)', () => {
    // 2025-06-15 is a normal day (BST, no transition)
    // 20:00-06:00 = 10h, minus 30min = 9.5h — same as without date
    expect(calculatePayableHours('20:00', '06:00', 30, '2025-06-15')).toBe(9.5);
  });

  it('DST-aware: standard day shift with date', () => {
    expect(calculatePayableHours('07:00', '19:00', 30, '2025-06-15')).toBe(11.5);
  });

  it('backward compat: without date, cross-midnight still works', () => {
    expect(calculatePayableHours('20:00', '06:00', 30)).toBe(9.5);
  });
});

// ── suggestNextPeriod ─────────────────────────────────────────────────────────

describe('suggestNextPeriod', () => {
  it('first run (null lastRun) returns current calendar month', () => {
    const result = suggestNextPeriod(null, 'monthly');
    expect(result.start).toMatch(/^\d{4}-\d{2}-01$/);
    // end is last day of month
    const end = new Date(result.end + 'T00:00:00Z');
    expect(end.getUTCDate()).toBeGreaterThanOrEqual(28);
  });

  it('monthly: next period starts day after last period ended', () => {
    const result = suggestNextPeriod({ period_end: '2025-01-31' }, 'monthly');
    expect(result.start).toBe('2025-02-01');
    expect(result.end).toBe('2025-02-28');
  });

  it('weekly: 7-day period', () => {
    const result = suggestNextPeriod({ period_end: '2025-01-12' }, 'weekly');
    expect(result.start).toBe('2025-01-13');
    expect(result.end).toBe('2025-01-19');
  });

  it('fortnightly: 14-day period', () => {
    const result = suggestNextPeriod({ period_end: '2025-01-12' }, 'fortnightly');
    expect(result.start).toBe('2025-01-13');
    expect(result.end).toBe('2025-01-26');
  });
});

// ── buildSageCSV ──────────────────────────────────────────────────────────────

describe('buildSageCSV', () => {
  const lines = [{
    staff_id: 'S001',
    base_hours: 120, base_pay: 1440,
    night_hours: 36, night_enhancement: 64.80,
    weekend_hours: 12, weekend_enhancement: 14.40,
    bank_holiday_hours: 0, bank_holiday_enhancement: 0,
    overtime_hours: 0, overtime_enhancement: 0,
    sleep_in_count: 2, sleep_in_pay: 100,
    on_call_hours: 0, on_call_enhancement: 0,
    total_hours: 156, total_enhancements: 179.20, gross_pay: 1619.20,
    nmw_compliant: true, tax_code: '1257L', student_loan_plan: null,
  }];
  const staffMap = new Map([['S001', { name: 'Jane Smith', hourly_rate: 12 }]]);
  const run = { period_start: '2025-06-01', period_end: '2025-06-30' };

  it('produces correct header row', () => {
    const csv = buildSageCSV(lines, staffMap, run);
    const [header] = csv.split('\r\n');
    expect(header).toContain('Staff_Name');
    expect(header).toContain('Total_Gross_Pay');
    expect(header).toContain('Night_Enhancement');
    expect(header).toContain('Ref:Est_PAYE');
  });

  it('produces correct data row', () => {
    const csv = buildSageCSV(lines, staffMap, run);
    const [, dataRow] = csv.split('\r\n');
    expect(dataRow).toContain('Jane Smith');
    expect(dataRow).toContain('1619.20');
    expect(dataRow).toContain('1257L');
  });

  it('escapes names with commas', () => {
    const specialMap = new Map([['S001', { name: 'Smith, Jane', hourly_rate: 12 }]]);
    const csv = buildSageCSV(lines, specialMap, run);
    expect(csv).toContain('"Smith, Jane"');
  });

  it('Total_Gross_Pay includes holiday_pay and ssp_amount', () => {
    const linesWithHoliday = [{
      ...lines[0],
      gross_pay: 1000,
      holiday_pay: 200,
      ssp_amount: 50,
      holiday_days: 2,
      ssp_days: 1,
    }];
    const csv = buildSageCSV(linesWithHoliday, staffMap, run);
    const [header, dataRow] = csv.split('\r\n');
    const cols = header.split(',');
    const totalIdx = cols.indexOf('Total_Gross_Pay');
    const values = dataRow.split(',');
    // Total should be 1000 + 200 + 50 = 1250.00
    expect(values[totalIdx]).toBe('1250.00');
  });

  it('Total_Gross_Pay handles missing holiday_pay/ssp_amount gracefully', () => {
    const linesNoExtras = [{
      ...lines[0],
      gross_pay: 1000,
      holiday_pay: undefined,
      ssp_amount: undefined,
    }];
    const csv = buildSageCSV(linesNoExtras, staffMap, run);
    const [header, dataRow] = csv.split('\r\n');
    const cols = header.split(',');
    const totalIdx = cols.indexOf('Total_Gross_Pay');
    const values = dataRow.split(',');
    expect(values[totalIdx]).toBe('1000.00');
  });
});

// ── calculateShiftPay — rule date filtering ─────────────────────────────────

describe('calculateShiftPay — rule date filtering', () => {
  const staff = makeStaff({ hourly_rate: 12.00 });

  it('does not apply rule before its effective_from date', () => {
    const rulesWithDate = [
      { applies_to: 'night', rate_type: 'percentage', amount: 15, name: 'Night Enh', priority: 0, effective_from: '2025-07-01' },
    ];
    // Shift on 2025-06-15 — rule not yet effective
    const result = calculateShiftPay('N', '2025-06-15', staff, rulesWithDate, BASE_CONFIG, false, false);
    expect(result.enhancements.length).toBe(0);
    expect(result.totalEnhancement).toBe(0);
  });

  it('applies rule on its effective_from date', () => {
    const rulesWithDate = [
      { applies_to: 'night', rate_type: 'percentage', amount: 15, name: 'Night Enh', priority: 0, effective_from: '2025-06-04' },
    ];
    // 2025-06-04 is a Wednesday — rule effective from this date
    const result = calculateShiftPay('N', '2025-06-04', staff, rulesWithDate, BASE_CONFIG, false, false);
    expect(result.enhancements.length).toBe(1);
  });

  it('does not apply rule after its effective_to date', () => {
    const rulesWithDate = [
      { applies_to: 'night', rate_type: 'percentage', amount: 15, name: 'Night Enh', priority: 0, effective_from: '2025-01-01', effective_to: '2025-06-01' },
    ];
    // Shift on 2025-06-15 — rule expired
    const result = calculateShiftPay('N', '2025-06-15', staff, rulesWithDate, BASE_CONFIG, false, false);
    expect(result.enhancements.length).toBe(0);
  });

  it('applies rule when effective_to is null (open-ended)', () => {
    const rulesWithDate = [
      { applies_to: 'night', rate_type: 'percentage', amount: 15, name: 'Night Enh', priority: 0, effective_from: '2025-01-01', effective_to: null },
    ];
    const result = calculateShiftPay('N', '2025-06-04', staff, rulesWithDate, BASE_CONFIG, false, false);
    expect(result.enhancements.length).toBe(1);
  });

  it('old rule replaced by new rule mid-period', () => {
    const rulesWithDate = [
      { applies_to: 'night', rate_type: 'percentage', amount: 10, name: 'Old Night', priority: 0, effective_from: '2025-01-01', effective_to: '2025-06-14' },
      { applies_to: 'night', rate_type: 'percentage', amount: 20, name: 'New Night', priority: 0, effective_from: '2025-06-15' },
    ];
    // Before changeover: old rule (10%)
    const r1 = calculateShiftPay('N', '2025-06-04', staff, rulesWithDate, BASE_CONFIG, false, false);
    expect(r1.enhancements[0].amount).toBe(10);
    // After changeover: new rule (20%)
    const r2 = calculateShiftPay('N', '2025-06-18', staff, rulesWithDate, BASE_CONFIG, false, false);
    expect(r2.enhancements[0].amount).toBe(20);
  });
});
