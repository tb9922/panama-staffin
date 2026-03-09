import { describe, it, expect, vi } from 'vitest';
import { requireAuth } from '../../middleware/auth.js';

// Mock authService so we can control JWT verification
vi.mock('../../services/authService.js', () => ({
  verifyToken: vi.fn(() => ({ username: 'admin', role: 'admin' })),
  isTokenDenied: vi.fn(() => false),
}));

// Mock homeRepo + userHomeRepo (required by auth.js import)
vi.mock('../../repositories/homeRepo.js', () => ({}));
vi.mock('../../repositories/userHomeRepo.js', () => ({ hasAccess: vi.fn() }));

function makeReq(overrides = {}) {
  return {
    method: 'POST',
    cookies: { panama_token: 'valid-jwt', panama_csrf: 'secret123' },
    headers: { 'x-csrf-token': 'secret123' },
    ...overrides,
  };
}

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) { res.statusCode = code; return res; },
    json(data) { res.body = data; return res; },
  };
  return res;
}

describe('CSRF double-submit validation', () => {
  it('passes when cookie and header match (POST)', () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBeNull();
  });

  it('passes when cookie and header match (PUT)', () => {
    const req = makeReq({ method: 'PUT' });
    const res = makeRes();
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('passes when cookie and header match (DELETE)', () => {
    const req = makeReq({ method: 'DELETE' });
    const res = makeRes();
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects POST when header is missing', () => {
    const req = makeReq({ headers: {} });
    const res = makeRes();
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('CSRF token mismatch');
  });

  it('rejects POST when cookie is missing', () => {
    const req = makeReq({ cookies: { panama_token: 'valid-jwt' } });
    const res = makeRes();
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('rejects POST when tokens do not match', () => {
    const req = makeReq({
      cookies: { panama_token: 'valid-jwt', panama_csrf: 'token-a' },
      headers: { 'x-csrf-token': 'token-b' },
    });
    const res = makeRes();
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('CSRF token mismatch');
  });

  it('skips CSRF check for GET requests (safe method)', () => {
    const req = makeReq({ method: 'GET', headers: {} });
    const res = makeRes();
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('skips CSRF check for HEAD requests (safe method)', () => {
    const req = makeReq({ method: 'HEAD', headers: {} });
    const res = makeRes();
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('skips CSRF check for OPTIONS requests (safe method)', () => {
    const req = makeReq({ method: 'OPTIONS', headers: {} });
    const res = makeRes();
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('skips CSRF check when using Authorization header (API clients)', () => {
    const req = makeReq({
      cookies: { panama_token: 'valid-jwt' }, // no panama_csrf
      headers: { authorization: 'Bearer valid-jwt' }, // no x-csrf-token
    });
    const res = makeRes();
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 401 when no auth token at all', () => {
    const req = makeReq({ cookies: {}, headers: {} });
    const res = makeRes();
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});
