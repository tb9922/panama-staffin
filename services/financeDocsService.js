import * as financeRepo from '../repositories/financeRepo.js';
import * as recordAttachmentsRepo from '../repositories/recordAttachments.js';

function normalizeSupplierName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function monthKey(dateValue) {
  return typeof dateValue === 'string' && dateValue.length >= 7 ? dateValue.slice(0, 7) : 'unknown';
}

export async function getFinanceDocs(homeId) {
  const [expensesResult, schedulesResult, attachments] = await Promise.all([
    financeRepo.findExpenses(homeId, { limit: 2000, offset: 0 }),
    financeRepo.findPaymentSchedules(homeId, { limit: 2000, offset: 0 }),
    recordAttachmentsRepo.findByHome(homeId, { moduleIds: ['finance_expense', 'finance_payment_schedule'], limit: 5000 }),
  ]);

  const attachmentBuckets = new Map();
  for (const attachment of attachments) {
    const key = `${attachment.module}:${attachment.record_id}`;
    const bucket = attachmentBuckets.get(key) || [];
    bucket.push(attachment);
    attachmentBuckets.set(key, bucket);
  }

  const expenses = expensesResult.rows.map((expense) => {
    const docs = attachmentBuckets.get(`finance_expense:${expense.id}`) || [];
    return {
      ...expense,
      supplier_name: normalizeSupplierName(expense.supplier),
      attachment_count: docs.length,
      latest_attachment: docs[0] || null,
      approved_without_document: expense.status === 'approved' && docs.length === 0,
      pending_too_long: expense.status === 'pending'
        && expense.expense_date
        && new Date(`${expense.expense_date}T00:00:00Z`).getTime() < Date.now() - (14 * 86400000),
    };
  });

  const schedules = schedulesResult.rows.map((schedule) => {
    const scheduleDocs = attachmentBuckets.get(`finance_payment_schedule:${schedule.id}`) || [];
    const resultingExpenses = expenses.filter((expense) => expense.schedule_id === schedule.id);
    const resultingDocs = resultingExpenses.reduce((sum, expense) => sum + expense.attachment_count, 0);
    return {
      ...schedule,
      supplier_name: normalizeSupplierName(schedule.supplier),
      attachment_count: scheduleDocs.length,
      latest_attachment: scheduleDocs[0] || null,
      processed_without_source: resultingExpenses.length > 0 && scheduleDocs.length === 0 && resultingDocs === 0,
    };
  });

  const documents = [
    ...expenses.flatMap((expense) => (attachmentBuckets.get(`finance_expense:${expense.id}`) || []).map((attachment) => ({
      type: 'expense',
      parent_id: expense.id,
      supplier: expense.supplier_name || '—',
      month: monthKey(expense.expense_date),
      category: expense.category,
      status: expense.status,
      attachment,
    }))),
    ...schedules.flatMap((schedule) => (attachmentBuckets.get(`finance_payment_schedule:${schedule.id}`) || []).map((attachment) => ({
      type: 'payment_schedule',
      parent_id: schedule.id,
      supplier: schedule.supplier_name || '—',
      month: monthKey(schedule.next_due),
      category: schedule.category,
      status: schedule.on_hold ? 'on_hold' : 'active',
      attachment,
    }))),
  ].sort((a, b) => new Date(b.attachment.created_at).getTime() - new Date(a.attachment.created_at).getTime());

  const groupCounts = (items, keyFn) => {
    const buckets = new Map();
    for (const item of items) {
      const key = keyFn(item);
      const bucket = buckets.get(key) || { key, count: 0 };
      bucket.count += 1;
      buckets.set(key, bucket);
    }
    return [...buckets.values()].sort((a, b) => String(a.key).localeCompare(String(b.key)));
  };

  return {
    summary: {
      approved_without_document: expenses.filter((expense) => expense.approved_without_document).length,
      pending_too_long: expenses.filter((expense) => expense.pending_too_long).length,
      processed_without_source: schedules.filter((schedule) => schedule.processed_without_source).length,
      total_documents: documents.length,
    },
    documents,
    expenses,
    schedules,
    byMonth: groupCounts(documents, (item) => item.month),
    bySupplier: groupCounts(documents, (item) => item.supplier || '—'),
    byCategory: groupCounts(documents, (item) => item.category || 'other'),
    byStatus: groupCounts(documents, (item) => item.status || 'unknown'),
  };
}
