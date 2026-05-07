import { withTransaction } from '../db.js';
import { NotFoundError, ConflictError } from '../errors.js';
import * as homeRepo from '../repositories/homeRepo.js';
import * as staffRepo from '../repositories/staffRepo.js';
import * as overrideRepo from '../repositories/overrideRepo.js';
import * as dayNoteRepo from '../repositories/dayNoteRepo.js';
import * as auditRepo from '../repositories/auditRepo.js';
import { endOfLocalMonthISO, startOfLocalMonthISO } from '../lib/dateOnly.js';
import {
  canManageSensitiveStaffFields,
  redactStaffForBroadReader,
} from '../shared/staffPolicy.js';

function getSchedulingWindow(anchorDate = new Date()) {
  return {
    from: startOfLocalMonthISO(anchorDate, -6),
    to: endOfLocalMonthISO(anchorDate, 2),
  };
}

function canSeeOverrideReasons(userRole) {
  return ['admin', 'home_manager', 'deputy_manager'].includes(userRole);
}

function redactOverrideReasons(overrides = {}) {
  const redacted = {};
  for (const [date, entries] of Object.entries(overrides || {})) {
    redacted[date] = {};
    for (const [staffId, override] of Object.entries(entries || {})) {
      if (!override || typeof override !== 'object') continue;
      const { reason, ...safeOverride } = override;
      if (reason) {
        safeOverride.reason_category = ['AL', 'SICK', 'NS'].includes(safeOverride.shift)
          ? 'absence'
          : 'rota_change';
      }
      redacted[date][staffId] = safeOverride;
    }
  }
  return redacted;
}

function redactConfigForRole(config, userRole) {
  const result = { ...(config || {}) };
  const canSeeCostConfig = ['admin', 'home_manager', 'deputy_manager', 'finance_officer'].includes(userRole);
  const canSeeEditPin = ['admin', 'home_manager'].includes(userRole);

  if (!canSeeEditPin) delete result.edit_lock_pin;
  if (!canSeeCostConfig) {
    delete result.agency_rate_day;
    delete result.agency_rate_night;
    delete result.ot_premium;
    delete result.bh_premium_multiplier;
  }
  return result;
}

export async function listHomes() {
  return homeRepo.listAll();
}

// Assemble the full home data object in the same shape the frontend expects.
// All repo queries run in parallel — P50 latency target < 50ms on 1 home.
export async function assembleData(homeSlug, userRole) {
  const home = await homeRepo.findBySlug(homeSlug);
  if (!home) throw new NotFoundError(`Home not found: ${homeSlug}`);

  // Bound overrides + day notes to a reasonable window (6 months back, 3 months forward)
  // to prevent unbounded data growth as deployment ages.
  const windowAnchor = new Date();
  const { from, to } = getSchedulingWindow(windowAnchor);

  const [staffResult, overrides, dayNotes] = await Promise.all([
    staffRepo.findByHome(home.id),
    overrideRepo.findByHome(home.id, from, to),
    dayNoteRepo.findByHome(home.id, from, to),
  ]);
  const staff = staffResult.rows;

  const payload = {
    _updatedAt: home.updated_at?.toISOString() || null,
    _windowAnchorDate: windowAnchor.toISOString(),
    config: redactConfigForRole(home.config, userRole),
    annual_leave: home.annual_leave,
    staff,
    overrides: canSeeOverrideReasons(userRole) ? overrides : redactOverrideReasons(overrides),
    day_notes: canSeeOverrideReasons(userRole) ? dayNotes : {},
  };

  // PII allowlist — only roles with legitimate HR/payroll/staff-management access
  // receive NI numbers, date_of_birth, and hourly_rate.
  // Denylist is unsafe: new PII fields would leak until explicitly blocked.
  // Roles excluded: training_lead, shift_coordinator, viewer, staff_member (and any unknown role).
  if (!canManageSensitiveStaffFields(userRole)) {
    payload.staff = redactStaffForBroadReader(staff);
  }

  return payload;
}

// Save all domains in a single transaction with row-level locking.
// SELECT ... FOR UPDATE on the homes row ensures concurrent saves are serialised:
// the second save blocks until the first commits, then sees the new updated_at
// and correctly 409s via optimistic locking. No partial saves on any failure.
export async function saveData(homeSlug, body, username, clientUpdatedAt, auditDetails = null) {
  // await (not return) so the code below runs after the transaction commits
  await withTransaction(async (client) => {
    // Lock the home row — concurrent saves block here until this transaction commits
    const home = await homeRepo.findBySlugForUpdate(homeSlug, client);
    if (!home) throw new NotFoundError(`Home not found: ${homeSlug}`);

    // Optimistic locking check inside the lock — guarantees no race window
    if (clientUpdatedAt && home.updated_at) {
      const serverUpdatedAt = home.updated_at.toISOString();
      if (serverUpdatedAt !== clientUpdatedAt) {
        throw new ConflictError('This home was modified by someone else since you last loaded it.');
      }
    }

    // Use the same date window as assembleData to avoid destroying overrides/notes
    // outside the loaded range (e.g. far-future AL bookings).
    const windowAnchor = body?._windowAnchorDate
      ? new Date(body._windowAnchorDate)
      : clientUpdatedAt
        ? new Date(clientUpdatedAt)
        : new Date();
    const { from, to } = getSchedulingWindow(windowAnchor);

    if (body.config) {
      const nextConfig = { ...(home.config || {}), ...body.config };
      if (!Object.prototype.hasOwnProperty.call(nextConfig, 'edit_lock_pin') &&
          Object.prototype.hasOwnProperty.call(home.config || {}, 'edit_lock_pin')) {
        nextConfig.edit_lock_pin = home.config.edit_lock_pin;
      }
      await homeRepo.updateConfig(home.id, nextConfig, client);
    }
    if (body.staff) {
      const existingStaff = await staffRepo.findAllByHome(home.id, client);
      const mergedById = new Map(existingStaff.map((staff) => [staff.id, staff]));
      for (const staff of body.staff) {
        mergedById.set(staff.id, mergedById.has(staff.id) ? { ...mergedById.get(staff.id), ...staff } : staff);
      }
      const mergedStaff = [...mergedById.values()];
      await staffRepo.sync(home.id, mergedStaff, client);
    }
    if (body.overrides) await overrideRepo.replace(home.id, body.overrides, client, from, to);
    if (body.day_notes) await dayNoteRepo.replace(home.id, body.day_notes, client, from, to);
    if (body.annual_leave != null) await homeRepo.updateAnnualLeave(home.id, body.annual_leave, client);
    await auditRepo.log('save', homeSlug, username, auditDetails, client);
  });

  // Return the new updated_at so the client keeps serverUpdatedAt.current in sync.
  // Without this, every second save from the same tab would get a false 409.
  const fresh = await homeRepo.findBySlug(homeSlug);
  return { updatedAt: fresh?.updated_at?.toISOString() || null };
}

// Ensure a home row exists for the given slug. Used by the import script.
export async function upsertHome(slug, name, configData, annualLeave) {
  return homeRepo.upsert(slug, name, configData, annualLeave);
}
