import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../repositories/financeRepo.js', () => ({
  findExpenses: vi.fn(),
  findPaymentSchedules: vi.fn(),
}));

vi.mock('../../repositories/recordAttachments.js', () => ({
  findByHome: vi.fn(),
}));

import * as financeRepo from '../../repositories/financeRepo.js';
import * as recordAttachmentsRepo from '../../repositories/recordAttachments.js';
import { getFinanceDocs } from '../../services/financeDocsService.js';

describe('financeDocsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads all pages and derives finance audit flags without schedule-expense cross scans', async () => {
    financeRepo.findExpenses
      .mockResolvedValueOnce({
        rows: [{
          id: 'exp-1',
          supplier: 'Acme Ltd ',
          status: 'approved',
          expense_date: '2026-04-01',
          category: 'utilities',
          schedule_id: null,
        }],
        total: 2,
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'exp-2',
          supplier: 'Acme Ltd',
          status: 'pending',
          expense_date: '2026-04-15',
          category: 'utilities',
          schedule_id: 'sch-1',
        }],
        total: 2,
      });
    financeRepo.findPaymentSchedules.mockResolvedValueOnce({
      rows: [{
        id: 'sch-1',
        supplier: 'Acme Ltd',
        category: 'utilities',
        next_due: '2026-04-30',
        on_hold: false,
      }],
      total: 1,
    });
    recordAttachmentsRepo.findByHome.mockResolvedValueOnce([
      { id: 'att-1', module: 'finance_expense', record_id: 'exp-2', created_at: '2026-04-20T10:00:00Z' },
    ]);

    const result = await getFinanceDocs(10);

    expect(financeRepo.findExpenses).toHaveBeenNthCalledWith(1, 10, { limit: 500, offset: 0 });
    expect(financeRepo.findExpenses).toHaveBeenNthCalledWith(2, 10, { limit: 500, offset: 1 });
    expect(result.summary.approved_without_document).toBe(1);
    expect(result.schedules[0].processed_without_source).toBe(false);
    expect(result.bySupplier).toEqual([{ key: 'Acme Ltd', count: 1 }]);
  });
});
