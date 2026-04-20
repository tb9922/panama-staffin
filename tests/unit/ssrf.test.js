import { describe, expect, it } from 'vitest';
import { isInternalAppUrl, isPrivateUrl } from '../../lib/ssrf.js';

describe('ssrf helpers', () => {
  it('blocks same-origin API endpoints as internal app URLs', () => {
    expect(isInternalAppUrl(
      'https://panama.example.com/api/users',
      'https://panama.example.com',
    )).toBe(true);
  });

  it('blocks same-origin ops endpoints as internal app URLs', () => {
    expect(isInternalAppUrl(
      'https://panama.example.com/metrics',
      'https://panama.example.com',
    )).toBe(true);
  });

  it('allows non-sensitive paths on the same origin', () => {
    expect(isInternalAppUrl(
      'https://panama.example.com/public/webhook-target',
      'https://panama.example.com',
    )).toBe(false);
  });

  it('still blocks private localhost URLs', () => {
    expect(isPrivateUrl('https://localhost:3001/api/users')).toBe(true);
  });
});
