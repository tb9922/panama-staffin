import { calculateEscalationLevel } from '../lib/actionItems.js';
import * as actionItemRepo from '../repositories/actionItemRepo.js';

const AGENCY_OVERRIDE_ACTION_KEY = 'emergency_override_review';

function dateOnly(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function compactLines(lines) {
  return lines.filter(Boolean).join('\n');
}

function agencyOverridePriority(attempt) {
  if (Number(attempt.viable_internal_candidate_count || 0) > 0) return 'critical';
  if (!attempt.linked_agency_shift_id) return 'high';
  return 'medium';
}

export function buildAgencyOverrideAction(attempt, { actorId = null, today = new Date() } = {}) {
  if (!attempt?.emergency_override) return null;

  const dueDate = dateOnly(attempt.gap_date);
  const priority = agencyOverridePriority(attempt);
  const shiftLabel = [attempt.shift_code, attempt.role_needed].filter(Boolean).join(' ');
  const titleSuffix = shiftLabel || `attempt ${attempt.id}`;

  return {
    source_type: 'agency_approval_attempt',
    source_id: String(attempt.id),
    source_action_key: AGENCY_OVERRIDE_ACTION_KEY,
    title: `Review emergency agency override: ${titleSuffix}`.slice(0, 300),
    description: compactLines([
      attempt.reason ? `Reason: ${attempt.reason}` : null,
      attempt.emergency_override_reason ? `Override rationale: ${attempt.emergency_override_reason}` : null,
      attempt.gap_date ? `Gap date: ${dateOnly(attempt.gap_date)}` : null,
      attempt.shift_code ? `Shift: ${attempt.shift_code}` : null,
      attempt.role_needed ? `Role needed: ${attempt.role_needed}` : null,
      `Internal bank candidates: ${Number(attempt.internal_bank_candidate_count || 0)}`,
      `Viable internal candidates: ${Number(attempt.viable_internal_candidate_count || 0)}`,
      attempt.linked_agency_shift_id ? `Linked agency shift: ${attempt.linked_agency_shift_id}` : 'No linked agency shift recorded',
    ]),
    category: 'staffing',
    priority,
    owner_role: 'Home manager',
    due_date: dueDate,
    status: 'open',
    evidence_required: true,
    escalation_level: calculateEscalationLevel({
      dueDate,
      status: 'open',
      priority,
      today,
    }),
    created_by: actorId,
    updated_by: actorId,
  };
}

export async function ensureAgencyOverrideAction(homeId, attempt, options = {}, client) {
  const action = buildAgencyOverrideAction(attempt, options);
  if (!action) {
    if (attempt?.id == null) return { item: null, created: false, skipped: true };
    return {
      ...(await actionItemRepo.cancelBySource(
        homeId,
        'agency_approval_attempt',
        String(attempt.id),
        AGENCY_OVERRIDE_ACTION_KEY,
        options.actorId ?? null,
        client,
      )),
      created: false,
      skipped: true,
    };
  }
  return actionItemRepo.syncBySource(homeId, action, options.actorId ?? null, client);
}
