import { describe, expect, it, vi } from 'vitest';
import { isSecureRequest, tokenCookieOptions } from '../../lib/authCookies.js';

function makeReq({ secure = false, encrypted = false, forwardedProto, trustProxy = false } = {}) {
  return {
    secure,
    socket: { encrypted },
    headers: forwardedProto ? { 'x-forwarded-proto': forwardedProto } : {},
    app: { get: vi.fn(() => trustProxy) },
  };
}

describe('authCookies', () => {
  it('ignores x-forwarded-proto when trust proxy is disabled', () => {
    const req = makeReq({ forwardedProto: 'https', trustProxy: false });

    expect(isSecureRequest(req)).toBe(false);
    expect(tokenCookieOptions(req).secure).toBe(false);
  });

  it('treats trusted x-forwarded-proto=https requests as secure', () => {
    const req = makeReq({ forwardedProto: 'https', trustProxy: 1 });

    expect(isSecureRequest(req)).toBe(true);
    expect(tokenCookieOptions(req).secure).toBe(true);
  });

  it('treats direct TLS requests as secure without proxy headers', () => {
    const req = makeReq({ encrypted: true });

    expect(isSecureRequest(req)).toBe(true);
  });
});
