import { describe, expect, it } from 'vitest';
import { MOCK_SCHEDULING_DATA } from '../../test/fixtures/schedulingData.js';
import { getDateRange } from '../cqc.js';
import { buildReadinessMatrix, getOverallReadiness, getReadinessGaps } from '../cqcReadiness.js';

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
  it('normalizes legacy evidence categories and tracks overdue reviews', () => {
    const data = buildBaseData();
    data.cqc_evidence = [
      {
        id: 'ev-1',
        quality_statement: 'S1',
        type: 'qualitative',
        title: 'Learning review',
        evidence_category: 'feedback',
        date_from: '2026-02-01',
        review_due: '2026-03-01',
        added_at: '2026-02-05T10:00:00Z',
      },
      {
        id: 'ev-2',
        quality_statement: 'S1',
        type: 'qualitative',
        title: 'Process note',
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
    expect(s1.narrativePresent).toBe(true);
    expect(['partial', 'covered']).toContain(s1.status);
  });

  it('summarizes overall readiness and sorts gaps by severity', () => {
    const matrix = new Map([
      ['S1', { statementId: 'S1', status: 'missing', reasons: ['No evidence'] }],
      ['S2', { statementId: 'S2', status: 'weak', reasons: ['Metrics only'] }],
      ['S3', { statementId: 'S3', status: 'partial', reasons: ['Missing partner feedback'] }],
      ['S4', { statementId: 'S4', status: 'covered', reasons: [] }],
    ]);

    const overall = getOverallReadiness(matrix);
    const gaps = getReadinessGaps(matrix);

    expect(overall.total).toBe(4);
    expect(gaps.map((entry) => entry.statementId)).toEqual(['S1', 'S2', 'S3']);
  });
});
