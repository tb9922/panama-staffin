import { withTransaction } from '../db.js';
import { NotFoundError, ConflictError } from '../errors.js';
import * as homeRepo from '../repositories/homeRepo.js';
import * as staffRepo from '../repositories/staffRepo.js';
import * as overrideRepo from '../repositories/overrideRepo.js';
import * as dayNoteRepo from '../repositories/dayNoteRepo.js';
import * as auditRepo from '../repositories/auditRepo.js';

function getSchedulingWindow(anchorDate = new Date()) {
  const anchor = anchorDate instanceof Date ? anchorDate : new Date(anchorDate);
  return {
    from: new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - 6, 1)).toISOString().slice(0, 10),
    to: new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 3, 0)).toISOString().slice(0, 10),
  };
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
    config: home.config,
    annual_leave: home.annual_leave,
    staff,
    overrides,
    day_notes: dayNotes,
  };

  // edit_lock_pin: home_manager only (and legacy 'admin' string used by tests).
  // deputy_manager and other roles must not see the PIN via DevTools network tab.
  const hasPinAccess = userRole === 'admin' || userRole === 'home_manager';
  if (!hasPinAccess && payload.config?.edit_lock_pin) {
    payload.config = { ...payload.config };
    delete payload.config.edit_lock_pin;
  }

  // PII allowlist — only roles with legitimate HR/payroll/staff-management access
  // receive NI numbers, date_of_birth, and hourly_rate.
  // Denylist is unsafe: new PII fields would leak until explicitly blocked.
  // Roles excluded: training_lead, shift_coordinator, viewer, staff_member (and any unknown role).
  const PII_ROLES = new Set(['admin', 'home_manager', 'deputy_manager', 'hr_officer', 'finance_officer']);
  if (!PII_ROLES.has(userRole)) {
    payload.staff = staff.map(({ id, name, role, team, pref, skill, active, start_date, contract_hours, wtr_opt_out, al_entitlement, al_carryover, leaving_date }) =>
      ({ id, name, role, team, pref, skill, active, start_date, contract_hours, wtr_opt_out, al_entitlement, al_carryover, leaving_date }));
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

    if (body.config) await homeRepo.updateConfig(home.id, body.config, client);
    if (body.staff) await staffRepo.sync(home.id, body.staff, client);
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
