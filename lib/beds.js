// lib/beds.js — Bed status lifecycle: transition map, validation, constants
// Zero imports. Pure functions only. Fully unit-testable.
// First state machine pattern in the codebase.

export const STATUSES = [
  'available', 'reserved', 'occupied', 'hospital_hold',
  'vacating', 'deep_clean', 'maintenance', 'decommissioned',
];

export const ROOM_TYPES = ['single', 'shared', 'en_suite', 'nursing', 'bariatric'];

export const VACATING_REASONS = ['discharged', 'deceased', 'transferred'];
export const RELEASE_REASONS = ['family_declined', 'assessment_failed', 'funding_rejected', 'resident_deceased', 'resident_recovered', 'other'];

// Allowed transitions: from_status -> [to_statuses]
export const VALID_TRANSITIONS = {
  available:      ['reserved', 'occupied', 'maintenance', 'decommissioned'],
  reserved:       ['available', 'occupied'],
  occupied:       ['hospital_hold', 'vacating'],
  hospital_hold:  ['occupied', 'vacating'],
  vacating:       ['deep_clean'],
  deep_clean:     ['available', 'maintenance'],
  maintenance:    ['available', 'decommissioned'],
  decommissioned: ['maintenance'],
};

/**
 * Validate a status transition.
 * Returns null if valid, error string if invalid.
 */
export function validateTransition(fromStatus, toStatus) {
  if (fromStatus === toStatus) {
    return `Cannot transition to the same status: '${fromStatus}'`;
  }
  const allowed = VALID_TRANSITIONS[fromStatus];
  if (!allowed) {
    return `Unknown status: '${fromStatus}'`;
  }
  if (!allowed.includes(toStatus)) {
    return `Cannot transition from '${fromStatus}' to '${toStatus}'. Allowed: ${allowed.join(', ')}`;
  }
  return null;
}

// Metadata requirements per target status
export const REQUIRED_METADATA = {
  occupied:       ['residentId'],
  hospital_hold:  ['holdExpires'],
  vacating:       ['reason'],
};

// Fields to clear when leaving a status
export const CLEAR_ON_EXIT = {
  hospital_hold: ['hold_expires'],
  reserved:      ['reserved_until', 'booked_from', 'booked_until'],
};

/**
 * Validate metadata for a transition. Returns error string or null.
 */
export function validateTransitionMetadata(toStatus, metadata = {}) {
  const required = REQUIRED_METADATA[toStatus];
  if (!required) return null;

  for (const field of required) {
    if (metadata[field] == null || metadata[field] === '') {
      const labels = {
        residentId: 'a resident',
        holdExpires: 'an expiry date',
        reason: 'a reason',
      };
      return `${toStatus} requires ${labels[field] || field}`;
    }
  }

  if (toStatus === 'vacating' && metadata.reason && !VACATING_REASONS.includes(metadata.reason)) {
    return `Invalid vacating reason: '${metadata.reason}'. Must be one of: ${VACATING_REASONS.join(', ')}`;
  }

  return null;
}

/**
 * Validate release_reason when transitioning reserved -> available.
 */
export function validateReleaseReason(fromStatus, toStatus, metadata = {}) {
  if (fromStatus === 'reserved' && toStatus === 'available') {
    if (!metadata.releaseReason) {
      return 'Releasing a reservation requires a release reason';
    }
    if (!RELEASE_REASONS.includes(metadata.releaseReason)) {
      return `Invalid release reason: '${metadata.releaseReason}'. Must be one of: ${RELEASE_REASONS.join(', ')}`;
    }
  }
  return null;
}

/**
 * Check if available -> occupied requires skipReservation flag.
 */
export function validateEmergencyAdmission(fromStatus, toStatus, metadata = {}) {
  if (fromStatus === 'available' && toStatus === 'occupied' && !metadata.skipReservation) {
    return 'Direct admission from available requires skipReservation: true (emergency path)';
  }
  return null;
}

/**
 * Get the default reserved_until date (7 days from now).
 */
export function defaultReservedUntil() {
  const d = new Date();
  const local = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7);
  const year = local.getFullYear();
  const month = String(local.getMonth() + 1).padStart(2, '0');
  const day = String(local.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Badge colour key for a bed status (matches BADGE keys in design.js).
 */
export const STATUS_BADGES = {
  available:      'green',
  reserved:       'blue',
  occupied:       'gray',
  hospital_hold:  'amber',
  vacating:       'orange',
  deep_clean:     'purple',
  maintenance:    'red',
  decommissioned: 'gray',
};

/**
 * Human-readable status labels for UI display.
 */
export const STATUS_LABELS = {
  available:      'Available',
  reserved:       'Reserved',
  occupied:       'Occupied',
  hospital_hold:  'Hospital Hold',
  vacating:       'Vacating',
  deep_clean:     'Deep Clean',
  maintenance:    'Maintenance',
  decommissioned: 'Decommissioned',
};
