import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db.js', () => ({
  pool: {
    connect: vi.fn(),
  },
}));

vi.mock('../../repositories/evidenceHubRepo.js', () => ({
  search: vi.fn(),
  listUploaders: vi.fn(),
}));

vi.mock('../../shared/evidenceHub.js', async () => {
  const actual = await vi.importActual('../../shared/evidenceHub.js');
  return {
    ...actual,
    getReadableEvidenceSources: vi.fn(() => [{ id: 'record', label: 'Operational Records', module: null }]),
    getEvidenceSourceLabel: vi.fn(() => 'Operational Records'),
    canDeleteEvidenceSource: vi.fn(() => false),
  };
});

vi.mock('../../shared/recordAttachmentModules.js', async () => {
  const actual = await vi.importActual('../../shared/recordAttachmentModules.js');
  return {
    ...actual,
    getReadableRecordAttachmentModules: vi.fn(() => [{ id: 'finance_invoice' }]),
    canReadRecordAttachmentModule: vi.fn(() => true),
    getRecordAttachmentModule: vi.fn(() => ({ label: 'Invoice', pagePath: '/finance/income' })),
  };
});

import { pool } from '../../db.js';
import * as evidenceHubRepo from '../../repositories/evidenceHubRepo.js';
import { _HR_PARENT_META, search } from '../../services/evidenceHubService.js';

describe('evidenceHubService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pool.connect.mockResolvedValue({
      query: vi.fn(),
      release: vi.fn(),
    });
  });

  it('sorts rows safely when some attachments have null createdAt', async () => {
    evidenceHubRepo.search.mockResolvedValue({
      rows: [
        {
          sourceModule: 'record',
          sourceSubType: 'finance_invoice',
          sourceRecordId: 'inv-1',
          attachmentId: 'att-1',
          createdAt: null,
        },
        {
          sourceModule: 'record',
          sourceSubType: 'finance_invoice',
          sourceRecordId: 'inv-2',
          attachmentId: 'att-2',
          createdAt: '2026-04-20T10:00:00Z',
        },
      ],
      total: 2,
    });

    const result = await search({ id: 1, config: {} }, 'finance_officer', {});

    expect(result.rows.map((row) => row.sourceRecordId)).toEqual(['inv-2', 'inv-1']);
    expect(result.total).toBe(2);
  });

  it('keeps HR parent metadata for every supported HR attachment subtype', () => {
    expect(_HR_PARENT_META).toMatchObject({
      disciplinary: expect.any(Object),
      grievance: expect.any(Object),
      performance: expect.any(Object),
      rtw_interview: expect.any(Object),
      oh_referral: expect.any(Object),
      contract: expect.any(Object),
      family_leave: expect.any(Object),
      flexible_working: expect.any(Object),
      edi: expect.any(Object),
      tupe: expect.any(Object),
      renewal: expect.any(Object),
    });
  });
});
