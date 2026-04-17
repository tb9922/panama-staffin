const LONDON_TZ = 'Europe/London';

function formatLondonParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number.parseInt(map.year, 10),
    month: Number.parseInt(map.month, 10) - 1,
    day: Number.parseInt(map.day, 10),
  };
}

function toDateOnlyParts(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return { year, month: month - 1, day };
  }

  return formatLondonParts(value);
}

export function todayLocalISO(date = new Date()) {
  const { year, month, day } = toDateOnlyParts(date);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function addDaysLocalISO(date, days) {
  const { year, month, day } = toDateOnlyParts(date);
  const next = new Date(year, month, day);
  next.setDate(next.getDate() + days);
  return todayLocalISO(next);
}

export function startOfLocalMonthISO(date = new Date(), monthOffset = 0) {
  const { year, month } = toDateOnlyParts(date);
  return todayLocalISO(new Date(year, month + monthOffset, 1));
}
