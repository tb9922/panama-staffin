/**
 * Integration tests for Beds & Occupancy module.
 *
 * Validates: CRUD, status transitions, optimistic locking, concurrency (FOR UPDATE),
 * room moves, revert, bulk setup, dashboard integration, home isolation.
 *
 * Requires: PostgreSQL running with migrations applied (including 090_create_beds.sql).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../../db.js';
import * as bedRepo from '../../repositories/bedRepo.js';
import * as bedTransitionRepo from '../../repositories/bedTransitionRepo.js';
import * as bedService from '../../services/bedService.js';
import * as dashboardRepo from '../../repositories/dashboardRepo.js';

let homeA, homeB, residentId;
const bedIds = [];
let residentSeq = 1;

async function createResident(homeId, name = `Test Resident ${residentSeq++}`) {
  const { rows: [resident] } = await pool.query(
    `INSERT INTO finance_residents (home_id, resident_name, room_number, admission_date, care_type, funding_type, weekly_fee, status, created_by)
     VALUES ($1, $2, '1A', '2025-01-01', 'residential', 'self_funded', 1000, 'active', 'test')
     RETURNING id`,
    [homeId, name]
  );
  return resident.id;
}

beforeAll(async () => {
  // Clean up previous test data
  await pool.query(`DELETE FROM bed_transitions WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'bed-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM beds WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'bed-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM finance_residents WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'bed-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug LIKE 'bed-test-%'`);

  const { rows: [ha] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('bed-test-a', 'Bed Test Home A') RETURNING id`
  );
  const { rows: [hb] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('bed-test-b', 'Bed Test Home B') RETURNING id`
  );
  homeA = ha.id;
  homeB = hb.id;

  // Create a test resident for occupancy tests
  const { rows: [r] } = await pool.query(
    `INSERT INTO finance_residents (home_id, resident_name, room_number, admission_date, care_type, funding_type, weekly_fee, status, created_by)
     VALUES ($1, 'Test Resident', '1A', '2025-01-01', 'residential', 'self_funded', 1000, 'active', 'test')
     RETURNING id`,
    [homeA]
  );
  residentId = r.id;
});

afterAll(async () => {
  await pool.query(`DELETE FROM bed_transitions WHERE home_id IN ($1, $2)`, [homeA, homeB]).catch(() => {});
  await pool.query(`DELETE FROM beds WHERE home_id IN ($1, $2)`, [homeA, homeB]).catch(() => {});
  await pool.query(`DELETE FROM finance_residents WHERE home_id IN ($1, $2)`, [homeA, homeB]).catch(() => {});
  if (homeA) await pool.query('DELETE FROM homes WHERE id = $1', [homeA]);
  if (homeB) await pool.query('DELETE FROM homes WHERE id = $1', [homeB]);
});

// ── bedRepo: create and read ─────────────────────────────────────────────────

describe('bedRepo: create and read', () => {
  let bedId;

  it('creates a bed with default status available', async () => {
    const bed = await bedRepo.create(homeA, {
      room_number: 'R001',
      room_name: 'Rose Room',
      room_type: 'single',
      floor: 'Ground',
      notes: 'Test bed',
      created_by: 'admin',
    });

    expect(bed).not.toBeNull();
    expect(bed.id).toBeTruthy();
    bedId = bed.id;
    bedIds.push(bedId);

    expect(bed.room_number).toBe('R001');
    expect(bed.room_name).toBe('Rose Room');
    expect(bed.room_type).toBe('single');
    expect(bed.status).toBe('available');
    expect(bed.home_id).toBe(homeA);
  });

  it('reads bed by id', async () => {
    const bed = await bedRepo.findById(bedId, homeA);
    expect(bed).not.toBeNull();
    expect(bed.id).toBe(bedId);
    expect(bed.room_number).toBe('R001');
  });

  it('blocks cross-home read', async () => {
    const bed = await bedRepo.findById(bedId, homeB);
    expect(bed).toBeNull();
  });

  it('rejects duplicate room_number in same home', async () => {
    await expect(bedRepo.create(homeA, {
      room_number: 'R001',
      created_by: 'admin',
    })).rejects.toThrow(/room number already exists/i);
  });

  it('allows same room_number in different home', async () => {
    const bed = await bedRepo.create(homeB, {
      room_number: 'R001',
      created_by: 'admin',
    });
    expect(bed).not.toBeNull();
    bedIds.push(bed.id);
  });

  it('lists beds by home', async () => {
    const beds = await bedRepo.findByHome(homeA);
    expect(beds.length).toBeGreaterThanOrEqual(1);
    expect(beds.every(b => b.home_id === homeA)).toBe(true);
  });

  it('defaults room_type to single when not provided', async () => {
    const bed = await bedRepo.create(homeA, {
      room_number: 'R002',
      created_by: 'admin',
    });
    expect(bed.room_type).toBe('single');
    bedIds.push(bed.id);
  });
});

// ── bedRepo: updateStatus ─────────────────────────────────────────────────────

describe('bedRepo: updateStatus', () => {
  let bedId;

  beforeAll(async () => {
    const bed = await bedRepo.create(homeA, {
      room_number: 'R010',
      created_by: 'admin',
    });
    bedId = bed.id;
    bedIds.push(bedId);
  });

  it('updates status and metadata fields', async () => {
    const updated = await bedRepo.updateStatus(bedId, homeA, {
      status: 'reserved',
      reserved_until: '2026-04-01',
      booked_from: '2026-03-15',
      booked_until: '2026-04-15',
      status_since: '2026-03-01',
      notes: 'Reserved for new admission',
      updated_by: 'admin',
    });

    expect(updated.status).toBe('reserved');
    expect(updated.reserved_until).toBe('2026-04-01');
    expect(updated.booked_from).toBe('2026-03-15');
    expect(updated.notes).toBe('Reserved for new admission');
  });

  it('clears nullable fields with explicit null', async () => {
    const updated = await bedRepo.updateStatus(bedId, homeA, {
      status: 'available',
      resident_id: null,
      reserved_until: null,
      booked_from: null,
      booked_until: null,
      hold_expires: null,
      status_since: '2026-03-02',
      notes: null,
      updated_by: 'admin',
    });

    expect(updated.status).toBe('available');
    expect(updated.reserved_until).toBeNull();
    expect(updated.booked_from).toBeNull();
    expect(updated.notes).toBeNull();
  });
});

// ── bedTransitionRepo ─────────────────────────────────────────────────────────

describe('bedService: update and delete metadata', () => {
  it('updates bed metadata for an available bed', async () => {
    const bed = await bedRepo.create(homeA, {
      room_number: 'EDIT001',
      room_name: 'Willow',
      room_type: 'single',
      floor: '1',
      created_by: 'admin',
    });
    bedIds.push(bed.id);

    const updated = await bedService.updateBed(bed.id, homeA, 'bed-test-a', {
      room_number: 'EDIT001A',
      room_name: 'Willow Suite',
      room_type: 'en_suite',
      floor: 'Ground',
      notes: 'Updated via test',
      clientUpdatedAt: bed.updated_at,
    }, 'admin');

    expect(updated.room_number).toBe('EDIT001A');
    expect(updated.room_name).toBe('Willow Suite');
    expect(updated.room_type).toBe('en_suite');
    expect(updated.floor).toBe('Ground');
    expect(updated.notes).toBe('Updated via test');
  });

  it('blocks room number changes for occupied beds', async () => {
    const bed = await bedRepo.create(homeA, {
      room_number: 'EDIT002',
      room_type: 'single',
      status: 'occupied',
      created_by: 'admin',
    });
    bedIds.push(bed.id);

    await expect(bedService.updateBed(bed.id, homeA, 'bed-test-a', {
      room_number: 'EDIT002B',
      room_name: 'Occupied Room',
      room_type: 'single',
      floor: '1',
      notes: '',
      clientUpdatedAt: bed.updated_at,
    }, 'admin')).rejects.toThrow(/room number can only be changed/i);
  });

  it('deletes an available bed', async () => {
    const bed = await bedRepo.create(homeA, {
      room_number: 'DEL001',
      room_type: 'single',
      created_by: 'admin',
    });

    const deleted = await bedService.deleteBed(bed.id, homeA, 'bed-test-a', 'admin', bed.updated_at);
    const found = await bedRepo.findById(bed.id, homeA);

    expect(deleted.room_number).toBe('DEL001');
    expect(found).toBeNull();
  });

  it('blocks deleting a non-available bed', async () => {
    const bed = await bedRepo.create(homeA, {
      room_number: 'DEL002',
      room_type: 'single',
      status: 'maintenance',
      created_by: 'admin',
    });
    bedIds.push(bed.id);

    await expect(bedService.deleteBed(bed.id, homeA, 'bed-test-a', 'admin', bed.updated_at))
      .rejects.toThrow(/only available beds can be deleted/i);
  });
});

describe('bedTransitionRepo', () => {
  let bedId;

  beforeAll(async () => {
    const bed = await bedRepo.create(homeA, {
      room_number: 'R020',
      created_by: 'admin',
    });
    bedId = bed.id;
    bedIds.push(bedId);
  });

  it('records a transition', async () => {
    const t = await bedTransitionRepo.recordTransition(homeA, {
      bedId,
      fromStatus: 'initial',
      toStatus: 'available',
      changedBy: 'admin',
      reason: 'Bed created',
    });

    expect(t).not.toBeNull();
    expect(t.bed_id).toBe(bedId);
    expect(t.from_status).toBe('initial');
    expect(t.to_status).toBe('available');
  });

  it('retrieves transitions ordered by newest first', async () => {
    // Record a second transition
    await bedTransitionRepo.recordTransition(homeA, {
      bedId,
      fromStatus: 'available',
      toStatus: 'reserved',
      changedBy: 'admin',
      reason: 'Test reservation',
    });

    const transitions = await bedTransitionRepo.getTransitionsByBed(bedId, homeA);
    expect(transitions.length).toBe(2);
    expect(transitions[0].to_status).toBe('reserved');
    expect(transitions[1].to_status).toBe('available');
  });

  it('getLatestTransition returns most recent', async () => {
    const latest = await bedTransitionRepo.getLatestTransition(bedId, homeA);
    expect(latest.to_status).toBe('reserved');
  });

  it('returns monthly occupancy rows without querying a deleted_at column', async () => {
    const rows = await bedTransitionRepo.getMonthlyOccupancy(homeA, 3);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveProperty('month');
    expect(rows[0]).toHaveProperty('occupancyRate');
  });
});

// ── bedService: createBed ────────────────────────────────────────────────────

describe('bedService: createBed', () => {
  it('creates bed and records initial transition', async () => {
    const bed = await bedService.createBed(homeA, 'bed-test-a', {
      room_number: 'S001',
      room_type: 'en_suite',
    }, 'admin');

    expect(bed.room_number).toBe('S001');
    expect(bed.status).toBe('available');
    bedIds.push(bed.id);

    // Check transition was recorded
    const transitions = await bedTransitionRepo.getTransitionsByBed(bed.id, homeA);
    expect(transitions.length).toBe(1);
    expect(transitions[0].from_status).toBe('initial');
    expect(transitions[0].to_status).toBe('available');
  });
});

// ── bedService: setupBeds (bulk) ─────────────────────────────────────────────

describe('bedService: setupBeds', () => {
  it('creates multiple beds in a single transaction', async () => {
    const beds = await bedService.setupBeds(homeA, 'bed-test-a', [
      { room_number: 'B001', room_type: 'single' },
      { room_number: 'B002', room_type: 'shared', status: 'reserved' },
      { room_number: 'B003', room_type: 'en_suite' },
    ], 'admin');

    expect(beds).toHaveLength(3);
    for (const b of beds) bedIds.push(b.id);

    expect(beds[0].room_number).toBe('B001');
    expect(beds[0].status).toBe('available');
    expect(beds[1].room_number).toBe('B002');
    expect(beds[1].status).toBe('reserved');

    // Each bed should have an initial transition
    for (const bed of beds) {
      const transitions = await bedTransitionRepo.getTransitionsByBed(bed.id, homeA);
      expect(transitions.length).toBeGreaterThanOrEqual(1);
      expect(transitions.some(t => t.from_status === 'initial')).toBe(true);
    }
  });

  it('rejects batch with duplicate room numbers', async () => {
    await expect(bedService.setupBeds(homeA, 'bed-test-a', [
      { room_number: 'DUP01' },
      { room_number: 'DUP01' },
    ], 'admin')).rejects.toThrow(/duplicate room number/i);
  });
});

// ── bedService: transitionStatus ─────────────────────────────────────────────

describe('bedService: transitionStatus', () => {
  let bedId, updatedAt;

  beforeAll(async () => {
    const bed = await bedService.createBed(homeA, 'bed-test-a', {
      room_number: 'T001',
    }, 'admin');
    bedId = bed.id;
    updatedAt = bed.updated_at;
    bedIds.push(bedId);
  });

  it('transitions available -> reserved with optimistic lock', async () => {
    const bed = await bedService.transitionStatus(bedId, homeA, 'bed-test-a', {
      status: 'reserved',
      username: 'admin',
      clientUpdatedAt: updatedAt,
    });

    expect(bed.status).toBe('reserved');
    expect(bed.reserved_until).toBeTruthy(); // defaultReservedUntil()
    updatedAt = bed.updated_at;
  });

  it('transitions reserved -> occupied with residentId', async () => {
    const bed = await bedService.transitionStatus(bedId, homeA, 'bed-test-a', {
      status: 'occupied',
      residentId,
      username: 'admin',
      clientUpdatedAt: updatedAt,
    });

    expect(bed.status).toBe('occupied');
    expect(bed.resident_id).toBe(residentId);
    // reserved_until should be cleared (CLEAR_ON_EXIT for reserved)
    expect(bed.reserved_until).toBeNull();
    updatedAt = bed.updated_at;
  });

  it('transitions occupied -> hospital_hold', async () => {
    const bed = await bedService.transitionStatus(bedId, homeA, 'bed-test-a', {
      status: 'hospital_hold',
      holdExpires: '2026-04-15',
      username: 'admin',
      clientUpdatedAt: updatedAt,
    });

    expect(bed.status).toBe('hospital_hold');
    expect(bed.hold_expires).toBe('2026-04-15');
    updatedAt = bed.updated_at;
  });

  it('transitions hospital_hold -> occupied (return from hospital)', async () => {
    const bed = await bedService.transitionStatus(bedId, homeA, 'bed-test-a', {
      status: 'occupied',
      residentId,
      username: 'admin',
      clientUpdatedAt: updatedAt,
    });

    expect(bed.status).toBe('occupied');
    // hold_expires should be cleared (CLEAR_ON_EXIT for hospital_hold)
    expect(bed.hold_expires).toBeNull();
    updatedAt = bed.updated_at;
  });

  it('transitions occupied -> vacating with reason', async () => {
    const bed = await bedService.transitionStatus(bedId, homeA, 'bed-test-a', {
      status: 'vacating',
      reason: 'discharged',
      username: 'admin',
      clientUpdatedAt: updatedAt,
    });

    expect(bed.status).toBe('vacating');
    updatedAt = bed.updated_at;
  });

  it('transitions vacating -> deep_clean', async () => {
    const bed = await bedService.transitionStatus(bedId, homeA, 'bed-test-a', {
      status: 'deep_clean',
      username: 'admin',
      clientUpdatedAt: updatedAt,
    });

    expect(bed.status).toBe('deep_clean');
    updatedAt = bed.updated_at;
  });

  it('transitions deep_clean -> available (full cycle complete)', async () => {
    const bed = await bedService.transitionStatus(bedId, homeA, 'bed-test-a', {
      status: 'available',
      username: 'admin',
      clientUpdatedAt: updatedAt,
    });

    expect(bed.status).toBe('available');
    expect(bed.resident_id).toBeNull();
    updatedAt = bed.updated_at;
  });

  it('records full transition history', async () => {
    const transitions = await bedTransitionRepo.getTransitionsByBed(bedId, homeA);
    // initial + 7 transitions
    expect(transitions.length).toBe(8);
  });
});

// ── Validation errors ────────────────────────────────────────────────────────

describe('bedService: validation errors', () => {
  let bedId, updatedAt;

  beforeAll(async () => {
    const bed = await bedService.createBed(homeA, 'bed-test-a', {
      room_number: 'V001',
    }, 'admin');
    bedId = bed.id;
    updatedAt = bed.updated_at;
    bedIds.push(bedId);
  });

  it('rejects invalid transition (available -> deep_clean)', async () => {
    await expect(bedService.transitionStatus(bedId, homeA, 'bed-test-a', {
      status: 'deep_clean',
      username: 'admin',
      clientUpdatedAt: updatedAt,
    })).rejects.toThrow(/cannot transition/i);
  });

  it('rejects occupied without residentId', async () => {
    // First reserve
    const reserved = await bedService.transitionStatus(bedId, homeA, 'bed-test-a', {
      status: 'reserved',
      username: 'admin',
      clientUpdatedAt: updatedAt,
    });
    updatedAt = reserved.updated_at;

    await expect(bedService.transitionStatus(bedId, homeA, 'bed-test-a', {
      status: 'occupied',
      username: 'admin',
      clientUpdatedAt: updatedAt,
    })).rejects.toThrow(/resident/i);
  });

  it('rejects assigning a resident who already occupies another bed', async () => {
    const duplicateResidentId = await createResident(homeA, 'Duplicate Bed Resident');
    const first = await bedService.createBed(homeA, 'bed-test-a', { room_number: 'UNI001' }, 'admin');
    const second = await bedService.createBed(homeA, 'bed-test-a', { room_number: 'UNI002' }, 'admin');
    bedIds.push(first.id, second.id);

    await bedService.transitionStatus(first.id, homeA, 'bed-test-a', {
      status: 'reserved',
      username: 'admin',
      clientUpdatedAt: first.updated_at,
    }).then((reserved) => bedService.transitionStatus(first.id, homeA, 'bed-test-a', {
      status: 'occupied',
      residentId: duplicateResidentId,
      username: 'admin',
      clientUpdatedAt: reserved.updated_at,
    }));

    const reservedSecond = await bedService.transitionStatus(second.id, homeA, 'bed-test-a', {
      status: 'reserved',
      username: 'admin',
      clientUpdatedAt: second.updated_at,
    });

    await expect(bedService.transitionStatus(second.id, homeA, 'bed-test-a', {
      status: 'occupied',
      residentId: duplicateResidentId,
      username: 'admin',
      clientUpdatedAt: reservedSecond.updated_at,
    })).rejects.toThrow(/already assigned/i);
  });

  it('rejects emergency admission without skipReservation flag', async () => {
    // Release reservation first
    const avail = await bedService.transitionStatus(bedId, homeA, 'bed-test-a', {
      status: 'available',
      releaseReason: 'other',
      username: 'admin',
      clientUpdatedAt: updatedAt,
    });
    updatedAt = avail.updated_at;

    // Try direct available -> occupied without skipReservation
    await expect(bedService.transitionStatus(bedId, homeA, 'bed-test-a', {
      status: 'occupied',
      residentId,
      username: 'admin',
      clientUpdatedAt: updatedAt,
    })).rejects.toThrow(/skipReservation/);
  });
});

// ── Optimistic locking ───────────────────────────────────────────────────────

describe('bedService: optimistic locking', () => {
  it('rejects stale clientUpdatedAt', async () => {
    const bed = await bedService.createBed(homeA, 'bed-test-a', {
      room_number: 'OPT001',
    }, 'admin');
    bedIds.push(bed.id);

    const staleTs = bed.updated_at;

    // Make a change to advance updated_at
    await bedService.transitionStatus(bed.id, homeA, 'bed-test-a', {
      status: 'reserved',
      username: 'admin',
      clientUpdatedAt: staleTs,
    });

    // Now try with the stale timestamp
    await expect(bedService.transitionStatus(bed.id, homeA, 'bed-test-a', {
      status: 'occupied',
      residentId,
      username: 'admin',
      clientUpdatedAt: staleTs, // stale — should fail
    })).rejects.toThrow(/updated by someone else/i);
  });
});

// ── bedService: moveBed ──────────────────────────────────────────────────────

describe('bedService: moveBed', () => {
  let fromBedId, toBedId, moveResidentId;

  beforeAll(async () => {
    moveResidentId = await createResident(homeA, 'Move Bed Resident');

    // Create source bed (occupied) and destination bed (available)
    const fromBed = await bedService.createBed(homeA, 'bed-test-a', {
      room_number: 'M001',
    }, 'admin');
    fromBedId = fromBed.id;
    bedIds.push(fromBedId);

    // Transition to occupied via reservation
    const reserved = await bedService.transitionStatus(fromBedId, homeA, 'bed-test-a', {
      status: 'reserved',
      username: 'admin',
      clientUpdatedAt: fromBed.updated_at,
    });
    await bedService.transitionStatus(fromBedId, homeA, 'bed-test-a', {
      status: 'occupied',
      residentId: moveResidentId,
      username: 'admin',
      clientUpdatedAt: reserved.updated_at,
    });

    const toBed = await bedService.createBed(homeA, 'bed-test-a', {
      room_number: 'M002',
    }, 'admin');
    toBedId = toBed.id;
    bedIds.push(toBedId);
  });

  it('moves resident from occupied to available bed', async () => {
    const result = await bedService.moveBed(fromBedId, toBedId, homeA, 'bed-test-a', 'admin');

    expect(result.from.status).toBe('vacating');
    expect(result.from.resident_id).toBeNull();
    expect(result.to.status).toBe('occupied');
    expect(result.to.resident_id).toBe(moveResidentId);
  });

  it('rejects move from non-occupied bed', async () => {
    // fromBed is now vacating, not occupied
    const newAvail = await bedService.createBed(homeA, 'bed-test-a', {
      room_number: 'M003',
    }, 'admin');
    bedIds.push(newAvail.id);

    await expect(
      bedService.moveBed(fromBedId, newAvail.id, homeA, 'bed-test-a', 'admin')
    ).rejects.toThrow(/source bed must be occupied/i);
  });

  it('rejects move to non-available bed', async () => {
    const secondMoveResidentId = await createResident(homeA, 'Move Bed Resident 2');
    // toBed is now occupied, create a new occupied source
    const src = await bedService.createBed(homeA, 'bed-test-a', {
      room_number: 'M004',
    }, 'admin');
    bedIds.push(src.id);
    const r1 = await bedService.transitionStatus(src.id, homeA, 'bed-test-a', {
      status: 'reserved',
      username: 'admin',
      clientUpdatedAt: src.updated_at,
    });
    await bedService.transitionStatus(src.id, homeA, 'bed-test-a', {
      status: 'occupied',
      residentId: secondMoveResidentId,
      username: 'admin',
      clientUpdatedAt: r1.updated_at,
    });

    await expect(
      bedService.moveBed(src.id, toBedId, homeA, 'bed-test-a', 'admin')
    ).rejects.toThrow(/destination bed must be available/i);
  });

  it('rejects stale clientUpdatedAt on room move', async () => {
    const residentForStaleMove = await createResident(homeA, 'Move Bed Resident Stale');
    const src = await bedService.createBed(homeA, 'bed-test-a', {
      room_number: 'M005',
    }, 'admin');
    bedIds.push(src.id);
    const srcReserved = await bedService.transitionStatus(src.id, homeA, 'bed-test-a', {
      status: 'reserved',
      username: 'admin',
      clientUpdatedAt: src.updated_at,
    });
    const occupiedSrc = await bedService.transitionStatus(src.id, homeA, 'bed-test-a', {
      status: 'occupied',
      residentId: residentForStaleMove,
      username: 'admin',
      clientUpdatedAt: srcReserved.updated_at,
    });

    const dest = await bedService.createBed(homeA, 'bed-test-a', {
      room_number: 'M006',
      room_name: 'Stale target',
    }, 'admin');
    bedIds.push(dest.id);
    const staleDestinationTimestamp = dest.updated_at;
    await bedService.updateBed(dest.id, homeA, 'bed-test-a', {
      room_number: 'M006',
      room_name: 'Refreshed target',
      room_type: 'single',
      floor: null,
      notes: '',
      clientUpdatedAt: dest.updated_at,
    }, 'admin');

    await expect(
      bedService.moveBed(src.id, dest.id, homeA, 'bed-test-a', 'admin', occupiedSrc.updated_at, staleDestinationTimestamp)
    ).rejects.toThrow(/updated by someone else|modified by another user/i);
  });
});

// ── bedService: revertTransition ─────────────────────────────────────────────

describe('bedService: revertTransition', () => {
  it('reverts the last transition', async () => {
    const bed = await bedService.createBed(homeA, 'bed-test-a', {
      room_number: 'REV001',
    }, 'admin');
    bedIds.push(bed.id);

    // Reserve it
    await bedService.transitionStatus(bed.id, homeA, 'bed-test-a', {
      status: 'reserved',
      username: 'admin',
      clientUpdatedAt: bed.updated_at,
    });

    // Revert: should go back to available
    const reverted = await bedService.revertTransition(
      bed.id, homeA, 'bed-test-a', 'admin', 'Changed my mind'
    );

    expect(reverted.status).toBe('available');
  });

  it('rejects revert to initial (violates DB check constraint)', async () => {
    // A newly created bed has only the initial→available transition.
    // Reverting would try to set status='initial' which is not a valid DB status.
    const bed = await bedService.createBed(homeA, 'bed-test-a', {
      room_number: 'REV002',
    }, 'admin');
    bedIds.push(bed.id);

    await expect(bedService.revertTransition(
      bed.id, homeA, 'bed-test-a', 'admin', 'Testing revert'
    )).rejects.toThrow(/check constraint|beds_status_check/i);
  });
});

// ── bedRepo: occupancy summary ───────────────────────────────────────────────

describe('bedRepo: getOccupancySummary', () => {
  it('returns counts by status', async () => {
    const summary = await bedRepo.getOccupancySummary(homeA);

    expect(typeof summary.total).toBe('number');
    expect(typeof summary.occupied).toBe('number');
    expect(typeof summary.available).toBe('number');
    expect(typeof summary.occupancyRate).toBe('number');
    expect(summary.total).toBeGreaterThan(0);
  });
});

// ── Dashboard integration ────────────────────────────────────────────────────

describe('Dashboard: bed counts', () => {
  it('getBedCounts returns expected shape', async () => {
    const counts = await dashboardRepo.getBedCounts(homeA);

    expect(counts).toHaveProperty('total');
    expect(counts).toHaveProperty('occupied');
    expect(counts).toHaveProperty('available');
    expect(counts).toHaveProperty('hospitalHold');
    expect(counts).toHaveProperty('occupancyRate');
    expect(typeof counts.total).toBe('number');
    expect(counts.total).toBeGreaterThan(0);
  });

  it('getBedVacancyCost returns expected shape', async () => {
    const vacancy = await dashboardRepo.getBedVacancyCost(homeA);

    expect(vacancy).toHaveProperty('vacantBeds');
    expect(vacancy).toHaveProperty('totalVacancyDays');
    expect(vacancy).toHaveProperty('floorWeeklyLoss');
    expect(vacancy).toHaveProperty('avgWeeklyLoss');
    expect(typeof vacancy.vacantBeds).toBe('number');
  });

  it('getBedAlerts returns expected shape', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const alerts = await dashboardRepo.getBedAlerts(homeA, today);

    expect(alerts).toHaveProperty('hospitalHoldExpiring');
    expect(alerts).toHaveProperty('staleReservations');
    expect(alerts).toHaveProperty('residentBedMismatch');
  });

  it('getBedSummary combines all three', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const summary = await dashboardRepo.getBedSummary(homeA, today);

    // Should have keys from all three sub-queries
    expect(summary).toHaveProperty('total');
    expect(summary).toHaveProperty('occupancyRate');
    expect(summary).toHaveProperty('vacantBeds');
    expect(summary).toHaveProperty('hospitalHoldExpiring');
  });
});

// ── Home isolation ───────────────────────────────────────────────────────────

describe('Home isolation', () => {
  it('beds from home A are not visible to home B', async () => {
    const bedsA = await bedRepo.findByHome(homeA);
    const bedsB = await bedRepo.findByHome(homeB);

    expect(bedsA.length).toBeGreaterThan(bedsB.length);
    // Home B should only have the one bed we created in the "allows same room_number" test
    expect(bedsB.length).toBe(1);
    expect(bedsB[0].room_number).toBe('R001');
  });
});

// ── bedRepo: findExpiringHolds and findStaleOccupants ────────────────────────

describe('bedRepo: expiring holds and stale occupants', () => {
  it('findExpiringHolds returns beds with holds expiring within range', async () => {
    const holdResidentId = await createResident(homeA, 'Hospital Hold Resident');
    const bed = await bedService.createBed(homeA, 'bed-test-a', {
      room_number: 'EH001',
    }, 'admin');
    bedIds.push(bed.id);

    // Reserve, occupy, then hospital hold
    const r1 = await bedService.transitionStatus(bed.id, homeA, 'bed-test-a', {
      status: 'reserved',
      username: 'admin',
      clientUpdatedAt: bed.updated_at,
    });
    const r2 = await bedService.transitionStatus(bed.id, homeA, 'bed-test-a', {
      status: 'occupied',
      residentId: holdResidentId,
      username: 'admin',
      clientUpdatedAt: r1.updated_at,
    });
    await bedService.transitionStatus(bed.id, homeA, 'bed-test-a', {
      status: 'hospital_hold',
      holdExpires: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10), // 3 days
      username: 'admin',
      clientUpdatedAt: r2.updated_at,
    });

    const expiring = await bedRepo.findExpiringHolds(homeA, 7);
    expect(expiring.some(b => b.id === bed.id)).toBe(true);
  });

  it('findStaleOccupants finds beds with discharged residents', async () => {
    // This test would require a resident with status 'discharged'
    // For now just verify the function runs without error
    const stale = await bedRepo.findStaleOccupants(homeA);
    expect(Array.isArray(stale)).toBe(true);
  });
});
