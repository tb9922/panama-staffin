import { pool } from '../db.js';
import { toIsoOrNull } from '../lib/serverTimestamps.js';
import { hasModuleAccess } from '../shared/roles.js';

export const OPERATIONAL_REVIEW_TYPES = [
  'overdue_escalation',
  'emergency_agency_override',
  'unverified_completed_action',
  'evidence_missing',
  'manager_sign_off_required',
];

export const OPERATIONAL_REVIEW_SEVERITIES = ['critical', 'high', 'medium', 'low'];

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

const SEVERITY_RANK = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const TYPE_LABELS = {
  overdue_escalation: 'Overdue escalation',
  emergency_agency_override: 'Emergency agency override review',
  unverified_completed_action: 'Unverified completed action',
  evidence_missing: 'Evidence missing',
  manager_sign_off_required: 'Manager sign-off required',
};

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function clampLimit(limit) {
  const parsed = parseInt(limit ?? DEFAULT_LIMIT, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function intOrNull(value) {
  return value == null ? null : parseInt(value, 10);
}

function homeFromRow(row) {
  return {
    id: intOrNull(row.home_id),
    slug: row.home_slug,
    name: row.home_name || row.home_slug,
  };
}

function ownerLabel(row, fallback = 'Unassigned') {
  return firstText(row.owner_display_name, row.owner_username, row.owner_name, row.owner_role, row.evidence_owner) || fallback;
}

function actionSeverity(priority, escalationLevel = 0) {
  if (priority === 'critical' || Number(escalationLevel || 0) >= 4) return 'critical';
  if (priority === 'high' || Number(escalationLevel || 0) >= 3) return 'high';
  if (priority === 'medium' || Number(escalationLevel || 0) >= 1) return 'medium';
  return 'low';
}

function agencySeverity(row) {
  if (Number(row.viable_internal_candidate_count || 0) > 0) return 'critical';
  if (!row.linked_agency_shift_id) return 'high';
  return 'medium';
}

function signOffSeverity(row) {
  const band = String(row.band || '').toLowerCase();
  if (band.includes('red') || band.includes('not_ready') || Number(row.overall_score || 100) < 60) return 'high';
  return 'medium';
}

function baseItem(row, overrides) {
  const type = overrides.type;
  const reviewDate = overrides.review_date || null;
  return {
    id: `${type}:${row.source_kind || overrides.source_kind}:${row.home_id}:${row.source_id}`,
    type,
    type_label: TYPE_LABELS[type],
    severity: overrides.severity,
    home: homeFromRow(row),
    title: overrides.title,
    owner_label: overrides.owner_label,
    actionable_label: overrides.actionable_label,
    due_date: overrides.due_date || null,
    review_date: reviewDate,
    display_date: reviewDate || overrides.due_date || null,
    source: {
      module: overrides.module,
      kind: row.source_kind || overrides.source_kind,
      id: String(row.source_id),
      label: overrides.source_label,
    },
    link_target: overrides.link_target,
    meta: overrides.meta || {},
  };
}

function buildLink(row, { path, module, label, query = {} }) {
  return {
    path,
    module,
    label,
    home_id: intOrNull(row.home_id),
    home_slug: row.home_slug,
    source_kind: row.source_kind,
    source_id: String(row.source_id),
    query,
  };
}

function shapeOverdueAction(row) {
  return baseItem(row, {
    type: 'overdue_escalation',
    source_kind: 'action_item',
    severity: actionSeverity(row.priority, row.escalation_level),
    title: row.title || 'Overdue manager action',
    owner_label: ownerLabel(row, 'Action owner unassigned'),
    actionable_label: `Escalation L${Number(row.escalation_level || 0)}`,
    due_date: dateOnly(row.due_date),
    source_label: row.source_type || 'action_item',
    module: 'governance',
    link_target: buildLink(row, { path: '/actions', module: 'governance', label: 'Open manager action' }),
    meta: {
      priority: row.priority,
      status: row.status,
      escalation_level: intOrNull(row.escalation_level) || 0,
      source_type: row.source_type,
      source_action_key: row.source_action_key,
    },
  });
}

function shapeAgencyOverride(row) {
  return baseItem(row, {
    type: 'emergency_agency_override',
    source_kind: 'agency_approval_attempt',
    severity: agencySeverity(row),
    title: row.reason || `${row.shift_code || 'Agency'} emergency override`,
    owner_label: ownerLabel(row, 'Payroll or rota lead'),
    actionable_label: 'Review override rationale',
    review_date: dateOnly(row.gap_date),
    source_label: 'agency_approval_attempt',
    module: 'payroll',
    link_target: buildLink(row, { path: '/payroll/agency', module: 'payroll', label: 'Open agency tracker' }),
    meta: {
      shift_code: row.shift_code,
      role_needed: row.role_needed,
      outcome: row.outcome,
      internal_bank_candidate_count: intOrNull(row.internal_bank_candidate_count) || 0,
      viable_internal_candidate_count: intOrNull(row.viable_internal_candidate_count) || 0,
      linked_agency_shift_id: intOrNull(row.linked_agency_shift_id),
    },
  });
}

function shapeUnverified(row) {
  const isAuditTask = row.source_kind === 'audit_task';
  return baseItem(row, {
    type: 'unverified_completed_action',
    severity: row.priority ? actionSeverity(row.priority, row.escalation_level) : 'medium',
    title: row.title || (isAuditTask ? 'Completed audit task' : 'Completed action'),
    owner_label: ownerLabel(row, isAuditTask ? 'QA reviewer' : 'Verifier unassigned'),
    actionable_label: isAuditTask ? 'QA sign-off required' : 'Verification required',
    review_date: dateOnly(row.completed_at || row.due_date),
    due_date: dateOnly(row.due_date),
    source_label: isAuditTask ? 'audit_task' : 'action_item',
    module: 'governance',
    link_target: buildLink(row, {
      path: isAuditTask ? '/audit-calendar' : '/actions',
      module: 'governance',
      label: isAuditTask ? 'Open audit task' : 'Open manager action',
    }),
    meta: {
      priority: row.priority || null,
      status: row.status,
      evidence_required: Boolean(row.evidence_required),
      completed_at: toIsoOrNull(row.completed_at),
    },
  });
}

function shapeEvidenceMissing(row) {
  return baseItem(row, {
    type: 'evidence_missing',
    source_kind: 'audit_task',
    severity: row.status === 'verified' ? 'high' : 'medium',
    title: row.title || 'Audit task evidence missing',
    owner_label: ownerLabel(row, 'Evidence owner unassigned'),
    actionable_label: 'Attach or record evidence',
    review_date: dateOnly(row.completed_at || row.due_date),
    due_date: dateOnly(row.due_date),
    source_label: 'audit_task',
    module: 'governance',
    link_target: buildLink(row, { path: '/audit-calendar', module: 'governance', label: 'Open audit calendar' }),
    meta: {
      status: row.status,
      evidence_required: Boolean(row.evidence_required),
      completed_at: toIsoOrNull(row.completed_at),
      qa_signed_off_at: toIsoOrNull(row.qa_signed_off_at),
    },
  });
}

function shapeSignOff(row) {
  const isAuditTask = row.source_kind === 'audit_task';
  const path = isAuditTask ? '/audit-calendar' : (row.engine === 'gdpr' ? '/gdpr' : '/cqc');
  const module = isAuditTask ? 'governance' : (row.engine === 'gdpr' ? 'gdpr' : 'compliance');
  return baseItem(row, {
    type: 'manager_sign_off_required',
    severity: isAuditTask ? 'high' : signOffSeverity(row),
    title: row.title || `${String(row.engine || 'assessment').toUpperCase()} assessment snapshot`,
    owner_label: isAuditTask ? ownerLabel(row, 'Home manager') : firstText(row.computed_by, 'Assessment reviewer'),
    actionable_label: 'Manager sign-off required',
    review_date: dateOnly(row.review_at || row.completed_at || row.computed_at),
    due_date: dateOnly(row.due_date),
    source_label: isAuditTask ? 'audit_task' : 'assessment_snapshot',
    module,
    link_target: buildLink(row, {
      path,
      module,
      label: isAuditTask ? 'Open audit calendar' : 'Open assessment',
      query: row.engine ? { engine: row.engine } : {},
    }),
    meta: {
      engine: row.engine || null,
      band: row.band || null,
      overall_score: row.overall_score == null ? null : Number(row.overall_score),
      computed_by: row.computed_by || null,
    },
  });
}

function typeTotal(rows) {
  const first = rows.find(row => row._type_total != null);
  return first ? parseInt(first._type_total, 10) : rows.length;
}

function canReadHomeModule(home, moduleId, isPlatformAdmin = false) {
  if (isPlatformAdmin) return true;
  if (!home?.role_id || !moduleId) return false;
  return hasModuleAccess(home.role_id, moduleId, 'read', { includeOwn: false });
}

function homeIdsForModule(homes, moduleId, isPlatformAdmin = false) {
  return homes
    .filter(home => canReadHomeModule(home, moduleId, isPlatformAdmin))
    .map(home => home.id)
    .filter(Number.isFinite);
}

function homeIdsForAnyModule(homes, moduleIds, isPlatformAdmin = false) {
  return homes
    .filter(home => moduleIds.some(moduleId => canReadHomeModule(home, moduleId, isPlatformAdmin)))
    .map(home => home.id)
    .filter(Number.isFinite);
}

function filterItemsByModule(items, homes, isPlatformAdmin = false) {
  if (isPlatformAdmin) return items;
  const homeById = new Map(homes.map(home => [Number(home.id), home]));
  return items.filter((item) => canReadHomeModule(
    homeById.get(Number(item.home?.id)),
    item.source?.module || item.link_target?.module,
    false,
  ));
}

async function queryOverdueActions(homeIds, limit, client) {
  const { rows } = await client.query(
    `SELECT ai.id AS source_id, ai.home_id, h.slug AS home_slug,
            COALESCE(h.config->>'home_name', h.name) AS home_name,
            'action_item' AS source_kind,
            ai.title, ai.priority, ai.status, ai.due_date, ai.escalation_level,
            ai.source_type, ai.source_action_key, ai.owner_name, ai.owner_role,
            u.display_name AS owner_display_name, u.username AS owner_username,
            COUNT(*) OVER() AS _type_total
       FROM action_items ai
       JOIN homes h ON h.id = ai.home_id AND h.deleted_at IS NULL
       LEFT JOIN users u ON u.id = ai.owner_user_id
      WHERE ai.home_id = ANY($1::int[])
        AND ai.deleted_at IS NULL
        AND ai.status NOT IN ('completed', 'verified', 'cancelled')
        AND ai.due_date < CURRENT_DATE
      ORDER BY ai.due_date ASC,
               ai.escalation_level DESC,
               CASE ai.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
               ai.id DESC
      LIMIT $2`,
    [homeIds, limit],
  );
  return { rows, items: rows.map(shapeOverdueAction), total: typeTotal(rows) };
}

async function queryAgencyOverrides(homeIds, limit, client) {
  const { rows } = await client.query(
    `SELECT a.id AS source_id, a.home_id, h.slug AS home_slug,
            COALESCE(h.config->>'home_name', h.name) AS home_name,
            'agency_approval_attempt' AS source_kind,
            a.gap_date, a.shift_code, a.role_needed, a.reason, a.outcome,
            a.internal_bank_candidate_count, a.viable_internal_candidate_count,
            a.linked_agency_shift_id,
            u.display_name AS owner_display_name, u.username AS owner_username,
            COUNT(*) OVER() AS _type_total
       FROM agency_approval_attempts a
       JOIN homes h ON h.id = a.home_id AND h.deleted_at IS NULL
       LEFT JOIN users u ON u.id = a.checked_by
      WHERE a.home_id = ANY($1::int[])
        AND a.deleted_at IS NULL
        AND a.emergency_override = true
        AND a.gap_date >= CURRENT_DATE - INTERVAL '35 days'
        AND a.gap_date <= CURRENT_DATE
      ORDER BY a.gap_date DESC, a.id DESC
      LIMIT $2`,
    [homeIds, limit],
  );
  return { rows, items: rows.map(shapeAgencyOverride), total: typeTotal(rows) };
}

async function queryUnverifiedCompleted(homeIds, limit, client) {
  const { rows } = await client.query(
    `WITH candidates AS (
       SELECT ai.id AS source_id, ai.home_id, h.slug AS home_slug,
              COALESCE(h.config->>'home_name', h.name) AS home_name,
              'action_item' AS source_kind,
              ai.title, ai.priority, ai.status, ai.due_date, ai.completed_at,
              ai.escalation_level, ai.evidence_required,
              ai.owner_name, ai.owner_role,
              u.display_name AS owner_display_name, u.username AS owner_username
         FROM action_items ai
         JOIN homes h ON h.id = ai.home_id AND h.deleted_at IS NULL
         LEFT JOIN users u ON u.id = ai.owner_user_id
        WHERE ai.home_id = ANY($1::int[])
          AND ai.deleted_at IS NULL
          AND ai.status = 'completed'
          AND ai.verified_at IS NULL
       UNION ALL
       SELECT at.id AS source_id, at.home_id, h.slug AS home_slug,
              COALESCE(h.config->>'home_name', h.name) AS home_name,
              'audit_task' AS source_kind,
              at.title, NULL::text AS priority, at.status, at.due_date, at.completed_at,
              NULL::int AS escalation_level, at.evidence_required,
              NULL::text AS owner_name, NULL::text AS owner_role,
              u.display_name AS owner_display_name, u.username AS owner_username
         FROM audit_tasks at
         JOIN homes h ON h.id = at.home_id AND h.deleted_at IS NULL
         LEFT JOIN users u ON u.id = at.owner_user_id
        WHERE at.home_id = ANY($1::int[])
          AND at.deleted_at IS NULL
          AND at.status = 'completed'
          AND at.qa_signed_off_at IS NULL
     )
     SELECT *, COUNT(*) OVER() AS _type_total
       FROM candidates
      ORDER BY completed_at ASC NULLS LAST, due_date ASC NULLS LAST, source_id DESC
      LIMIT $2`,
    [homeIds, limit],
  );
  return { rows, items: rows.map(shapeUnverified), total: typeTotal(rows) };
}

async function queryEvidenceMissing(homeIds, limit, client) {
  const { rows } = await client.query(
    `SELECT at.id AS source_id, at.home_id, h.slug AS home_slug,
            COALESCE(h.config->>'home_name', h.name) AS home_name,
            'audit_task' AS source_kind,
            at.title, at.status, at.due_date, at.completed_at, at.evidence_required,
            at.qa_signed_off_at,
            u.display_name AS owner_display_name, u.username AS owner_username,
            COUNT(*) OVER() AS _type_total
       FROM audit_tasks at
       JOIN homes h ON h.id = at.home_id AND h.deleted_at IS NULL
       LEFT JOIN users u ON u.id = at.owner_user_id
      WHERE at.home_id = ANY($1::int[])
        AND at.deleted_at IS NULL
        AND at.evidence_required = true
        AND at.status IN ('completed', 'verified')
        AND (at.evidence_notes IS NULL OR btrim(at.evidence_notes) = '')
      ORDER BY at.completed_at ASC NULLS LAST, at.due_date ASC, at.id DESC
      LIMIT $2`,
    [homeIds, limit],
  );
  return { rows, items: rows.map(shapeEvidenceMissing), total: typeTotal(rows) };
}

async function queryManagerSignOff(homeIds, limit, client) {
  const { rows } = await client.query(
    `WITH candidates AS (
       SELECT at.id AS source_id, at.home_id, h.slug AS home_slug,
              COALESCE(h.config->>'home_name', h.name) AS home_name,
              'audit_task' AS source_kind,
              at.title, NULL::text AS engine, NULL::text AS band,
              NULL::numeric AS overall_score, NULL::text AS computed_by,
              at.due_date, at.completed_at, NULL::timestamptz AS computed_at,
              at.completed_at AS review_at,
              u.display_name AS owner_display_name, u.username AS owner_username
         FROM audit_tasks at
         JOIN homes h ON h.id = at.home_id AND h.deleted_at IS NULL
         LEFT JOIN users u ON u.id = at.owner_user_id
        WHERE at.home_id = ANY($1::int[])
          AND at.deleted_at IS NULL
          AND at.status = 'completed'
          AND at.manager_signed_off_at IS NULL
       UNION ALL
       SELECT s.id AS source_id, s.home_id, h.slug AS home_slug,
              COALESCE(h.config->>'home_name', h.name) AS home_name,
              'assessment_snapshot' AS source_kind,
              concat(upper(s.engine), ' assessment snapshot') AS title,
              s.engine, s.band, s.overall_score, s.computed_by,
              NULL::date AS due_date, NULL::timestamptz AS completed_at,
              s.computed_at, s.computed_at AS review_at,
              NULL::text AS owner_display_name, NULL::text AS owner_username
         FROM assessment_snapshots s
         JOIN homes h ON h.id = s.home_id AND h.deleted_at IS NULL
        WHERE s.home_id = ANY($1::int[])
          AND s.signed_off_by IS NULL
     )
     SELECT *, COUNT(*) OVER() AS _type_total
       FROM candidates
      ORDER BY review_at ASC NULLS LAST, source_id DESC
      LIMIT $2`,
    [homeIds, limit],
  );
  return { rows, items: rows.map(shapeSignOff), total: typeTotal(rows) };
}

function sortItems(items) {
  return [...items].sort((a, b) => (
    (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99)
    || String(a.display_date || '9999-12-31').localeCompare(String(b.display_date || '9999-12-31'))
    || String(a.home?.name || '').localeCompare(String(b.home?.name || ''))
    || String(a.title || '').localeCompare(String(b.title || ''))
  ));
}

export async function getAccessibleOperationalReviewHomes({ username, isPlatformAdmin = false } = {}, client = pool) {
  if (isPlatformAdmin) {
    const { rows } = await client.query(
      `SELECT h.id, h.slug, COALESCE(h.config->>'home_name', h.name) AS name,
              'platform_admin' AS role_id
         FROM homes h
        WHERE h.deleted_at IS NULL
        ORDER BY name`,
    );
    return rows.map(row => ({
      id: intOrNull(row.id),
      slug: row.slug,
      name: row.name || row.slug,
      role_id: row.role_id,
    }));
  }

  const normalized = normalizeUsername(username);
  if (!normalized) return [];

  const { rows } = await client.query(
    `SELECT h.id, h.slug, COALESCE(h.config->>'home_name', h.name) AS name,
            uhr.role_id
       FROM user_home_roles uhr
       JOIN users u ON u.username = uhr.username AND u.active = true
       JOIN homes h ON h.id = uhr.home_id AND h.deleted_at IS NULL
      WHERE uhr.username = $1
      ORDER BY name`,
    [normalized],
  );
  return rows.map(row => ({
    id: intOrNull(row.id),
    slug: row.slug,
    name: row.name || row.slug,
    role_id: row.role_id,
  }));
}

export async function getOperationalReviewQueueForUser(options = {}, client = pool) {
  const {
    username,
    isPlatformAdmin = false,
    type,
    severity,
    limit: requestedLimit,
  } = options;
  const limit = clampLimit(requestedLimit);
  const homes = await getAccessibleOperationalReviewHomes({ username, isPlatformAdmin }, client);
  const governanceHomeIds = homeIdsForModule(homes, 'governance', isPlatformAdmin);
  const payrollHomeIds = homeIdsForModule(homes, 'payroll', isPlatformAdmin);
  const signOffHomeIds = homeIdsForAnyModule(homes, ['governance', 'compliance', 'gdpr'], isPlatformAdmin);
  const allVisibleHomeIds = [...new Set([...governanceHomeIds, ...payrollHomeIds, ...signOffHomeIds])];

  const emptySummary = Object.fromEntries(OPERATIONAL_REVIEW_TYPES.map(reviewType => [reviewType, 0]));
  if (allVisibleHomeIds.length === 0) {
    return {
      generated_at: new Date().toISOString(),
      homes,
      summary: {
        total: 0,
        by_type: emptySummary,
        by_severity: Object.fromEntries(OPERATIONAL_REVIEW_SEVERITIES.map(level => [level, 0])),
      },
      items: [],
      _total: 0,
    };
  }

  const perTypeLimit = Math.max(limit, 50);
  const queries = await Promise.all([
    governanceHomeIds.length ? queryOverdueActions(governanceHomeIds, perTypeLimit, client) : { rows: [], items: [], total: 0 },
    payrollHomeIds.length ? queryAgencyOverrides(payrollHomeIds, perTypeLimit, client) : { rows: [], items: [], total: 0 },
    governanceHomeIds.length ? queryUnverifiedCompleted(governanceHomeIds, perTypeLimit, client) : { rows: [], items: [], total: 0 },
    governanceHomeIds.length ? queryEvidenceMissing(governanceHomeIds, perTypeLimit, client) : { rows: [], items: [], total: 0 },
    signOffHomeIds.length ? queryManagerSignOff(signOffHomeIds, Math.max(perTypeLimit * 3, 150), client) : { rows: [], items: [], total: 0 },
  ]);

  const scopedQueries = queries.map(result => ({
    ...result,
    items: filterItemsByModule(result.items, homes, isPlatformAdmin),
  }));

  const byType = { ...emptySummary };
  for (const [index, result] of scopedQueries.entries()) {
    byType[OPERATIONAL_REVIEW_TYPES[index]] = result.items.length;
  }

  let items = scopedQueries.flatMap(result => result.items);
  if (type) items = items.filter(item => item.type === type);
  if (severity) items = items.filter(item => item.severity === severity);
  const sorted = sortItems(items);
  const limited = sorted.slice(0, limit);

  const bySeverity = Object.fromEntries(OPERATIONAL_REVIEW_SEVERITIES.map(level => [level, 0]));
  for (const item of sorted) {
    bySeverity[item.severity] = (bySeverity[item.severity] || 0) + 1;
  }

  return {
    generated_at: new Date().toISOString(),
    homes,
    summary: {
      total: Object.values(byType).reduce((sum, value) => sum + Number(value || 0), 0),
      by_type: byType,
      by_severity: bySeverity,
    },
    items: limited,
    _total: sorted.length,
  };
}
