import { getPayrollRuns } from './api.js';

function addIsoDays(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export async function loadAllPayrollRuns(homeSlug, pageSize = 500) {
  const allRuns = [];
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const page = await getPayrollRuns(homeSlug, { limit: pageSize, offset });
    const rows = Array.isArray(page) ? page : (page?.rows || []);
    total = Array.isArray(page) ? rows.length : (page?.total ?? rows.length);
    allRuns.push(...rows);
    if (rows.length < pageSize || Array.isArray(page)) break;
    offset += rows.length;
  }

  return allRuns;
}

export function suggestNextPayrollPayDate(lastRun, nextPeriodEnd) {
  if (!nextPeriodEnd) return '';
  if (!lastRun?.period_end || !lastRun?.pay_date) return nextPeriodEnd;

  const lagMs = Date.parse(`${lastRun.pay_date}T00:00:00Z`) - Date.parse(`${lastRun.period_end}T00:00:00Z`);
  if (!Number.isFinite(lagMs) || lagMs <= 0) return nextPeriodEnd;

  const lagDays = Math.round(lagMs / 86400000);
  return addIsoDays(nextPeriodEnd, lagDays);
}
