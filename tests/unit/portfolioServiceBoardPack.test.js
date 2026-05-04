import { describe, expect, it } from 'vitest';
import { buildPortfolioBoardPack } from '../../services/portfolioService.js';

describe('portfolio board pack evidence and data quality surfacing', () => {
  it('summarises unknown KPI coverage and carries CQC gap examples into the board pack', () => {
    const pack = buildPortfolioBoardPack({
      generated_at: '2026-05-04T09:00:00.000Z',
      homes: [{
        home_id: 1,
        home_slug: 'oak-house',
        home_name: 'Oak House',
        rag: {
          overall: 'unknown',
          staffing: 'unknown',
          cqc_evidence: 'red',
          training: 'green',
        },
        data_quality: {
          unknown_count: 1,
          unknown_signals: [{
            key: 'staffing',
            label: 'Staffing',
            reason: 'No planned staffing baseline is available for the next 7 days.',
            fix: 'Set minimum staffing rules and rota patterns in Settings.',
            route: '/settings',
          }],
        },
        cqc_evidence: {
          open_gaps: 6,
          overall: { band: 'not_ready', label: 'Heuristic: Significant Gaps', badge: 'red' },
          gap_examples: [{
            statement_id: 'safe-care-treatment',
            statement_name: 'Safe care and treatment',
            status: 'missing',
            summary: '0 evidence items across 0 of 4 expected categories.',
            reasons: ['Missing observation, outcomes'],
          }],
        },
        manager_actions: { overdue: 0, escalated_l3_plus: 0 },
        agency: { emergency_override_pct: 0 },
      }],
    });

    expect(pack.summary.homes_with_unknown_kpis).toBe(1);
    expect(pack.summary.unknown_kpi_signals).toBe(1);
    expect(pack.summary.cqc_gap_homes).toBe(1);
    expect(pack.summary.cqc_open_gaps).toBe(6);
    expect(pack.data_quality_issues).toEqual([
      expect.objectContaining({
        home_name: 'Oak House',
        key: 'staffing',
        route: '/settings',
      }),
    ]);
    expect(pack.cqc_evidence_gaps[0]).toEqual(expect.objectContaining({
      home_name: 'Oak House',
      open_gaps: 6,
      gap_examples: [expect.objectContaining({
        statement_name: 'Safe care and treatment',
        status: 'missing',
      })],
    }));
  });
});
