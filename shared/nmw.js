// Shared NMW/NLW rate lookup — used by server validation and frontend UI.
// Rates are configurable per home; fallbacks are April 2026 statutory rates.

/**
 * Returns the applicable minimum wage rate and label for a staff member
 * based on their age (derived from date_of_birth).
 *
 * @param {string|null} staffDob  - "YYYY-MM-DD" or null
 * @param {object}      config   - home config with nlw_rate, nmw_rate_18_20, nmw_rate_under_18
 * @returns {{ rate: number, label: string }}
 */
export function getMinimumWageRate(staffDob, config) {
  const nlwRate = config?.nlw_rate || 12.71;
  if (!staffDob) return { rate: nlwRate, label: 'NLW' };

  const now = new Date();
  const dob = new Date(staffDob + 'T00:00:00Z');
  if (isNaN(dob.getTime())) return { rate: nlwRate, label: 'NLW' };

  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age--;

  if (age >= 21) return { rate: nlwRate, label: 'NLW' };
  if (age >= 18) return { rate: config?.nmw_rate_18_20 || 10.85, label: 'NMW (18-20)' };
  return { rate: config?.nmw_rate_under_18 || 8.00, label: 'NMW (U18)' };
}
