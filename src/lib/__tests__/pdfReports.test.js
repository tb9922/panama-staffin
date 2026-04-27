/** @vitest-environment jsdom */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateEvidencePackPDF, generatePortfolioBoardPackPDF } from '../pdfReports.js';
import { MOCK_SCHEDULING_DATA } from '../../test/fixtures/schedulingData.js';

describe('pdfReports', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates the CQC evidence pack without relying on doc.autoTable()', () => {
    const data = {
      ...MOCK_SCHEDULING_DATA,
      onboarding: {},
      training: {},
      supervisions: {},
      appraisals: {},
      fire_drills: [],
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
      cqc_evidence: [],
    };

    expect(() => generateEvidencePackPDF(data, 28)).not.toThrow();
  });

  it('generates the portfolio board pack PDF from KPI payloads', () => {
    const pack = {
      generated_at: '2026-04-27T09:00:00.000Z',
      summary: {
        home_count: 1,
        red_homes: 1,
        amber_homes: 0,
        green_homes: 0,
        overdue_actions: 2,
        escalated_actions_l3_plus: 1,
        emergency_override_pct_red_homes: 1,
      },
      homes: [{
        home_id: 1,
        home_name: 'Oak House',
        rag: {
          overall: 'red',
          staffing: 'unknown',
          agency: 'red',
          training: 'amber',
          manager_actions: 'red',
          incidents: 'green',
          complaints: 'green',
          audits: 'green',
          supervisions: 'green',
          cqc_evidence: 'amber',
          maintenance: 'green',
          occupancy: 'green',
          outcomes: 'green',
        },
        manager_actions: { open: 3, overdue: 2, escalated_l3_plus: 1 },
        agency: { shifts_28d: 4, emergency_override_pct: 25 },
        training: { compliance_pct: 92, expired: 1 },
        incidents: { open: 0, cqc_notifiable_overdue: 0, riddor_overdue: 0 },
        complaints: { open: 0, ack_overdue: 0, response_overdue: 0 },
        cqc_evidence: { open_gaps: 3, overall: 'mostly_ready' },
        maintenance: { overdue: 0, certs_expired: 0 },
        occupancy: { pct: 96, available: 1 },
        outcomes: { rag: 'green', falls_28d: 0, infections_28d: 0 },
      }],
      weakest_homes: [{
        home_name: 'Oak House',
        red_count: 3,
        amber_count: 2,
        rag: { overall: 'red', agency: 'red', training: 'amber', manager_actions: 'red' },
      }],
      escalated_actions: [{
        home_name: 'Oak House',
        title: 'Close safeguarding action',
        priority: 'critical',
        due_date: '2026-04-20',
        escalation_level: 4,
        owner_name: 'Home manager',
      }],
      agency_pressure: [{
        home_name: 'Oak House',
        shifts_28d: 4,
        emergency_overrides_7d: 2,
        emergency_override_pct: 25,
        rag: 'red',
      }],
      training_gaps: [{
        home_name: 'Oak House',
        compliance_pct: 92,
        expired: 1,
        expiring_30d: 2,
        not_started: 1,
        rag: 'amber',
      }],
      cqc_evidence_gaps: [{
        home_name: 'Oak House',
        open_gaps: 3,
        overall: 'mostly_ready',
        rag: 'amber',
      }],
    };

    expect(() => generatePortfolioBoardPackPDF(pack)).not.toThrow();
  });
});
