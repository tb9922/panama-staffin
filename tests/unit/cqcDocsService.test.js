import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../repositories/cqcEvidenceRepo.js', () => ({
  findByHome: vi.fn(),
}));

vi.mock('../../repositories/cqcEvidenceFileRepo.js', () => ({
  findByHome: vi.fn(),
}));

import * as cqcEvidenceRepo from '../../repositories/cqcEvidenceRepo.js';
import * as cqcEvidenceFileRepo from '../../repositories/cqcEvidenceFileRepo.js';
import { getCqcDocs } from '../../services/cqcDocsService.js';

describe('cqcDocsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pages through all evidence rows and keeps latest attachments', async () => {
    cqcEvidenceRepo.findByHome
      .mockResolvedValueOnce({
        rows: [{ id: 'ev-1', quality_statement: 'S1', evidence_category: null, evidence_owner: null, review_due: null }],
        total: 2,
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'ev-2', quality_statement: 'S2', evidence_category: 'policy', evidence_owner: 'Manager', review_due: null }],
        total: 2,
      });
    cqcEvidenceFileRepo.findByHome.mockResolvedValueOnce([
      { id: 'file-2', evidence_id: 'ev-2', created_at: '2026-04-20T10:00:00Z' },
      { id: 'file-1', evidence_id: 'ev-1', created_at: '2026-04-19T10:00:00Z' },
    ]);

    const result = await getCqcDocs(10);

    expect(cqcEvidenceRepo.findByHome).toHaveBeenNthCalledWith(1, 10, { limit: 500, offset: 0 });
    expect(cqcEvidenceRepo.findByHome).toHaveBeenNthCalledWith(2, 10, { limit: 500, offset: 1 });
    expect(result.evidence).toHaveLength(2);
    expect(result.summary.total_documents).toBe(2);
    expect(result.evidence.find((row) => row.id === 'ev-2')?.latest_attachment?.id).toBe('file-2');
    expect(result.byCategory.find((row) => row.key === 'uncategorised')?.count).toBe(1);
  });
});
