import { pool } from '../db.js';
import { AUDIT_TASK_TEMPLATES } from '../lib/auditTaskTemplates.js';

const REQUIRED_STAFFING_PERIODS = ['early', 'late', 'night'];
const REQUIRED_SHIFT_CODES = ['E', 'L', 'N'];
const EXPECTED_AUDIT_TEMPLATE_KEYS = AUDIT_TASK_TEMPLATES.map((template) => template.key);

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function int(value) {
  const parsed = Number.parseInt(value ?? 0, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function arrayOfStrings(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function configuredTrainingTypes(config) {
  if (!Array.isArray(config?.training_types)) return [];
  return config.training_types.filter((type) => type && type.active !== false && String(type.id || '').trim());
}

function requiredTrainingSlotCount(config, activeStaff = []) {
  const types = configuredTrainingTypes(config);
  if (types.length === 0 || activeStaff.length === 0) return 0;

  return activeStaff.reduce((total, staff) => {
    const role = staff.role || null;
    const requiredForStaff = types.filter((type) => {
      if (!Array.isArray(type.roles) || type.roles.length === 0) return true;
      return role != null && type.roles.includes(role);
    });
    return total + requiredForStaff.length;
  }, 0);
}

function staffingBaseline(config) {
  const minimum = config?.minimum_staffing || {};
  const configuredPeriods = REQUIRED_STAFFING_PERIODS.filter((period) => {
    const rule = minimum[period] || {};
    return positiveNumber(rule.heads) || positiveNumber(rule.skill_points);
  });
  const shiftCodes = config?.shifts && typeof config.shifts === 'object'
    ? Object.keys(config.shifts)
    : [];
  const presentShiftCodes = REQUIRED_SHIFT_CODES.filter((code) => config?.shifts?.[code]);

  return {
    configuredPeriods,
    missingPeriods: REQUIRED_STAFFING_PERIODS.filter((period) => !configuredPeriods.includes(period)),
    shiftCodes,
    missingShiftCodes: REQUIRED_SHIFT_CODES.filter((code) => !presentShiftCodes.includes(code)),
    hasCycleStartDate: typeof config?.cycle_start_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(config.cycle_start_date),
  };
}

function requiredModuleBaseline(config) {
  const candidates = [
    config?.required_modules,
    config?.requiredModules,
    config?.enabled_modules,
    config?.enabledModules,
  ];
  for (const value of candidates) {
    if (Array.isArray(value)) return arrayOfStrings(value);
  }

  const moduleObject = config?.modules;
  if (moduleObject && typeof moduleObject === 'object' && !Array.isArray(moduleObject)) {
    return Object.entries(moduleObject)
      .filter(([, enabled]) => enabled !== false && enabled !== 'false' && enabled != null)
      .map(([moduleId]) => moduleId);
  }
  return [];
}

function pct(value) {
  const bounded = Math.max(0, Math.min(1, Number(value) || 0));
  return Math.round(bounded * 100);
}

function check(id, label, score, missingItems, details = {}) {
  const missing = missingItems.filter(Boolean);
  return {
    id,
    label,
    complete: score >= 1,
    score,
    score_pct: pct(score),
    missing_items: missing,
    details,
  };
}

function completionFromChecks(checks) {
  const scoredChecks = checks.filter((item) => item.score !== null);
  if (scoredChecks.length === 0) return { completion_pct: 100, completed_checks: 0, total_checks: 0 };
  const total = scoredChecks.reduce((sum, item) => sum + item.score, 0);
  return {
    completion_pct: Math.round((total / scoredChecks.length) * 100),
    completed_checks: scoredChecks.filter((item) => item.complete).length,
    total_checks: scoredChecks.length,
  };
}

function buildTrainingCheck(home, facts) {
  const types = configuredTrainingTypes(home.config);
  const requiredSlots = requiredTrainingSlotCount(home.config, facts.active_staff || []);
  const missing = [];
  if (types.length === 0) missing.push('Configure at least one active mandatory training type');
  if (facts.active_staff_count > 0 && requiredSlots === 0) {
    missing.push('Training types do not apply to any active staff roles');
  }
  return check('training_baseline', 'Training baseline', types.length > 0 && (facts.active_staff_count === 0 || requiredSlots > 0) ? 1 : 0, missing, {
    active_training_types: types.length,
    required_training_slots: requiredSlots,
    active_staff_count: facts.active_staff_count,
  });
}

function buildStaffingCheck(home) {
  const baseline = staffingBaseline(home.config);
  const missing = [];
  if (baseline.missingPeriods.length > 0) {
    missing.push(`Set minimum staffing for ${baseline.missingPeriods.join(', ')}`);
  }
  if (baseline.missingShiftCodes.length > 0) {
    missing.push(`Configure shift patterns for ${baseline.missingShiftCodes.join(', ')}`);
  }
  if (!baseline.hasCycleStartDate) missing.push('Set the rota cycle start date');

  const pieces = [
    baseline.missingPeriods.length === 0,
    baseline.missingShiftCodes.length === 0,
    baseline.hasCycleStartDate,
  ];
  return check('staffing_baseline', 'Staffing baseline', pieces.filter(Boolean).length / pieces.length, missing, {
    configured_periods: baseline.configuredPeriods,
    shift_codes: baseline.shiftCodes,
    cycle_start_date: home.config?.cycle_start_date || null,
  });
}

function buildStaffRosterCheck(facts) {
  const missing = [];
  if (facts.active_staff_count <= 0) missing.push('Add at least one active staff record');
  return check('staff_roster', 'Staff roster', facts.active_staff_count > 0 ? 1 : 0, missing, {
    active_staff_count: facts.active_staff_count,
    care_staff_count: facts.care_staff_count,
  });
}

function buildOccupancyCheck(home, facts) {
  const registeredBeds = int(home.config?.registered_beds ?? home.config?.beds);
  const bedCount = int(facts.bed_count);
  const missing = [];
  if (registeredBeds <= 0) missing.push('Set registered beds in home config');
  if (bedCount <= 0) missing.push('Create bed records for occupancy tracking');
  if (registeredBeds > 0 && bedCount > 0 && bedCount !== registeredBeds) {
    missing.push(`Align bed records with registered beds (${bedCount}/${registeredBeds})`);
  }

  const score = (registeredBeds > 0 ? 0.45 : 0)
    + (bedCount > 0 ? 0.35 : 0)
    + (registeredBeds > 0 && bedCount > 0 && bedCount === registeredBeds ? 0.2 : 0);

  return check('occupancy_beds', 'Occupancy and beds', score, missing, {
    registered_beds: registeredBeds || null,
    bed_count: bedCount,
    occupied_beds: int(facts.occupied_beds),
    available_beds: int(facts.available_beds),
    occupancy_pct: bedCount > 0 ? Math.round((int(facts.occupied_beds) / bedCount) * 100) : null,
  });
}

function buildAuditCheck(facts) {
  const present = new Set(arrayOfStrings(facts.audit_template_keys));
  const missingKeys = EXPECTED_AUDIT_TEMPLATE_KEYS.filter((key) => !present.has(key));
  const missing = [];
  if (EXPECTED_AUDIT_TEMPLATE_KEYS.length > 0 && present.size === 0) {
    missing.push('Generate recurring audit tasks from templates');
  } else if (missingKeys.length > 0) {
    missing.push(`Missing ${missingKeys.length} audit task template(s)`);
  }
  const score = EXPECTED_AUDIT_TEMPLATE_KEYS.length === 0
    ? 1
    : Math.min(1, present.size / EXPECTED_AUDIT_TEMPLATE_KEYS.length);
  return check('audit_templates_tasks', 'Audit templates and tasks', score, missing, {
    expected_template_count: EXPECTED_AUDIT_TEMPLATE_KEYS.length,
    configured_template_count: present.size,
    task_count: int(facts.audit_task_count),
    missing_template_keys: missingKeys,
  });
}

function buildUsersCheck(facts) {
  const missing = [];
  if (facts.assigned_user_count <= 0) missing.push('Assign at least one active user to the home');
  return check('users_assigned', 'Users assigned', facts.assigned_user_count > 0 ? 1 : 0, missing, {
    assigned_user_count: facts.assigned_user_count,
  });
}

function buildModulesCheck(home) {
  const modules = requiredModuleBaseline(home.config);
  return check('required_modules', 'Required modules', modules.length > 0 ? 1 : 0, modules.length > 0 ? [] : ['No required module baseline is configured'], {
    required_modules: modules,
  });
}

function buildEvidenceCheck(facts) {
  const manual = int(facts.cqc_evidence_count);
  const linked = int(facts.cqc_evidence_link_count);
  const statementCount = int(facts.cqc_evidence_statement_count);
  const missing = [];
  if (manual + linked <= 0) missing.push('Add at least one CQC evidence item or linked evidence record');
  return check('evidence_baseline', 'Evidence baseline', manual + linked > 0 ? 1 : 0, missing, {
    cqc_evidence_count: manual,
    linked_evidence_count: linked,
    covered_quality_statements: statementCount,
  });
}

export function buildHomeSetupCompleteness(home, facts = {}) {
  const safeFacts = {
    active_staff: [],
    active_staff_count: 0,
    care_staff_count: 0,
    bed_count: 0,
    occupied_beds: 0,
    available_beds: 0,
    audit_template_keys: [],
    audit_task_count: 0,
    assigned_user_count: 0,
    cqc_evidence_count: 0,
    cqc_evidence_link_count: 0,
    cqc_evidence_statement_count: 0,
    ...facts,
  };
  const checks = [
    buildTrainingCheck(home, safeFacts),
    buildStaffingCheck(home),
    buildStaffRosterCheck(safeFacts),
    buildOccupancyCheck(home, safeFacts),
    buildAuditCheck(safeFacts),
    buildUsersCheck(safeFacts),
    buildModulesCheck(home),
    buildEvidenceCheck(safeFacts),
  ];
  const completion = completionFromChecks(checks);
  const missingItems = checks.flatMap((item) => item.missing_items);

  return {
    home_id: home.id,
    home_slug: home.slug,
    home_name: home.config?.home_name || home.name,
    role_id: home.role_id || null,
    ...completion,
    missing_items: missingItems,
    checks: Object.fromEntries(checks.map((item) => [item.id, item])),
  };
}

async function getAccessibleHomes(username, isPlatformAdmin) {
  if (isPlatformAdmin) {
    const { rows } = await pool.query(
      `SELECT id, slug, name, config, 'platform_admin' AS role_id
         FROM homes
        WHERE deleted_at IS NULL
        ORDER BY name`,
    );
    return rows;
  }

  const { rows } = await pool.query(
    `SELECT h.id, h.slug, h.name, h.config, uhr.role_id
       FROM user_home_roles uhr
       JOIN homes h ON h.id = uhr.home_id AND h.deleted_at IS NULL
       JOIN users u ON u.username = uhr.username AND u.active = true
      WHERE uhr.username = $1
      ORDER BY h.name`,
    [normalizeUsername(username)],
  );
  return rows;
}

function rowsByHome(rows, shape) {
  const map = new Map();
  for (const row of rows) {
    map.set(row.home_id, shape(row));
  }
  return map;
}

async function querySetupFacts(homeIds) {
  if (homeIds.length === 0) return new Map();

  const [
    staffResult,
    bedResult,
    auditResult,
    userResult,
    evidenceResult,
  ] = await Promise.all([
    pool.query(
      `SELECT home_id,
              COUNT(*) FILTER (WHERE active = true)::int AS active_staff_count,
              COUNT(*) FILTER (
                WHERE active = true
                  AND role IN ('Carer', 'Night Carer', 'Float Carer', 'Senior Carer', 'Night Senior', 'Float Senior', 'Team Lead')
              )::int AS care_staff_count,
              COALESCE(
                jsonb_agg(jsonb_build_object('id', id, 'role', role) ORDER BY id)
                  FILTER (WHERE active = true),
                '[]'::jsonb
              ) AS active_staff
         FROM staff
        WHERE home_id = ANY($1::int[])
          AND deleted_at IS NULL
        GROUP BY home_id`,
      [homeIds],
    ),
    pool.query(
      `SELECT home_id,
              COUNT(*)::int AS bed_count,
              COUNT(*) FILTER (WHERE status = 'occupied')::int AS occupied_beds,
              COUNT(*) FILTER (WHERE status = 'available')::int AS available_beds
         FROM beds
        WHERE home_id = ANY($1::int[])
        GROUP BY home_id`,
      [homeIds],
    ),
    pool.query(
      `SELECT home_id,
              COUNT(*)::int AS audit_task_count,
              COALESCE(
                array_agg(DISTINCT template_key) FILTER (WHERE template_key IS NOT NULL),
                ARRAY[]::text[]
              ) AS audit_template_keys
         FROM audit_tasks
        WHERE home_id = ANY($1::int[])
          AND deleted_at IS NULL
        GROUP BY home_id`,
      [homeIds],
    ),
    pool.query(
      `SELECT uhr.home_id,
              COUNT(DISTINCT uhr.username)::int AS assigned_user_count
         FROM user_home_roles uhr
         JOIN users u ON u.username = uhr.username AND u.active = true
        WHERE uhr.home_id = ANY($1::int[])
        GROUP BY uhr.home_id`,
      [homeIds],
    ),
    pool.query(
      `WITH manual AS (
         SELECT home_id,
                COUNT(*)::int AS cqc_evidence_count,
                COUNT(DISTINCT quality_statement) FILTER (WHERE quality_statement IS NOT NULL)::int AS manual_statement_count
           FROM cqc_evidence
          WHERE home_id = ANY($1::int[])
            AND deleted_at IS NULL
          GROUP BY home_id
       ),
       linked AS (
         SELECT home_id,
                COUNT(*)::int AS cqc_evidence_link_count,
                COUNT(DISTINCT quality_statement) FILTER (WHERE quality_statement IS NOT NULL)::int AS linked_statement_count
           FROM cqc_evidence_links
          WHERE home_id = ANY($1::int[])
            AND deleted_at IS NULL
          GROUP BY home_id
       )
       SELECT COALESCE(m.home_id, l.home_id) AS home_id,
              COALESCE(m.cqc_evidence_count, 0)::int AS cqc_evidence_count,
              COALESCE(l.cqc_evidence_link_count, 0)::int AS cqc_evidence_link_count,
              (COALESCE(m.manual_statement_count, 0) + COALESCE(l.linked_statement_count, 0))::int AS cqc_evidence_statement_count
         FROM manual m
         FULL OUTER JOIN linked l ON l.home_id = m.home_id`,
      [homeIds],
    ),
  ]);

  const staff = rowsByHome(staffResult.rows, (row) => ({
    active_staff_count: int(row.active_staff_count),
    care_staff_count: int(row.care_staff_count),
    active_staff: Array.isArray(row.active_staff) ? row.active_staff : [],
  }));
  const beds = rowsByHome(bedResult.rows, (row) => ({
    bed_count: int(row.bed_count),
    occupied_beds: int(row.occupied_beds),
    available_beds: int(row.available_beds),
  }));
  const audits = rowsByHome(auditResult.rows, (row) => ({
    audit_task_count: int(row.audit_task_count),
    audit_template_keys: arrayOfStrings(row.audit_template_keys),
  }));
  const users = rowsByHome(userResult.rows, (row) => ({
    assigned_user_count: int(row.assigned_user_count),
  }));
  const evidence = rowsByHome(evidenceResult.rows, (row) => ({
    cqc_evidence_count: int(row.cqc_evidence_count),
    cqc_evidence_link_count: int(row.cqc_evidence_link_count),
    cqc_evidence_statement_count: int(row.cqc_evidence_statement_count),
  }));

  const facts = new Map();
  for (const homeId of homeIds) {
    facts.set(homeId, {
      ...(staff.get(homeId) || {}),
      ...(beds.get(homeId) || {}),
      ...(audits.get(homeId) || {}),
      ...(users.get(homeId) || {}),
      ...(evidence.get(homeId) || {}),
    });
  }
  return facts;
}

function buildSummary(homes) {
  const homeCount = homes.length;
  const average = homeCount > 0
    ? Math.round(homes.reduce((sum, home) => sum + home.completion_pct, 0) / homeCount)
    : 100;
  return {
    home_count: homeCount,
    average_completion_pct: average,
    complete_homes: homes.filter((home) => home.completion_pct === 100).length,
    incomplete_homes: homes.filter((home) => home.completion_pct < 100).length,
  };
}

export async function getHomeSetupCompletenessForUser({ username, isPlatformAdmin = false } = {}) {
  const homes = await getAccessibleHomes(username, isPlatformAdmin);
  const homeIds = homes.map((home) => home.id);
  const facts = await querySetupFacts(homeIds);
  const rows = homes
    .map((home) => buildHomeSetupCompleteness(home, facts.get(home.id) || {}))
    .sort((a, b) => a.completion_pct - b.completion_pct || String(a.home_name).localeCompare(String(b.home_name)));

  return {
    generated_at: new Date().toISOString(),
    summary: buildSummary(rows),
    homes: rows,
  };
}

export const _private = {
  configuredTrainingTypes,
  requiredTrainingSlotCount,
  staffingBaseline,
  requiredModuleBaseline,
};
