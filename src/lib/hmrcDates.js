export function currentTaxYearForDate(now = new Date()) {
  const m = now.getMonth() + 1;
  const d = now.getDate();
  if (m > 4 || (m === 4 && d >= 6)) return now.getFullYear();
  return now.getFullYear() - 1;
}
