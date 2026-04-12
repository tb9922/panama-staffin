import { describe, expect, it } from 'vitest';
import { MOCK_SCHEDULING_DATA } from '../../test/fixtures/schedulingData.js';
import { getDateRange } from '../cqc.js';
import { buildReadinessMatrix, getOverallReadiness, getQuestionReadiness, getReadinessGaps } from '../cqcReadiness.js';

function buildBaseData() {
  return {
    ...MOCK_SCHEDULING_DATA,
    incidents: [],
    complaints: [],
    complaint_surveys: [],
    maintenance: [],
    ipc_audits: [],
    risk_register: [],
    policy_reviews: [],
    whistleblowing_concerns: [],
    dols: [],
    mca_assessments: [],
    care_certificate: {},
    onboarding: {},
    cqc_evidence: [],
    cqc_statement_narratives: [],
  };
}

describe('cqcReadiness', () => {
  it('normalizes legacy evidence categories and applies per-category freshness thresholds', () => {
    const data = buildBaseData();
    data.cqc_evidence = [
      {
        id: 'ev-1',
        quality_statement: 'S1',
        type: 'qualitative',
        title: 'Resident survey',
        evidence_category: 'feedback',
        date_from: '2025-09-01',
        review_due: '2026-03-01',
        added_at: '2025-09-02T10:00:00Z',
      },
      {
        id: 'ev-2',
        quality_statement: 'S1',
        type: 'qualitative',
        title: 'Process audit',
        evidence_category: 'management_info',
        date_from: '2026-02-10',
        review_due: '2026-08-01',
        added_at: '2026-02-10T10:00:00Z',
      },
    ];
    data.cqc_statement_narratives = [
      {
        quality_statement: 'S1',
        narrative: 'The service is learning from incidents.',
        risks: '',
        actions: '',
      },
    ];

    const matrix = buildReadinessMatrix(data, getDateRange(28), '2026-04-12');
    const s1 = matrix.get('S1');

    expect(s1.evidenceByCategory.staff_leader_feedback).toBe(1);
    expect(s1.evidenceByCategory.processes).toBe(1);
    expect(s1.reviewOverdue).toBe(1);
    expect(s1.staleCount).toBe(1);
    expect(s1.staleItems[0].category).toBe('staff_leader_feedback');
    expect(s1.narrativePresent).toBe(true);
    expect(s1.status).toBe('stale');
    expect(s1.summary).toMatch(/Missing:/);
  });

  it('treats a statement with no manual evidence and no working auto-metrics as missing', () => {
    const data = buildBaseData();
    const matrix = buildReadinessMatrix(data, getDateRange(28), '2026-04-12');
    const wl6 = matrix.get('WL6');

    expect(wl6.evidenceCount).toBe(0);
    expect(wl6.metricCoverageCount).toBe(0);
    expect(wl6.status).toBe('missing');
  });

  it('summarizes question readiness and sorts gaps by severity', () => {
    const matrix = new Map([
      ['S1', { statementId: 'S1', category: 'safe', status: 'missing', summary: 'No evidence' }],
      ['S2', { statementId: 'S2', category: 'safe', status: 'weak', summary: 'Metrics only' }],
      ['S3', { statementId: 'S3', category: 'safe', status: 'stale', summary: 'Old evidence' }],
      ['S4', { statementId: 'S4', category: 'safe', status: 'partial', summary: 'Missing partner feedback' }],
      ['C1', { statementId: 'C1', category: 'caring', status: 'strong', summary: 'Healthy' }],
    ]);

    const questionSummary = getQuestionReadiness(matrix);
    const overall = getOverallReadiness(matrix);
    const gaps = getReadinessGaps(matrix);

    expect(questionSummary.find((entry) => entry.question === 'safe')).toMatchObject({
      total: 4,
      missing: 1,
      weak: 1,
      stale: 1,
      partial: 1,
      strong: 0,
    });
    expect(overall.strong).toBe(1);
    expect(gaps.map((entry) => entry.statementId)).toEqual(['S1', 'S2', 'S3', 'S4']);
  });
});
