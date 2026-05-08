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
            source_type: 'portfolio_data_quality',
            source_action_key: 'unknown_staffing',
            title: 'Resolve Staffing portfolio data-quality gap',
            category: 'governance',
            priority: 'high',
            owner_role: 'Home manager',
            due_date: '2026-05-11',
            status: 'open',
            escalation_level: 2,
            evidence_required: true,
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
        source_type: 'portfolio_data_quality',
        source_id: '1',
        source_action_key: 'unknown_staffing',
        owner_role: 'Home manager',
        due_date: '2026-05-11',
        status: 'open',
        escalation_level: 2,
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

  it('carries board-pack action exception totals and omitted counts', () => {
    const pack = buildPortfolioBoardPack({
      generated_at: '2026-05-04T09:00:00.000Z',
      homes: [{
        home_id: 1,
        home_slug: 'oak-house',
        home_name: 'Oak House',
        rag: { overall: 'amber', manager_actions: 'amber' },
        manager_actions: { overdue: 1, escalated_l3_plus: 0 },
        agency: { emergency_override_pct: 0 },
      }],
    }, {
      rows: [{
        home_name: 'Oak House',
        title: 'Overdue non-L3 action',
        priority: 'high',
        escalation_level: 1,
      }],
      total: 3,
      omitted: 2,
    });

    expect(pack.escalated_actions).toHaveLength(1);
    expect(pack.action_exceptions).toEqual(pack.escalated_actions);
    expect(pack.action_exception_count).toBe(3);
    expect(pack.action_exception_omitted_count).toBe(2);
  });

  it('ranks unknown-heavy homes as hidden-chaos weakest homes', () => {
    const pack = buildPortfolioBoardPack({
      homes: [
        {
          home_id: 1,
          home_slug: 'amber-house',
          home_name: 'Amber House',
          rag: { overall: 'amber', training: 'amber', staffing: 'green' },
          data_quality: { unknown_count: 0, unknown_signals: [] },
          manager_actions: { overdue: 0, escalated_l3_plus: 0 },
          agency: { emergency_override_pct: 0 },
        },
        {
          home_id: 2,
          home_slug: 'hidden-house',
          home_name: 'Hidden House',
          rag: {
            overall: 'unknown',
            staffing: 'unknown',
            training: 'unknown',
            incidents: 'unknown',
            complaints: 'unknown',
          },
          data_quality: { unknown_count: 4, unknown_signals: [] },
          manager_actions: { overdue: 0, escalated_l3_plus: 0 },
          agency: { emergency_override_pct: 0 },
        },
      ],
    });

    expect(pack.weakest_homes[0]).toEqual(expect.objectContaining({
      home_slug: 'hidden-house',
      unknown_count: 4,
    }));
  });

  it('adds cross-home exception lists for board review', () => {
    const pack = buildPortfolioBoardPack({
      homes: [{
        home_id: 1,
        home_slug: 'oak-house',
        home_name: 'Oak House',
        rag: {
          overall: 'red',
          audits: 'red',
          supervisions: 'amber',
          maintenance: 'red',
          incidents: 'red',
          complaints: 'amber',
          outcomes: 'red',
        },
        data_quality: { unknown_count: 0, unknown_signals: [] },
        audits: { overdue: 2, due_7d: 1, pending_qa: 1, evidence_missing: 1, policy_due_30d: 0 },
        supervisions: { overdue: 1, due_7d: 2, no_record: 3 },
        maintenance: { overdue: 1, due_30d: 2, certs_expired: 1 },
        incidents: {
          open: 5,
          rate_per_resident_month: 0.2,
          cqc_notifiable_overdue: 1,
          riddor_overdue: 0,
          duty_of_candour_overdue: 1,
        },
        complaints: {
          open: 2,
          rate_per_resident_month: 0.1,
          ack_overdue: 1,
          response_overdue: 0,
        },
        outcomes: {
          falls_28d: 4,
          infections_28d: 1,
          pressure_sores_new_28d: 2,
          manual_rag: 'red',
        },
        manager_actions: { overdue: 0, escalated_l3_plus: 0 },
        agency: { emergency_override_pct: 0 },
      }],
    });

    expect(pack.audit_exceptions[0]).toEqual(expect.objectContaining({ home_slug: 'oak-house', overdue: 2 }));
    expect(pack.supervision_exceptions[0]).toEqual(expect.objectContaining({ home_slug: 'oak-house', no_record: 3 }));
    expect(pack.maintenance_exceptions[0]).toEqual(expect.objectContaining({ home_slug: 'oak-house', certs_expired: 1 }));
    expect(pack.incident_complaint_exceptions[0]).toEqual(expect.objectContaining({
      home_slug: 'oak-house',
      incident_overdue_notifications: 2,
      complaint_overdue_responses: 1,
    }));
    expect(pack.outcome_exceptions[0]).toEqual(expect.objectContaining({
      home_slug: 'oak-house',
      pressure_sores_new_28d: 2,
    }));
  });
});
