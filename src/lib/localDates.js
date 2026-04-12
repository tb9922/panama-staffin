export function todayLocalISO(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  const [year, month, day] = String(dateStr).split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

export function addDaysLocalISO(dateStr, days) {
  const date = parseLocalDate(dateStr) || new Date();
  date.setDate(date.getDate() + days);
  return todayLocalISO(date);
}

export function startOfLocalMonth(date = new Date(), monthOffset = 0) {
  const d = date instanceof Date ? new Date(date) : new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  d.setMonth(d.getMonth() + monthOffset);
  return d;
}

export function endOfLocalMonth(date = new Date(), monthOffset = 0) {
  const d = date instanceof Date ? new Date(date) : new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setMonth(d.getMonth() + monthOffset + 1, 0);
  return d;
}

export function startOfLocalMonthISO(date = new Date(), monthOffset = 0) {
  return todayLocalISO(startOfLocalMonth(date, monthOffset));
}

export function endOfLocalMonthISO(date = new Date(), monthOffset = 0) {
  return todayLocalISO(endOfLocalMonth(date, monthOffset));
}

export function startOfLocalWeek(date = new Date()) {
  const d = date instanceof Date ? new Date(date) : new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

export function startOfLocalWeekISO(date = new Date()) {
  return todayLocalISO(startOfLocalWeek(date));
}

export function startOfNextLocalDay(date = new Date()) {
  const d = date instanceof Date ? new Date(date) : new Date(date);
  d.setHours(24, 0, 0, 0);
  return d;
}

export function currentLocalYearMonth(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
