/**
 * Unit tests for dashboardService alert priority scoring.
 *
 * Tests buildAlerts() — a pure function that takes module metrics
 * and returns alerts with priority (1-5) and sorted by priority desc.
 */

import { describe, it, expect } from 'vitest';
import { _buildAlerts as buildAlerts } from '../../services/dashboardService.js';

// All-zeros baseline — no alerts expected
const EMPTY = {
  incidents: { open: 0, cqcOverdue: 0, riddorOverdue: 0, docOverdue: 0, overdueActions: 0 },
  complaints: { open: 0, unacknowledged: 0, overdueResponse: 0 },
  maintenance: { total: 0, overdue: 0, dueSoon: 0, expiredCerts: 0, compliancePct: 100 },
  training: { expired: 0, expiringSoon: 0 },
  supervisions: { overdue: 0, dueSoon: 0, noRecord: 0 },
  appraisals: { overdue: 0, dueSoon: 0, noRecord: 0 },
  fireDrills: { lastDate: null, drillsThisYear: 4, overdue: false },
  ipc: { activeOutbreaks: 0, overdueActions: 0, latestScore: null },
  risks: { total: 0, critical: 0, overdueReviews: 0, overdueActions: 0 },
  policies: { total: 0, overdue: 0, dueSoon: 0, compliancePct: 100 },
  whistleblowing: { open: 0, unacknowledged: 0 },
  dols: { active: 0, expiringSoon: 0, overdueReviews: 0 },
  careCertificate: { inProgress: 0, overdue: 0 },
  beds: { total: 30, occupied: 30, available: 0, hospitalHold: 0, occupancyRate: 100 },
};

function withOverride(overrides) {
  const m = {};
  for (const key of Object.keys(EMPTY)) {
    m[key] = { ...EMPTY[key], ...(overrides[key] || {}) };
  }
  return m;
}

describe('buildAlerts priority scoring', () => {
  it('returns empty array when all metrics are clean', () => {
    const alerts = buildAlerts(EMPTY);
    expect(alerts).toEqual([]);
  });

  // ── Priority 5 — Regulatory deadline breach ──────────────────────────────

  it('CQC overdue alert has priority 5', () => {
    const alerts = buildAlerts(withOverride({ incidents: { cqcOverdue: 2 } }));
    const cqcAlert = alerts.find(a => a.message.includes('CQC notification'));
    expect(cqcAlert).toBeDefined();
    expect(cqcAlert.priority).toBe(5);
  });

  it('RIDDOR overdue alert has priority 5', () => {
    const alerts = buildAlerts(withOverride({ incidents: { riddorOverdue: 1 } }));
    const riddorAlert = alerts.find(a => a.message.includes('RIDDOR'));
    expect(riddorAlert).toBeDefined();
    expect(riddorAlert.priority).toBe(5);
  });

  // ── Priority 4 — Serious compliance concern ─────────────────────────────

  it('Duty of Candour overdue has priority 4', () => {
    const alerts = buildAlerts(withOverride({ incidents: { docOverdue: 1 } }));
    const docAlert = alerts.find(a => a.message.includes('Duty of Candour'));
    expect(docAlert).toBeDefined();
    expect(docAlert.priority).toBe(4);
  });

  it('critical risk has priority 4', () => {
    const alerts = buildAlerts(withOverride({ risks: { critical: 1 } }));
    const riskAlert = alerts.find(a => a.message.includes('critical risk'));
    expect(riskAlert).toBeDefined();
    expect(riskAlert.priority).toBe(4);
  });

  it('unacknowledged whistleblowing has priority 4', () => {
    const alerts = buildAlerts(withOverride({ whistleblowing: { unacknowledged: 1 } }));
    const wbAlert = alerts.find(a => a.message.includes('whistleblowing'));
    expect(wbAlert).toBeDefined();
    expect(wbAlert.priority).toBe(4);
  });

  it('occupancy below 80% has priority 4', () => {
    const alerts = buildAlerts(withOverride({ beds: { occupancyRate: 75 } }));
    const bedAlert = alerts.find(a => a.message.includes('significant revenue risk'));
    expect(bedAlert).toBeDefined();
    expect(bedAlert.priority).toBe(4);
  });

  // ── Priority 3 — Overdue / action needed ────────────────────────────────

  it('expired training has priority 3', () => {
    const alerts = buildAlerts(withOverride({ training: { expired: 5 } }));
    const trainingAlert = alerts.find(a => a.message.includes('expired training'));
    expect(trainingAlert).toBeDefined();
    expect(trainingAlert.priority).toBe(3);
  });

  it('overdue maintenance has priority 3', () => {
    const alerts = buildAlerts(withOverride({ maintenance: { overdue: 2 } }));
    const maintAlert = alerts.find(a => a.message.includes('overdue maintenance'));
    expect(maintAlert).toBeDefined();
    expect(maintAlert.priority).toBe(3);
  });

  it('overdue complaint response has priority 3', () => {
    const alerts = buildAlerts(withOverride({ complaints: { overdueResponse: 1 } }));
    const cAlert = alerts.find(a => a.message.includes('overdue complaint'));
    expect(cAlert).toBeDefined();
    expect(cAlert.priority).toBe(3);
  });

  it('overdue policy review has priority 3', () => {
    const alerts = buildAlerts(withOverride({ policies: { overdue: 1 } }));
    const pAlert = alerts.find(a => a.message.includes('overdue policy'));
    expect(pAlert).toBeDefined();
    expect(pAlert.priority).toBe(3);
  });

  it('overdue supervision has priority 3', () => {
    const alerts = buildAlerts(withOverride({ supervisions: { overdue: 3 } }));
    const sAlert = alerts.find(a => a.message.includes('overdue supervision'));
    expect(sAlert).toBeDefined();
    expect(sAlert.priority).toBe(3);
  });

  // ── Priority 2 — Approaching deadlines ──────────────────────────────────

  it('expiring-soon training has priority 2', () => {
    const alerts = buildAlerts(withOverride({ training: { expiringSoon: 3 } }));
    const tAlert = alerts.find(a => a.message.includes('expiring in 30 days'));
    expect(tAlert).toBeDefined();
    expect(tAlert.priority).toBe(2);
  });

  it('due-soon maintenance has priority 2', () => {
    const alerts = buildAlerts(withOverride({ maintenance: { dueSoon: 2 } }));
    const mAlert = alerts.find(a => a.message.includes('due in 30 days'));
    expect(mAlert).toBeDefined();
    expect(mAlert.priority).toBe(2);
  });

  it('occupancy 80-90% has priority 2', () => {
    const alerts = buildAlerts(withOverride({ beds: { occupancyRate: 85 } }));
    const bAlert = alerts.find(a => a.message.includes('below 90% target'));
    expect(bAlert).toBeDefined();
    expect(bAlert.priority).toBe(2);
  });

  // ── Priority 1 — Informational ──────────────────────────────────────────

  it('fire drills < 4/year has priority 1', () => {
    const alerts = buildAlerts(withOverride({ fireDrills: { drillsThisYear: 2, overdue: false } }));
    const fdAlert = alerts.find(a => a.message.includes('fire drill'));
    expect(fdAlert).toBeDefined();
    expect(fdAlert.priority).toBe(1);
  });

  it('available beds (occupancy >= 90) has priority 1', () => {
    const alerts = buildAlerts(withOverride({ beds: { available: 3, occupancyRate: 92 } }));
    const bAlert = alerts.find(a => a.message.includes('bed(s) available'));
    expect(bAlert).toBeDefined();
    expect(bAlert.priority).toBe(1);
  });

  // ── Sort order ──────────────────────────────────────────────────────────

  it('sorts by priority descending', () => {
    const alerts = buildAlerts(withOverride({
      incidents: { cqcOverdue: 1 },       // priority 5
      training: { expired: 2 },            // priority 3
      maintenance: { dueSoon: 1 },          // priority 2
      fireDrills: { drillsThisYear: 1, overdue: false }, // priority 1
    }));

    expect(alerts.length).toBeGreaterThanOrEqual(4);
    // First should be priority 5
    expect(alerts[0].priority).toBe(5);
    // Last should be priority 1
    expect(alerts[alerts.length - 1].priority).toBe(1);
    // All should be non-ascending
    for (let i = 1; i < alerts.length; i++) {
      expect(alerts[i].priority).toBeLessThanOrEqual(alerts[i - 1].priority);
    }
  });

  // ── All alerts have required shape ──────────────────────────────────────

  it('all alerts have type, module, message, link, priority', () => {
    const alerts = buildAlerts(withOverride({
      incidents: { cqcOverdue: 1, riddorOverdue: 1, docOverdue: 1, open: 2, overdueActions: 1 },
      complaints: { unacknowledged: 1, overdueResponse: 1 },
      maintenance: { overdue: 1, expiredCerts: 1, dueSoon: 1 },
      training: { expired: 3, expiringSoon: 2 },
      risks: { critical: 1, overdueReviews: 1, overdueActions: 1 },
    }));

    for (const a of alerts) {
      expect(a).toHaveProperty('type');
      expect(a).toHaveProperty('module');
      expect(a).toHaveProperty('message');
      expect(a).toHaveProperty('link');
      expect(a).toHaveProperty('priority');
      expect(typeof a.priority).toBe('number');
      expect(a.priority).toBeGreaterThanOrEqual(1);
      expect(a.priority).toBeLessThanOrEqual(5);
    }
  });

  // ── Backward compatibility ──────────────────────────────────────────────

  it('existing alert fields (type, module, message, link) unchanged', () => {
    const alerts = buildAlerts(withOverride({ incidents: { cqcOverdue: 1 } }));
    const a = alerts[0];
    expect(a.type).toBe('error');
    expect(a.module).toBe('incidents');
    expect(a.message).toContain('CQC notification');
    expect(a.link).toBe('/incidents');
  });
});
