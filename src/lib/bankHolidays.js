export const BANK_HOLIDAY_REGIONS = [
  { value: 'england-and-wales', label: 'England & Wales' },
  { value: 'scotland', label: 'Scotland' },
  { value: 'northern-ireland', label: 'Northern Ireland' },
];

const UK_BANK_HOLIDAYS = [
  { date: '2024-01-01', name: "New Year's Day" },
  { date: '2024-03-29', name: 'Good Friday' },
  { date: '2024-04-01', name: 'Easter Monday' },
  { date: '2024-05-06', name: 'Early May bank holiday' },
  { date: '2024-05-27', name: 'Spring bank holiday' },
  { date: '2024-08-26', name: 'Summer bank holiday' },
  { date: '2024-12-25', name: 'Christmas Day' },
  { date: '2024-12-26', name: 'Boxing Day' },
  { date: '2025-01-01', name: "New Year's Day" },
  { date: '2025-04-18', name: 'Good Friday' },
  { date: '2025-04-21', name: 'Easter Monday' },
  { date: '2025-05-05', name: 'Early May bank holiday' },
  { date: '2025-05-26', name: 'Spring bank holiday' },
  { date: '2025-08-25', name: 'Summer bank holiday' },
  { date: '2025-12-25', name: 'Christmas Day' },
  { date: '2025-12-26', name: 'Boxing Day' },
  { date: '2026-01-01', name: "New Year's Day" },
  { date: '2026-04-03', name: 'Good Friday' },
  { date: '2026-04-06', name: 'Easter Monday' },
  { date: '2026-05-04', name: 'Early May bank holiday' },
  { date: '2026-05-25', name: 'Spring bank holiday' },
  { date: '2026-08-31', name: 'Summer bank holiday' },
  { date: '2026-12-25', name: 'Christmas Day' },
  { date: '2026-12-28', name: 'Boxing Day (substitute)' },
  { date: '2027-01-01', name: "New Year's Day" },
  { date: '2027-03-26', name: 'Good Friday' },
  { date: '2027-03-29', name: 'Easter Monday' },
  { date: '2027-05-03', name: 'Early May bank holiday' },
  { date: '2027-05-31', name: 'Spring bank holiday' },
  { date: '2027-08-30', name: 'Summer bank holiday' },
  { date: '2027-12-27', name: 'Christmas Day (substitute)' },
  { date: '2027-12-28', name: 'Boxing Day (substitute)' },
  { date: '2028-01-03', name: "New Year's Day (substitute)" },
  { date: '2028-04-14', name: 'Good Friday' },
  { date: '2028-04-17', name: 'Easter Monday' },
  { date: '2028-05-01', name: 'Early May bank holiday' },
  { date: '2028-05-29', name: 'Spring bank holiday' },
  { date: '2028-08-28', name: 'Summer bank holiday' },
  { date: '2028-12-25', name: 'Christmas Day' },
  { date: '2028-12-26', name: 'Boxing Day' },
];

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function makeUtcDate(year, monthIndex, day) {
  return new Date(Date.UTC(year, monthIndex, day));
}

function nthWeekdayOfMonth(year, monthIndex, weekday, ordinal) {
  const date = makeUtcDate(year, monthIndex, 1);
  let seen = 0;
  while (date.getUTCMonth() === monthIndex) {
    if (date.getUTCDay() === weekday) {
      seen += 1;
      if (seen === ordinal) return new Date(date);
    }
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return null;
}

function lastWeekdayOfMonth(year, monthIndex, weekday) {
  const date = makeUtcDate(year, monthIndex + 1, 0);
  while (date.getUTCDay() !== weekday) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return date;
}

function substituteIfWeekend(date) {
  const day = date.getUTCDay();
  if (day === 6) date.setUTCDate(date.getUTCDate() + 2);
  if (day === 0) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return makeUtcDate(year, month - 1, day);
}

function generateFallbackBankHolidays(year) {
  const easter = easterSunday(year);
  const goodFriday = new Date(easter);
  goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
  const easterMonday = new Date(easter);
  easterMonday.setUTCDate(easterMonday.getUTCDate() + 1);

  const newYearsDay = substituteIfWeekend(makeUtcDate(year, 0, 1));
  const christmasDay = substituteIfWeekend(makeUtcDate(year, 11, 25));
  const boxingDay = substituteIfWeekend(makeUtcDate(year, 11, 26));
  if (formatDate(christmasDay) === formatDate(boxingDay)) {
    boxingDay.setUTCDate(boxingDay.getUTCDate() + 1);
  }

  return [
    { date: formatDate(newYearsDay), name: newYearsDay.getUTCDate() === 1 ? "New Year's Day" : "New Year's Day (substitute)" },
    { date: formatDate(goodFriday), name: 'Good Friday' },
    { date: formatDate(easterMonday), name: 'Easter Monday' },
    { date: formatDate(nthWeekdayOfMonth(year, 4, 1, 1)), name: 'Early May bank holiday' },
    { date: formatDate(lastWeekdayOfMonth(year, 4, 1)), name: 'Spring bank holiday' },
    { date: formatDate(lastWeekdayOfMonth(year, 7, 1)), name: 'Summer bank holiday' },
    { date: formatDate(christmasDay), name: christmasDay.getUTCDate() === 25 ? 'Christmas Day' : 'Christmas Day (substitute)' },
    { date: formatDate(boxingDay), name: boxingDay.getUTCDate() === 26 ? 'Boxing Day' : 'Boxing Day (substitute)' },
  ];
}

export function getHardcodedBankHolidays(yearFrom, yearTo) {
  return UK_BANK_HOLIDAYS.filter((holiday) => {
    const year = parseInt(holiday.date.substring(0, 4), 10);
    return year >= yearFrom && year <= yearTo;
  });
}

export function getFallbackBankHolidays(yearFrom, yearTo, region = 'england-and-wales') {
  if (region !== 'england-and-wales') {
    throw new Error(`Fallback bank holidays are only available for England & Wales; ${region} must sync from GOV.UK`);
  }
  const holidays = [...getHardcodedBankHolidays(yearFrom, yearTo)];
  const coveredYears = new Set(holidays.map((holiday) => parseInt(holiday.date.substring(0, 4), 10)));
  for (let year = yearFrom; year <= yearTo; year += 1) {
    if (!coveredYears.has(year)) {
      holidays.push(...generateFallbackBankHolidays(year));
    }
  }
  return holidays.sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchGovUKBankHolidays(region = 'england-and-wales') {
  const res = await fetch(`/api/bank-holidays?region=${encodeURIComponent(region)}`);
  if (!res.ok) throw new Error('Failed to fetch from GOV.UK');
  return res.json();
}

export function mergeBankHolidays(existing, newHolidays) {
  const dateSet = new Set((existing || []).map((holiday) => holiday.date));
  const merged = [...(existing || [])];
  for (const holiday of newHolidays) {
    if (!dateSet.has(holiday.date)) {
      merged.push(holiday);
      dateSet.add(holiday.date);
    }
  }
  return merged.sort((a, b) => a.date.localeCompare(b.date));
}

export async function syncBankHolidays(existing, region = 'england-and-wales') {
  let source = 'fallback';
  let holidays;
  try {
    holidays = await fetchGovUKBankHolidays(region);
    source = 'GOV.UK API';
  } catch (err) {
    if (region !== 'england-and-wales') throw err;
    const now = new Date();
    holidays = getFallbackBankHolidays(now.getUTCFullYear(), now.getUTCFullYear() + 6, region);
    source = 'generated fallback (API unavailable)';
  }
  const merged = mergeBankHolidays(existing, holidays);
  const added = merged.length - (existing || []).length;
  return { holidays: merged, added, source };
}
