import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../repositories/maintenanceRepo.js', () => ({
  findByHome: vi.fn(),
}));

vi.mock('../../repositories/recordAttachments.js', () => ({
  findByHome: vi.fn(),
}));

import * as maintenanceRepo from '../../repositories/maintenanceRepo.js';
import * as recordAttachmentsRepo from '../../repositories/recordAttachments.js';
import { getMaintenanceDocs } from '../../services/maintenanceDocsService.js';

describe('maintenanceDocsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads paged maintenance checks and flags contractor evidence gaps', async () => {
    maintenanceRepo.findByHome
      .mockResolvedValueOnce({
        rows: [
          { id: 'm-1', category: 'fire', contractor: 'Acme Ltd ', next_due: '2026-03-01', certificate_expiry: '2026-04-25' },
          { id: 'm-2', category: 'fire', contractor: 'Acme Ltd', next_due: '2026-03-02', certificate_expiry: '2026-04-25' },
        ],
        total: 3,
      })
      .mockResolvedValueOnce({
        rows: [
          { id: 'm-3', category: 'fire', contractor: 'Acme Ltd', next_due: '2026-03-03', certificate_expiry: '2026-04-25' },
        ],
        total: 3,
      });
    recordAttachmentsRepo.findByHome.mockResolvedValueOnce([]);

    const result = await getMaintenanceDocs(10, {
      maintenance_categories: [{ id: 'fire', name: 'Fire Safety' }],
    });

    expect(maintenanceRepo.findByHome).toHaveBeenNthCalledWith(1, 10, { limit: 500, offset: 0 });
    expect(maintenanceRepo.findByHome).toHaveBeenNthCalledWith(2, 10, { limit: 500, offset: 2 });
    expect(result.summary.total_checks).toBe(3);
    expect(result.byCategory[0]).toMatchObject({ id: 'fire', checks: 3 });
    expect(result.byContractor[0]).toMatchObject({ contractor: 'Acme Ltd', evidence_gap: true });
  });
});
