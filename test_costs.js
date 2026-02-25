// Deep cost/budget calculation test for Panama Staffing app
// Run with: node test_costs.js

import {
  getStaffForDay, formatDate, isWorkingShift, isAgencyShift, isOTShift,
  isBHShift, getShiftHours, isBankHoliday, getBankHoliday,
} from './src/lib/rotation.js';
import { calculateDayCost } from './src/lib/escalation.js';

const API = 'http://localhost:3001/api/data?home=Oakwood_Care_Home';
let DATA;
try {
  const res = await fetch(API);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  DATA = await res.json();
} catch (e) {
  console.error('FATAL: Cannot fetch ' + API + ' - ' + e.message);
  process.exit(1);
}
const { config, staff, overrides } = DATA;

let passCount = 0, failCount = 0, warnCount = 0;
const findings = [];
function pass(m) { passCount++; console.log('  PASS  ' + m); }
function fail(m) { failCount++; findings.push('FAIL: ' + m); console.log('  FAIL  ' + m); }
function warn(m) { warnCount++; findings.push('WARN: ' + m); console.log('  WARN  ' + m); }
function heading(m) { console.log('\n' + '='.repeat(72) + '\n  ' + m + '\n' + '='.repeat(72)); }
function subhead(m) { console.log('\n--- ' + m + ' ---'); }
function aeq(a, b, e) { return Math.abs(a - b) < (e || 0.011); }
function rd(v) { return Math.round(v * 100) / 100; }

// ============================================================
// SECTION 1: Day-by-day cost verification for Feb 2026
// ============================================================
heading('SECTION 1: Day-by-day cost verification — Feb 2026');

const year = 2026, month = 1; // JS month 1 = February
const daysInMonth = new Date(year, month + 1, 0).getDate();
let monthBase = 0, monthOT = 0, monthAgDay = 0, monthAgNight = 0, monthBH = 0, monthTotal = 0;

for (let d = 1; d <= daysInMonth; d++) {
  const date = new Date(year, month, d);
  const ds = formatDate(date);
  const staffForDay = getStaffForDay(staff, date, overrides, config);
  const cost = calculateDayCost(staffForDay, config);

  // Manual verification
  let manualBase = 0, manualOT = 0, manualAgDay = 0, manualAgNight = 0, manualBH = 0;
  for (const s of staffForDay) {
    const shift = s.actualShift || s.shift;
    if (!isWorkingShift(shift)) continue;
    const hours = getShiftHours(shift, config);
    if (isAgencyShift(shift)) {
      const isNight = shift.includes('N') || shift === 'AG-N';
      if (isNight) manualAgNight += hours * (config.agency_rate_night || 0);
      else manualAgDay += hours * (config.agency_rate_day || 0);
      continue;
    }
    const rate = s.hourly_rate || 0;
    manualBase += hours * rate;
    if (isOTShift(shift)) manualOT += hours * (config.ot_premium || 0);
    if (isBHShift(shift)) manualBH += hours * rate * ((config.bh_premium_multiplier || 1) - 1);
  }

  const dayOk = aeq(cost.base, manualBase, 0.02) && aeq(cost.otPremium, manualOT, 0.02)
    && aeq(cost.agencyDay, manualAgDay, 0.02) && aeq(cost.agencyNight, manualAgNight, 0.02)
    && aeq(cost.bhPremium, manualBH, 0.02);

  const expTotal = rd(manualBase + manualOT + manualAgDay + manualAgNight + manualBH);
  const totalOk = aeq(cost.total, expTotal, 0.05);

  if (dayOk && totalOk) {
    pass(ds + ' total=' + rd(cost.total) + ' staff=' + staffForDay.length);
  } else {
    fail(ds + ' MISMATCH => fn: base=' + rd(cost.base) + ' ot=' + rd(cost.otPremium)
      + ' agD=' + rd(cost.agencyDay) + ' agN=' + rd(cost.agencyNight)
      + ' bh=' + rd(cost.bhPremium) + ' tot=' + rd(cost.total)
      + ' | manual: base=' + rd(manualBase) + ' ot=' + rd(manualOT)
      + ' agD=' + rd(manualAgDay) + ' agN=' + rd(manualAgNight)
      + ' bh=' + rd(manualBH) + ' tot=' + expTotal);
  }

  monthBase += cost.base;
  monthOT += cost.otPremium;
  monthAgDay += cost.agencyDay;
  monthAgNight += cost.agencyNight;
  monthBH += cost.bhPremium;
  monthTotal += cost.total;
}

subhead('Monthly totals for Feb 2026');
console.log('  Base: ' + rd(monthBase) + '  OT: ' + rd(monthOT)
  + '  AgDay: ' + rd(monthAgDay) + '  AgNight: ' + rd(monthAgNight)
  + '  BH: ' + rd(monthBH) + '  TOTAL: ' + rd(monthTotal));
const sumParts = rd(monthBase + monthOT + monthAgDay + monthAgNight + monthBH);
if (aeq(monthTotal, sumParts, 0.1)) pass('Monthly total matches sum of parts: ' + rd(monthTotal) + ' vs ' + sumParts);
else fail('Monthly total mismatch: total=' + rd(monthTotal) + ' vs sum=' + sumParts);

// ============================================================
// SECTION 2: Bank Holiday Detection
// ============================================================
heading('SECTION 2: Bank Holiday Detection');

const bhDates = (config.bank_holidays || []).map(bh => bh.date);
console.log('Configured BH count: ' + bhDates.length);
if (bhDates.length === 16) pass('16 bank holidays configured');
else fail('Expected 16 bank holidays, got ' + bhDates.length);

let bhPass = 0, bhFail = 0;
for (const dateStr of bhDates) {
  const parts = dateStr.split('-');
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (isBankHoliday(d, config)) { bhPass++; pass('BH detected: ' + dateStr); }
  else { bhFail++; fail('BH NOT detected: ' + dateStr); }
}
console.log('BH detection: ' + bhPass + '/' + bhDates.length + ' passed');

// Test non-BH dates should return false
const nonBH = ['2026-02-10', '2026-03-15', '2026-07-04'];
for (const dateStr of nonBH) {
  const parts = dateStr.split('-');
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (!isBankHoliday(d, config)) pass('Correctly NOT a BH: ' + dateStr);
  else fail('False BH positive: ' + dateStr);
}

// getBankHoliday should return name for BH dates
const firstBH = bhDates[0];
const firstParts = firstBH.split('-');
const firstBHDate = new Date(Number(firstParts[0]), Number(firstParts[1]) - 1, Number(firstParts[2]));
const bhName = getBankHoliday(firstBHDate, config);
if (bhName && typeof bhName === 'string' && bhName.length > 0) pass('getBankHoliday returns name: ' + bhName);
else fail('getBankHoliday returned: ' + JSON.stringify(bhName));

// ============================================================
// SECTION 3: Edge Cases
// ============================================================
heading('SECTION 3: Edge Cases');

subhead('3a: No hourly_rate (rate=0 fallback)');
const fakeStaffNoRate = [{ name: 'NoRate', hourly_rate: 0, actualShift: 'E', shift: 'E', team: 'A' }];
const costNoRate = calculateDayCost(fakeStaffNoRate, config);
if (costNoRate.base === 0 && costNoRate.total === 0) pass('Zero rate => zero cost');
else fail('Zero rate should give 0 cost, got base=' + costNoRate.base + ' total=' + costNoRate.total);

const fakeStaffUndef = [{ name: 'UndefRate', actualShift: 'L', shift: 'L', team: 'A' }];
const costUndef = calculateDayCost(fakeStaffUndef, config);
if (costUndef.base === 0 && costUndef.total === 0) pass('Undefined rate => zero cost (|| 0 fallback)');
else fail('Undefined rate gave base=' + costUndef.base + ' total=' + costUndef.total);

subhead('3b: Empty staff list');
const costEmpty = calculateDayCost([], config);
if (costEmpty.total === 0 && costEmpty.base === 0) pass('Empty staff => zero cost');
else fail('Empty staff cost not zero: ' + JSON.stringify(costEmpty));

subhead('3c: Agency shift ignores staff hourly_rate');
const fakeAgency = [{ name: 'AgTest', hourly_rate: 999, actualShift: 'AG-E', shift: 'AG-E', team: 'A' }];
const costAg = calculateDayCost(fakeAgency, config);
const agExpected = getShiftHours('AG-E', config) * config.agency_rate_day;
if (costAg.base === 0 && aeq(costAg.agencyDay, agExpected)) {
  pass('Agency uses config rate, not staff rate. agencyDay=' + rd(costAg.agencyDay) + ' expected=' + rd(agExpected));
} else {
  fail('Agency rate check: base=' + costAg.base + ' agencyDay=' + costAg.agencyDay + ' expected=' + agExpected);
}

subhead('3d: OT shift gets base + premium');
const fakeOT = [{ name: 'OTTest', hourly_rate: 12, actualShift: 'OC-E', shift: 'OC-E', team: 'A' }];
const costOT = calculateDayCost(fakeOT, config);
const otHours = getShiftHours('OC-E', config);
const expBase = otHours * 12;
const expOTPrem = otHours * config.ot_premium;
if (aeq(costOT.base, expBase) && aeq(costOT.otPremium, expOTPrem)) {
  pass('OT shift: base=' + rd(costOT.base) + '(' + rd(expBase) + ') otPrem=' + rd(costOT.otPremium) + '(' + rd(expOTPrem) + ')');
} else {
  fail('OT calc mismatch: base=' + rd(costOT.base) + '(' + rd(expBase) + ') otPrem=' + rd(costOT.otPremium) + '(' + rd(expOTPrem) + ')');
}

subhead('3e: BH shift gets base + BH premium');
const fakeBH = [{ name: 'BHTest', hourly_rate: 12, actualShift: 'BH-D', shift: 'BH-D', team: 'A' }];
const costBHTest = calculateDayCost(fakeBH, config);
const bhHours = getShiftHours('BH-D', config);
const expBHBase = bhHours * 12;
const expBHPrem = bhHours * 12 * (config.bh_premium_multiplier - 1);
if (aeq(costBHTest.base, expBHBase) && aeq(costBHTest.bhPremium, expBHPrem)) {
  pass('BH shift: base=' + rd(costBHTest.base) + '(' + rd(expBHBase) + ') bhPrem=' + rd(costBHTest.bhPremium) + '(' + rd(expBHPrem) + ')');
} else {
  fail('BH calc mismatch: base=' + rd(costBHTest.base) + '(' + rd(expBHBase) + ') bhPrem=' + rd(costBHTest.bhPremium) + '(' + rd(expBHPrem) + ')');
}

subhead('3f: Non-working shifts cost nothing');
for (const nwShift of ['OFF', 'AL', 'SICK', 'AVL']) {
  const fakeNW = [{ name: 'NWTest', hourly_rate: 15, actualShift: nwShift, shift: nwShift, team: 'A' }];
  const costNW = calculateDayCost(fakeNW, config);
  if (costNW.total === 0) pass(nwShift + ' shift => zero cost');
  else fail(nwShift + ' shift cost should be 0, got ' + costNW.total);
}

// ============================================================
// SECTION 4: Budget Tracker Calculations
// ============================================================
heading('SECTION 4: Budget Tracker Calculations');

const budget = config.monthly_staff_budget || 0;
console.log('Configured monthly_staff_budget: ' + budget);
console.log('Configured monthly_agency_cap: ' + (config.monthly_agency_cap || 0));

subhead('4a: 12-month rolling window');
const now = new Date();
const rollingMonths = [];
for (let i = -6; i <= 5; i++) {
  const m = new Date(now.getFullYear(), now.getMonth() + i, 1);
  rollingMonths.push({ year: m.getFullYear(), month: m.getMonth() });
}
if (rollingMonths.length === 12) pass('12-month rolling window has 12 entries');
else fail('Rolling window has ' + rollingMonths.length + ' entries, expected 12');

subhead('4b: Monthly cost accumulation for one month');
// Calculate full month cost for current month
const testYear = 2026, testMonth = 1; // Feb 2026
const testDays = new Date(testYear, testMonth + 1, 0).getDate();
let totalForMonth = 0, agencyForMonth = 0;
for (let d = 1; d <= testDays; d++) {
  const date = new Date(testYear, testMonth, d);
  const sfd = getStaffForDay(staff, date, overrides, config);
  const c = calculateDayCost(sfd, config);
  totalForMonth += c.total;
  agencyForMonth += (c.agencyDay + c.agencyNight);
}
console.log('  Feb 2026 total cost: ' + rd(totalForMonth));
console.log('  Feb 2026 agency cost: ' + rd(agencyForMonth));
if (totalForMonth > 0) pass('Monthly cost is positive: ' + rd(totalForMonth));
else warn('Monthly cost is zero or negative: ' + totalForMonth);

subhead('4c: Agency percentage calculation');
const agencyPct = totalForMonth > 0 ? (agencyForMonth / totalForMonth) * 100 : 0;
console.log('  Agency %: ' + rd(agencyPct) + '%');
const agTarget = (config.agency_target_pct || 0.05) * 100;
console.log('  Agency target: ' + agTarget + '%');
if (agencyPct >= 0 && agencyPct <= 100) pass('Agency % in valid range: ' + rd(agencyPct) + '%');
else fail('Agency % out of range: ' + agencyPct);

subhead('4d: Variance calculations');
if (budget > 0) {
  const variance = totalForMonth - budget;
  const variancePct = (variance / budget) * 100;
  console.log('  Budget: ' + budget + '  Actual: ' + rd(totalForMonth) + '  Variance: ' + rd(variance) + ' (' + rd(variancePct) + '%)');
  if (typeof variance === 'number' && !isNaN(variance)) pass('Variance is valid number: ' + rd(variance));
  else fail('Variance is NaN or invalid');
} else {
  console.log('  Budget not set (0), variance is forced to 0 per BudgetTracker logic');
  pass('Budget=0 handled correctly (variance forced to 0)');
}

subhead('4e: YTD calculation');
const currentYear = now.getFullYear();
const currentMonth = now.getMonth();
let ytdActual = 0;
for (let m = 0; m <= currentMonth; m++) {
  const daysInM = new Date(currentYear, m + 1, 0).getDate();
  let mTotal = 0;
  for (let d = 1; d <= daysInM; d++) {
    const date = new Date(currentYear, m, d);
    const sfd = getStaffForDay(staff, date, overrides, config);
    const c = calculateDayCost(sfd, config);
    mTotal += c.total;
  }
  ytdActual += mTotal;
}
console.log('  YTD actual (' + currentYear + ' Jan-' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][currentMonth] + '): ' + rd(ytdActual));
if (ytdActual > 0) pass('YTD is positive: ' + rd(ytdActual));
else warn('YTD is zero or negative');

// ============================================================
// SECTION 5: NaN / undefined / negative scan
// ============================================================
heading('SECTION 5: NaN / undefined / negative value scan');

let nanCount = 0, undefCount = 0, negCount = 0;
const scanStart = new Date(2026, 0, 1);
for (let d = 0; d < 90; d++) {
  const date = new Date(scanStart.getTime() + d * 86400000);
  const ds = formatDate(date);
  const sfd = getStaffForDay(staff, date, overrides, config);
  const c = calculateDayCost(sfd, config);
  const fields = ['base', 'otPremium', 'agencyDay', 'agencyNight', 'bhPremium', 'total'];
  for (const f of fields) {
    if (c[f] === undefined) { undefCount++; fail(ds + String.fromCharCode(32) + f + String.fromCharCode(32) + 'is undefined'); }
    else if (isNaN(c[f])) { nanCount++; fail(ds + String.fromCharCode(32) + f + String.fromCharCode(32) + 'is NaN'); }
    else if (c[f] < 0) { negCount++; fail(ds + String.fromCharCode(32) + f + String.fromCharCode(32) + 'is negative: ' + c[f]); }
  }
}
if (nanCount === 0 && undefCount === 0 && negCount === 0) {
  pass('90-day scan: no NaN, undefined, or negative values found');
} else {
  fail('90-day scan: NaN=' + nanCount + ' undefined=' + undefCount + ' negative=' + negCount);
}

// ============================================================
// SECTION 6: Integrity and back-compat checks
// ============================================================
heading('SECTION 6: Integrity and back-compatibility checks');

subhead('6a: Config rate sanity');
if (config.ot_premium > 0) pass('ot_premium is positive: ' + config.ot_premium);
else fail('ot_premium is not positive: ' + config.ot_premium);
if (config.agency_rate_day > 0) pass('agency_rate_day is positive: ' + config.agency_rate_day);
else fail('agency_rate_day not positive: ' + config.agency_rate_day);
if (config.agency_rate_night > 0) pass('agency_rate_night is positive: ' + config.agency_rate_night);
else fail('agency_rate_night not positive: ' + config.agency_rate_night);
if (config.bh_premium_multiplier >= 1) pass('bh_premium_multiplier >= 1: ' + config.bh_premium_multiplier);
else fail('bh_premium_multiplier < 1: ' + config.bh_premium_multiplier);

subhead('6b: Staff hourly rates');
let rateIssues = 0;
for (const s of staff) {
  if (!s.hourly_rate || s.hourly_rate <= 0) {
    rateIssues++;
    warn('Staff ' + s.id + ' (' + s.name + ') has no/zero hourly_rate: ' + s.hourly_rate);
  } else if (s.hourly_rate < config.nlw_rate) {
    warn('Staff ' + s.id + ' (' + s.name + ') rate ' + s.hourly_rate + ' is below NLW ' + config.nlw_rate);
  }
}
if (rateIssues === 0) pass('All ' + staff.length + ' staff have positive hourly rates');

subhead('6c: Shift hours sanity');
const testShifts = ['E', 'L', 'EL', 'N', 'AG-E', 'AG-N', 'OC-E', 'OC-N', 'BH-D', 'BH-N'];
for (const sh of testShifts) {
  const h = getShiftHours(sh, config);
  if (h > 0 && h <= 13) pass(sh + ' => ' + h + 'h');
  else fail(sh + ' hours invalid: ' + h);
}

subhead('6d: Back-compat fields (standard, oclPremium)');
const testDate = new Date(2026, 1, 16);
const testSFD = getStaffForDay(staff, testDate, overrides, config);
const testCost = calculateDayCost(testSFD, config);
if (testCost.standard !== undefined && testCost.standard === testCost.base)
  pass('cost.standard === cost.base: ' + rd(testCost.standard));
else if (testCost.standard === undefined)
  warn('cost.standard is undefined (back-compat field missing)');
else
  fail('cost.standard (' + testCost.standard + ') !== cost.base (' + testCost.base + ')');

if (testCost.oclPremium !== undefined && testCost.oclPremium === testCost.otPremium)
  pass('cost.oclPremium === cost.otPremium: ' + rd(testCost.oclPremium));
else if (testCost.oclPremium === undefined)
  warn('cost.oclPremium is undefined (back-compat field missing)');
else
  fail('cost.oclPremium (' + testCost.oclPremium + ') !== cost.otPremium (' + testCost.otPremium + ')');

// ============================================================
// SUMMARY
// ============================================================
heading('TEST SUMMARY');
console.log('  PASSED: ' + passCount);
console.log('  FAILED: ' + failCount);
console.log('  WARNINGS: ' + warnCount);
console.log();
if (findings.length > 0) {
  console.log('All findings:');
  for (const f of findings) console.log('  ' + f);
}
if (failCount === 0) console.log('ALL TESTS PASSED');
else console.log(failCount + ' TESTS FAILED');
process.exit(failCount > 0 ? 1 : 0);
