import { pool, withTransaction } from '../db.js';
import * as gdprRepo from '../repositories/gdprRepo.js';
import * as auditRepo from '../repositories/auditRepo.js';
import { ValidationError } from '../errors.js';

// ── SAR Data Gathering ───────────────────────────────────────────────────────

/**
 * Gather all personal data for a subject across all tables.
 * Used for Subject Access Requests. Returns a structured object.
 */
export async function gatherPersonalData(subjectType, subjectId, homeId, client, subjectName) {
  const conn = client || pool;

  if (subjectType === 'staff') {
    const [
      staff, overrides, training, supervisions, appraisals,
      timesheets, payrollLines, taxCodes, sspPeriods,
      pensionEnrolment, pensionContributions, accessLog,
      incidents, fireDrills, handoverEntries,
    ] = await Promise.all([
      conn.query(`SELECT * FROM staff WHERE home_id = $1 AND id = $2`, [homeId, subjectId]),
      conn.query(`SELECT * FROM shift_overrides WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
      conn.query(`SELECT * FROM training_records WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
      conn.query(`SELECT * FROM supervisions WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
      conn.query(`SELECT * FROM appraisals WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
      conn.query(`SELECT * FROM timesheet_entries WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
      conn.query(
        `SELECT pl.* FROM payroll_lines pl
         JOIN payroll_runs pr ON pr.id = pl.payroll_run_id
         WHERE pr.home_id = $1 AND pl.staff_id = $2`, [homeId, subjectId]),
      conn.query(`SELECT * FROM tax_codes WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
      conn.query(`SELECT * FROM ssp_periods WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
      conn.query(`SELECT * FROM pension_enrolments WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
      conn.query(
        `SELECT pc.* FROM pension_contributions pc
         JOIN pension_enrolments pe ON pe.id = pc.enrolment_id
         WHERE pe.home_id = $1 AND pe.staff_id = $2`, [homeId, subjectId]),
      conn.query(`SELECT * FROM access_log WHERE user_name = (
        SELECT name FROM staff WHERE home_id = $1 AND id = $2
      ) ORDER BY ts DESC LIMIT 500`, [homeId, subjectId]),
      // Staff appears in incident staff_involved JSONB array
      conn.query(
        `SELECT * FROM incidents WHERE home_id = $1 AND jsonb_exists(staff_involved, $2) AND deleted_at IS NULL`,
        [homeId, subjectId]),
      // Staff appears in fire drill staff_present JSONB array
      conn.query(
        `SELECT * FROM fire_drills WHERE home_id = $1 AND jsonb_exists(staff_present, $2)`,
        [homeId, subjectId]),
      // Handover entries authored by this staff member (matched via staff name)
      conn.query(
        `SELECT * FROM handover_entries WHERE home_id = $1 AND author = (
          SELECT name FROM staff WHERE home_id = $1 AND id = $2
        )`, [homeId, subjectId]),
    ]);

    return {
      subject_type: 'staff',
      subject_id: subjectId,
      gathered_at: new Date().toISOString(),
      data: {
        staff: staff.rows,
        shift_overrides: overrides.rows,
        training_records: training.rows,
        supervisions: supervisions.rows,
        appraisals: appraisals.rows,
        timesheet_entries: timesheets.rows,
        payroll_lines: payrollLines.rows,
        tax_codes: taxCodes.rows,
        ssp_periods: sspPeriods.rows,
        pension_enrolment: pensionEnrolment.rows,
        pension_contributions: pensionContributions.rows,
        access_log: accessLog.rows,
        incidents: incidents.rows,
        fire_drills: fireDrills.rows,
        handover_entries: handoverEntries.rows,
      },
    };
  }

  if (subjectType === 'resident') {
    const queries = [
      conn.query(`SELECT * FROM dols WHERE home_id = $1 AND id = $2`, [homeId, subjectId]),
      conn.query(`SELECT * FROM mca_assessments WHERE home_id = $1 AND id = $2`, [homeId, subjectId]),
    ];
    // Name-based queries only run when subject_name is provided (residents have no stable ID across tables)
    if (subjectName) {
      queries.push(
        conn.query(
          `SELECT * FROM incidents WHERE home_id = $1 AND person_affected_name = $2 AND deleted_at IS NULL`,
          [homeId, subjectName]),
        conn.query(
          `SELECT * FROM complaints WHERE home_id = $1 AND raised_by_name = $2 AND deleted_at IS NULL`,
          [homeId, subjectName]),
      );
    }
    const results = await Promise.all(queries);
    return {
      subject_type: 'resident',
      subject_id: subjectId,
      gathered_at: new Date().toISOString(),
      incomplete: !subjectName ? 'subject_name not provided — incidents and complaints not searched' : undefined,
      data: {
        dols: results[0].rows,
        mca_assessments: results[1].rows,
        incidents: results[2]?.rows || [],
        complaints: results[3]?.rows || [],
      },
    };
  }

  return { subject_type: subjectType, subject_id: subjectId, data: {} };
}

// ── Erasure (Anonymisation) ──────────────────────────────────────────────────

/**
 * Execute right-to-erasure by anonymising personal data across all tables.
 * Uses transaction — all-or-nothing. Preserves record structure for CQC auditability.
 */
export async function executeErasure(staffId, homeId, requestId, username, homeSlug) {
  return withTransaction(async (client) => {
    const anon = `[REDACTED-${staffId.slice(0, 4)}]`;

    // Anonymise staff record (keep id, role, team, skill for operational data)
    await client.query(
      `UPDATE staff SET
         name = $2, date_of_birth = NULL, ni_number = NULL,
         hourly_rate = 0, contract_hours = NULL, leaving_date = CURRENT_DATE,
         active = FALSE
       WHERE home_id = $1 AND id = $3`,
      [homeId, anon, staffId]
    );

    // Anonymise supervisions
    await client.query(
      `UPDATE supervisions SET supervisor = $2, topics = NULL, actions = NULL, notes = NULL
       WHERE home_id = $1 AND staff_id = $3`,
      [homeId, anon, staffId]
    );

    // Anonymise appraisals
    await client.query(
      `UPDATE appraisals SET appraiser = $2, objectives = NULL, training_needs = NULL,
         development_plan = NULL, notes = NULL
       WHERE home_id = $1 AND staff_id = $3`,
      [homeId, anon, staffId]
    );

    // Remove training records (not legally required to retain after erasure)
    await client.query(
      `DELETE FROM training_records WHERE home_id = $1 AND staff_id = $2`,
      [homeId, staffId]
    );

    // Anonymise tax codes
    await client.query(
      `UPDATE tax_codes SET tax_code = 'XXXX', ni_category = NULL, student_loan_plan = NULL
       WHERE home_id = $1 AND staff_id = $2`,
      [homeId, staffId]
    );

    // Clear SSP period notes (special category health data)
    await client.query(
      `UPDATE ssp_periods SET notes = NULL WHERE home_id = $1 AND staff_id = $2`,
      [homeId, staffId]
    );

    // Deliberately retained with staff_id linkage (pseudonymised via staff.name → [REDACTED]):
    // - timesheet_entries: operational hours data, retained per PAYE Regulations 2003 (6 years)
    // - payroll_lines/payroll_runs: salary records, retained per PAYE Regulations 2003 (6 years)
    // - ssp_periods: dates retained per Limitation Act 1980 s.11 (6 years), notes cleared above
    // - pension_enrolments/contributions: retained per Pension Schemes Act 1993 (6 years)
    // - shift_overrides: operational scheduling data, no PII beyond staff_id

    // Mark the request as completed
    if (requestId) {
      await gdprRepo.updateRequest(requestId, {
        status: 'completed',
        completed_date: new Date().toISOString().slice(0, 10),
        completed_by: username,
      }, client);
    }

    // Audit the erasure
    await auditRepo.log('erasure', homeSlug || null, username, `Erased staff ${staffId} from home ${homeId}`, client);

    return { anonymised: true, staff_id: staffId };
  });
}

// ── Retention Scan ───────────────────────────────────────────────────────────

/**
 * Read-only scan of data against retention schedule.
 * Returns a report of what data exists and whether it's past retention.
 */
// Tables allowed in retention scan queries — prevents SQL injection via applies_to_table
const RETENTION_ALLOWED_TABLES = new Set([
  'staff', 'ssp_periods', 'training_records', 'onboarding', 'payroll_runs',
  'pension_enrolments', 'incidents', 'complaints', 'dols', 'audit_log',
  'access_log', 'risk_register', 'whistleblowing_concerns', 'maintenance',
  'retention_schedule',
]);

// Tables without home_id (global tables)
const GLOBAL_TABLES = new Set(['retention_schedule', 'access_log', 'audit_log']);

// Tables that use 'ts' instead of 'created_at' for date column
const TS_TABLES = new Set(['access_log', 'audit_log']);

export async function scanRetention(homeId) {
  const schedule = await gdprRepo.getRetentionSchedule();

  const results = [];
  for (const rule of schedule) {
    if (!rule.applies_to_table) continue;
    if (!RETENTION_ALLOWED_TABLES.has(rule.applies_to_table)) continue;

    const table = rule.applies_to_table;
    const isGlobal = GLOBAL_TABLES.has(table);
    const dateCol = TS_TABLES.has(table) ? 'ts' : 'created_at';
    let count = 0;
    let expiredCount = 0;

    try {
      // Count total records
      const totalResult = await pool.query(
        isGlobal
          ? `SELECT COUNT(*) AS cnt FROM ${table}`
          : `SELECT COUNT(*) AS cnt FROM ${table} WHERE home_id = $1`,
        isGlobal ? [] : [homeId]
      );
      count = parseInt(totalResult.rows[0].cnt, 10);

      // Count records past retention
      if (table !== 'retention_schedule') {
        const expiredResult = await pool.query(
          isGlobal
            ? `SELECT COUNT(*) AS cnt FROM ${table} WHERE ${dateCol} < NOW() - INTERVAL '1 day' * $1`
            : `SELECT COUNT(*) AS cnt FROM ${table} WHERE home_id = $2 AND ${dateCol} < NOW() - INTERVAL '1 day' * $1`,
          isGlobal ? [rule.retention_days] : [rule.retention_days, homeId]
        );
        expiredCount = parseInt(expiredResult.rows[0].cnt, 10);
      }
    } catch {
      // Table might not have the expected date column — skip
    }

    results.push({
      data_category: rule.data_category,
      retention_period: rule.retention_period,
      retention_days: rule.retention_days,
      retention_basis: rule.retention_basis,
      legal_basis: rule.legal_basis,
      special_category: rule.special_category,
      total_records: count,
      expired_records: expiredCount,
      action_needed: expiredCount > 0,
    });
  }

  return results;
}

// ── Breach Risk Assessment ───────────────────────────────────────────────────

/**
 * Pure function — assess breach risk and determine ICO notifiability.
 * UK GDPR Article 33: notify ICO within 72 hours unless unlikely to result in risk.
 */
export function assessBreachRisk(breachData) {
  const severityWeights = { low: 1, medium: 2, high: 3, critical: 4 };
  const riskWeights = { unlikely: 1, possible: 2, likely: 3, high: 4 };

  const sevScore = severityWeights[breachData.severity] || 1;
  const riskScore = riskWeights[breachData.risk_to_rights] || 1;
  const affectedScore = Math.min(4, Math.ceil((breachData.individuals_affected || 0) / 10));

  // Special category data multiplier
  const specialCats = (breachData.data_categories || []).filter(c =>
    ['staff_health', 'dbs', 'resident_health', 'dols', 'mca'].includes(c)
  );
  const specialMultiplier = specialCats.length > 0 ? 1.5 : 1.0;

  const rawScore = ((sevScore + riskScore + affectedScore) / 3) * specialMultiplier;
  const score = Math.round(rawScore * 10) / 10;

  let riskLevel, icoNotifiable;
  if (score >= 3.0) {
    riskLevel = 'critical';
    icoNotifiable = true;
  } else if (score >= 2.0) {
    riskLevel = 'high';
    icoNotifiable = true;
  } else if (score >= 1.5) {
    riskLevel = 'medium';
    icoNotifiable = true;
  } else {
    riskLevel = 'low';
    icoNotifiable = false;
  }

  // ICO deadline: 72 hours from discovery
  const discoveredDate = new Date(breachData.discovered_date);
  const icoDeadline = new Date(discoveredDate.getTime() + 72 * 60 * 60 * 1000);

  return {
    score,
    riskLevel,
    icoNotifiable,
    icoDeadline: icoDeadline.toISOString(),
    specialCategoryDataInvolved: specialCats.length > 0,
    factors: {
      severity: sevScore,
      riskToRights: riskScore,
      affected: affectedScore,
      specialMultiplier,
    },
  };
}

// ── Passthrough to repo ──────────────────────────────────────────────────────

export async function findRequests(homeId) { return gdprRepo.findRequests(homeId); }
export async function findRequestById(id) { return gdprRepo.findRequestById(id); }
export async function createRequest(homeId, data) { return gdprRepo.createRequest(homeId, data); }
export async function updateRequest(id, data) { return gdprRepo.updateRequest(id, data); }

export async function findBreaches(homeId) { return gdprRepo.findBreaches(homeId); }
export async function findBreachById(id) { return gdprRepo.findBreachById(id); }
export async function createBreach(homeId, data) { return gdprRepo.createBreach(homeId, data); }
export async function updateBreach(id, data) {
  if (data.status && ['resolved', 'closed'].includes(data.status)) {
    const current = await gdprRepo.findBreachById(id);
    if (current?.ico_notifiable && !current?.ico_notified) {
      throw new ValidationError('ICO must be notified before resolving a notifiable breach');
    }
  }
  return gdprRepo.updateBreach(id, data);
}

export async function getRetentionSchedule() { return gdprRepo.getRetentionSchedule(); }

export async function findConsent(homeId) { return gdprRepo.findConsent(homeId); }
export async function createConsent(homeId, data) { return gdprRepo.createConsent(homeId, data); }
export async function updateConsent(id, data) { return gdprRepo.updateConsent(id, data); }

export async function findDPComplaints(homeId) { return gdprRepo.findDPComplaints(homeId); }
export async function createDPComplaint(homeId, data) { return gdprRepo.createDPComplaint(homeId, data); }
export async function updateDPComplaint(id, data) { return gdprRepo.updateDPComplaint(id, data); }

export async function getAccessLog(opts) { return gdprRepo.getAccessLog(opts); }
