import { describe, expect, it } from 'vitest';
import { buildAutoLinksForRecord } from '../../services/cqcAutoLinkService.js';

describe('buildAutoLinksForRecord', () => {
  it('maps a falls incident to S1, S4, and S5', () => {
    const links = buildAutoLinksForRecord(12, 'incident', {
      id: 'inc-001',
      type: 'fall',
      date: '2026-04-14',
      safeguarding_referral: false,
    }, 'manager');

    expect(links.map((link) => link.quality_statement)).toEqual(['S1', 'S4', 'S5']);
    expect(links.every((link) => link.linked_by === 'manager')).toBe(true);
    expect(links.every((link) => link.source_recorded_at === '2026-04-14T00:00:00Z')).toBe(true);
  });

  it('maps a non-falls incident only to S1 unless safeguarding is triggered', () => {
    const links = buildAutoLinksForRecord(12, 'incident', {
      id: 'inc-002',
      type: 'medication',
      date: '2026-04-14',
      safeguarding_referral: false,
    });

    expect(links.map((link) => link.quality_statement)).toEqual(['S1']);
  });

  it('adds S3 for safeguarding incidents', () => {
    const links = buildAutoLinksForRecord(12, 'incident', {
      id: 'inc-003',
      type: 'behaviour',
      date: '2026-04-14',
      safeguarding_referral: true,
    });

    expect(links.map((link) => link.quality_statement)).toEqual(['S1', 'S3']);
  });

  it('maps a resolved complaint to R4', () => {
    const links = buildAutoLinksForRecord(12, 'complaint', {
      id: 'cmp-001',
      status: 'resolved',
      date: '2026-04-10',
    });

    expect(links).toHaveLength(1);
    expect(links[0].quality_statement).toBe('R4');
    expect(links[0].evidence_category).toBe('peoples_experience');
  });

  it('maps a supervision to WL5 and E3', () => {
    const links = buildAutoLinksForRecord(12, 'supervision', {
      id: 'sup-001',
      date: '2026-04-01',
    });

    expect(links.map((link) => link.quality_statement)).toEqual(['WL5', 'E3']);
  });

  it('maps manual CQC evidence to its own statement and category', () => {
    const links = buildAutoLinksForRecord(12, 'cqc_evidence', {
      id: 'cqc-001',
      quality_statement: 'R6',
      evidence_category: 'outcomes',
      title: 'Equity review',
      date_to: '2026-04-12',
    });

    expect(links).toHaveLength(1);
    expect(links[0].quality_statement).toBe('R6');
    expect(links[0].evidence_category).toBe('outcomes');
    expect(links[0].source_recorded_at).toBe('2026-04-12T00:00:00Z');
  });

  it('returns no links for an unknown module', () => {
    const links = buildAutoLinksForRecord(12, 'unknown_module', { id: 'x-1' });
    expect(links).toEqual([]);
  });
});
