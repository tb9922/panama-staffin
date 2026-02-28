/**
 * Shared audit utilities — field-diff detection and audit+diff convenience wrapper.
 *
 * Extracted from lib/hrFieldMappers.js so all modules (not just HR) can use it.
 */

const SKIP_FIELDS = new Set([
  'updated_at', 'version', 'created_at', 'created_by', 'home_id',
]);

/**
 * Compare two record snapshots and return an array of changed fields.
 *
 * @param {object|null} before — record state before the update
 * @param {object}      after  — record state after the update
 * @returns {Array<{ field: string, old: *, new: * }>}
 */
export function diffFields(before, after) {
  if (!after) return [];
  const changes = [];
  for (const key of Object.keys(after)) {
    if (SKIP_FIELDS.has(key)) continue;
    const oldVal = before?.[key];
    const newVal = after[key];
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changes.push({ field: key, old: oldVal, new: newVal });
    }
  }
  // Detect removed fields (present in before but absent in after)
  if (before) {
    for (const key of Object.keys(before)) {
      if (SKIP_FIELDS.has(key) || key in after) continue;
      changes.push({ field: key, old: before[key], new: undefined });
    }
  }
  return changes;
}

/**
 * Convenience: compute diff then write an audit log entry in one call.
 *
 * @param {object} auditService — the auditService module (has .log())
 * @param {string} action       — e.g. "ipc_update"
 * @param {string} homeSlug
 * @param {string} username
 * @param {*}      id           — record ID
 * @param {object|null} before  — record before update
 * @param {object}      after   — record after update
 */
export async function auditWithDiff(auditService, action, homeSlug, username, id, before, after) {
  const changes = diffFields(before, after);
  await auditService.log(action, homeSlug, username, { id, changes });
}
