// P0-M4 — assert AES-GCM cryptographic invariants for webhook secret columns.
//
// Migration 183 adds CHECK constraints that prevent webhook secret rows from
// existing in a state where decrypt() would crash (1-byte IV, wrong-length tag).
// These tests verify the constants used by the encryption pipeline match what
// the migration enforces at the DB layer.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { encrypt, decrypt, _resetKeyCache } from '../../services/encryptionService.js';

// AES-256-GCM standard sizes — these MUST match the CHECK constraints in
// migrations/183_webhook_aes_gcm_invariants.sql. If the encryption pipeline
// ever changes these (e.g. to a different IV size), the migration constraint
// must be updated in lockstep.
const EXPECTED_IV_BYTES = 12;
const EXPECTED_TAG_BYTES = 16;

const TEST_KEY = crypto.randomBytes(32).toString('hex');

describe('Webhook secret crypto invariants (P0-M4)', () => {
  beforeEach(() => {
    _resetKeyCache();
    process.env.ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(() => {
    _resetKeyCache();
    delete process.env.ENCRYPTION_KEY;
  });

  it('encrypt() always emits a 12-byte IV (GCM standard)', () => {
    for (let i = 0; i < 50; i++) {
      const { iv } = encrypt(`test-secret-${i}`);
      expect(iv.length).toBe(EXPECTED_IV_BYTES);
    }
  });

  it('encrypt() always emits a 16-byte auth tag (GCM standard)', () => {
    for (let i = 0; i < 50; i++) {
      const { tag } = encrypt(`test-secret-${i}`);
      expect(tag.length).toBe(EXPECTED_TAG_BYTES);
    }
  });

  it('decrypt rejects a 1-byte IV (the migration-100 placeholder default)', () => {
    const { encrypted, tag } = encrypt('test-secret');
    const badIv = Buffer.from([0]);
    expect(() => decrypt(encrypted, badIv, tag)).toThrow();
  });

  it('decrypt rejects an empty tag', () => {
    const { encrypted, iv } = encrypt('test-secret');
    const badTag = Buffer.alloc(0);
    expect(() => decrypt(encrypted, iv, badTag)).toThrow();
  });

  it('round-trip encrypt → decrypt with proper-length IV and tag works', () => {
    const plaintext = 'webhook-signing-secret-' + crypto.randomBytes(8).toString('hex');
    const { encrypted, iv, tag } = encrypt(plaintext);
    expect(iv.length).toBe(EXPECTED_IV_BYTES);
    expect(tag.length).toBe(EXPECTED_TAG_BYTES);
    expect(decrypt(encrypted, iv, tag)).toBe(plaintext);
  });
});
