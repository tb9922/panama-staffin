import { describe, expect, it } from 'vitest';
import { normalizeEndpointPath, resolveAccessLogEndpoint } from '../../middleware/accessLog.js';

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
});
