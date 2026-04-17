function parseDateOnly(value) {
  if (!value) return null;
  return new Date(`${value}T00:00:00Z`);
}

function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function addMonthsClamped(date, months) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const lastDayOfTargetMonth = new Date(Date.UTC(year, month + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month + months, Math.min(day, lastDayOfTargetMonth)));
}

export function getDolsMaxExpiryDate(authorisationDate) {
  const parsed = parseDateOnly(authorisationDate);
  if (!parsed || Number.isNaN(parsed.getTime())) return null;
  return formatDateOnly(addMonthsClamped(parsed, 12));
}

export function validateDolsAuthorisationWindow(record) {
  if (!record?.authorised) return null;
  if (!record?.authorisation_date || !record?.expiry_date) return null;

  const authorisationDate = parseDateOnly(record.authorisation_date);
  const expiryDate = parseDateOnly(record.expiry_date);
  if (!authorisationDate || !expiryDate) return null;
  if (Number.isNaN(authorisationDate.getTime()) || Number.isNaN(expiryDate.getTime())) return null;

  if (expiryDate < authorisationDate) {
    return 'Expiry date cannot be earlier than the authorisation date.';
  }

  const maxExpiryDate = parseDateOnly(getDolsMaxExpiryDate(record.authorisation_date));
  if (maxExpiryDate && expiryDate > maxExpiryDate) {
    return `DoLS/LPS authorisation cannot run beyond 12 months from the authorisation date (${formatDateOnly(maxExpiryDate)}).`;
  }

  return null;
}
