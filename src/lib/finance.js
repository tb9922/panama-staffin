// Finance module constants and client-side helpers

export const FUNDING_TYPES = [
  { id: 'self_funded', label: 'Self-Funded' },
  { id: 'la_funded', label: 'LA Funded' },
  { id: 'chc_funded', label: 'CHC Funded' },
  { id: 'split_funded', label: 'Split Funded' },
  { id: 'respite', label: 'Respite' },
];

export const CARE_TYPES = [
  { id: 'residential', label: 'Residential' },
  { id: 'nursing', label: 'Nursing' },
  { id: 'dementia_residential', label: 'Dementia (Residential)' },
  { id: 'dementia_nursing', label: 'Dementia (Nursing)' },
  { id: 'respite', label: 'Respite' },
];

export const RESIDENT_STATUSES = [
  { id: 'active', label: 'Active', badge: 'green' },
  { id: 'discharged', label: 'Discharged', badge: 'gray' },
  { id: 'deceased', label: 'Deceased', badge: 'gray' },
  { id: 'suspended', label: 'Suspended', badge: 'amber' },
];

export const EXPENSE_CATEGORIES = [
  { id: 'staffing', label: 'Staffing' },
  { id: 'agency', label: 'Agency' },
  { id: 'food', label: 'Food & Catering' },
  { id: 'utilities', label: 'Utilities' },
  { id: 'maintenance', label: 'Maintenance & Repairs' },
  { id: 'medical_supplies', label: 'Medical Supplies' },
  { id: 'cleaning', label: 'Cleaning' },
  { id: 'insurance', label: 'Insurance' },
  { id: 'rent', label: 'Rent' },
  { id: 'rates', label: 'Business Rates' },
  { id: 'training', label: 'Training' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'professional_fees', label: 'Professional Fees' },
  { id: 'transport', label: 'Transport' },
  { id: 'laundry', label: 'Laundry' },
  { id: 'other', label: 'Other' },
];

export const INVOICE_STATUSES = [
  { id: 'draft', label: 'Draft', badge: 'gray' },
  { id: 'sent', label: 'Sent', badge: 'blue' },
  { id: 'partially_paid', label: 'Part Paid', badge: 'amber' },
  { id: 'paid', label: 'Paid', badge: 'green' },
  { id: 'overdue', label: 'Overdue', badge: 'red' },
  { id: 'void', label: 'Void', badge: 'gray' },
  { id: 'credited', label: 'Credited', badge: 'purple' },
];

export const EXPENSE_STATUSES = [
  { id: 'pending', label: 'Pending', badge: 'amber' },
  { id: 'approved', label: 'Approved', badge: 'blue' },
  { id: 'rejected', label: 'Rejected', badge: 'red' },
  { id: 'paid', label: 'Paid', badge: 'green' },
  { id: 'void', label: 'Void', badge: 'gray' },
];

export const PAYER_TYPES = [
  { id: 'resident', label: 'Self-Funder' },
  { id: 'la', label: 'Local Authority' },
  { id: 'chc', label: 'CHC/NHS' },
  { id: 'family', label: 'Family Top-Up' },
  { id: 'other', label: 'Other' },
];

export const PAYMENT_METHODS = [
  { id: 'bacs', label: 'BACS' },
  { id: 'cheque', label: 'Cheque' },
  { id: 'card', label: 'Card' },
  { id: 'cash', label: 'Cash' },
  { id: 'direct_debit', label: 'Direct Debit' },
  { id: 'petty_cash', label: 'Petty Cash' },
  { id: 'other', label: 'Other' },
];

export const LINE_TYPES = [
  { id: 'fee', label: 'Fee' },
  { id: 'top_up', label: 'Top-Up' },
  { id: 'fnc', label: 'FNC' },
  { id: 'additional', label: 'Additional' },
  { id: 'adjustment', label: 'Adjustment' },
  { id: 'credit', label: 'Credit' },
];

export const CHASE_METHODS = [
  { id: 'email', label: 'Email' },
  { id: 'phone', label: 'Phone' },
  { id: 'letter', label: 'Letter' },
  { id: 'in_person', label: 'In Person' },
  { id: 'other', label: 'Other' },
];

export const SCHEDULE_FREQUENCIES = [
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'annually', label: 'Annually' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getStatusBadge(statusId, statusList) {
  const s = statusList.find(x => x.id === statusId);
  return s?.badge || 'gray';
}

export function getLabel(id, list) {
  return list.find(x => x.id === id)?.label || id || '—';
}

export function formatCurrency(n) {
  if (n == null || n === '' || isNaN(n)) return '—';
  const val = parseFloat(n);
  if (isNaN(val)) return '—';
  const sign = val < 0 ? '-' : '';
  return `${sign}£${Math.abs(val).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const PAYMENT_STATUSES = [
  { id: 'up_to_date', label: 'Up to date', badge: 'green' },
  { id: 'outstanding', label: 'Outstanding', badge: 'amber' },
  { id: 'overdue', label: 'Overdue', badge: 'red' },
  { id: 'no_invoices', label: 'No invoices', badge: 'gray' },
];

export function getPaymentStatus(resident) {
  if (resident.outstanding_balance > 0) {
    if (!resident.last_payment_date) return 'overdue';
    const daysSince = (Date.now() - new Date(resident.last_payment_date).getTime()) / 86400000;
    return daysSince > 35 ? 'overdue' : 'outstanding';
  }
  return resident.last_payment_date ? 'up_to_date' : 'no_invoices';
}

export function calculateExpectedMonthlyIncome(residents) {
  if (!residents || residents.length === 0) return 0;
  return residents
    .filter(r => r.status === 'active')
    .reduce((sum, r) => sum + (parseFloat(r.weekly_fee) || 0), 0) * 4.33;
}

export function calculateOccupancyRate(activeCount, registeredBeds) {
  if (!registeredBeds || registeredBeds <= 0) return 0;
  return (activeCount / registeredBeds) * 100;
}

export function getAgeingBucket(dueDate, asOfDate) {
  if (!dueDate) return 'current';
  const due = new Date(dueDate);
  const asOf = asOfDate ? new Date(asOfDate) : new Date();
  const diffDays = Math.floor((asOf - due) / 86400000);
  if (diffDays <= 0) return 'current';
  if (diffDays <= 30) return 'days_1_30';
  if (diffDays <= 60) return 'days_31_60';
  if (diffDays <= 90) return 'days_61_90';
  return 'days_90_plus';
}

export function getFinanceAlertsForDashboard(alerts) {
  if (!Array.isArray(alerts)) return [];
  return alerts.map(a => ({
    type: a.type === 'info' ? 'warning' : a.type,
    msg: `Finance: ${a.message}`,
    link: a.link || null,
  }));
}
