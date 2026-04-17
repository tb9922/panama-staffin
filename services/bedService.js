import { withTransaction } from '../db.js';
import * as bedRepo from '../repositories/bedRepo.js';
import * as bedTransitionRepo from '../repositories/bedTransitionRepo.js';
import * as financeRepo from '../repositories/financeRepo.js';
import * as auditService from '../services/auditService.js';
import {
  validateTransition,
  validateTransitionMetadata,
  validateReleaseReason,
  validateEmergencyAdmission,
  defaultReservedUntil,
  CLEAR_ON_EXIT,
} from '../lib/beds.js';
import { ValidationError, NotFoundError, ConflictError } from '../errors.js';
import logger from '../logger.js';
import { todayLocalISO } from '../lib/dateOnly.js';

function today() {
  return todayLocalISO();
}

function normalizeTransitionNotes(notes) {
  if (typeof notes !== 'string') return null;
  const trimmed = notes.trim();
  return trimmed || null;
}

function getTransitionReason(oldStatus, newStatus, transitionData) {
  if (oldStatus === 'reserved' && newStatus === 'available') {
    return transitionData.releaseReason ?? null;
  }
  return transitionData.reason ?? null;
}

function assertNotStale(bed, clientUpdatedAt) {
  if (!clientUpdatedAt) return;
  const serverTs = bed.updated_at instanceof Date
    ? bed.updated_at.toISOString()
    : String(bed.updated_at);
  if (serverTs !== clientUpdatedAt) {
    throw new ConflictError('This bed was updated by someone else - please refresh');
  }
}

function assertRoomNumberEditable(bed, nextRoomNumber) {
  if (!nextRoomNumber || nextRoomNumber === bed.room_number) return;
  if (bed.status !== 'available' || bed.resident_id) {
    throw new ValidationError('Room number can only be changed when the bed is available');
  }
}

function assertBedDeletable(bed) {
  if (bed.status !== 'available' || bed.resident_id) {
    throw new ValidationError('Only available beds can be deleted');
  }
}

async function assertResidentNotAlreadyOccupied(homeId, residentId, currentBedId, client) {
  if (!residentId) return;
  const existing = await bedRepo.findByResidentId(residentId, homeId, client);
  if (existing && existing.id !== currentBedId) {
    throw new ValidationError(`Resident is already assigned to occupied bed ${existing.room_number}`);
  }
}

function buildStatusData(oldStatus, newStatus, transitionData) {
  const {
    residentId, holdExpires, reservedUntil,
    bookedFrom, bookedUntil, username,
  } = transitionData;
  const transitionNotes = normalizeTransitionNotes(transitionData.notes);

  const data = {
    status: newStatus,
    resident_id: newStatus === 'occupied' ? (residentId ?? null) : null,
    status_since: today(),
    hold_expires: holdExpires ?? null,
    reserved_until: newStatus === 'reserved'
      ? (reservedUntil || defaultReservedUntil())
      : null,
    booked_from: bookedFrom ?? null,
    booked_until: bookedUntil ?? null,
    updated_by: username,
  };

  if (transitionNotes) {
    data.notes = transitionNotes;
  }

  const clearFields = CLEAR_ON_EXIT[oldStatus];
  if (clearFields) {
    for (const field of clearFields) {
      data[field] = null;
    }
  }

  return data;
}

export async function getBeds(homeId) {
  return bedRepo.findByHome(homeId);
}

export async function getBed(bedId, homeId) {
  const bed = await bedRepo.findById(bedId, homeId);
  if (!bed) throw new NotFoundError('Bed not found');
  return bed;
}

export async function getBedHistory(bedId, homeId) {
  return bedTransitionRepo.getTransitionsByBed(bedId, homeId);
}

export async function getOccupancySummary(homeId) {
  return bedRepo.getOccupancySummary(homeId);
}

export async function getExpiringHolds(homeId, withinDays = 7) {
  return bedRepo.findExpiringHolds(homeId, withinDays);
}

export async function checkResidentBedSync(homeId) {
  return bedRepo.findStaleOccupants(homeId);
}

export async function createBed(homeId, homeSlug, data, username) {
  const bed = await withTransaction(async (client) => {
    const row = await bedRepo.create(homeId, { ...data, created_by: username }, client);

    await bedTransitionRepo.recordTransition(homeId, {
      bedId: row.id,
      fromStatus: 'initial',
      toStatus: row.status || 'available',
      changedBy: username,
      reason: 'Bed created',
    }, client);

    return row;
  });

  auditService.log('bed_create', homeSlug, username, {
    bedId: bed.id,
    roomNumber: bed.room_number,
    status: bed.status,
  }).catch(() => {});

  logger.info({ homeId, bedId: bed.id, roomNumber: bed.room_number, status: bed.status, username }, 'Bed created');
  return bed;
}

export async function updateBed(bedId, homeId, homeSlug, data, username) {
  const result = await withTransaction(async (client) => {
    const bed = await bedRepo.findByIdForUpdate(bedId, homeId, client);
    if (!bed) throw new NotFoundError('Bed not found');

    assertNotStale(bed, data.clientUpdatedAt);
    assertRoomNumberEditable(bed, data.room_number);

    const updated = await bedRepo.updateDetails(bedId, homeId, {
      room_number: data.room_number,
      room_name: data.room_name,
      room_type: data.room_type,
      floor: data.floor,
      notes: data.notes,
      updated_by: username,
    }, client);

    return { before: bed, updated };
  });

  auditService.log('bed_update', homeSlug, username, {
    bedId,
    fromRoomNumber: result.before.room_number,
    toRoomNumber: result.updated.room_number,
    status: result.updated.status,
  }).catch(() => {});

  logger.info({
    homeId,
    bedId,
    fromRoomNumber: result.before.room_number,
    toRoomNumber: result.updated.room_number,
    username,
  }, 'Bed details updated');

  return result.updated;
}

export async function setupBeds(homeId, homeSlug, bedsArray, username) {
  const roomNumbers = bedsArray.map(b => b.room_number);
  const seen = new Set();
  for (const rn of roomNumbers) {
    if (seen.has(rn)) {
      throw new ValidationError(`Duplicate room number in batch: ${rn}`);
    }
    seen.add(rn);
  }

  const created = await withTransaction(async (client) => {
    const results = [];
    for (const bed of bedsArray) {
      const row = await bedRepo.create(homeId, { ...bed, created_by: username }, client);
      await bedTransitionRepo.recordTransition(homeId, {
        bedId: row.id,
        fromStatus: 'initial',
        toStatus: bed.status || 'available',
        changedBy: username,
        reason: 'Bulk setup',
      }, client);
      results.push(row);
    }
    return results;
  });

  auditService.log('beds_setup', homeSlug, username, { count: bedsArray.length }).catch(() => {});
  for (const bed of created) {
    logger.info({ homeId, bedId: bed.id, roomNumber: bed.room_number, status: bed.status }, 'Bed created via bulk setup');
  }

  return created;
}

export async function transitionStatus(bedId, homeId, homeSlug, transitionData) {
  const {
    status: newStatus,
    residentId,
    username,
    clientUpdatedAt,
  } = transitionData;

  const updatedBed = await withTransaction(async (client) => {
    const bed = await bedRepo.findByIdForUpdate(bedId, homeId, client);
    if (!bed) throw new NotFoundError('Bed not found');

    assertNotStale(bed, clientUpdatedAt);

    const transErr = validateTransition(bed.status, newStatus);
    if (transErr) throw new ValidationError(transErr);

    const metaErr = validateTransitionMetadata(newStatus, transitionData);
    if (metaErr) throw new ValidationError(metaErr);

    const releaseErr = validateReleaseReason(bed.status, newStatus, transitionData);
    if (releaseErr) throw new ValidationError(releaseErr);

    const emergencyErr = validateEmergencyAdmission(bed.status, newStatus, transitionData);
    if (emergencyErr) throw new ValidationError(emergencyErr);

    if (residentId && newStatus === 'occupied') {
      const resident = await financeRepo.findResidentById(residentId, homeId, client);
      if (!resident) throw new ValidationError('Resident not found in this home');
      await assertResidentNotAlreadyOccupied(homeId, residentId, bedId, client);
    }

    const statusData = buildStatusData(bed.status, newStatus, transitionData);
    const transitionReason = getTransitionReason(bed.status, newStatus, transitionData);
    const transitionNotes = normalizeTransitionNotes(transitionData.notes);
    const updated = await bedRepo.updateStatus(bedId, homeId, statusData, client);

    await bedTransitionRepo.recordTransition(homeId, {
      bedId,
      fromStatus: bed.status,
      toStatus: newStatus,
      residentId: residentId ?? null,
      changedBy: username,
      reason: transitionReason,
      notes: transitionNotes,
    }, client);

    return { updated, fromStatus: bed.status, roomNumber: bed.room_number };
  });

  auditService.log('bed_transition', homeSlug, username, {
    bedId,
    roomNumber: updatedBed.roomNumber,
    from: updatedBed.fromStatus,
    to: newStatus,
  }).catch(() => {});

  const isEmergency = updatedBed.fromStatus !== 'reserved' &&
    updatedBed.fromStatus !== 'available' &&
    newStatus === 'occupied';
  if (isEmergency) {
    logger.warn({ homeId, bedId, residentId, username, from: updatedBed.fromStatus, to: newStatus }, 'Emergency direct admission');
  } else {
    logger.info({ homeId, bedId, from: updatedBed.fromStatus, to: newStatus, username }, 'Bed status changed');
  }

  return updatedBed.updated;
}

export async function moveBed(fromBedId, toBedId, homeId, homeSlug, username) {
  const result = await withTransaction(async (client) => {
    const [firstId, secondId] = fromBedId < toBedId
      ? [fromBedId, toBedId]
      : [toBedId, fromBedId];
    const firstBed = await bedRepo.findByIdForUpdate(firstId, homeId, client);
    const secondBed = await bedRepo.findByIdForUpdate(secondId, homeId, client);

    const fromBed = fromBedId === firstId ? firstBed : secondBed;
    const toBed = toBedId === firstId ? firstBed : secondBed;

    if (!fromBed) throw new NotFoundError('Source bed not found');
    if (!toBed) throw new NotFoundError('Destination bed not found');
    if (fromBed.status !== 'occupied') throw new ValidationError('Source bed must be occupied');
    if (toBed.status !== 'available') throw new ValidationError('Destination bed must be available');

    const residentId = fromBed.resident_id;
    const now = today();

    const updatedFrom = await bedRepo.updateStatus(fromBedId, homeId, {
      status: 'vacating',
      resident_id: null,
      status_since: now,
      notes: 'Room move',
      updated_by: username,
    }, client);

    const updatedTo = await bedRepo.updateStatus(toBedId, homeId, {
      status: 'occupied',
      resident_id: residentId,
      status_since: now,
      notes: 'Room move',
      updated_by: username,
    }, client);

    await bedTransitionRepo.recordTransition(homeId, {
      bedId: fromBedId,
      fromStatus: 'occupied',
      toStatus: 'vacating',
      residentId,
      changedBy: username,
      reason: 'room_move',
    }, client);

    await bedTransitionRepo.recordTransition(homeId, {
      bedId: toBedId,
      fromStatus: 'available',
      toStatus: 'occupied',
      residentId,
      changedBy: username,
      reason: 'room_move',
    }, client);

    return { updatedFrom, updatedTo, residentId };
  });

  auditService.log('bed_move', homeSlug, username, {
    fromBedId,
    toBedId,
    residentId: result.residentId,
  }).catch(() => {});

  logger.info({ homeId, fromBedId, toBedId, residentId: result.residentId, username }, 'Resident moved between beds');

  return { from: result.updatedFrom, to: result.updatedTo };
}

export async function deleteBed(bedId, homeId, homeSlug, username, clientUpdatedAt) {
  const deleted = await withTransaction(async (client) => {
    const bed = await bedRepo.findByIdForUpdate(bedId, homeId, client);
    if (!bed) throw new NotFoundError('Bed not found');

    assertNotStale(bed, clientUpdatedAt);
    assertBedDeletable(bed);

    const removed = await bedRepo.deleteById(bedId, homeId, client);
    if (!removed) throw new NotFoundError('Bed not found');
    return removed;
  });

  auditService.log('bed_delete', homeSlug, username, {
    bedId,
    roomNumber: deleted.room_number,
    status: deleted.status,
  }).catch(() => {});

  logger.info({ homeId, bedId, roomNumber: deleted.room_number, username }, 'Bed deleted');

  return deleted;
}

export async function revertTransition(bedId, homeId, homeSlug, username, reason) {
  const result = await withTransaction(async (client) => {
    const bed = await bedRepo.findByIdForUpdate(bedId, homeId, client);
    if (!bed) throw new NotFoundError('Bed not found');

    const latest = await bedTransitionRepo.getLatestTransition(bedId, homeId, client);
    if (!latest) throw new ValidationError('No transition to revert');

    const revertTo = latest.from_status;

    const updated = await bedRepo.updateStatus(bedId, homeId, {
      status: revertTo,
      status_since: today(),
      resident_id: revertTo === 'occupied' ? (latest.resident_id ?? null) : null,
      notes: `Reverted: ${reason || 'No reason given'}`,
      updated_by: username,
    }, client);

    await bedTransitionRepo.recordTransition(homeId, {
      bedId,
      fromStatus: bed.status,
      toStatus: revertTo,
      changedBy: username,
      reason: `Reverted: ${reason || 'No reason given'}`,
    }, client);

    return { updated, fromStatus: bed.status, toStatus: revertTo };
  });

  auditService.log('bed_revert', homeSlug, username, {
    bedId,
    fromStatus: result.fromStatus,
    toStatus: result.toStatus,
    reason,
  }).catch(() => {});

  logger.info({ homeId, bedId, from: result.fromStatus, to: result.toStatus, reason, username }, 'Bed transition reverted');

  return result.updated;
}
