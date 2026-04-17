// Shared NMW/NLW rate lookup used by server validation and frontend UI.
// Rates are configurable per home; fallbacks are statutory rates from 1 April 2026.

export const DEFAULT_NLW_RATE = 12.71;
export const DEFAULT_NMW_RATE_18_20 = 10.85;
export const DEFAULT_NMW_RATE_UNDER_18 = 8.00;

export function getConfiguredNlwRate(config) {
  return config?.nlw_rate || DEFAULT_NLW_RATE;
}

/**
 * Returns the applicable minimum wage rate and label for a staff member
 * based on their age (derived from date_of_birth).
 *
 * @param {string|null} staffDob  - "YYYY-MM-DD" or null
 * @param {object} config         - home config with nlw_rate, nmw_rate_18_20, nmw_rate_under_18
 * @param {string|Date} [asOfDate] - reference date for age calc (default: today)
 * @returns {{ rate: number, label: string }}
 */
export function getMinimumWageRate(staffDob, config, asOfDate) {
  const nlwRate = getConfiguredNlwRate(config);
  if (!staffDob) return { rate: nlwRate, label: 'NLW' };

  const ref = asOfDate
    ? new Date(typeof asOfDate === 'string' ? `${asOfDate}T00:00:00Z` : asOfDate)
    : new Date();
  const dob = new Date(`${staffDob}T00:00:00Z`);
  if (isNaN(dob.getTime())) return { rate: nlwRate, label: 'NLW' };

  let age = ref.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = ref.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && ref.getUTCDate() < dob.getUTCDate())) age--;

  if (age >= 21) return { rate: nlwRate, label: 'NLW' };
  if (age >= 18) return { rate: config?.nmw_rate_18_20 || DEFAULT_NMW_RATE_18_20, label: 'NMW (18-20)' };
  return { rate: config?.nmw_rate_under_18 || DEFAULT_NMW_RATE_UNDER_18, label: 'NMW (U18)' };
}
