import { withTransaction } from '../db.js';
import { AppError, ConflictError } from '../errors.js';
import * as homeRepo from '../repositories/homeRepo.js';
import * as overrideRepo from '../repositories/overrideRepo.js';
import * as shiftHourAdjustmentRepo from '../repositories/shiftHourAdjustmentRepo.js';
import * as overrideRequestRepo from '../repositories/overrideRequestRepo.js';
import * as staffRepo from '../repositories/staffRepo.js';
import * as auditService from './auditService.js';
import { dispatchEvent } from './webhookService.js';
import { calculateAccrual } from '../src/lib/accrual.js';
import { getALDeductionHours, getLeaveYear } from '../shared/rotation.js';
import { todayLocalISO } from '../lib/dateOnly.js';

export async function submitALRequest({ homeId, staffId, date, reason }) {
  return withTransaction(async (client) => {
    const home = await homeRepo.findById(homeId, client);
    const staff = await staffRepo.findById(homeId, staffId, client);
    if (!home) throw new AppError('Home not found', 404, 'HOME_NOT_FOUND');
    if (!staff || staff.active === false) throw new AppError('Staff member not found', 404, 'STAFF_NOT_FOUND');

    const existing = await overrideRequestRepo.findByStaff(homeId, staffId, { limit: 200 }, client);
    if (existing.some((item) => item.status === 'pending' && item.requestType === 'AL' && item.date === date)) {
      throw new ConflictError('A pending annual leave request already exists for that date', 'AL_REQUEST_EXISTS');
    }

    const overrides = await overrideRepo.findByHome(homeId, undefined, undefined, client);
    const leaveYear = getLeaveYear(date, home.config?.leave_year_start);
    const hourAdjustments = await shiftHourAdjustmentRepo.findMapByHomePeriod(homeId, leaveYear.startStr, leaveYear.endStr, staffId, client);
    const accrual = calculateAccrual(staff, home.config || {}, overrides, date, hourAdjustments);
    const alHours = getALDeductionHours(staff, date, home.config || {});
    if (alHours <= 0) {
      throw new AppError('Annual leave can only be requested on a working day', 400, 'AL_NON_WORKING_DAY');
    }
    // Aggregate-pending guard: a staff member can submit multiple AL requests
    // that each individually fit balance but collectively exceed it. Subtract
    // the sum of currently-pending AL requests from the projected balance.
    const pendingHours = existing
      .filter((item) => item.status === 'pending' && item.requestType === 'AL')
      .reduce((sum, item) => sum + (Number(item.alHours) || 0), 0);
    const projectedRemaining = accrual.remainingHours - pendingHours;
    if (projectedRemaining < alHours - 0.05) {
      throw new AppError(
        `This request plus your other pending leave (${pendingHours.toFixed(1)}h) would exceed your balance`,
        400,
        'AL_BALANCE_EXCEEDED',
      );
    }

    let request;
    try {
      request = await overrideRequestRepo.create({
        homeId,
        staffId,
        requestType: 'AL',
        date,
        alHours,
        reason: reason || null,
      }, client);
    } catch (err) {
      if (err.code === '23505' && String(err.constraint || '').includes('override_requests_pending_al_unique')) {
        throw new ConflictError('A pending annual leave request already exists for that date', 'AL_REQUEST_EXISTS');
      }
      throw err;
    }

    await auditService.log('al_request_submitted', home.slug, staff.name, {
      request_id: request.id,
      staff_id: staffId,
      date,
      al_hours: alHours,
    }, client);
    await dispatchEvent(homeId, 'al_request.submitted', { requestId: request.id, staffId, date });
    return request;
  });
}

export async function findByStaff({ homeId, staffId }) {
  return overrideRequestRepo.findByStaff(homeId, staffId);
}

export async function findPending({ homeId }) {
  return overrideRequestRepo.findPending(homeId);
}

export async function decideRequest({ homeId, id, status, decidedBy, decisionNote, expectedVersion }) {
  if (!['approved', 'rejected'].includes(status)) {
    throw new AppError('Invalid status', 400, 'INVALID_REQUEST_STATUS');
  }

  return withTransaction(async (client) => {
    const home = await homeRepo.findById(homeId, client);
    const existing = await overrideRequestRepo.findById(homeId, id, client);
    if (!home) throw new AppError('Home not found', 404, 'HOME_NOT_FOUND');
    if (!existing) throw new AppError('Request not found', 404, 'REQUEST_NOT_FOUND');
    if (existing.status !== 'pending') {
      throw new ConflictError('This request has already been decided', 'REQUEST_ALREADY_DECIDED');
    }

    if (status === 'approved' && existing.requestType === 'AL') {
      await client.query(
        'SELECT pg_advisory_xact_lock($1::integer, hashtext($2))',
        [homeId, existing.date],
      );
    }

    const updated = await overrideRequestRepo.decide({
      homeId,
      id,
      status,
      decidedBy,
      decisionNote,
      expectedVersion,
    }, client);
    if (!updated) {
      throw new ConflictError('Request was modified by another user', 'REQUEST_VERSION_CONFLICT');
    }

    if (status === 'approved' && existing.requestType === 'AL') {
      if (home.config?.edit_lock_pin && existing.date < todayLocalISO()) {
        throw new AppError('Past dates are locked. Approve this through Scheduling with the edit PIN.', 423, 'SCHEDULING_EDIT_LOCKED');
      }
      const maxAL = home.config?.max_al_same_day ?? 2;
      const { rows: countRows } = await client.query(
        `SELECT COUNT(*)::int AS cnt
           FROM shift_overrides
          WHERE home_id = $1
            AND date = $2
            AND shift = 'AL'
            AND staff_id <> $3`,
        [homeId, existing.date, existing.staffId],
      );
      if ((countRows[0]?.cnt || 0) >= maxAL) {
        throw new AppError(`Max AL per day (${maxAL}) already reached on ${existing.date}`, 400, 'AL_MAX_PER_DAY');
      }
      const staff = await staffRepo.findById(homeId, existing.staffId, client);
      if (!staff || staff.active === false) throw new AppError('Staff member not found', 404, 'STAFF_NOT_FOUND');
      const overrides = await overrideRepo.findByHome(homeId, undefined, undefined, client);
      const leaveYear = getLeaveYear(existing.date, home.config?.leave_year_start);
      const hourAdjustments = await shiftHourAdjustmentRepo.findMapByHomePeriod(homeId, leaveYear.startStr, leaveYear.endStr, existing.staffId, client);
      const accrual = calculateAccrual(staff, home.config || {}, overrides, existing.date, hourAdjustments);
      const alHours = Number(existing.alHours) || 0;
      if (alHours <= 0 || accrual.remainingHours < alHours - 0.05) {
        throw new AppError('Annual leave balance is no longer sufficient for this request', 400, 'AL_BALANCE_EXCEEDED');
      }
      await overrideRepo.upsertOne(homeId, existing.date, existing.staffId, {
        shift: 'AL',
        source: 'al_request',
        reason: existing.reason || 'Annual leave approved',
        al_hours: existing.alHours,
      }, client);
    }

    await auditService.log(`override_request_${status}`, home.slug, decidedBy, {
      request_id: id,
      staff_id: existing.staffId,
      request_type: existing.requestType,
      date: existing.date,
    }, client);
    await dispatchEvent(homeId, `override_request.${status}`, {
      requestId: id,
      staffId: existing.staffId,
      requestType: existing.requestType,
      date: existing.date,
    });
    return updated;
  });
}

export async function cancelByStaff({ homeId, staffId, id, expectedVersion }) {
  return withTransaction(async (client) => {
    const home = await homeRepo.findById(homeId, client);
    if (!home) throw new AppError('Home not found', 404, 'HOME_NOT_FOUND');
    const updated = await overrideRequestRepo.cancelByStaff({ homeId, staffId, id, expectedVersion }, client);
    if (!updated) throw new ConflictError('Request not found or already decided', 'REQUEST_NOT_CANCELLABLE');
    await auditService.log('override_request_cancelled_by_staff', home.slug, staffId, {
      request_id: id,
      staff_id: staffId,
    }, client);
    // Webhook parity with submitted/approved/rejected — receivers must be able to
    // mirror the full lifecycle. Without this the third-party state diverges
    // permanently for cancelled requests.
    await dispatchEvent(homeId, 'override_request.cancelled', {
      requestId: id,
      staffId,
      requestType: updated.requestType,
      date: updated.date,
    });
    return updated;
  });
}
