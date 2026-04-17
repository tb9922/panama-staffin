/**
 * Unit tests for GDPR 7-domain controls model.
 *
 * Validates: domain scoring, overall aggregation, banding, confidence,
 * provenance metadata, backward-compat operationalHealth.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateGdprControlsScore, GDPR_DOMAINS, GDPR_SCORE_BANDS,
  getGdprScoreBand, GDPR_DOMAIN_PROVENANCE, ENGINE_VERSION,
} from '../gdpr.js';

describe('GDPR_DOMAINS', () => {
  it('has 7 domains', () => {
    expect(GDPR_DOMAINS).toHaveLength(7);
  });

  it('weights sum to 1.0', () => {
    const total = GDPR_DOMAINS.reduce((s, d) => s + d.weight, 0);
    expect(total).toBeCloseTo(1.0);
  });

  it('each domain has an ICO toolkit reference', () => {
    for (const d of GDPR_DOMAINS) {
      expect(d.icoToolkit).toBeTruthy();
    }
  });
});

describe('getGdprScoreBand', () => {
  it('returns Good for 90+', () => expect(getGdprScoreBand(95).label).toBe('Good'));
  it('returns Adequate for 70-89', () => expect(getGdprScoreBand(75).label).toBe('Adequate'));
  it('returns Requires Improvement for 50-69', () => expect(getGdprScoreBand(55).label).toBe('Requires Improvement'));
  it('returns Inadequate for 0-49', () => expect(getGdprScoreBand(30).label).toBe('Inadequate'));
  it('returns Inadequate for 0', () => expect(getGdprScoreBand(0).label).toBe('Inadequate'));
});

describe('calculateGdprControlsScore', () => {
  it('returns engine_version', () => {
    const result = calculateGdprControlsScore({ requests: [], breaches: [], complaints: [], retentionScan: [], consent: [] });
    expect(result.engine_version).toBe(ENGINE_VERSION);
  });

  it('returns 7 domains in result', () => {
    const result = calculateGdprControlsScore({ requests: [], breaches: [], complaints: [], retentionScan: [], consent: [] });
    expect(Object.keys(result.domains)).toHaveLength(7);
  });

  it('scores 100 for rights_management with all requests completed', () => {
    const past = new Date();
    past.setDate(past.getDate() + 5);
    const result = calculateGdprControlsScore({
      requests: [
        { status: 'completed', deadline: past.toISOString().slice(0, 10) },
        { status: 'completed', deadline: past.toISOString().slice(0, 10) },
      ],
      breaches: [], complaints: [], retentionScan: [], consent: [],
    });
    expect(result.domains.rights_management.score).toBe(100);
  });

  it('penalises rights_management for overdue requests', () => {
    const past = new Date();
    past.setDate(past.getDate() - 10);
    const result = calculateGdprControlsScore({
      requests: [
        { status: 'received', deadline: past.toISOString().slice(0, 10) },
      ],
      breaches: [], complaints: [], retentionScan: [], consent: [],
    });
    expect(result.domains.rights_management.score).toBeLessThan(100);
  });

  it('scores breach_management based on ICO notification compliance', () => {
    const result = calculateGdprControlsScore({
      requests: [],
      breaches: [
        { status: 'resolved', ico_notifiable: true, ico_notified: true, decision_at: '2026-01-01', root_cause: 'Human error', containment_actions: 'Locked accounts' },
      ],
      complaints: [], retentionScan: [], consent: [],
    });
    expect(result.domains.breach_management.score).toBe(100);
  });

  it('penalises breach_management for unnotified ICO breaches', () => {
    const result = calculateGdprControlsScore({
      requests: [],
      breaches: [
        { status: 'open', ico_notifiable: true, ico_notified: false },
      ],
      complaints: [], retentionScan: [], consent: [],
    });
    expect(result.domains.breach_management.score).toBeLessThan(100);
  });

  it('scores retention domain based on schedule completeness', () => {
    const result = calculateGdprControlsScore({
      requests: [], breaches: [], complaints: [],
      retentionScan: [
        { data_category: 'staff', action_needed: false },
        { data_category: 'payroll', action_needed: false },
        { data_category: 'clinical', action_needed: false },
        { data_category: 'audit', action_needed: false },
        { data_category: 'gdpr', action_needed: false },
      ],
      consent: [],
    });
    expect(result.domains.retention.score).toBe(100);
  });

  it('penalises retention for violations', () => {
    const result = calculateGdprControlsScore({
      requests: [], breaches: [], complaints: [],
      retentionScan: [
        { data_category: 'staff', action_needed: true },
        { data_category: 'payroll', action_needed: false },
      ],
      consent: [],
    });
    expect(result.domains.retention.score).toBeLessThan(100);
  });

  it('includes operationalHealth for backward compat', () => {
    const result = calculateGdprControlsScore({ requests: [], breaches: [], complaints: [], retentionScan: [], consent: [] });
    expect(result.operationalHealth).toBeDefined();
    expect(result.operationalHealth.score).toBe(100);
    expect(result.operationalHealth.band).toBe('good');
  });

  it('caps overall at Requires Improvement if any domain is Inadequate', () => {
    // 5 overdue SARs, all other domains at zero data
    const past = new Date();
    past.setDate(past.getDate() - 10);
    const result = calculateGdprControlsScore({
      requests: Array(5).fill({ status: 'received', deadline: past.toISOString().slice(0, 10) }),
      breaches: [], complaints: [], retentionScan: [], consent: [],
    });
    // rights_management: 0% completion, all overdue → must be Inadequate
    expect(result.domains.rights_management.band.label).toBe('Inadequate');
    // overall must not reach Good or Adequate when any domain is Inadequate (cap rule)
    expect(['Good', 'Adequate']).not.toContain(result.band.label);
  });

  it('includes confidence per domain', () => {
    const result = calculateGdprControlsScore({ requests: [], breaches: [], complaints: [], retentionScan: [], consent: [] });
    for (const d of Object.values(result.domains)) {
      expect(['high', 'medium', 'low']).toContain(d.confidence);
    }
  });

  it('includes provenance per domain', () => {
    const result = calculateGdprControlsScore({ requests: [], breaches: [], complaints: [], retentionScan: [], consent: [] });
    for (const [, d] of Object.entries(result.domains)) {
      expect(d.provenance).toBeDefined();
      expect(d.provenance.source_modules).toBeDefined();
    }
  });

  it('includes overall confidence', () => {
    const result = calculateGdprControlsScore({ requests: [], breaches: [], complaints: [], retentionScan: [], consent: [] });
    expect(['high', 'medium', 'low']).toContain(result.confidence);
  });

  it('reports assessed vs total domains', () => {
    const result = calculateGdprControlsScore({ requests: [], breaches: [], complaints: [], retentionScan: [], consent: [] });
    expect(result.assessedDomains).toBe(7);
    expect(result.totalDomains).toBe(7);
  });
});

describe('GDPR_DOMAIN_PROVENANCE', () => {
  it('has provenance for all 7 domains', () => {
    for (const d of GDPR_DOMAINS) {
      expect(GDPR_DOMAIN_PROVENANCE[d.id]).toBeDefined();
      expect(GDPR_DOMAIN_PROVENANCE[d.id].source_modules).toBeDefined();
      expect(GDPR_DOMAIN_PROVENANCE[d.id].assumptions).toBeDefined();
    }
  });
});

// ── Hardening Scenario Tests ────────────────────────────────────────────────

describe('Scenario: retention violations reduce retention domain score', () => {
  it('violations lower retention domain below 100', () => {
    const result = calculateGdprControlsScore({
      requests: [], breaches: [], complaints: [], consent: [],
      retentionScan: [
        { data_category: 'staff', action_needed: true },
        { data_category: 'payroll', action_needed: true },
        { data_category: 'audit', action_needed: false },
      ],
    });
    expect(result.domains.retention.score).toBeLessThan(100);
    const violationControl = result.domains.retention.controls.find(c => c.id === 'no_retention_violations');
    expect(violationControl.evidenced).toBe(false);
  });

  it('no violations = 100% retention', () => {
    const result = calculateGdprControlsScore({
      requests: [], breaches: [], complaints: [], consent: [],
      retentionScan: [
        { data_category: 'staff', action_needed: false },
        { data_category: 'payroll', action_needed: false },
        { data_category: 'audit', action_needed: false },
        { data_category: 'clinical', action_needed: false },
        { data_category: 'gdpr', action_needed: false },
      ],
    });
    expect(result.domains.retention.score).toBe(100);
  });
});

describe('Scenario: ROPA/DPIA data improves accountability domain', () => {
  it('active ROPA entries evidence accountability', () => {
    const result = calculateGdprControlsScore({
      requests: [], breaches: [], complaints: [], consent: [], retentionScan: [],
      ropa: [{ status: 'active', dpia_required: false }],
      dpia: [],
    });
    const ropaControl = result.domains.accountability.controls.find(c => c.id === 'ropa_maintained');
    expect(ropaControl.evidenced).toBe(true);
  });

  it('missing ROPA reduces accountability', () => {
    const result = calculateGdprControlsScore({
      requests: [], breaches: [], complaints: [], consent: [], retentionScan: [],
      ropa: [],
      dpia: [],
    });
    const ropaControl = result.domains.accountability.controls.find(c => c.id === 'ropa_maintained');
    expect(ropaControl.evidenced).toBe(false);
  });

  it('completed DPIAs evidence accountability', () => {
    const result = calculateGdprControlsScore({
      requests: [], breaches: [], complaints: [], consent: [], retentionScan: [],
      ropa: [],
      dpia: [{ screening_result: 'required', status: 'approved' }],
    });
    const dpiaControl = result.domains.accountability.controls.find(c => c.id === 'dpia_completed');
    expect(dpiaControl.evidenced).toBe(true);
  });

  it('incomplete required DPIAs reduce accountability', () => {
    const result = calculateGdprControlsScore({
      requests: [], breaches: [], complaints: [], consent: [], retentionScan: [],
      ropa: [],
      dpia: [{ screening_result: 'required', status: 'screening' }],
    });
    const dpiaControl = result.domains.accountability.controls.find(c => c.id === 'dpia_completed');
    expect(dpiaControl.evidenced).toBe(false);
  });

  it('ROPA with dpia_required but no DPIA reduces accountability', () => {
    const result = calculateGdprControlsScore({
      requests: [], breaches: [], complaints: [], consent: [], retentionScan: [],
      ropa: [{ status: 'active', dpia_required: true }],
      dpia: [],
    });
    const coverageControl = result.domains.accountability.controls.find(c => c.id === 'high_risk_covered');
    expect(coverageControl.evidenced).toBe(false);
  });
});

describe('Scenario: live vs snapshot parity', () => {
  it('calling calculateGdprControlsScore twice with same data returns same score', () => {
    const data = {
      requests: [{ status: 'completed', deadline: '2026-12-31' }],
      breaches: [],
      complaints: [],
      consent: [{ legal_basis: 'consent' }],
      retentionScan: [{ data_category: 'staff', action_needed: false }, { data_category: 'payroll', action_needed: false }, { data_category: 'audit', action_needed: false }, { data_category: 'clinical', action_needed: false }, { data_category: 'gdpr', action_needed: false }],
      ropa: [{ status: 'active', dpia_required: false }],
      dpia: [],
    };
    const score1 = calculateGdprControlsScore(data);
    const score2 = calculateGdprControlsScore(data);
    expect(score1.overallScore).toBe(score2.overallScore);
    expect(score1.band.label).toBe(score2.band.label);
    for (const domainId of Object.keys(score1.domains)) {
      expect(score1.domains[domainId].score).toBe(score2.domains[domainId].score);
    }
  });
});
