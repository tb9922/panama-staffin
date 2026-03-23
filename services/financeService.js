import { withTransaction } from '../db.js';
import logger from '../logger.js';
import * as financeRepo from '../repositories/financeRepo.js';

// ── Residents ─────────────────────────────────────────────────────────────────

export async function findResidents(homeId, filters) {
  return financeRepo.findResidents(homeId, filters);
}

export async function findResidentsWithBeds(homeId, filters) {
  return financeRepo.findResidentsWithBeds(homeId, filters);
}

export async function findResidentById(id, homeId) {
  return financeRepo.findResidentById(id, homeId);
}

export async function createResident(homeId, data) {
  validateFundingConsistency(data);
  const resident = await financeRepo.createResident(homeId, data);
  logger.info({ homeId, residentId: resident.id, fundingType: resident.funding_type }, 'Finance resident created');
  return resident;
}

export async function updateResident(id, homeId, data, username, version) {
  if ('funding_type' in data) validateFundingConsistency(data);

  // Fee change requires transaction to prevent TOCTOU race
  if ('weekly_fee' in data && data.weekly_fee != null) {
    return withTransaction(async (client) => {
      const existing = await financeRepo.findResidentById(id, homeId, client);
      if (!existing) return null;
      const oldFee = existing.weekly_fee;
      const newFee = parseFloat(data.weekly_fee);
      if (oldFee !== newFee) {
        await financeRepo.createFeeChange(homeId, {
          resident_id: id,
          effective_date: new Date().toISOString().slice(0, 10),
          previous_weekly: oldFee,
          new_weekly: newFee,
          reason: data._fee_change_reason || 'Fee updated',
          created_by: username,
        }, client);
        logger.info({ homeId, residentId: id, oldFee, newFee }, 'Fee change recorded');
      }
      const updated = await financeRepo.updateResident(id, homeId, data, client, version);
      if (updated === null) throw Object.assign(new Error('Record was modified by another user. Please refresh and try again.'), { statusCode: 409 });
      return updated;
    });
  }

  return financeRepo.updateResident(id, homeId, data, null, version);
}

function validateFundingConsistency(data) {
  const ft = data.funding_type;
  if (ft === 'la_funded' && (!data.la_contribution || parseFloat(data.la_contribution) <= 0) && !data._skipFundingCheck) {
    // Only warn on create when la_contribution is explicitly 0; allow update without it
    if (data.la_contribution === 0 || data.la_contribution === '0') {
      logger.warn({ fundingType: ft }, 'LA-funded resident created with zero LA contribution');
    }
  }
}

// ── Fee Changes ───────────────────────────────────────────────────────────────

export async function findFeeChanges(residentId, homeId) {
  return financeRepo.findFeeChanges(residentId, homeId);
}

// ── Invoices ──────────────────────────────────────────────────────────────────

export async function findInvoices(homeId, filters) {
  return financeRepo.findInvoices(homeId, filters);
}

export async function findInvoiceById(id, homeId) {
  const invoice = await financeRepo.findInvoiceById(id, homeId);
  if (!invoice) return null;
  const lines = await financeRepo.findInvoiceLines(id, homeId);
  return { ...invoice, lines };
}

export async function createInvoiceWithLines(homeId, data, username) {
  return withTransaction(async (client) => {
    // Validate resident inside transaction to prevent TOCTOU race
    if (data.resident_id) {
      const resident = await financeRepo.findResidentById(data.resident_id, homeId, client);
      if (!resident) throw Object.assign(new Error('Resident not found'), { statusCode: 400 });
      if (resident.status !== 'active') throw Object.assign(new Error('Cannot create invoice for non-active resident'), { statusCode: 400 });
    }

    // Generate invoice number atomically
    const now = new Date();
    const prefix = `INV-${String(now.getUTCFullYear()).slice(2)}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const invoiceNumber = await financeRepo.getNextInvoiceNumber(homeId, prefix, client);

    // Calculate totals from lines
    const lines = data.lines || [];
    const subtotal = Math.round(lines.reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0) * 100) / 100;
    const adjustments = parseFloat(data.adjustments) || 0;
    const totalAmount = Math.round((subtotal + adjustments) * 100) / 100;
    if (totalAmount < 0) throw Object.assign(new Error('Invoice total cannot be negative after adjustments'), { statusCode: 400 });

    const invoice = await financeRepo.createInvoice(homeId, {
      ...data,
      invoice_number: invoiceNumber,
      subtotal,
      total_amount: totalAmount,
      amount_paid: 0,
      balance_due: totalAmount,
      created_by: username,
    }, client);

    for (const line of lines) {
      await financeRepo.createInvoiceLine(invoice.id, homeId, line, client);
    }

    if (invoice.resident_id) {
      await financeRepo.recalculateResidentBalance(invoice.resident_id, homeId, client);
    }

    logger.info({ homeId, invoiceId: invoice.id, invoiceNumber, total: totalAmount, payerType: invoice.payer_type, createdBy: username }, 'Invoice created');
    const savedLines = await financeRepo.findInvoiceLines(invoice.id, homeId, client);
    return { ...invoice, lines: savedLines };
  });
}

export async function updateInvoice(id, homeId, data) {
  const existing = await financeRepo.findInvoiceById(id, homeId);
  if (!existing) return null;
  if (existing.status === 'void' || existing.status === 'credited') {
    throw Object.assign(new Error(`Cannot update a ${existing.status} invoice`), { statusCode: 400 });
  }
  const result = await financeRepo.updateInvoice(id, homeId, data);
  if (result) logger.info({ homeId, invoiceId: id, fields: Object.keys(data) }, 'Invoice updated');
  return result;
}

export async function updateInvoiceWithLines(id, homeId, data, username, version) {
  return withTransaction(async (client) => {
    const existing = await financeRepo.findInvoiceById(id, homeId, client, { forUpdate: true });
    if (!existing) return null;

    // Validate resident belongs to this home if resident_id is being changed
    const residentChanged = 'resident_id' in data && data.resident_id != null && data.resident_id !== existing.resident_id;
    if (residentChanged) {
      const newResident = await financeRepo.findResidentById(data.resident_id, homeId, client);
      if (!newResident) throw Object.assign(new Error('Resident not found in this home'), { statusCode: 400 });
    }

    // Recalculate totals if lines provided
    if (data.lines) {
      await financeRepo.deleteInvoiceLines(id, homeId, client);
      const lines = data.lines;
      const subtotal = Math.round(lines.reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0) * 100) / 100;
      const adjustments = parseFloat(data.adjustments ?? existing.adjustments) || 0;
      const totalAmount = Math.round((subtotal + adjustments) * 100) / 100;
      if (totalAmount < 0) throw Object.assign(new Error('Invoice total cannot be negative after adjustments'), { statusCode: 400 });
      const amountPaid = existing.amount_paid || 0;
      if (totalAmount < amountPaid) {
        throw Object.assign(
          new Error(`Invoice total (£${totalAmount.toFixed(2)}) cannot be less than amount already paid (£${amountPaid.toFixed(2)})`),
          { statusCode: 400 }
        );
      }
      data.subtotal = subtotal;
      data.total_amount = totalAmount;
      data.balance_due = Math.round((totalAmount - amountPaid) * 100) / 100;
      for (const line of lines) {
        await financeRepo.createInvoiceLine(id, homeId, line, client);
      }
    }

    const invoice = await financeRepo.updateInvoice(id, homeId, data, client, version);
    if (invoice === null) throw Object.assign(new Error('Record was modified by another user. Please refresh and try again.'), { statusCode: 409 });

    // Recalculate balance for old resident
    if (existing.resident_id) {
      await financeRepo.recalculateResidentBalance(existing.resident_id, homeId, client);
    }
    // If resident changed, also recalculate balance for the new resident
    if (residentChanged) {
      await financeRepo.recalculateResidentBalance(data.resident_id, homeId, client);
    }

    const savedLines = await financeRepo.findInvoiceLines(id, homeId, client);
    return { ...invoice, lines: savedLines };
  });
}

export async function recordPayment(invoiceId, homeId, paymentData, username) {
  return withTransaction(async (client) => {
    const invoice = await financeRepo.findInvoiceById(invoiceId, homeId, client, { forUpdate: true });
    if (!invoice) throw Object.assign(new Error('Invoice not found'), { statusCode: 404 });

    if (invoice.status === 'void' || invoice.status === 'credited') {
      throw Object.assign(new Error(`Cannot record payment on ${invoice.status} invoice`), { statusCode: 400 });
    }

    const paymentAmount = parseFloat(paymentData.amount);
    if (!paymentAmount || paymentAmount <= 0) {
      throw Object.assign(new Error('Payment amount must be greater than zero'), { statusCode: 400 });
    }
    if (paymentAmount > invoice.balance_due) {
      throw Object.assign(new Error(`Payment amount (${paymentAmount}) exceeds outstanding balance (${invoice.balance_due})`), { statusCode: 400 });
    }

    const newPaid = Math.round(((invoice.amount_paid || 0) + paymentAmount) * 100) / 100;
    const newBalance = Math.round((invoice.total_amount - newPaid) * 100) / 100;
    const newStatus = newBalance <= 0 ? 'paid' : 'partially_paid';

    const updated = await financeRepo.updateInvoice(invoiceId, homeId, {
      amount_paid: newPaid,
      balance_due: newBalance,
      status: newStatus,
      paid_date: newBalance <= 0 ? (paymentData.paid_date || new Date().toISOString().slice(0, 10)) : null,
      payment_method: paymentData.payment_method || null,
      payment_reference: paymentData.payment_reference || null,
    }, client);

    if (invoice.resident_id) {
      await financeRepo.updateResidentPaymentInfo(
        invoice.resident_id, homeId,
        paymentData.paid_date || new Date().toISOString().slice(0, 10),
        paymentAmount, client
      );
    }

    logger.info({ homeId, invoiceId, amount: paymentAmount, newBalance, newStatus, method: paymentData.payment_method, recordedBy: username }, 'Payment recorded');
    return updated;
  });
}

// ── Expenses ──────────────────────────────────────────────────────────────────

export async function findExpenses(homeId, filters) {
  return financeRepo.findExpenses(homeId, filters);
}

export async function findExpenseById(id, homeId) {
  return financeRepo.findExpenseById(id, homeId);
}

export async function createExpense(homeId, data) {
  const expense = await financeRepo.createExpense(homeId, data);
  logger.info({ homeId, expenseId: expense.id, category: expense.category, gross: expense.gross_amount, createdBy: expense.created_by }, 'Expense created');
  return expense;
}

export async function updateExpense(id, homeId, data, version) {
  const result = await financeRepo.updateExpense(id, homeId, data, null, version);
  if (result) logger.info({ homeId, expenseId: id, fields: Object.keys(data) }, 'Expense updated');
  return result;
}

export async function approveExpense(id, homeId, approver) {
  return withTransaction(async (client) => {
    const expense = await financeRepo.findExpenseById(id, homeId, client, { forUpdate: true });
    if (!expense) throw Object.assign(new Error('Expense not found'), { statusCode: 404 });
    if (expense.status !== 'pending') {
      throw Object.assign(new Error(`Cannot approve expense with status '${expense.status}'`), { statusCode: 400 });
    }
    if (expense.created_by === approver) {
      logger.warn({ homeId, expenseId: id, createdBy: expense.created_by, approver }, 'Expense approval rejected: same user');
      throw Object.assign(new Error('Cannot approve your own expense'), { statusCode: 400 });
    }
    const updated = await financeRepo.updateExpense(id, homeId, {
      status: 'approved',
      approved_by: approver,
      approved_date: new Date().toISOString().slice(0, 10),
    }, client);
    logger.info({ homeId, expenseId: id, approver, gross: expense.gross_amount }, 'Expense approved');
    return updated;
  });
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export async function getFinanceDashboard(homeId, from, to) {
  const [income, expenses, expensesByCat, occupancy, ageing, incomeTrend, expenseTrend] = await Promise.all([
    financeRepo.getIncomeSummary(homeId, from, to),
    financeRepo.getExpenseSummary(homeId, from, to),
    financeRepo.getExpensesByCategory(homeId, from, to),
    financeRepo.countActiveResidents(homeId),
    financeRepo.getReceivablesAgeing(homeId, new Date().toISOString().slice(0, 10)),
    financeRepo.getMonthlyIncomeTrend(homeId, 6),
    financeRepo.getMonthlyExpenseTrend(homeId, 6),
  ]);

  // Read payroll, agency costs and home config via repo layer
  let staffCosts = 0;
  let agencyCosts = 0;
  let registeredBeds = 0;
  try { staffCosts = await financeRepo.getPayrollTotal(homeId, from, to); } catch { /* payroll tables may not exist */ }
  try { agencyCosts = await financeRepo.getAgencyTotal(homeId, from, to); } catch { /* agency tables may not exist */ }
  try { registeredBeds = await financeRepo.getRegisteredBeds(homeId); } catch { /* fallback */ }

  const totalExpenses = expenses.total_expenses + staffCosts + agencyCosts;
  const netPosition = income.total_invoiced - totalExpenses;

  return {
    income,
    expenses: { ...expenses, staff_costs: staffCosts, agency_costs: agencyCosts, total_all: totalExpenses },
    expenses_by_category: expensesByCat,
    occupancy: { active: occupancy, registered_beds: registeredBeds, rate: registeredBeds > 0 ? (occupancy / registeredBeds * 100) : 0 },
    ageing,
    net_position: netPosition,
    margin: income.total_invoiced > 0 ? (netPosition / income.total_invoiced * 100) : 0,
    income_trend: incomeTrend,
    expense_trend: expenseTrend,
  };
}

// ── Alerts ────────────────────────────────────────────────────────────────────

export async function getFinanceAlerts(homeId) {
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysOut = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const [overdueCount, pendingCount, feeReviews, ageing, chasesDue, upcoming, outstandingResidents] = await Promise.all([
    financeRepo.getOverdueInvoiceCount(homeId, today),
    financeRepo.getPendingExpenseCount(homeId),
    financeRepo.getFeeReviewsDue(homeId, thirtyDaysOut),
    financeRepo.getReceivablesAgeing(homeId, today),
    financeRepo.getChasesDueForAction(homeId, today),
    financeRepo.getUpcomingPayments(homeId, today),
    financeRepo.getResidentsWithOutstandingBalance(homeId),
  ]);

  const alerts = [];

  if (ageing.buckets.days_90_plus > 0) {
    alerts.push({ type: 'error', message: `£${ageing.buckets.days_90_plus.toFixed(0)} receivables 90+ days overdue`, link: '/finance/receivables' });
  }
  if (ageing.buckets.days_61_90 > 0) {
    alerts.push({ type: 'error', message: `£${ageing.buckets.days_61_90.toFixed(0)} receivables 60-90 days overdue`, link: '/finance/receivables' });
  }
  if (ageing.buckets.days_31_60 > 0) {
    alerts.push({ type: 'warning', message: `£${ageing.buckets.days_31_60.toFixed(0)} receivables 31-60 days overdue`, link: '/finance/receivables' });
  }
  if (ageing.buckets.days_1_30 > 0) {
    alerts.push({ type: 'warning', message: `£${ageing.buckets.days_1_30.toFixed(0)} receivables 1-30 days overdue`, link: '/finance/receivables' });
  }
  if (overdueCount > 0) {
    alerts.push({ type: 'warning', message: `${overdueCount} invoice${overdueCount > 1 ? 's' : ''} overdue`, link: '/finance/income' });
  }
  if (pendingCount > 0) {
    alerts.push({ type: 'info', message: `${pendingCount} expense${pendingCount > 1 ? 's' : ''} awaiting approval`, link: '/finance/expenses' });
  }
  for (const r of feeReviews.slice(0, 5)) {
    alerts.push({ type: 'warning', message: `Fee review due for ${r.resident_name} (Room ${r.room_number || '?'})`, link: '/finance/income' });
  }

  // Chase follow-ups due
  if (chasesDue.length > 0) {
    alerts.push({ type: 'warning', message: `${chasesDue.length} chase follow-up${chasesDue.length > 1 ? 's' : ''} due or overdue`, link: '/finance/receivables' });
  }

  // Scheduled payments due
  if (upcoming.length > 0) {
    alerts.push({ type: 'info', message: `${upcoming.length} scheduled payment${upcoming.length > 1 ? 's' : ''} due`, link: '/finance/payment-schedules' });
  }

  // Resident outstanding balances
  if (outstandingResidents.length > 0) {
    const total = outstandingResidents.reduce((s, r) => s + parseFloat(r.outstanding_balance), 0);
    alerts.push({
      type: 'warning',
      message: `${outstandingResidents.length} resident${outstandingResidents.length > 1 ? 's' : ''} with \u00A3${total.toFixed(0)} outstanding`,
      link: '/finance/income',
    });
  }

  return alerts;
}

// ── Chase Log ────────────────────────────────────────────────────────────────

export async function findChasesByInvoice(invoiceId, homeId) {
  return financeRepo.findChasesByInvoice(invoiceId, homeId);
}

export async function createChase(homeId, data, username) {
  return withTransaction(async (client) => {
    const invoice = await financeRepo.findInvoiceById(data.invoice_id, homeId, client, { forUpdate: true });
    if (!invoice) throw Object.assign(new Error('Invoice not found'), { statusCode: 404 });
    if (invoice.status === 'paid' || invoice.status === 'void' || invoice.status === 'credited') {
      throw Object.assign(new Error(`Cannot chase a ${invoice.status} invoice`), { statusCode: 400 });
    }
    const chase = await financeRepo.createChase(homeId, { ...data, created_by: username }, client);
    logger.info({ homeId, invoiceId: data.invoice_id, chaseId: chase.id, method: chase.method }, 'Chase recorded');
    return chase;
  });
}

// ── Payment Schedule ─────────────────────────────────────────────────────────

export async function findPaymentSchedules(homeId, filters) {
  return financeRepo.findPaymentSchedules(homeId, filters);
}

export async function findPaymentScheduleById(id, homeId) {
  return financeRepo.findPaymentScheduleById(id, homeId);
}

export async function createPaymentSchedule(homeId, data, username) {
  const schedule = await financeRepo.createPaymentSchedule(homeId, { ...data, created_by: username });
  logger.info({ homeId, scheduleId: schedule.id, supplier: schedule.supplier, amount: schedule.amount }, 'Payment schedule created');
  return schedule;
}

export async function updatePaymentSchedule(id, homeId, data, version) {
  const result = await financeRepo.updatePaymentSchedule(id, homeId, data, null, version);
  if (result) logger.info({ homeId, scheduleId: id, fields: Object.keys(data) }, 'Payment schedule updated');
  return result;
}

export async function processScheduledPayment(scheduleId, homeId, username) {
  return withTransaction(async (client) => {
    const schedule = await financeRepo.findPaymentScheduleById(scheduleId, homeId, client, true);
    if (!schedule) throw Object.assign(new Error('Payment schedule not found'), { statusCode: 404 });
    if (schedule.on_hold) throw Object.assign(new Error('Payment schedule is on hold'), { statusCode: 400 });
    const expense = await financeRepo.createExpense(homeId, {
      expense_date: schedule.next_due,
      category: schedule.category,
      description: `${schedule.supplier} — ${schedule.description || schedule.category} (scheduled)`,
      supplier: schedule.supplier,
      net_amount: schedule.amount,
      vat_amount: 0,
      gross_amount: schedule.amount,
      status: schedule.auto_approve ? 'approved' : 'pending',
      approved_by: schedule.auto_approve ? 'auto' : null,
      approved_date: schedule.auto_approve ? new Date().toISOString().slice(0, 10) : null,
      recurring: true,
      recurrence_frequency: schedule.frequency,
      created_by: username,
    }, client);

    const nextDue = advanceDate(schedule.next_due, schedule.frequency);
    await financeRepo.updatePaymentSchedule(scheduleId, homeId, { next_due: nextDue }, client);

    logger.info({ homeId, scheduleId, expenseId: expense.id, nextDue }, 'Scheduled payment processed');
    return { expense, next_due: nextDue };
  });
}

function advanceDate(dateStr, frequency) {
  const [y, m, day] = dateStr.split('-').map(Number);
  switch (frequency) {
    case 'weekly': {
      const dt = new Date(Date.UTC(y, m - 1, day + 7));
      return dt.toISOString().slice(0, 10);
    }
    case 'monthly':
    case 'quarterly':
    case 'annually': {
      const addMonths = frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : 12;
      let nm = m - 1 + addMonths;
      let ny = y + Math.floor(nm / 12);
      nm = nm % 12;
      const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
      const nd = Math.min(day, lastDay);
      return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
    }
    default:
      return dateStr;
  }
}

// ── Reject Expense ──────────────────────────────────────────────────────────

export async function rejectExpense(id, homeId, rejector, reason) {
  return withTransaction(async (client) => {
    const expense = await financeRepo.findExpenseById(id, homeId, client, { forUpdate: true });
    if (!expense) throw Object.assign(new Error('Expense not found'), { statusCode: 404 });
    if (expense.status !== 'pending') {
      throw Object.assign(new Error(`Cannot reject expense with status '${expense.status}'`), { statusCode: 400 });
    }
    const updated = await financeRepo.updateExpense(id, homeId, {
      status: 'rejected',
      rejected_by: rejector,
      rejected_date: new Date().toISOString().slice(0, 10),
      rejection_reason: reason || null,
    }, client);
    logger.info({ homeId, expenseId: id, rejector }, 'Expense rejected');
    return updated;
  });
}

// ── Soft Delete ─────────────────────────────────────────────────────────────

export async function softDeleteResident(id, homeId, username) {
  const deleted = await financeRepo.softDelete('resident', id, homeId);
  if (deleted) logger.info({ homeId, residentId: id, deletedBy: username }, 'Finance resident soft-deleted');
  return deleted;
}

export async function softDeleteInvoice(id, homeId, username) {
  return withTransaction(async (client) => {
    const invoice = await financeRepo.findInvoiceById(id, homeId, client, { forUpdate: true });
    if (!invoice) return false;
    if (invoice.status !== 'draft' && invoice.status !== 'void') {
      throw Object.assign(new Error(`Cannot delete invoice with status '${invoice.status}' — void it first`), { statusCode: 400 });
    }
    const deleted = await financeRepo.softDelete('invoice', id, homeId, client);
    if (deleted) {
      await financeRepo.deleteInvoiceLines(id, homeId, client);
      if (invoice.resident_id) {
        await financeRepo.recalculateResidentBalance(invoice.resident_id, homeId, client);
      }
      logger.info({ homeId, invoiceId: id, deletedBy: username }, 'Invoice soft-deleted');
    }
    return deleted;
  });
}

export async function softDeleteExpense(id, homeId, username) {
  return withTransaction(async (client) => {
    const expense = await financeRepo.findExpenseById(id, homeId, client, { forUpdate: true });
    if (!expense) return false;
    if (expense.status !== 'pending' && expense.status !== 'void') {
      throw Object.assign(new Error(`Cannot delete expense with status '${expense.status}' — void it first`), { statusCode: 400 });
    }
    const deleted = await financeRepo.softDelete('expense', id, homeId, client);
    if (deleted) logger.info({ homeId, expenseId: id, deletedBy: username }, 'Expense soft-deleted');
    return deleted;
  });
}

export async function softDeletePaymentSchedule(id, homeId, username) {
  const deleted = await financeRepo.softDelete('schedule', id, homeId);
  if (deleted) logger.info({ homeId, scheduleId: id, deletedBy: username }, 'Payment schedule soft-deleted');
  return deleted;
}

// ── Receivables Detail ───────────────────────────────────────────────────────

export async function getReceivablesDetail(homeId) {
  const today = new Date().toISOString().slice(0, 10);
  const [ageing, chasesDue, lastChases] = await Promise.all([
    financeRepo.getReceivablesAgeing(homeId, today),
    financeRepo.getChasesDueForAction(homeId, today),
    financeRepo.getLastChasePerInvoice(homeId),
  ]);
  const chaseMap = new Map(lastChases.map(c => [c.invoice_id, c]));
  const enriched = ageing.overdue_items.map(item => ({
    ...item,
    last_chase: chaseMap.get(item.id) || null,
  }));
  return { ...ageing, overdue_items: enriched, chases_due: chasesDue };
}
