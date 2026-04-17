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

  it('maps risk, handover, and care certificate records into the new safe evidence coverage', () => {
    const riskLinks = buildAutoLinksForRecord(12, 'risk', {
      id: 'risk-001',
      title: 'Medication supply gap',
      last_reviewed: '2026-04-09',
    });
    const handoverLinks = buildAutoLinksForRecord(12, 'handover', {
      id: 'handover-001',
      date: '2026-04-10',
      priority: 'action',
    });
    const careCertLinks = buildAutoLinksForRecord(12, 'care_certificate', {
      id: 'S001',
      start_date: '2026-03-01',
    });

    expect(riskLinks.map((link) => link.quality_statement)).toEqual(['WL5']);
    expect(handoverLinks.map((link) => link.quality_statement)).toEqual(['S2']);
    expect(careCertLinks.map((link) => link.quality_statement)).toEqual(['S6']);
  });

  it('maps onboarding, DoLS, MCA, and appraisals using source dates', () => {
    const onboardingLinks = buildAutoLinksForRecord(12, 'onboarding', {
      id: 'S001:dbs_check',
      section: 'dbs_check',
      verified_date: '2026-04-01',
    });
    const dolsLinks = buildAutoLinksForRecord(12, 'dols', {
      id: 'dls-001',
      application_date: '2026-04-02',
    });
    const mcaLinks = buildAutoLinksForRecord(12, 'mca_assessment', {
      id: 'mca-001',
      assessment_date: '2026-04-03',
    });
    const appraisalLinks = buildAutoLinksForRecord(12, 'appraisal', {
      id: 'apr-001',
      date: '2026-04-04',
    });

    expect(onboardingLinks[0].quality_statement).toBe('S6');
    expect(onboardingLinks[0].source_recorded_at).toBe('2026-04-01T00:00:00Z');
    expect(dolsLinks[0].quality_statement).toBe('E6');
    expect(dolsLinks[0].source_recorded_at).toBe('2026-04-02T00:00:00Z');
    expect(mcaLinks[0].quality_statement).toBe('E6');
    expect(mcaLinks[0].source_recorded_at).toBe('2026-04-03T00:00:00Z');
    expect(appraisalLinks[0].quality_statement).toBe('S6');
    expect(appraisalLinks[0].source_recorded_at).toBe('2026-04-04T00:00:00Z');
  });

  it('maps safeguarding training to S3 processes evidence', () => {
    const links = buildAutoLinksForRecord(12, 'training_record', {
      id: 'S001::safeguarding-adults',
      training_type: 'safeguarding-adults',
      completed: '2026-04-05',
    });

    expect(links).toHaveLength(1);
    expect(links[0].quality_statement).toBe('S3');
    expect(links[0].evidence_category).toBe('processes');
    expect(links[0].source_recorded_at).toBe('2026-04-05T00:00:00Z');
  });

  it('maps partner feedback to its own statement under partner feedback evidence', () => {
    const links = buildAutoLinksForRecord(12, 'cqc_partner_feedback', {
      id: 44,
      quality_statement: 'WL3',
      summary: 'Partner noted a strong speaking-up culture.',
      feedback_date: '2026-04-03',
    });

    expect(links).toHaveLength(1);
    expect(links[0].quality_statement).toBe('WL3');
    expect(links[0].evidence_category).toBe('partner_feedback');
    expect(links[0].source_recorded_at).toBe('2026-04-03T00:00:00Z');
  });

  it('returns no links for an unknown module', () => {
    const links = buildAutoLinksForRecord(12, 'unknown_module', { id: 'x-1' });
    expect(links).toEqual([]);
  });
});
