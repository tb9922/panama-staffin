import { describe, expect, it } from 'vitest';
import {
  RAG,
  buildPortfolioRag,
  overallRag,
  ragAtLeast,
  ragAtMost,
} from '../../shared/portfolioRag.js';

describe('portfolio RAG thresholds', () => {
  it('scores higher-is-better thresholds', () => {
    expect(ragAtLeast(96, { greenAtLeast: 95, amberAtLeast: 90 })).toBe(RAG.GREEN);
    expect(ragAtLeast(92, { greenAtLeast: 95, amberAtLeast: 90 })).toBe(RAG.AMBER);
    expect(ragAtLeast(89, { greenAtLeast: 95, amberAtLeast: 90 })).toBe(RAG.RED);
    expect(ragAtLeast(null, { greenAtLeast: 95, amberAtLeast: 90 })).toBe(RAG.UNKNOWN);
  });

  it('scores lower-is-better thresholds', () => {
    expect(ragAtMost(0, { greenAtMost: 0, amberAtMost: 2 })).toBe(RAG.GREEN);
    expect(ragAtMost(2, { greenAtMost: 0, amberAtMost: 2 })).toBe(RAG.AMBER);
    expect(ragAtMost(3, { greenAtMost: 0, amberAtMost: 2 })).toBe(RAG.RED);
    expect(ragAtMost(undefined, { greenAtMost: 0, amberAtMost: 2 })).toBe(RAG.UNKNOWN);
  });

  it('rolls up overall status from visible RAG values', () => {
    expect(overallRag({ training: RAG.GREEN, cqc: RAG.UNKNOWN })).toBe(RAG.GREEN);
    expect(overallRag({ training: RAG.GREEN, cqc: RAG.AMBER })).toBe(RAG.AMBER);
    expect(overallRag({ training: RAG.AMBER, cqc: RAG.RED })).toBe(RAG.RED);
    expect(overallRag({ training: RAG.UNKNOWN })).toBe(RAG.UNKNOWN);
  });

  it('builds the V1 home RAG map from portfolio KPIs', () => {
    const rag = buildPortfolioRag({
      staffing: { gaps_per_100_planned_shifts: null },
      agency: { emergency_override_pct: 21 },
      training: { compliance_pct: 94 },
      incidents: { open: 40, rate_per_resident_month: 0.04, cqc_notifiable_overdue: 0, riddor_overdue: 0 },
      complaints: { open: 20, rate_per_resident_month: 0.01, ack_overdue: 0, response_overdue: 0 },
      audits: { overdue: 0 },
      supervisions: { overdue: 3 },
      cqc_evidence: { open_gaps: 5 },
      maintenance: { overdue: 0, certs_expired: 0 },
      manager_actions: { overdue: 1, escalated_l3_plus: 0 },
      occupancy: { pct: 91 },
      outcomes: { rag: RAG.UNKNOWN },
    });

    expect(rag.agency).toBe(RAG.RED);
    expect(rag.training).toBe(RAG.AMBER);
    expect(rag.incidents).toBe(RAG.GREEN);
    expect(rag.complaints).toBe(RAG.GREEN);
    expect(rag.supervisions).toBe(RAG.RED);
    expect(rag.cqc_evidence).toBe(RAG.RED);
    expect(rag.maintenance).toBe(RAG.GREEN);
    expect(rag.overall).toBe(RAG.RED);
  });

  it('uses rate-based incident and complaint bands with absolute overdue gates', () => {
    const rag = buildPortfolioRag({
      staffing: { gaps_per_100_planned_shifts: 0 },
      agency: { emergency_override_pct: 0 },
      training: { compliance_pct: 100 },
      incidents: {
        open: 1,
        rate_per_resident_month: 0.2,
        cqc_notifiable_overdue: 0,
        riddor_overdue: 0,
        duty_of_candour_overdue: 0,
      },
      complaints: {
        open: 1,
        rate_per_resident_month: 0.01,
        ack_overdue: 3,
        response_overdue: 0,
      },
      audits: { overdue: 0 },
      supervisions: { overdue: 0 },
      cqc_evidence: { open_gaps: 0 },
      maintenance: { overdue: 0, certs_expired: 0 },
      manager_actions: { overdue: 0, escalated_l3_plus: 0 },
      occupancy: { pct: 100 },
      outcomes: { rag: RAG.GREEN },
    });

    expect(rag.incidents).toBe(RAG.RED);
    expect(rag.complaints).toBe(RAG.RED);
  });
});
