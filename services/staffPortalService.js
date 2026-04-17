import { withTransaction } from '../db.js';
import { AppError, ConflictError } from '../errors.js';
import * as homeRepo from '../repositories/homeRepo.js';
import * as overrideRepo from '../repositories/overrideRepo.js';
import * as payrollRunRepo from '../repositories/payrollRunRepo.js';
import * as sspRepo from '../repositories/sspRepo.js';
import * as staffRepo from '../repositories/staffRepo.js';
import * as trainingRepo from '../repositories/trainingRepo.js';
import * as auditService from './auditService.js';
import { dispatchEvent } from './webhookService.js';
import { assemblePayslipData } from './payrollService.js';
import { getTrainingTypes } from '../shared/training.js';
import { todayLocalISO } from '../lib/dateOnly.js';
import {
  addDays,
  formatDate,
  getActualShift,
  getScheduledShift,
  getCycleDay,
  parseDate,
} from '../shared/rotation.js';
import { calculateAccrual } from '../src/lib/accrual.js';

const PROFILE_ALLOWLIST = new Set(['phone', 'address', 'emergency_contact']);

function shapeOwnProfile(staff) {
  return {
    id: staff.id,
    name: staff.name,
    role: staff.role,
    team: staff.team,
    phone: staff.phone || '',
    address: staff.address || '',
    emergency_contact: staff.emergency_contact || '',
  };
}

export async function getStaffScheduleWindow({ homeId, staffId, from, to }) {
  const [home, staff, overrides] = await Promise.all([
    homeRepo.findById(homeId),
    staffRepo.findById(homeId, staffId),
    overrideRepo.findByHome(homeId, from, to),
  ]);
  if (!home) throw new AppError('Home not found', 404, 'HOME_NOT_FOUND');
  if (!staff || staff.active === false) throw new AppError('Staff member not found', 404, 'STAFF_NOT_FOUND');

  const start = parseDate(from);
  const end = parseDate(to);
  const days = [];
  for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
    const actual = getActualShift(staff, cursor, overrides, home.config?.cycle_start_date);
    const cycleDay = getCycleDay(cursor, home.config?.cycle_start_date);
    const scheduledShift = getScheduledShift(staff, cycleDay, cursor);
    days.push({
      date: formatDate(cursor),
      shift: actual.shift,
      scheduledShift,
      isOverride: actual.shift !== scheduledShift,
      reason: actual.reason || null,
      source: actual.source || 'scheduled',
    });
  }

  return {
    staff: {
      id: staff.id,
      name: staff.name,
      role: staff.role,
      team: staff.team,
    },
    config: {
      homeName: home.config?.home_name || home.name,
      cycleStartDate: home.config?.cycle_start_date || null,
    },
    days,
  };
}

export async function getStaffAccrualSummary({ homeId, staffId, asOfDate }) {
  const [home, staff, overrides] = await Promise.all([
    homeRepo.findById(homeId),
    staffRepo.findById(homeId, staffId),
    overrideRepo.findByHome(homeId),
  ]);
  if (!home) throw new AppError('Home not found', 404, 'HOME_NOT_FOUND');
  if (!staff || staff.active === false) throw new AppError('Staff member not found', 404, 'STAFF_NOT_FOUND');
  return calculateAccrual(staff, home.config || {}, overrides, asOfDate || todayLocalISO());
}

export async function getStaffPayslipRuns({ homeId, staffId }) {
  const { rows } = await payrollRunRepo.findByHome(homeId, { limit: 50, offset: 0 });
  const visibleRuns = rows.filter((run) => ['approved', 'exported', 'locked'].includes(run.status));
  const items = [];
  for (const run of visibleRuns) {
    const payslips = await assemblePayslipData(run.id, homeId, staffId);
    if (!payslips?.length) continue;
    const payslip = payslips[0];
    items.push({
      runId: run.id,
      periodStart: run.period_start,
      periodEnd: run.period_end,
      status: run.status,
      grossPay: payslip.line?.gross_pay ?? payslip.gross_pay ?? null,
      netPay: payslip.line?.net_pay ?? payslip.net_pay ?? null,
      generatedAt: run.exported_at || run.approved_at || run.updated_at,
    });
  }
  return items;
}

export async function getStaffTrainingStatus({ homeId, staffId }) {
  const [home, staff, records] = await Promise.all([
    homeRepo.findById(homeId),
    staffRepo.findById(homeId, staffId),
    trainingRepo.findByStaff(homeId, staffId),
  ]);
  if (!home) throw new AppError('Home not found', 404, 'HOME_NOT_FOUND');
  if (!staff || staff.active === false) throw new AppError('Staff member not found', 404, 'STAFF_NOT_FOUND');

  const recordMap = new Map(records.map((record) => [record.training_type_id, record]));
  const today = todayLocalISO();
  const items = getTrainingTypes(home.config || {})
    .filter((type) => type.active !== false)
    .filter((type) => !type.roles || type.roles.includes(staff.role))
    .map((type) => {
      const record = recordMap.get(type.id);
      let status = 'missing';
      if (record?.completed) status = record.expiry && record.expiry < today ? 'expired' : 'complete';
      return {
        id: type.id,
        name: type.name,
        category: type.category,
        refresherMonths: type.refresher_months ?? null,
        status,
        completed: record?.completed || null,
        expiry: record?.expiry || null,
        acknowledgedAt: record?.acknowledged_at || null,
        acknowledgedByStaff: record?.acknowledged_by_staff === true,
      };
    });

  return {
    staff: { id: staff.id, name: staff.name, role: staff.role },
    items,
  };
}

export async function acknowledgeTrainingByStaff({ homeId, staffId, typeId }) {
  return withTransaction(async (client) => {
    const [home, staff] = await Promise.all([
      homeRepo.findById(homeId, client),
      staffRepo.findById(homeId, staffId, client),
    ]);
    if (!home) throw new AppError('Home not found', 404, 'HOME_NOT_FOUND');
    if (!staff) throw new AppError('Staff member not found', 404, 'STAFF_NOT_FOUND');
    const ok = await trainingRepo.acknowledgeByStaff(homeId, staffId, typeId, client);
    if (!ok) throw new AppError('Training record not found', 404, 'TRAINING_NOT_FOUND');
    await auditService.log('training_acknowledged_by_staff', home.slug, staff.name, {
      staff_id: staffId,
      training_type_id: typeId,
    }, client);
    return { ok: true };
  });
}

export async function getOwnProfile({ homeId, staffId }) {
  const staff = await staffRepo.findById(homeId, staffId);
  if (!staff || staff.active === false) throw new AppError('Staff member not found', 404, 'STAFF_NOT_FOUND');
  return shapeOwnProfile(staff);
}

export async function updateOwnProfile({ homeId, staffId, patch, actorUsername }) {
  return withTransaction(async (client) => {
    const [home, existing] = await Promise.all([
      homeRepo.findById(homeId, client),
      staffRepo.findById(homeId, staffId, client),
    ]);
    if (!home) throw new AppError('Home not found', 404, 'HOME_NOT_FOUND');
    if (!existing || existing.active === false) throw new AppError('Staff member not found', 404, 'STAFF_NOT_FOUND');
    const safePatch = Object.fromEntries(
      Object.entries(patch || {}).filter(([key]) => PROFILE_ALLOWLIST.has(key)),
    );
    if (Object.keys(safePatch).length === 0) {
      return shapeOwnProfile(existing);
    }
    const updated = await staffRepo.updateOne(homeId, staffId, safePatch, undefined, client);
    await auditService.log('staff_profile_updated_by_self', home.slug, actorUsername || existing.name, {
      staff_id: staffId,
      changed_fields: Object.keys(safePatch),
    }, client);
    return shapeOwnProfile(updated);
  });
}

export async function reportSick({ homeId, staffId, date, reason, actorUsername }) {
  return withTransaction(async (client) => {
    const [home, staff] = await Promise.all([
      homeRepo.findById(homeId, client),
      staffRepo.findById(homeId, staffId, client),
    ]);
    if (!home) throw new AppError('Home not found', 404, 'HOME_NOT_FOUND');
    if (!staff || staff.active === false) throw new AppError('Staff member not found', 404, 'STAFF_NOT_FOUND');

    // Idempotency guard: if SICK is already recorded for this date, return early
    // without re-emitting webhook + audit. Otherwise repeated submits (double-click,
    // network retry, second-tab) would double-count and confuse downstream listeners.
    const existingOverrides = await overrideRepo.findByHome(homeId, date, date, client);
    const alreadySick = existingOverrides?.[date]?.[staffId]?.shift === 'SICK';
    const activePeriod = await sspRepo.getActiveSickPeriod(homeId, staffId, date, date, client);
    if (alreadySick && activePeriod) {
      return { ok: true, sickPeriod: activePeriod, alreadyRecorded: true };
    }

    await overrideRepo.upsertOne(homeId, date, staffId, {
      shift: 'SICK',
      reason: reason || 'Self-reported sick',
      source: 'self_reported',
      al_hours: null,
    }, client);

    let sickPeriod = activePeriod;
    if (!activePeriod) {
      const previous = await sspRepo.findRecentClosedPeriod(homeId, staffId, date, 56, client);
      sickPeriod = await sspRepo.createSickPeriod(homeId, {
        staff_id: staffId,
        start_date: date,
        end_date: null,
        qualifying_days_per_week: 5,
        waiting_days_served: previous ? 3 : 0,
        linked_to_period_id: previous?.id || null,
        notes: reason || 'Self-reported sick',
      }, client);
    }

    await auditService.log('sick_self_reported', home.slug, actorUsername || staff.name, {
      staff_id: staffId,
      date,
    }, client);
    await dispatchEvent(homeId, 'sick.self_reported', { staffId, date });
    return { ok: true, sickPeriod };
  });
}
