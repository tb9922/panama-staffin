/**
 * Shared audit utilities — field-diff detection and audit+diff convenience wrapper.
 *
 * Extracted from lib/hrFieldMappers.js so all modules (not just HR) can use it.
 */

const SKIP_FIELDS = new Set([
  'updated_at', 'version', 'created_at', 'created_by', 'home_id',
]);

// PII/sensitive fields — log that they changed but redact actual values.
// Prevents personal data from leaking into audit_log entries.
const SENSITIVE_FIELDS = new Set([
  'ni_number', 'date_of_birth', 'hourly_rate', 'contract_hours',
  'password_hash', 'secret', 'secret_encrypted', 'secret_iv', 'secret_tag',
  'ni_category', 'tax_code', 'student_loan_plan', 'bank_details',
  'allegation_detail', 'investigation_notes', 'investigation_findings',
  'hearing_notes', 'hearing_employee_response', 'outcome_reason',
  'appeal_grounds', 'appeal_outcome_reason', 'suspension_reason',
  'subject_detail', 'desired_outcome', 'employee_statement_at_hearing',
  'concern_detail', 'informal_discussion_notes',
  'reason', 'questions_for_oh', 'report_summary',
  'adjustments_recommended', 'adjustments_implemented',
  'condition_description', 'description',
  'person_affected_name', 'raised_by_name', 'witnesses',
  'msp_outcome_preferences', 'msp_person_involved',
  // DoLS/MCA — GDPR Article 9 special category (mental capacity)
  'dob', 'resident_name', 'room_number', 'best_interest_decision',
  'restrictions', 'decision_area', 'lacks_capacity',
  // HR — health data (Article 9) and sensitive employment records
  'exit_interview_notes', 'underlying_condition', 'adjustments_detail',
  'fit_note_adjustments', 'fit_note_type',
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
      if (SENSITIVE_FIELDS.has(key)) {
        changes.push({ field: key, old: '[REDACTED]', new: '[REDACTED]' });
      } else {
        changes.push({ field: key, old: oldVal, new: newVal });
      }
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
