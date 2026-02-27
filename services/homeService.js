import { withTransaction } from '../db.js';
import { NotFoundError } from '../errors.js';
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

  const [staff, overrides, dayNotes] = await Promise.all([
    staffRepo.findByHome(home.id),
    overrideRepo.findByHome(home.id),
    dayNoteRepo.findByHome(home.id),
  ]);

  const payload = {
    _updatedAt: home.updated_at?.toISOString() || null,
    config: home.config,
    annual_leave: home.annual_leave,
    staff,
    overrides,
    day_notes: dayNotes,
  };

  // Viewer role: strip staff PII
  if (userRole !== 'admin') {
    payload.staff = staff.map(s => ({ ...s, date_of_birth: null, ni_number: null }));
  }

  return payload;
}

// Save all domains in a single transaction.
// On any failure the whole transaction rolls back — no partial saves.
export async function saveData(homeSlug, body, username) {
  const home = await homeRepo.findBySlug(homeSlug);
  if (!home) throw new NotFoundError(`Home not found: ${homeSlug}`);

  // await (not return) so the code below runs after the transaction commits
  await withTransaction(async (client) => {
    await homeRepo.updateConfig(home.id, body.config, client);
    await homeRepo.updateAnnualLeave(home.id, body.annual_leave, client);
    await staffRepo.sync(home.id, body.staff || [], client);
    await overrideRepo.replace(home.id, body.overrides || {}, client);
    await dayNoteRepo.replace(home.id, body.day_notes || {}, client);
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
