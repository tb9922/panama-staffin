import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../repositories/cqcEvidenceRepo.js', () => ({
  findByHome: vi.fn(),
}));

vi.mock('../../repositories/cqcEvidenceFileRepo.js', () => ({
  findByHome: vi.fn(),
}));

import * as cqcEvidenceRepo from '../../repositories/cqcEvidenceRepo.js';
import * as cqcEvidenceFileRepo from '../../repositories/cqcEvidenceFileRepo.js';
import { buildEvidenceQualityPayload, getEvidenceQuality, scoreEvidenceItem } from '../../services/evidenceQualityService.js';

const AS_OF = new Date('2026-05-04T00:00:00Z');

describe('evidenceQualityService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scores strong evidence green when mapped, fresh, owned and sourced', () => {
    const result = scoreEvidenceItem({
      id: 'ev-1',
      quality_statement: 'S1',
      type: 'qualitative',
      title: 'Incident learning review',
      description: '',
      date_to: '2026-04-01',
      evidence_category: 'processes',
      evidence_owner: 'Deputy Manager',
      review_due: '2026-08-01',
    }, 1, AS_OF);

    expect(result.score).toBe(100);
    expect(result.rag).toBe('green');
    expect(result.reasons).toEqual([]);
  });

  it('returns deterministic gap reasons for weak evidence', () => {
    const result = scoreEvidenceItem({
      id: 'ev-2',
      quality_statement: 'S2',
      type: '',
      title: 'Old pathway note',
      description: '',
      date_to: '2023-01-01',
      evidence_category: null,
      evidence_owner: '',
      review_due: '2026-01-01',
    }, 0, AS_OF);

    expect(result.rag).toBe('red');
    expect(result.reasons).toEqual(expect.arrayContaining([
      'Evidence is over 24 months old',
      'No attachment or source link',
      'No evidence owner',
      'Review date is overdue',
      'No evidence status/type',
    ]));
  });

  it('builds statement, domain and practical gap summaries including missing statements', () => {
    const payload = buildEvidenceQualityPayload([
      {
        id: 'ev-1',
        quality_statement: 'S1',
        type: 'qualitative',
        title: 'Incident learning review',
        description: 'https://example.test/review',
        date_to: '2026-04-01',
        evidence_category: 'processes',
        evidence_owner: 'Deputy Manager',
        review_due: '2026-08-01',
      },
    ], [], { domain: 'safe', asOf: AS_OF });

    expect(payload.summary.statement_count).toBe(8);
    expect(payload.domains).toHaveLength(1);
    expect(payload.statements.find((entry) => entry.statement_id === 'S1')?.rag).toBe('green');
    expect(payload.statements.find((entry) => entry.statement_id === 'S2')?.weakest_reasons).toContain('No mapped evidence');
    expect(payload.practical_gaps.some((gap) => gap.reason === 'No mapped evidence')).toBe(true);
  });

  it('loads evidence and files for a single home only via home-scoped repositories', async () => {
    cqcEvidenceRepo.findByHome.mockResolvedValueOnce({
      rows: [{ id: 'ev-1', quality_statement: 'S1', type: 'qualitative', title: 'Review', date_to: '2026-04-01' }],
      total: 1,
    });
    cqcEvidenceFileRepo.findByHome.mockResolvedValueOnce([{ id: 'file-1', evidence_id: 'ev-1' }]);

    const payload = await getEvidenceQuality(42, { statement: 'S1', asOf: AS_OF });

    expect(cqcEvidenceRepo.findByHome).toHaveBeenCalledWith(42, { limit: 500, offset: 0 });
    expect(cqcEvidenceFileRepo.findByHome).toHaveBeenCalledWith(42, { limit: 2000, offset: 0 });
    expect(payload.evidence[0].attachment_count).toBe(1);
  });
});
