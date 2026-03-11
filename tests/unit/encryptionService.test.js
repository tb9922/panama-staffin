import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { encrypt, decrypt, _resetKeyCache } from '../../services/encryptionService.js';

const TEST_KEY = crypto.randomBytes(32).toString('hex');

describe('encryptionService', () => {
  beforeEach(() => {
    _resetKeyCache();
    process.env.ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(() => {
    _resetKeyCache();
    delete process.env.ENCRYPTION_KEY;
  });

  it('round-trips a short secret', () => {
    const plaintext = 'my-webhook-secret';
    const { encrypted, iv, tag } = encrypt(plaintext);
    expect(decrypt(encrypted, iv, tag)).toBe(plaintext);
  });

  it('round-trips an empty string', () => {
    const { encrypted, iv, tag } = encrypt('');
    expect(decrypt(encrypted, iv, tag)).toBe('');
  });

  it('round-trips unicode text', () => {
    const plaintext = 'secret-\u00e9\u00e8\u00ea-\u{1F512}';
    const { encrypted, iv, tag } = encrypt(plaintext);
    expect(decrypt(encrypted, iv, tag)).toBe(plaintext);
  });

  it('round-trips a long secret (500 chars)', () => {
    const plaintext = 'x'.repeat(500);
    const { encrypted, iv, tag } = encrypt(plaintext);
    expect(decrypt(encrypted, iv, tag)).toBe(plaintext);
  });

  it('produces different ciphertext for same plaintext (unique IV)', () => {
    const { encrypted: a } = encrypt('same-secret');
    const { encrypted: b } = encrypt('same-secret');
    expect(a.equals(b)).toBe(false);
  });

  it('returns Buffers for encrypted, iv, and tag', () => {
    const { encrypted, iv, tag } = encrypt('test');
    expect(Buffer.isBuffer(encrypted)).toBe(true);
    expect(Buffer.isBuffer(iv)).toBe(true);
    expect(Buffer.isBuffer(tag)).toBe(true);
  });

  it('uses 12-byte IV', () => {
    const { iv } = encrypt('test');
    expect(iv.length).toBe(12);
  });

  it('uses 16-byte auth tag', () => {
    const { tag } = encrypt('test');
    expect(tag.length).toBe(16);
  });

  it('fails decryption with wrong key', () => {
    const { encrypted, iv, tag } = encrypt('secret');
    _resetKeyCache();
    process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    expect(() => decrypt(encrypted, iv, tag)).toThrow();
  });

  it('fails decryption with tampered ciphertext', () => {
    const { encrypted, iv, tag } = encrypt('secret');
    encrypted[0] ^= 0xff;
    expect(() => decrypt(encrypted, iv, tag)).toThrow();
  });

  it('fails decryption with tampered tag', () => {
    const { encrypted, iv, tag } = encrypt('secret');
    tag[0] ^= 0xff;
    expect(() => decrypt(encrypted, iv, tag)).toThrow();
  });

  it('throws when ENCRYPTION_KEY is not set', () => {
    _resetKeyCache();
    delete process.env.ENCRYPTION_KEY;
    expect(() => encrypt('test')).toThrow(/ENCRYPTION_KEY/);
  });

  it('throws when ENCRYPTION_KEY is too short', () => {
    _resetKeyCache();
    process.env.ENCRYPTION_KEY = 'abcd1234';
    expect(() => encrypt('test')).toThrow(/64 hex characters/);
  });

  it('throws when ENCRYPTION_KEY contains non-hex characters', () => {
    _resetKeyCache();
    process.env.ENCRYPTION_KEY = 'g'.repeat(64);
    expect(() => encrypt('test')).toThrow(/64 hex characters/);
  });

  it('throws when ENCRYPTION_KEY is too long', () => {
    _resetKeyCache();
    process.env.ENCRYPTION_KEY = 'a'.repeat(128);
    expect(() => encrypt('test')).toThrow(/64 hex characters/);
  });
});
