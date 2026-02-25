import {
  formatDate, parseDate, addDays, getCycleDay, getTeamBase,
  getScheduledShift, getActualShift, getStaffForDay,
  calculateStaffPeriodHours, checkWTR, getCycleDates,
  isWorkingShift, isEarlyShift, isLateShift, isNightShift,
  isDayShift,
  WORKING_SHIFTS, EARLY_SHIFTS, LATE_SHIFTS, NIGHT_SHIFTS,
  DAY_SHIFTS, CARE_ROLES, ALL_SHIFTS,
} from './src/lib/rotation.js';
import {
  countEarlyCoverage, countLateCoverage, countNightCoverage,
  calculateCoverage, getDayCoverageStatus, checkFatigueRisk,
} from './src/lib/escalation.js';

const API = 'http://localhost:3001/api/data?home=Oakwood_Care_Home';
let DATA;
try {
  const resp = await fetch(API);
  DATA = await resp.json();
} catch (e) {
  console.error('FATAL: Cannot reach API at', API, e.message);
  process.exit(1);
}
const { config, staff, overrides } = DATA;
const CYCLE_START = config.cycle_start_date;
const PANAMA = {
  A: [1,1,0,0,1,1,1,0,0,1,1,0,0,0],
  B: [0,0,1,1,0,0,0,1,1,0,0,1,1,1],
};
function dateBetween(s, e) {
  const dates = []; let d = parseDate(s); const end = parseDate(e);
  while (d <= end) { dates.push(new Date(d)); d = addDays(d, 1); }
  return dates;
}
function banner(t) { console.log('\n' + '='.repeat(80) + '\n  ' + t + '\n' + '='.repeat(80)); }
const bugs = [];
function bug(cat, msg) { bugs.push({category:cat, msg}); }

banner('TEST 1: Panama 2-2-3 Pattern Integrity');
const ALL_DAYS = dateBetween('2025-01-06','2026-12-31');
console.log('  Testing ' + ALL_DAYS.length + ' days...');
let compFail = 0;
for (const date of ALL_DAYS) {
  const cd = getCycleDay(date, CYCLE_START);
  if (PANAMA.A[cd] + PANAMA.B[cd] !== 1) { compFail++; if (compFail <= 5) bug('PATTERN', 'A+B!=1 on ' + formatDate(date) + ' cd=' + cd); }
}
console.log('  A+B complement: ' + (compFail === 0 ? 'PASS' : 'FAIL (' + compFail + ')'));
function getRunLengths(p) {
  const r = []; let c = p[0], l = 1;
  for (let i = 1; i < p.length; i++) { if (p[i] === c) l++; else { r.push({v:c,l}); c = p[i]; l = 1; } } r.push({v:c,l}); return r;
}
const runsA = getRunLengths(PANAMA.A);
const expA = [{v:1,l:2},{v:0,l:2},{v:1,l:3},{v:0,l:2},{v:1,l:2},{v:0,l:3}];
const patOk = JSON.stringify(runsA) === JSON.stringify(expA);
console.log('  Pattern A 2-2-3: ' + (patOk ? 'PASS' : 'FAIL'));
if (!patOk) bug('PATTERN', 'Team A not 2-2-3');
let cdWrap = 0;
for (const d of ALL_DAYS) { const cd = getCycleDay(d, CYCLE_START); if (cd < 0 || cd > 13) { cdWrap++; } }
console.log('  CycleDay [0..13]: ' + (cdWrap === 0 ? 'PASS' : 'FAIL'));
if (cdWrap) bug('PATTERN', 'CycleDay out of range ' + cdWrap + ' times');

banner('TEST 2: Coverage Gaps - Every Day Has Staff');
let gapDays = 0;
for (const date of ALL_DAYS) {
  const roster = getStaffForDay(staff, date, overrides, config);
  const working = roster.filter(r => isWorkingShift(r.shift));
  if (working.length === 0) { gapDays++; if (gapDays <= 5) bug('GAP', 'Zero staff on ' + formatDate(date)); }
}
console.log('  Days with zero working staff: ' + gapDays + ' / ' + ALL_DAYS.length);
console.log('  Coverage: ' + (gapDays === 0 ? 'PASS' : 'FAIL'));

banner('TEST 3: Day/Night Overlap Check');
let overlapCount = 0;
for (const date of ALL_DAYS) {
  const roster = getStaffForDay(staff, date, overrides, config);
  for (const r of roster) {
    if (!isWorkingShift(r.shift)) continue;
    const isDay = isDayShift(r.shift);
    const isNight = isNightShift(r.shift);
    if (isDay && isNight) {
      overlapCount++;
      if (overlapCount <= 5) bug('OVERLAP', formatDate(date) + ' ' + r.id + ' shift ' + r.shift + ' is both day and night');
    }
  }
}
console.log('  Day+Night overlaps: ' + overlapCount);
console.log('  Overlap check: ' + (overlapCount === 0 ? 'PASS' : 'FAIL'));

banner('TEST 4: DST Transitions (March/October)');
const dstDates = [
  '2025-03-29', '2025-03-30', '2025-03-31',
  '2025-10-25', '2025-10-26', '2025-10-27',
  '2026-03-28', '2026-03-29', '2026-03-30',
  '2026-10-24', '2026-10-25', '2026-10-26',
];
let dstFail = 0;
for (const ds of dstDates) {
  const d = parseDate(ds);
  const cd = getCycleDay(d, CYCLE_START);
  if (cd < 0 || cd > 13) { dstFail++; bug('DST', 'CycleDay out of range on DST date ' + ds + ': ' + cd); }
  const roster = getStaffForDay(staff, d, overrides, config);
  const working = roster.filter(r => isWorkingShift(r.shift));
  if (working.length === 0) { dstFail++; bug('DST', 'No staff on DST date ' + ds); }
  console.log('  ' + ds + ' cd=' + cd + ' staff=' + working.length);
}
console.log('  DST transitions: ' + (dstFail === 0 ? 'PASS' : 'FAIL (' + dstFail + ')'));

banner('TEST 5: Year Boundary (Dec 31 -> Jan 1)');
const ybDates = ['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02'];
let ybFail = 0;
for (let i = 0; i < ybDates.length - 1; i++) {
  const d1 = parseDate(ybDates[i]);
  const d2 = parseDate(ybDates[i+1]);
  const cd1 = getCycleDay(d1, CYCLE_START);
  const cd2 = getCycleDay(d2, CYCLE_START);
  const diff = ((cd2 - cd1) % 14 + 14) % 14;
  if (diff !== 1) { ybFail++; bug('YEAR_BOUNDARY', 'CycleDay jump: ' + ybDates[i] + '(' + cd1 + ') -> ' + ybDates[i+1] + '(' + cd2 + ')'); }
  console.log('  ' + ybDates[i] + ' cd=' + cd1 + ' -> ' + ybDates[i+1] + ' cd=' + cd2);
}
console.log('  Year boundary: ' + (ybFail === 0 ? 'PASS' : 'FAIL'));

banner('TEST 6: Leap Year (2028-02-29)');
const leapDates = dateBetween('2028-02-27', '2028-03-02');
let leapFail = 0;
for (let i = 0; i < leapDates.length; i++) {
  const cd = getCycleDay(leapDates[i], CYCLE_START);
  if (cd < 0 || cd > 13) { leapFail++; bug('LEAP', 'CycleDay OOB on ' + formatDate(leapDates[i])); }
  if (i > 0) {
    const prevCd = getCycleDay(leapDates[i-1], CYCLE_START);
    const diff = ((cd - prevCd) % 14 + 14) % 14;
    if (diff !== 1) { leapFail++; bug('LEAP', 'CycleDay jump around leap day'); }
  }
  console.log('  ' + formatDate(leapDates[i]) + ' cd=' + cd);
}
console.log('  Leap year: ' + (leapFail === 0 ? 'PASS' : 'FAIL'));

banner('TEST 7: getStaffForDay Coverage Table (First Full Cycle)');
const sampleDates = dateBetween('2025-01-06', '2025-01-19');
console.log('  Date       | CD | Early | Late | Night | Total | Shifts');
console.log('  ' + '-'.repeat(70));
for (const d of sampleDates) {
  const ds = formatDate(d);
  const cd = getCycleDay(d, CYCLE_START);
  const roster = getStaffForDay(staff, d, overrides, config);
  const early = roster.filter(r => isEarlyShift(r.shift)).length;
  const late = roster.filter(r => isLateShift(r.shift)).length;
  const night = roster.filter(r => isNightShift(r.shift)).length;
  const working = roster.filter(r => isWorkingShift(r.shift));
  const shifts = working.map(r => r.shift).join(',');
  console.log('  ' + ds + ' | ' + String(cd).padStart(2) + ' | ' + String(early).padStart(5) + ' | ' + String(late).padStart(4) + ' | ' + String(night).padStart(5) + ' | ' + String(working.length).padStart(5) + ' | ' + shifts);
}

banner('TEST 8: Override Application');
const overrideKeys = Object.keys(overrides || {});
console.log('  Override dates in data: ' + overrideKeys.length);
let overrideFail = 0;
for (const dateKey of overrideKeys) {
  const dayOverrides = overrides[dateKey];
  const d = parseDate(dateKey);
  const roster = getStaffForDay(staff, d, overrides, config);
  for (const [staffId, ovr] of Object.entries(dayOverrides)) {
    const shift = typeof ovr === 'string' ? ovr : ovr.shift;
    const entry = roster.find(r => r.id === staffId);
    if (!entry) { overrideFail++; bug('OVERRIDE', 'Staff ' + staffId + ' missing from roster on ' + dateKey); continue; }
    if (entry.shift !== shift) { overrideFail++; bug('OVERRIDE', dateKey + ' ' + staffId + ' expected ' + shift + ' got ' + entry.shift); }
    else { console.log('  OK: ' + dateKey + ' ' + staffId + ' -> ' + entry.shift); }
  }
}
console.log('  Override application: ' + (overrideFail === 0 ? 'PASS' : 'FAIL (' + overrideFail + ')'));

banner('TEST 9: WTR 48hr Weekly Average Compliance');
let wtrViolations = 0;
const wtrDates = dateBetween('2025-01-06', '2025-05-04');
console.log('  Testing WTR over ' + wtrDates.length + ' day reference period...');
const wtrTestStaff = staff.slice(0, 8);
for (const s of wtrTestStaff) {
  const result = checkWTR(s, wtrDates, overrides, config);
  const avg = result.avgWeekly || 0;
  const safe = result.safe;
  const optOut = result.optOut || s.wtr_opt_out;
  console.log('  ' + s.id + ' (' + s.name.padEnd(16) + ') avg=' + avg.toFixed(1).padStart(5) + 'h/wk optOut=' + optOut + ' safe=' + safe);
  if (!optOut && avg > 48) { wtrViolations++; bug('WTR', s.id + ' exceeds 48h weekly avg: ' + avg.toFixed(1)); }
}
console.log('  WTR violations (non-opted-out): ' + wtrViolations);

banner('TEST 10: Fatigue - Consecutive Working Days');
let fatigueIssues = 0;
const maxConsec = config.max_consecutive_days || 5;
console.log('  Max consecutive days allowed: ' + maxConsec);
for (const s of staff) {
  if (s.team === 'Float') continue; // Skip float staff
  let consec = 0;
  let maxFound = 0;
  let streakStart = null;
  let worstStart = null;
  for (const date of ALL_DAYS) {
    const result = getActualShift(s, date, overrides, CYCLE_START);
    const shift = typeof result === 'string' ? result : (result.shift || result);
    if (isWorkingShift(shift)) {
      if (consec === 0) streakStart = formatDate(date);
      consec++;
      if (consec > maxFound) { maxFound = consec; worstStart = streakStart; }
    } else { consec = 0; }
  }
  if (maxFound > maxConsec) {
    fatigueIssues++;
    bug('FATIGUE', s.id + ' (' + s.name + ') max consecutive=' + maxFound + ' starting ' + worstStart);
    console.log('  WARN: ' + s.id + ' max consecutive=' + maxFound + ' from ' + worstStart);
  }
}
console.log('  Staff with fatigue violations: ' + fatigueIssues + ' / ' + staff.length);
console.log('  Fatigue check: ' + (fatigueIssues === 0 ? 'PASS' : 'WARN (' + fatigueIssues + ' staff)'));

banner('TEST 11: Float Staff Behavior');
const floatStaff = staff.filter(s => s.team === 'Float');
console.log('  Float staff count: ' + floatStaff.length);
let floatFail = 0;
for (const s of floatStaff) {
  const testDates = dateBetween('2025-02-01', '2025-02-14');
  let localFail = 0;
  for (const d of testDates) {
    const cd = getCycleDay(d, CYCLE_START);
    const sched = getScheduledShift(s, cd);
    if (sched !== 'AVL') {
      localFail++;
      if (floatFail + localFail <= 5) bug('FLOAT', s.id + ' scheduled as ' + sched + ' not AVL on ' + formatDate(d));
    }
  }
  floatFail += localFail;
  console.log('  ' + s.id + ' (' + s.name + '): all 14 days = AVL? ' + (localFail === 0 ? 'YES' : 'NO (' + localFail + ' failures)'));
}
console.log('  Float behavior: ' + (floatFail === 0 ? 'PASS' : 'FAIL'));

banner('TEST 12: Team A vs B Working Day Balance');
const teamCount = { dayA: 0, dayB: 0, nightA: 0, nightB: 0 };
const year1 = dateBetween('2025-01-06', '2025-12-31');
for (const date of year1) {
  const cd = getCycleDay(date, CYCLE_START);
  if (PANAMA.A[cd]) { teamCount.dayA++; teamCount.nightA++; }
  if (PANAMA.B[cd]) { teamCount.dayB++; teamCount.nightB++; }
}
console.log('  Team A working days (2025): ' + teamCount.dayA);
console.log('  Team B working days (2025): ' + teamCount.dayB);
const balanceDiff = Math.abs(teamCount.dayA - teamCount.dayB);
console.log('  Difference: ' + balanceDiff + ' days');
const balanced = balanceDiff <= 7;
console.log('  Balance: ' + (balanced ? 'PASS' : 'FAIL (imbalance > 7 days)'));
if (!balanced) bug('BALANCE', 'Teams imbalanced by ' + balanceDiff + ' days');

banner('TEST 13: Escalation / Coverage Levels');
const escSample = dateBetween('2025-03-01', '2025-03-31');
const levelCounts = {};
for (const date of escSample) {
  const roster = getStaffForDay(staff, date, overrides, config);
  const status = getDayCoverageStatus(roster, config);
  const lvl = status.overall || 'UNKNOWN';
  levelCounts[lvl] = (levelCounts[lvl] || 0) + 1;
}
console.log('  March 2025 escalation distribution:');
for (const [lvl, count] of Object.entries(levelCounts).sort()) {
  console.log('    ' + lvl + ': ' + count + ' days');
}

banner('TEST 14: Shift Classification Consistency');
let classifyFail = 0;
const testShifts = [
  { shift: 'E', expectEarly: true, expectLate: false, expectNight: false, expectDay: true },
  { shift: 'L', expectEarly: false, expectLate: true, expectNight: false, expectDay: true },
  { shift: 'EL', expectEarly: true, expectLate: true, expectNight: false, expectDay: true },
  { shift: 'N', expectEarly: false, expectLate: false, expectNight: true, expectDay: false },
  { shift: 'SICK', expectWorking: false },
  { shift: 'AL', expectWorking: false },
  { shift: 'AVL', expectWorking: false },
];
for (const t of testShifts) {
  if (t.expectWorking === false) {
    const isW = isWorkingShift(t.shift);
    console.log('  ' + t.shift.padEnd(6) + ' working=' + isW + ' (expect false): ' + (!isW ? 'PASS' : 'FAIL'));
    if (isW) { classifyFail++; bug('CLASSIFY', t.shift + ' should not be working'); }
  } else {
    const eOk = isEarlyShift(t.shift) === t.expectEarly;
    const lOk = isLateShift(t.shift) === t.expectLate;
    const nOk = isNightShift(t.shift) === t.expectNight;
    const dOk = isDayShift(t.shift) === t.expectDay;
    const allOk = eOk && lOk && nOk && dOk;
    console.log('  ' + t.shift.padEnd(6) + ' E=' + isEarlyShift(t.shift) + ' L=' + isLateShift(t.shift) + ' N=' + isNightShift(t.shift) + ' D=' + isDayShift(t.shift) + ': ' + (allOk ? 'PASS' : 'FAIL'));
    if (!allOk) { classifyFail++; bug('CLASSIFY', t.shift + ' classification mismatch'); }
  }
}
console.log('  Classification: ' + (classifyFail === 0 ? 'PASS' : 'FAIL'));

banner('TEST 15: Global Sequential CycleDay');
let seqFail = 0;
for (let i = 1; i < ALL_DAYS.length; i++) {
  const cd1 = getCycleDay(ALL_DAYS[i-1], CYCLE_START);
  const cd2 = getCycleDay(ALL_DAYS[i], CYCLE_START);
  const expected = (cd1 + 1) % 14;
  if (cd2 !== expected) {
    seqFail++;
    if (seqFail <= 5) bug('SEQ', formatDate(ALL_DAYS[i-1]) + '(cd' + cd1 + ') -> ' + formatDate(ALL_DAYS[i]) + '(cd' + cd2 + ') expected cd' + expected);
  }
}
console.log('  Sequential jumps: ' + seqFail);
console.log('  Sequential CycleDay: ' + (seqFail === 0 ? 'PASS' : 'FAIL'));

banner('TEST 16: Shift Preferences');
let prefIssues = 0;
const prefStaff = staff.filter(s => s.pref && s.pref !== 'any' && s.pref !== 'ANY' && s.pref !== 'EL' && s.pref !== 'N');
console.log('  Staff with non-default preferences (E-only or L-only): ' + prefStaff.length);
for (const s of prefStaff) {
  let violations = 0;
  const testDays = dateBetween('2025-04-01', '2025-04-30');
  for (const d of testDays) {
    const cd = getCycleDay(d, CYCLE_START);
    const sched = getScheduledShift(s, cd);
    if (!isWorkingShift(sched)) continue;
    if (s.pref === 'E' && sched !== 'E') violations++;
    if (s.pref === 'L' && sched !== 'L') violations++;
  }
  if (violations > 0) {
    prefIssues++;
    bug('PREF', s.id + ' (' + s.name + ') pref=' + s.pref + ' violations=' + violations);
    console.log('  WARN: ' + s.id + ' (' + s.name + ') pref=' + s.pref + ' violations=' + violations);
  }
}
if (prefStaff.length === 0) console.log('  No E-only/L-only staff found to test');
console.log('  Preference compliance: ' + (prefIssues === 0 ? 'PASS' : 'WARN (' + prefIssues + ')'));

banner('TEST 17: Minimum Staffing Compliance');
const minEarly = config.minimum_staffing?.early?.heads || 3;
const minLate = config.minimum_staffing?.late?.heads || 3;
const minNight = config.minimum_staffing?.night?.heads || 3;
console.log('  Min early=' + minEarly + ' late=' + minLate + ' night=' + minNight);
let underEarly = 0, underLate = 0, underNight = 0;
for (const date of ALL_DAYS) {
  const roster = getStaffForDay(staff, date, overrides, config);
  const eCount = roster.filter(r => isEarlyShift(r.shift)).length;
  const lCount = roster.filter(r => isLateShift(r.shift)).length;
  const nCount = roster.filter(r => isNightShift(r.shift)).length;
  if (eCount < minEarly) { underEarly++; if (underEarly <= 3) bug('MIN_STAFF', formatDate(date) + ' early=' + eCount + ' < ' + minEarly); }
  if (lCount < minLate) { underLate++; if (underLate <= 3) bug('MIN_STAFF', formatDate(date) + ' late=' + lCount + ' < ' + minLate); }
  if (nCount < minNight) { underNight++; if (underNight <= 3) bug('MIN_STAFF', formatDate(date) + ' night=' + nCount + ' < ' + minNight); }
}
console.log('  Under-staffed early: ' + underEarly + ' / ' + ALL_DAYS.length + ' days');
console.log('  Under-staffed late:  ' + underLate + ' / ' + ALL_DAYS.length + ' days');
console.log('  Under-staffed night: ' + underNight + ' / ' + ALL_DAYS.length + ' days');
const totalUnder = underEarly + underLate + underNight;
console.log('  Min staffing: ' + (totalUnder === 0 ? 'PASS' : 'FAIL (' + totalUnder + ' under-staffed shifts)'));

banner('TEST 18: EL Double-Count Analysis');
let elCount = 0;
let elDoubleOk = 0;
const elSample = dateBetween('2025-01-06', '2025-03-31');
for (const date of elSample) {
  const roster = getStaffForDay(staff, date, overrides, config);
  const elStaff = roster.filter(r => r.shift === 'EL');
  for (const r of elStaff) {
    elCount++;
    const countsEarly = isEarlyShift(r.shift);
    const countsLate = isLateShift(r.shift);
    if (countsEarly && countsLate) elDoubleOk++;
    else bug('EL_DOUBLE', formatDate(date) + ' ' + r.id + ' EL not double-counted');
  }
}
console.log('  EL shifts found: ' + elCount);
console.log('  EL double-counted correctly: ' + elDoubleOk + ' / ' + elCount);
console.log('  EL analysis: ' + (elCount === 0 ? 'N/A (no EL shifts)' : elDoubleOk === elCount ? 'PASS' : 'FAIL'));

banner('FINAL BUG REPORT');
if (bugs.length === 0) {
  console.log('  No bugs found. All tests passed.');
} else {
  console.log('  Total issues found: ' + bugs.length);
  console.log();
  const categories = {};
  for (const b of bugs) {
    if (!categories[b.category]) categories[b.category] = [];
    categories[b.category].push(b.msg);
  }
  for (const [cat, msgs] of Object.entries(categories).sort()) {
    console.log('  [' + cat + '] (' + msgs.length + ' issues)');
    for (const m of msgs.slice(0, 10)) {
      console.log('    - ' + m);
    }
    if (msgs.length > 10) console.log('    ... and ' + (msgs.length - 10) + ' more');
    console.log();
  }
}

banner('TEST SUMMARY');
const summary = [
  { test: 'Panama 2-2-3 Pattern',      result: compFail === 0 && patOk && cdWrap === 0 },
  { test: 'Coverage Gaps',              result: gapDays === 0 },
  { test: 'Day/Night Overlap',          result: overlapCount === 0 },
  { test: 'DST Transitions',            result: dstFail === 0 },
  { test: 'Year Boundary',              result: ybFail === 0 },
  { test: 'Leap Year',                  result: leapFail === 0 },
  { test: 'Override Application',       result: overrideFail === 0 },
  { test: 'Sequential CycleDay',        result: seqFail === 0 },
  { test: 'Shift Classification',       result: classifyFail === 0 },
  { test: 'Min Staffing Compliance',    result: totalUnder === 0 },
  { test: 'Float Staff Behavior',       result: floatFail === 0 },
  { test: 'Team Balance',               result: balanced },
  { test: 'EL Double-Count',            result: elCount === 0 || elDoubleOk === elCount },
];
let passed = 0, failed = 0;
for (const s of summary) {
  const status = s.result ? 'PASS' : 'FAIL';
  if (s.result) passed++; else failed++;
  console.log('  ' + (s.result ? '[PASS]' : '[FAIL]') + ' ' + s.test);
}
console.log();
console.log('  Results: ' + passed + ' passed, ' + failed + ' failed out of ' + summary.length + ' core tests');
console.log('  Total bugs/anomalies logged: ' + bugs.length);
console.log();
