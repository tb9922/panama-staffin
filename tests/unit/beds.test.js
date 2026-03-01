/**
 * Unit tests for lib/beds.js — pure state machine logic.
 * No DB, no imports beyond the module under test.
 */

import { describe, it, expect } from 'vitest';
import {
  STATUSES,
  ROOM_TYPES,
  VACATING_REASONS,
  RELEASE_REASONS,
  VALID_TRANSITIONS,
  REQUIRED_METADATA,
  CLEAR_ON_EXIT,
  STATUS_BADGES,
  STATUS_LABELS,
  validateTransition,
  validateTransitionMetadata,
  validateReleaseReason,
  validateEmergencyAdmission,
  defaultReservedUntil,
} from '../../lib/beds.js';

// ── Constants ────────────────────────────────────────────────────────────────

describe('Constants', () => {
  it('STATUSES has 8 entries', () => {
    expect(STATUSES).toHaveLength(8);
    expect(STATUSES).toContain('available');
    expect(STATUSES).toContain('decommissioned');
  });

  it('ROOM_TYPES has 5 entries', () => {
    expect(ROOM_TYPES).toHaveLength(5);
    expect(ROOM_TYPES).toContain('single');
    expect(ROOM_TYPES).toContain('bariatric');
  });

  it('VACATING_REASONS has 3 entries', () => {
    expect(VACATING_REASONS).toEqual(['discharged', 'deceased', 'transferred']);
  });

  it('RELEASE_REASONS has 6 entries', () => {
    expect(RELEASE_REASONS).toHaveLength(6);
    expect(RELEASE_REASONS).toContain('family_declined');
    expect(RELEASE_REASONS).toContain('other');
  });

  it('every status has a badge key', () => {
    for (const s of STATUSES) {
      expect(STATUS_BADGES[s]).toBeDefined();
    }
  });

  it('every status has a label', () => {
    for (const s of STATUSES) {
      expect(STATUS_LABELS[s]).toBeDefined();
      expect(typeof STATUS_LABELS[s]).toBe('string');
    }
  });

  it('VALID_TRANSITIONS covers every status', () => {
    for (const s of STATUSES) {
      expect(VALID_TRANSITIONS[s]).toBeDefined();
      expect(Array.isArray(VALID_TRANSITIONS[s])).toBe(true);
    }
  });

  it('all transition targets are valid statuses', () => {
    for (const [from, targets] of Object.entries(VALID_TRANSITIONS)) {
      for (const to of targets) {
        expect(STATUSES).toContain(to);
      }
    }
  });
});

// ── validateTransition ───────────────────────────────────────────────────────

describe('validateTransition', () => {
  it('returns null for all valid transitions', () => {
    for (const [from, targets] of Object.entries(VALID_TRANSITIONS)) {
      for (const to of targets) {
        expect(validateTransition(from, to)).toBeNull();
      }
    }
  });

  it('rejects same-status transition', () => {
    const err = validateTransition('available', 'available');
    expect(err).toMatch(/same status/i);
  });

  it('rejects invalid from-status', () => {
    const err = validateTransition('nonexistent', 'available');
    expect(err).toMatch(/unknown status/i);
  });

  it('rejects disallowed transitions', () => {
    // available -> deep_clean is not allowed
    const err = validateTransition('available', 'deep_clean');
    expect(err).toMatch(/cannot transition/i);
    expect(err).toContain('deep_clean');
  });

  it('available can go to reserved, occupied, maintenance, decommissioned', () => {
    expect(validateTransition('available', 'reserved')).toBeNull();
    expect(validateTransition('available', 'occupied')).toBeNull();
    expect(validateTransition('available', 'maintenance')).toBeNull();
    expect(validateTransition('available', 'decommissioned')).toBeNull();
    // But NOT to hospital_hold, vacating, deep_clean
    expect(validateTransition('available', 'hospital_hold')).toBeTruthy();
    expect(validateTransition('available', 'vacating')).toBeTruthy();
    expect(validateTransition('available', 'deep_clean')).toBeTruthy();
  });

  it('occupied can only go to hospital_hold or vacating', () => {
    expect(validateTransition('occupied', 'hospital_hold')).toBeNull();
    expect(validateTransition('occupied', 'vacating')).toBeNull();
    expect(validateTransition('occupied', 'available')).toBeTruthy();
    expect(validateTransition('occupied', 'reserved')).toBeTruthy();
  });

  it('decommissioned can only go to maintenance', () => {
    expect(validateTransition('decommissioned', 'maintenance')).toBeNull();
    expect(validateTransition('decommissioned', 'available')).toBeTruthy();
  });

  it('hospital_hold can return to occupied or move to vacating', () => {
    expect(validateTransition('hospital_hold', 'occupied')).toBeNull();
    expect(validateTransition('hospital_hold', 'vacating')).toBeNull();
    expect(validateTransition('hospital_hold', 'available')).toBeTruthy();
  });

  it('vacating can only go to deep_clean', () => {
    expect(validateTransition('vacating', 'deep_clean')).toBeNull();
    expect(validateTransition('vacating', 'available')).toBeTruthy();
  });

  it('deep_clean can go to available or maintenance', () => {
    expect(validateTransition('deep_clean', 'available')).toBeNull();
    expect(validateTransition('deep_clean', 'maintenance')).toBeNull();
    expect(validateTransition('deep_clean', 'occupied')).toBeTruthy();
  });
});

// ── validateTransitionMetadata ──────────────────────────────────────────────

describe('validateTransitionMetadata', () => {
  it('returns null for statuses with no required metadata', () => {
    expect(validateTransitionMetadata('available', {})).toBeNull();
    expect(validateTransitionMetadata('reserved', {})).toBeNull();
    expect(validateTransitionMetadata('deep_clean', {})).toBeNull();
    expect(validateTransitionMetadata('maintenance', {})).toBeNull();
    expect(validateTransitionMetadata('decommissioned', {})).toBeNull();
  });

  it('occupied requires residentId', () => {
    expect(validateTransitionMetadata('occupied', {})).toMatch(/resident/i);
    expect(validateTransitionMetadata('occupied', { residentId: null })).toMatch(/resident/i);
    expect(validateTransitionMetadata('occupied', { residentId: '' })).toMatch(/resident/i);
    expect(validateTransitionMetadata('occupied', { residentId: 42 })).toBeNull();
  });

  it('hospital_hold requires holdExpires', () => {
    expect(validateTransitionMetadata('hospital_hold', {})).toMatch(/expiry/i);
    expect(validateTransitionMetadata('hospital_hold', { holdExpires: '' })).toMatch(/expiry/i);
    expect(validateTransitionMetadata('hospital_hold', { holdExpires: '2026-04-01' })).toBeNull();
  });

  it('vacating requires reason', () => {
    expect(validateTransitionMetadata('vacating', {})).toMatch(/reason/i);
    expect(validateTransitionMetadata('vacating', { reason: '' })).toMatch(/reason/i);
    expect(validateTransitionMetadata('vacating', { reason: 'discharged' })).toBeNull();
    expect(validateTransitionMetadata('vacating', { reason: 'deceased' })).toBeNull();
    expect(validateTransitionMetadata('vacating', { reason: 'transferred' })).toBeNull();
  });

  it('vacating rejects invalid reason', () => {
    const err = validateTransitionMetadata('vacating', { reason: 'evicted' });
    expect(err).toMatch(/invalid vacating reason/i);
  });

  it('handles missing metadata gracefully', () => {
    // No metadata arg at all
    expect(validateTransitionMetadata('occupied')).toMatch(/resident/i);
  });
});

// ── validateReleaseReason ────────────────────────────────────────────────────

describe('validateReleaseReason', () => {
  it('returns null for non-reserved-to-available transitions', () => {
    expect(validateReleaseReason('available', 'reserved', {})).toBeNull();
    expect(validateReleaseReason('occupied', 'vacating', {})).toBeNull();
    expect(validateReleaseReason('reserved', 'occupied', {})).toBeNull();
  });

  it('requires releaseReason for reserved -> available', () => {
    expect(validateReleaseReason('reserved', 'available', {})).toMatch(/release reason/i);
  });

  it('rejects invalid release reason', () => {
    const err = validateReleaseReason('reserved', 'available', { releaseReason: 'random' });
    expect(err).toMatch(/invalid release reason/i);
  });

  it('accepts all valid release reasons', () => {
    for (const reason of RELEASE_REASONS) {
      expect(validateReleaseReason('reserved', 'available', { releaseReason: reason })).toBeNull();
    }
  });
});

// ── validateEmergencyAdmission ───────────────────────────────────────────────

describe('validateEmergencyAdmission', () => {
  it('returns null for non-available-to-occupied transitions', () => {
    expect(validateEmergencyAdmission('reserved', 'occupied', {})).toBeNull();
    expect(validateEmergencyAdmission('hospital_hold', 'occupied', {})).toBeNull();
    expect(validateEmergencyAdmission('available', 'reserved', {})).toBeNull();
  });

  it('requires skipReservation for available -> occupied', () => {
    const err = validateEmergencyAdmission('available', 'occupied', {});
    expect(err).toMatch(/skipReservation/);
  });

  it('passes with skipReservation: true', () => {
    expect(validateEmergencyAdmission('available', 'occupied', { skipReservation: true })).toBeNull();
  });

  it('fails with skipReservation: false', () => {
    const err = validateEmergencyAdmission('available', 'occupied', { skipReservation: false });
    expect(err).toMatch(/skipReservation/);
  });
});

// ── defaultReservedUntil ─────────────────────────────────────────────────────

describe('defaultReservedUntil', () => {
  it('returns a date string in YYYY-MM-DD format', () => {
    const result = defaultReservedUntil();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns a date 7 days in the future', () => {
    const result = defaultReservedUntil();
    const expected = new Date();
    expected.setDate(expected.getDate() + 7);
    expect(result).toBe(expected.toISOString().slice(0, 10));
  });
});

// ── CLEAR_ON_EXIT ────────────────────────────────────────────────────────────

describe('CLEAR_ON_EXIT', () => {
  it('clears hold_expires when leaving hospital_hold', () => {
    expect(CLEAR_ON_EXIT.hospital_hold).toContain('hold_expires');
  });

  it('clears reservation fields when leaving reserved', () => {
    expect(CLEAR_ON_EXIT.reserved).toContain('reserved_until');
    expect(CLEAR_ON_EXIT.reserved).toContain('booked_from');
    expect(CLEAR_ON_EXIT.reserved).toContain('booked_until');
  });

  it('does not have clear rules for statuses that need no cleanup', () => {
    expect(CLEAR_ON_EXIT.available).toBeUndefined();
    expect(CLEAR_ON_EXIT.occupied).toBeUndefined();
  });
});

// ── Full lifecycle validation ────────────────────────────────────────────────

describe('Full lifecycle: available → reserved → occupied → hospital_hold → occupied → vacating → deep_clean → available', () => {
  const steps = [
    ['available', 'reserved'],
    ['reserved', 'occupied'],
    ['occupied', 'hospital_hold'],
    ['hospital_hold', 'occupied'],
    ['occupied', 'vacating'],
    ['vacating', 'deep_clean'],
    ['deep_clean', 'available'],
  ];

  for (const [from, to] of steps) {
    it(`${from} → ${to} is valid`, () => {
      expect(validateTransition(from, to)).toBeNull();
    });
  }
});

// ── Edge cases ───────────────────────────────────────────────────────────────

describe('Edge cases', () => {
  it('no status can transition to itself', () => {
    for (const s of STATUSES) {
      const err = validateTransition(s, s);
      expect(err).toBeTruthy();
    }
  });

  it('decommissioned is a near-terminal state (only exits to maintenance)', () => {
    const exits = VALID_TRANSITIONS.decommissioned;
    expect(exits).toEqual(['maintenance']);
  });

  it('maintenance is not a dead end — exits to available or decommissioned', () => {
    const exits = VALID_TRANSITIONS.maintenance;
    expect(exits).toContain('available');
    expect(exits).toContain('decommissioned');
  });

  it('REQUIRED_METADATA only has entries for occupied, hospital_hold, vacating', () => {
    const keys = Object.keys(REQUIRED_METADATA);
    expect(keys.sort()).toEqual(['hospital_hold', 'occupied', 'vacating']);
  });
});
