function toDateOnlyParts(value) {
  if (value instanceof Date) {
    return {
      year: value.getFullYear(),
      month: value.getMonth(),
      day: value.getDate(),
    };
  }

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return { year, month: month - 1, day };
  }

  const parsed = new Date(value);
  return {
    year: parsed.getFullYear(),
    month: parsed.getMonth(),
    day: parsed.getDate(),
  };
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
