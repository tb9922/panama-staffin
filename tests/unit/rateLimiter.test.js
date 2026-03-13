import { describe, it, expect } from 'vitest';
import { perUserKey, writeRateLimiter, readRateLimiter } from '../../lib/rateLimiter.js';

describe('rateLimiter', () => {
  it('exports writeRateLimiter middleware', () => {
    expect(typeof writeRateLimiter).toBe('function');
  });

  it('exports readRateLimiter middleware', () => {
    expect(typeof readRateLimiter).toBe('function');
  });

  describe('perUserKey', () => {
    it('returns IP:username for authenticated requests', () => {
      const req = { ip: '192.168.1.1', user: { username: 'admin' } };
      const key = perUserKey(req);
      expect(key).toBe('192.168.1.1:admin');
    });

    it('returns IP-only for unauthenticated requests', () => {
      const req = { ip: '10.0.0.5', user: undefined };
      const key = perUserKey(req);
      expect(key).toBe('10.0.0.5');
    });

    it('returns IP-only when user is null', () => {
      const req = { ip: '172.16.0.1', user: null };
      const key = perUserKey(req);
      expect(key).toBe('172.16.0.1');
    });

    it('differentiates users on the same IP', () => {
      const req1 = { ip: '192.168.1.1', user: { username: 'alice' } };
      const req2 = { ip: '192.168.1.1', user: { username: 'bob' } };
      expect(perUserKey(req1)).not.toBe(perUserKey(req2));
    });

    it('same user on different IPs gets different keys', () => {
      const req1 = { ip: '10.0.0.1', user: { username: 'admin' } };
      const req2 = { ip: '10.0.0.2', user: { username: 'admin' } };
      expect(perUserKey(req1)).not.toBe(perUserKey(req2));
    });
  });
});
