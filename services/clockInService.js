import { AppError } from '../errors.js';
import { withTransaction } from '../db.js';
import * as clockInRepo from '../repositories/clockInRepo.js';
import * as homeRepo from '../repositories/homeRepo.js';
import * as overrideRepo from '../repositories/overrideRepo.js';
import * as staffRepo from '../repositories/staffRepo.js';
import * as timesheetRepo from '../repositories/timesheetRepo.js';
import * as auditService from './auditService.js';
import { dispatchEvent } from './webhookService.js';
import { formatDate, getActualShift, parseDate, getShiftHours } from '../shared/rotation.js';

const EARTH_RADIUS_M = 6_371_000;
const LONDON_TZ = 'Europe/London';

function haversine(lat1, lng1, lat2, lng2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

function getLondonParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    minutes: Number.parseInt(map.hour, 10) * 60 + Number.parseInt(map.minute, 10),
  };
}

function getShiftWindowMinutes(config, shiftCode) {
  if (!shiftCode || ['OFF', 'AL', 'SICK', 'AVL'].includes(shiftCode)) return null;
  const shifts = config?.shifts || {};
  let lookup = shiftCode;
  if (lookup.startsWith('OC-') || lookup.startsWith('AG-')) lookup = lookup.slice(3);
  if (lookup === 'BH-D') lookup = 'EL';
  if (lookup === 'BH-N') lookup = 'N';
  const shift = shifts[lookup];
  if (!shift?.start || !shift?.end) return null;
  const [startH, startM] = shift.start.split(':').map(Number);
  const [endH, endM] = shift.end.split(':').map(Number);
  return {
    startMinutes: startH * 60 + startM,
    endMinutes: endH * 60 + endM,
    hours: getShiftHours(shiftCode, config),
  };
}

function checkShiftWindow(config, expectedShift, now, clockType, shiftDate) {
  const timing = getShiftWindowMinutes(config, expectedShift?.shift);
  if (!timing) return false;
  const { date: localDate, minutes: nowMinutes } = getLondonParts(now);
  const early = Number.parseInt(config?.clock_in_early_min, 10);
  const late = Number.parseInt(config?.clock_in_late_min, 10);
  const earlyMinutes = Number.isFinite(early) ? early : 15;
  const lateMinutes = Number.isFinite(late) ? late : 10;

  const overnight = timing.endMinutes <= timing.startMinutes;
  if (clockType === 'in') {
    if (localDate !== shiftDate) return false;
    return nowMinutes >= (timing.startMinutes - earlyMinutes) && nowMinutes <= (timing.startMinutes + lateMinutes);
  }

  if (!overnight) {
    if (localDate !== shiftDate) return false;
    return nowMinutes >= (timing.endMinutes - earlyMinutes) && nowMinutes <= (timing.endMinutes + lateMinutes);
  }

  const nextDay = formatDate(new Date(parseDate(shiftDate).getTime() + 24 * 60 * 60 * 1000));
  if (localDate !== nextDay) return false;
  return nowMinutes >= (timing.endMinutes - earlyMinutes) && nowMinutes <= (timing.endMinutes + lateMinutes);
}

async function lookupExpectedShift(home, staff, dateStr, client) {
  const overrides = await overrideRepo.findByHome(home.id, dateStr, dateStr, client);
  return getActualShift(staff, parseDate(dateStr), overrides, home.config?.cycle_start_date);
}

function roundHours(minutes) {
  return Math.round((minutes / 60) * 100) / 100;
}

async function feedTimesheet(home, staffId, clockOutRecord, client) {
  if (clockOutRecord.clockType !== 'out' || !clockOutRecord.approved) return null;

  const clockInRecord = await clockInRepo.findLatestApprovedInBefore(
    home.id,
    staffId,
    clockOutRecord.shiftDate,
    clockOutRecord.serverTime,
    client,
  );
  if (!clockInRecord) return null;

  const timing = getShiftWindowMinutes(home.config || {}, clockOutRecord.expectedShift);
  const scheduledStart = timing ? String(Math.floor(timing.startMinutes / 60)).padStart(2, '0') + ':' + String(timing.startMinutes % 60).padStart(2, '0') : null;
  const scheduledEnd = timing ? String(Math.floor(timing.endMinutes / 60)).padStart(2, '0') + ':' + String(timing.endMinutes % 60).padStart(2, '0') : null;
  const startDate = new Date(clockInRecord.serverTime);
  const endDate = new Date(clockOutRecord.serverTime);
  const payableHours = roundHours(Math.max(0, (endDate.getTime() - startDate.getTime()) / 60000));

  return timesheetRepo.upsertFromClockIn({
    homeId: home.id,
    staffId,
    date: clockOutRecord.shiftDate,
    scheduledStart,
    scheduledEnd,
    actualStart: clockInRecord.serverTime.slice(11, 16),
    actualEnd: clockOutRecord.serverTime.slice(11, 16),
    payableHours,
    note: `Clock-in generated from #${clockInRecord.id} and #${clockOutRecord.id}`,
  }, client);
}

export async function recordClockIn({ homeId, staffId, payload }) {
  return withTransaction(async (client) => {
    const [home, staff] = await Promise.all([
      homeRepo.findById(homeId, client),
      staffRepo.findById(homeId, staffId, client),
    ]);
    if (!home) throw new AppError('Home not found', 404, 'HOME_NOT_FOUND');
    if (!staff || staff.active === false) throw new AppError('Staff member not found', 404, 'STAFF_NOT_FOUND');

    const now = new Date();
    const shiftDate = getLondonParts(now).date;
    const expectedShift = await lookupExpectedShift(home, staff, shiftDate, client);
    const hasFence = home.config?.geofence_lat != null && home.config?.geofence_lng != null && home.config?.geofence_radius_m != null;
    let source = payload.lat == null || payload.lng == null ? 'manual' : 'gps';
    let distanceM = null;
    let withinGeofence = !hasFence;

    if (hasFence && payload.lat != null && payload.lng != null) {
      distanceM = haversine(
        Number(payload.lat),
        Number(payload.lng),
        Number(home.config.geofence_lat),
        Number(home.config.geofence_lng),
      );
      const accuracy = payload.accuracyM != null ? Number(payload.accuracyM) : 0;
      withinGeofence = distanceM <= (Number(home.config.geofence_radius_m) + accuracy);
    } else if (hasFence) {
      withinGeofence = false;
    }

    const withinWindow = checkShiftWindow(home.config || {}, expectedShift, now, payload.clockType, shiftDate);
    const autoApproved = source === 'gps'
      && withinGeofence
      && (payload.accuracyM == null || Number(payload.accuracyM) <= 100)
      && withinWindow;

    let record = await clockInRepo.create({
      homeId,
      staffId,
      clockType: payload.clockType,
      clientTime: payload.clientTime || null,
      lat: payload.lat ?? null,
      lng: payload.lng ?? null,
      accuracyM: payload.accuracyM ?? null,
      distanceM,
      withinGeofence,
      source,
      shiftDate,
      expectedShift: expectedShift?.shift || null,
      note: payload.note || null,
    }, client);

    if (autoApproved) {
      record = await clockInRepo.approve({ homeId, id: record.id, approvedBy: 'system' }, client);
      await feedTimesheet(home, staffId, record, client);
    }

    await auditService.log('clock_in_recorded', home.slug, staff.name, {
      record_id: record.id,
      clock_type: record.clockType,
      auto_approved: autoApproved,
      within_geofence: withinGeofence,
      distance_m: distanceM,
    }, client);
    await dispatchEvent(homeId, 'clock_in.recorded', {
      recordId: record.id,
      staffId,
      clockType: payload.clockType,
      autoApproved,
    });

    return { ...record, autoApproved };
  });
}

export async function getOwnClockState({ homeId, staffId }) {
  const today = getLondonParts(new Date()).date;
  const lastClock = await clockInRepo.findLastForStaff(homeId, staffId, today);
  return {
    today,
    lastClock,
    nextAction: !lastClock || lastClock.clockType === 'out' ? 'in' : 'out',
  };
}

export async function manualClockIn({ homeId, staffId, clockType, shiftDate, note, clientTime, actor }) {
  return withTransaction(async (client) => {
    const [home, staff] = await Promise.all([
      homeRepo.findById(homeId, client),
      staffRepo.findById(homeId, staffId, client),
    ]);
    if (!home) throw new AppError('Home not found', 404, 'HOME_NOT_FOUND');
    if (!staff) throw new AppError('Staff member not found', 404, 'STAFF_NOT_FOUND');
    const record = await clockInRepo.create({
      homeId,
      staffId,
      clockType,
      clientTime: clientTime || null,
      lat: null,
      lng: null,
      accuracyM: null,
      distanceM: null,
      withinGeofence: null,
      source: 'manual',
      shiftDate,
      expectedShift: null,
      note,
    }, client);
    await auditService.log('clock_in_manual', home.slug, actor, {
      record_id: record.id,
      staff_id: staffId,
      clock_type: clockType,
    }, client);
    return record;
  });
}

export async function approveClockIn({ homeId, id, approvedBy, note }) {
  return withTransaction(async (client) => {
    const home = await homeRepo.findById(homeId, client);
    if (!home) throw new AppError('Home not found', 404, 'HOME_NOT_FOUND');
    const record = await clockInRepo.approve({ homeId, id, approvedBy }, client);
    if (!record) throw new AppError('Clock-in not found or already approved', 404, 'CLOCK_IN_NOT_FOUND');
    await feedTimesheet(home, record.staffId, record, client);
    await auditService.log('clock_in_approved', home.slug, approvedBy, {
      record_id: id,
      note: note || null,
    }, client);
    return record;
  });
}

export async function findUnapproved({ homeId }) {
  return clockInRepo.findUnapproved(homeId);
}

export async function findByDate({ homeId, date }) {
  return clockInRepo.findByDate(homeId, date);
}
