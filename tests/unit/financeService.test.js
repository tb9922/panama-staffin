import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../repositories/financeRepo.js', () => ({
  getIncomeSummary: vi.fn(),
  getExpenseSummary: vi.fn(),
  getExpensesByCategory: vi.fn(),
  countActiveResidents: vi.fn(),
  getReceivablesAgeing: vi.fn(),
  getMonthlyIncomeTrend: vi.fn(),
  getMonthlyExpenseTrend: vi.fn(),
  getPayrollTotal: vi.fn(),
  getAgencyTotal: vi.fn(),
  getRegisteredBeds: vi.fn(),
}));

vi.mock('../../repositories/bedRepo.js', () => ({}));

vi.mock('../../logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import logger from '../../logger.js';
import * as financeRepo from '../../repositories/financeRepo.js';
import { getFinanceDashboard } from '../../services/financeService.js';

describe('financeService.getFinanceDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    financeRepo.getIncomeSummary.mockResolvedValue({ total_invoiced: 1000, invoice_count: 2 });
    financeRepo.getExpenseSummary.mockResolvedValue({ total_expenses: 200 });
    financeRepo.getExpensesByCategory.mockResolvedValue([]);
    financeRepo.countActiveResidents.mockResolvedValue(8);
    financeRepo.getReceivablesAgeing.mockResolvedValue({ total_outstanding: 0, buckets: {} });
    financeRepo.getMonthlyIncomeTrend.mockResolvedValue([]);
    financeRepo.getMonthlyExpenseTrend.mockResolvedValue([]);
    financeRepo.getPayrollTotal.mockResolvedValue(300);
    financeRepo.getAgencyTotal.mockResolvedValue(50);
    financeRepo.getRegisteredBeds.mockResolvedValue(10);
  });

  it('returns complete totals when all optional metrics load', async () => {
    const result = await getFinanceDashboard(1, '2026-04-01', '2026-04-30');

    expect(result.degraded).toBe(false);
    expect(result.degraded_metrics).toEqual([]);
    expect(result.expenses.total_all).toBe(550);
    expect(result.net_position).toBe(450);
    expect(result.margin).toBe(45);
    expect(result.occupancy.rate).toBe(80);
  });

  it('marks the dashboard degraded instead of silently zeroing failed optional metrics', async () => {
    financeRepo.getPayrollTotal.mockRejectedValue(new Error('payroll unavailable'));

    const result = await getFinanceDashboard(1, '2026-04-01', '2026-04-30');

    expect(result.degraded).toBe(true);
    expect(result.degraded_metrics).toEqual(['staff_costs']);
    expect(result.expenses.staff_costs).toBeNull();
    expect(result.expenses.total_all).toBeNull();
    expect(result.net_position).toBeNull();
    expect(result.margin).toBeNull();
    expect(result.occupancy.rate).toBe(80);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ homeId: 1, metricId: 'staff_costs' }),
      'Finance dashboard metric unavailable',
    );
  });
});
