// UK Bank Holidays (England & Wales) — hardcoded 2024-2028 + GOV.UK API sync

const UK_BANK_HOLIDAYS = [
  // 2024
  { date: '2024-01-01', name: "New Year's Day" },
  { date: '2024-03-29', name: 'Good Friday' },
  { date: '2024-04-01', name: 'Easter Monday' },
  { date: '2024-05-06', name: 'Early May bank holiday' },
  { date: '2024-05-27', name: 'Spring bank holiday' },
  { date: '2024-08-26', name: 'Summer bank holiday' },
  { date: '2024-12-25', name: 'Christmas Day' },
  { date: '2024-12-26', name: 'Boxing Day' },
  // 2025
  { date: '2025-01-01', name: "New Year's Day" },
  { date: '2025-04-18', name: 'Good Friday' },
  { date: '2025-04-21', name: 'Easter Monday' },
  { date: '2025-05-05', name: 'Early May bank holiday' },
  { date: '2025-05-26', name: 'Spring bank holiday' },
  { date: '2025-08-25', name: 'Summer bank holiday' },
  { date: '2025-12-25', name: 'Christmas Day' },
  { date: '2025-12-26', name: 'Boxing Day' },
  // 2026
  { date: '2026-01-01', name: "New Year's Day" },
  { date: '2026-04-03', name: 'Good Friday' },
  { date: '2026-04-06', name: 'Easter Monday' },
  { date: '2026-05-04', name: 'Early May bank holiday' },
  { date: '2026-05-25', name: 'Spring bank holiday' },
  { date: '2026-08-31', name: 'Summer bank holiday' },
  { date: '2026-12-25', name: 'Christmas Day' },
  { date: '2026-12-28', name: 'Boxing Day (substitute)' },
  // 2027
  { date: '2027-01-01', name: "New Year's Day" },
  { date: '2027-03-26', name: 'Good Friday' },
  { date: '2027-03-29', name: 'Easter Monday' },
  { date: '2027-05-03', name: 'Early May bank holiday' },
  { date: '2027-05-31', name: 'Spring bank holiday' },
  { date: '2027-08-30', name: 'Summer bank holiday' },
  { date: '2027-12-27', name: 'Christmas Day (substitute)' },
  { date: '2027-12-28', name: 'Boxing Day (substitute)' },
  // 2028
  { date: '2028-01-03', name: "New Year's Day (substitute)" },
  { date: '2028-04-14', name: 'Good Friday' },
  { date: '2028-04-17', name: 'Easter Monday' },
  { date: '2028-05-01', name: 'Early May bank holiday' },
  { date: '2028-05-29', name: 'Spring bank holiday' },
  { date: '2028-08-28', name: 'Summer bank holiday' },
  { date: '2028-12-25', name: 'Christmas Day' },
  { date: '2028-12-26', name: 'Boxing Day' },
];

// Get hardcoded bank holidays for a year range
export function getHardcodedBankHolidays(yearFrom, yearTo) {
  return UK_BANK_HOLIDAYS.filter(bh => {
    const y = parseInt(bh.date.substring(0, 4));
    return y >= yearFrom && y <= yearTo;
  });
}

// Fetch from GOV.UK API via server proxy
export async function fetchGovUKBankHolidays(region = 'england-and-wales') {
  const res = await fetch(`/api/bank-holidays?region=${encodeURIComponent(region)}`);
  if (!res.ok) throw new Error('Failed to fetch from GOV.UK');
  return res.json();
}

// Merge new holidays into existing list (no duplicates)
export function mergeBankHolidays(existing, newHolidays) {
  const dateSet = new Set((existing || []).map(bh => bh.date));
  const merged = [...(existing || [])];
  for (const bh of newHolidays) {
    if (!dateSet.has(bh.date)) {
      merged.push(bh);
      dateSet.add(bh.date);
    }
  }
  return merged.sort((a, b) => a.date.localeCompare(b.date));
}

// Sync bank holidays: try API first, fall back to hardcoded
export async function syncBankHolidays(existing, region = 'england-and-wales') {
  let source = 'hardcoded';
  let holidays;
  try {
    holidays = await fetchGovUKBankHolidays(region);
    source = 'GOV.UK API';
  } catch {
    if (region === 'england-and-wales') {
      const now = new Date();
      holidays = getHardcodedBankHolidays(now.getFullYear(), now.getFullYear() + 2);
      source = 'hardcoded (API unavailable)';
    } else {
      holidays = existing || [];
      source = 'existing list (region-specific API unavailable)';
    }
  }
  const merged = mergeBankHolidays(existing, holidays);
  const added = merged.length - (existing || []).length;
  return { holidays: merged, added, source };
}
