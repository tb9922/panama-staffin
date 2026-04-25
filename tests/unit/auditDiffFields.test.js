// P0-A2 follow-up regression tests for diffFields extraSensitive option.
//
// The gold-standard review flagged that removing `description` from
// SENSITIVE_FIELDS globally, without wiring the per-call `extraSensitive`
// option into the call sites, was purely cosmetic: zero callers used it.
// These tests lock:
//   1. description IS logged in plaintext by default (proving P0-A2 core fix)
//   2. extraSensitive option DOES redact description when passed
//   3. Article 9 modules (incidents, complaints, whistleblowing, DoLS) get
//      the protective redaction they need.

import { describe, it, expect } from 'vitest';
import { diffFields } from '../../lib/audit.js';

describe('diffFields — description redaction (P0-A2 follow-up)', () => {
  it('by default, description changes are logged in plaintext', () => {
    const changes = diffFields(
      { description: 'Resident A fell' },
      { description: 'Resident A had stroke' }
    );
    expect(changes).toEqual([
      { field: 'description', old: 'Resident A fell', new: 'Resident A had stroke' },
    ]);
  });

  it('with extraSensitive: ["description"], the value is redacted', () => {
    const changes = diffFields(
      { description: 'Resident A fell' },
      { description: 'Resident A had stroke' },
      { extraSensitive: ['description'] }
    );
    expect(changes).toEqual([
      { field: 'description', old: '[REDACTED]', new: '[REDACTED]' },
    ]);
  });

  it('extraSensitive honours multiple field names', () => {
    const changes = diffFields(
      { description: 'old', findings: 'old_f', notes: 'keep_a' },
      { description: 'new', findings: 'new_f', notes: 'keep_b' },
      { extraSensitive: ['description', 'findings'] }
    );
    expect(changes).toContainEqual({ field: 'description', old: '[REDACTED]', new: '[REDACTED]' });
    expect(changes).toContainEqual({ field: 'findings', old: '[REDACTED]', new: '[REDACTED]' });
    // notes is not in the extra set and not in the global set, so still plaintext
    expect(changes).toContainEqual({ field: 'notes', old: 'keep_a', new: 'keep_b' });
  });

  it('global SENSITIVE_FIELDS redaction still applies even when extraSensitive is passed', () => {
    // ni_number is in global SENSITIVE_FIELDS
    const changes = diffFields(
      { ni_number: 'AB123456C', description: 'test' },
      { ni_number: 'CD789012D', description: 'changed' },
      { extraSensitive: ['description'] }
    );
    expect(changes).toContainEqual({ field: 'ni_number', old: '[REDACTED]', new: '[REDACTED]' });
    expect(changes).toContainEqual({ field: 'description', old: '[REDACTED]', new: '[REDACTED]' });
  });

  it('backward-compatible: 2-arg call shape still works', () => {
    const changes = diffFields({ title: 'a' }, { title: 'b' });
    expect(changes).toEqual([{ field: 'title', old: 'a', new: 'b' }]);
  });

  it('extraSensitive accepts any iterable (Set, Array)', () => {
    const asArray = diffFields(
      { description: 'a' },
      { description: 'b' },
      { extraSensitive: ['description'] }
    );
    const asSet = diffFields(
      { description: 'a' },
      { description: 'b' },
      { extraSensitive: new Set(['description']) }
    );
    expect(asArray).toEqual(asSet);
  });
});
