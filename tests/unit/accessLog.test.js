import { describe, expect, it } from 'vitest';
import {
  classifyAccessLogCategories,
  normalizeEndpointPath,
  resolveAccessLogEndpoint,
} from '../../middleware/accessLog.js';

describe('accessLog helpers', () => {
  it('normalizes obvious ID-like path segments in fallback paths', () => {
    expect(normalizeEndpointPath('/api/staff/ST001')).toBe('/api/staff/:id');
    expect(normalizeEndpointPath('/api/hr/attachments/download/42')).toBe('/api/hr/attachments/download/:id');
    expect(normalizeEndpointPath('/api/incidents/inc-gdpr-001')).toBe('/api/incidents/:id');
  });

  it('prefers the Express route pattern when available', () => {
    const endpoint = resolveAccessLogEndpoint({
      baseUrl: '/api/staff',
      route: { path: '/:staffId' },
      path: '/api/staff/ST001',
    });
    expect(endpoint).toBe('/api/staff/:staffId');
  });

  it('falls back to sanitized request paths when the route is unavailable', () => {
    const endpoint = resolveAccessLogEndpoint({
      originalUrl: '/api/cqc-evidence-links/source/handover/123?home=oakwood',
    });
    expect(endpoint).toBe('/api/cqc-evidence-links/source/handover/:id');
  });

  it('classifies sensitive attachment and staff portal routes', () => {
    expect(classifyAccessLogCategories('/api/record-attachments/download/42')).toEqual(['attachments', 'personal_data']);
    expect(classifyAccessLogCategories('/api/me/payslips')).toEqual(['staff_portal', 'personal_data']);
    expect(classifyAccessLogCategories('/api/scan-intake/7/confirm')).toEqual(['documents', 'personal_data']);
    expect(classifyAccessLogCategories('/api/docs/onboarding')).toEqual(['hr', 'recruitment', 'documents']);
  });

  it('classifies V1 operating-system and governance routes', () => {
    expect(classifyAccessLogCategories('/api/action-items/42/complete')).toEqual(['governance', 'actions', 'accountability']);
    expect(classifyAccessLogCategories('/api/portfolio/kpis')).toEqual(['governance', 'portfolio', 'kpi']);
    expect(classifyAccessLogCategories('/api/portfolio-snapshots/current')).toEqual(['governance', 'portfolio', 'snapshots']);
    expect(classifyAccessLogCategories('/api/agency-attempts/report')).toEqual(['scheduling', 'staffing', 'agency']);
    expect(classifyAccessLogCategories('/api/internal-bank/candidates')).toEqual(['staff', 'scheduling', 'internal_bank']);
    expect(classifyAccessLogCategories('/api/audit-tasks/7/complete')).toEqual(['governance', 'audit_tasks', 'compliance']);
    expect(classifyAccessLogCategories('/api/outcomes/dashboard')).toEqual(['governance', 'outcomes', 'clinical']);
    expect(classifyAccessLogCategories('/api/reflective-practice')).toEqual(['hr', 'governance', 'reflective_practice']);
    expect(classifyAccessLogCategories('/api/operational-reviews')).toEqual(['governance', 'operational_reviews']);
  });

  it('classifies current compliance and platform route families without prefix bleed', () => {
    expect(classifyAccessLogCategories('/api/cqc-evidence-links/source/incident/123')).toEqual(['compliance', 'cqc', 'evidence_links']);
    expect(classifyAccessLogCategories('/api/ipc/audits')).toEqual(['clinical', 'ipc', 'compliance']);
    expect(classifyAccessLogCategories('/api/risk-register')).toEqual(['governance', 'risk']);
    expect(classifyAccessLogCategories('/api/policies/reviews')).toEqual(['governance', 'policies']);
    expect(classifyAccessLogCategories('/api/maintenance/jobs')).toEqual(['compliance', 'maintenance']);
    expect(classifyAccessLogCategories('/api/platform/ops')).toEqual(['platform', 'operations']);
    expect(classifyAccessLogCategories('/api/home-setup/beds')).toEqual(['config', 'homes', 'setup']);
    expect(classifyAccessLogCategories('/api/staffing')).toEqual([]);
  });
});
