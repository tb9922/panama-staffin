import { withTransaction } from '../db.js';
import { NotFoundError, ConflictError } from '../errors.js';
import * as homeRepo from '../repositories/homeRepo.js';
import * as staffRepo from '../repositories/staffRepo.js';
import * as overrideRepo from '../repositories/overrideRepo.js';
import * as dayNoteRepo from '../repositories/dayNoteRepo.js';
import * as auditRepo from '../repositories/auditRepo.js';

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
  const today = new Date();
  const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 6, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 3, 0)).toISOString().slice(0, 10);

  const [staffResult, overrides, dayNotes] = await Promise.all([
    staffRepo.findByHome(home.id),
    overrideRepo.findByHome(home.id, from, to),
    dayNoteRepo.findByHome(home.id, from, to),
  ]);
  const staff = staffResult.rows;

  const payload = {
    _updatedAt: home.updated_at?.toISOString() || null,
    config: home.config,
    annual_leave: home.annual_leave,
    staff,
    overrides,
    day_notes: dayNotes,
  };

  // Strip edit_lock_pin from config for non-admin roles — prevents any user
  // from reading the PIN via DevTools network tab.
  if (userRole !== 'admin' && payload.config?.edit_lock_pin) {
    payload.config = { ...payload.config };
    delete payload.config.edit_lock_pin;
  }

  // Viewer role: allowlist — only scheduling-relevant fields pass through.
  // Denylist is unsafe because new PII fields would leak until explicitly blocked.
  if (userRole !== 'admin') {
    payload.staff = staff.map(({ id, name, role, team, pref, skill, active, start_date, contract_hours, wtr_opt_out, al_entitlement, al_carryover, leaving_date }) =>
      ({ id, name, role, team, pref, skill, active, start_date, contract_hours, wtr_opt_out, al_entitlement, al_carryover, leaving_date }));
  }

  return payload;
}

// Save all domains in a single transaction with row-level locking.
// SELECT ... FOR UPDATE on the homes row ensures concurrent saves are serialised:
// the second save blocks until the first commits, then sees the new updated_at
// and correctly 409s via optimistic locking. No partial saves on any failure.
export async function saveData(homeSlug, body, username, clientUpdatedAt) {
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

    if (body.config) await homeRepo.updateConfig(home.id, body.config, client);
    if (body.staff) await staffRepo.sync(home.id, body.staff, client);
    if (body.overrides) await overrideRepo.replace(home.id, body.overrides, client);
    if (body.day_notes) await dayNoteRepo.replace(home.id, body.day_notes, client);
    await homeRepo.updateAnnualLeave(home.id, body.annual_leave, client);
    await auditRepo.log('save', homeSlug, username, null, client);
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
