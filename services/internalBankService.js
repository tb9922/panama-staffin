import { pool } from '../db.js';
import * as overrideRepo from '../repositories/overrideRepo.js';
import * as onboardingRepo from '../repositories/onboardingRepo.js';
import { hasModuleAccess } from '../shared/roles.js';
import {
  evaluateInternalBankTrainingEligibility,
  INTERNAL_BANK_BLOCKING_TRAINING_TYPE_IDS,
} from '../lib/trainingEligibility.js';
import {
  checkWTRImpact,
  getActualShift,
  isWorkingShift,
  parseDate,
} from '../shared/rotation.js';

const STAFF_SELECT = `
  s.id, s.home_id, s.name, s.role, s.team, s.pref, s.skill, s.hourly_rate,
  s.active, s.wtr_opt_out, s.start_date, s.contract_hours,
  s.date_of_birth, s.ni_number, s.al_entitlement, s.al_carryover,
  s.leaving_date, s.phone, s.address, s.emergency_contact,
  s.willing_extras, s.willing_other_homes, s.max_weekly_hours_topup,
  s.max_travel_radius_km, s.home_postcode, s.internal_bank_status, s.internal_bank_notes,
  h.slug AS home_slug, h.name AS home_name, h.config AS home_config
`;

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase();
}

function roleMatches(staffRole, neededRole) {
  const staff = normalizeRole(staffRole);
  const needed = normalizeRole(neededRole);
  if (!needed) return true;
  if (staff === needed) return true;
  if (needed.includes('senior')) return staff.includes('senior') || staff === 'team lead';
  if (needed.includes('carer')) return staff.includes('carer') || staff === 'team lead';
  if (needed.includes('night')) return staff.includes('night');
  return staff.includes(needed);
}

function proposedShiftFromAgencyCode(shiftCode) {
  if (shiftCode === 'AG-E') return 'E';
  if (shiftCode === 'AG-L') return 'L';
  if (shiftCode === 'AG-N') return 'N';
  return shiftCode || 'EL';
}

function toNumber(value) {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function shapeStaff(row) {
  return {
    id: row.id,
    home_id: row.home_id,
    home_slug: row.home_slug,
    home_name: row.home_config?.home_name || row.home_name,
    name: row.name,
    role: row.role,
    team: row.team,
    pref: row.pref,
    active: row.active,
    wtr_opt_out: row.wtr_opt_out,
    start_date: row.start_date,
    contract_hours: toNumber(row.contract_hours),
    willing_extras: row.willing_extras === true,
    willing_other_homes: row.willing_other_homes === true,
    max_weekly_hours_topup: toNumber(row.max_weekly_hours_topup),
    max_travel_radius_km: row.max_travel_radius_km == null ? null : parseInt(row.max_travel_radius_km, 10),
    home_postcode: row.home_postcode || null,
    internal_bank_status: row.internal_bank_status || 'available',
    internal_bank_notes: row.internal_bank_notes || null,
    home_config: row.home_config || {},
  };
}

async function getAccessibleHomes(username, isPlatformAdmin, client = pool) {
  if (isPlatformAdmin) {
    const { rows } = await client.query(
      `SELECT id, slug, name, config, 'home_manager' AS role_id
         FROM homes
        WHERE deleted_at IS NULL
        ORDER BY name`,
    );
    return rows;
  }
  const { rows } = await client.query(
    `SELECT h.id, h.slug, h.name, h.config, uhr.role_id
       FROM user_home_roles uhr
       JOIN users u ON u.username = uhr.username AND u.active = true
       JOIN homes h ON h.id = uhr.home_id AND h.deleted_at IS NULL
      WHERE uhr.username = $1
      ORDER BY h.name`,
    [String(username || '').trim().toLowerCase()],
  );
  return rows.filter(row => hasModuleAccess(row.role_id, 'staff', 'read', { includeOwn: false }));
}

function onboardingBlockers(staff, onboardingByHome) {
  const homeOnboarding = onboardingByHome.get(staff.home_id) || {};
  const record = homeOnboarding[staff.id] || {};
  const blockers = [];

  const dbs = record.dbs_check;
  if (dbs && dbs.status !== 'completed') blockers.push('DBS check not completed');

  const rtw = record.right_to_work;
  if (rtw && rtw.status !== 'completed') {
    blockers.push('Right to Work not verified');
  } else if (rtw?.expiry_date && rtw.expiry_date < new Date().toISOString().slice(0, 10)) {
    blockers.push('Right to Work expired');
  }

  return blockers;
}

async function getTrainingRecordsByStaff(staffRows, client = pool) {
  if (!staffRows.length) return new Map();
  const homeIds = [...new Set(staffRows.map(staff => staff.home_id))];
  const staffIds = [...new Set(staffRows.map(staff => staff.id))];
  const { rows } = await client.query(
    `SELECT home_id, staff_id, training_type_id,
            MAX(CASE WHEN expiry IS NULL THEN '9999-12-31' ELSE expiry::text END) AS latest_expiry
       FROM training_records
      WHERE home_id = ANY($1::int[])
        AND staff_id = ANY($2::text[])
        AND training_type_id = ANY($3::text[])
        AND completed IS NOT NULL
        AND deleted_at IS NULL
      GROUP BY home_id, staff_id, training_type_id`,
    [homeIds, staffIds, INTERNAL_BANK_BLOCKING_TRAINING_TYPE_IDS],
  );
  const byStaff = new Map();
  for (const row of rows) {
    const staffKey = `${row.home_id}:${row.staff_id}`;
    if (!byStaff.has(staffKey)) byStaff.set(staffKey, new Map());
    byStaff.get(staffKey).set(row.training_type_id, row.latest_expiry);
  }
  return byStaff;
}

function rankCandidate(candidate, targetHomeId) {
  let score = 0;
  if (candidate.home_id === targetHomeId) score += 100;
  if (candidate.viable) score += 50;
  if (candidate.internal_bank_status === 'available') score += 10;
  if (/senior|team lead/i.test(candidate.role || '')) score += 3;
  return score;
}

export async function findCandidates({
  targetHomeId,
  username,
  isPlatformAdmin = false,
  role,
  shiftDate,
  shiftCode,
  hours,
} = {}) {
  const accessibleHomes = await getAccessibleHomes(username, isPlatformAdmin);
  const accessibleHomeIds = accessibleHomes.map(home => home.id);
  if (!accessibleHomeIds.includes(targetHomeId)) {
    return { candidates: [], total: 0, viable_count: 0 };
  }

  const { rows } = await pool.query(
    `SELECT ${STAFF_SELECT}
       FROM staff s
       JOIN homes h ON h.id = s.home_id AND h.deleted_at IS NULL
      WHERE s.home_id = ANY($1::int[])
        AND s.deleted_at IS NULL
        AND s.active = true
        AND s.willing_extras = true
        AND s.internal_bank_status IN ('available', 'limited')
        AND (
          s.home_id = $2
          OR s.willing_other_homes = true
        )
      ORDER BY h.name, s.name`,
    [accessibleHomeIds, targetHomeId],
  );

  const staffRows = rows.map(shapeStaff).filter(staff => roleMatches(staff.role, role));
  const homeIds = [...new Set(staffRows.map(staff => staff.home_id))];
  const overrideEntries = await Promise.all(homeIds.map(async (homeId) => [
    homeId,
    await overrideRepo.findByHome(homeId, shiftDate, shiftDate),
  ]));
  const onboardingEntries = await Promise.all(homeIds.map(async (homeId) => [
    homeId,
    await onboardingRepo.findByHome(homeId),
  ]));
  const overridesByHome = new Map(overrideEntries);
  const onboardingByHome = new Map(onboardingEntries);
  const trainingByStaff = await getTrainingRecordsByStaff(staffRows);

  const proposedShift = proposedShiftFromAgencyCode(shiftCode);
  const targetDate = parseDate(shiftDate);
  const requestedHours = Number(hours || 0);
  const candidates = staffRows.map((staff) => {
    const overrides = overridesByHome.get(staff.home_id) || {};
    const actual = getActualShift(
      staff,
      targetDate,
      overrides,
      staff.home_config?.cycle_start_date,
      staff.home_config,
    );
    const available = !isWorkingShift(actual.shift) && !['AL', 'SICK', 'NS'].includes(actual.shift);
    const blockers = [];
    if (!available) blockers.push(`Already rostered ${actual.shift}`);
    if (staff.max_weekly_hours_topup != null && requestedHours > staff.max_weekly_hours_topup) {
      blockers.push(`Requested ${requestedHours}h exceeds top-up limit ${staff.max_weekly_hours_topup}h`);
    }

    const wtr = checkWTRImpact(staff, shiftDate, overrides, staff.home_config, proposedShift);
    if (wtr.ok === false) blockers.push(wtr.message || 'Working Time Regulations limit exceeded');
    blockers.push(...onboardingBlockers(staff, onboardingByHome));
    const training = evaluateInternalBankTrainingEligibility({
      staff,
      recordsByType: trainingByStaff.get(`${staff.home_id}:${staff.id}`) || new Map(),
      effectiveDate: shiftDate,
    });
    blockers.push(...training.blockers);

    const sameHome = staff.home_id === targetHomeId;
    const candidate = {
      ...staff,
      availability: available ? 'available' : 'unavailable',
      scheduled_shift: actual.shift,
      same_home: sameHome,
      distance_status: sameHome ? 'same_home' : 'unknown',
      training_status: training.status,
      fatigue_status: wtr.ok === false ? 'blocked' : (wtr.warn ? 'warning' : 'ok'),
      projected_hours: wtr.projectedHours,
      blockers,
      warnings: [
        ...(!sameHome ? ['Travel distance not calculated yet'] : []),
        ...(wtr.warn && wtr.ok !== false ? [wtr.message] : []),
      ].filter(Boolean),
      viable: blockers.length === 0,
    };
    return {
      ...candidate,
      score: rankCandidate(candidate, targetHomeId),
    };
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  return {
    candidates,
    total: candidates.length,
    viable_count: candidates.filter(candidate => candidate.viable).length,
  };
}
