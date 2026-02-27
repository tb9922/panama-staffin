import { pool, withTransaction } from '../db.js';
import * as gdprRepo from '../repositories/gdprRepo.js';
import * as auditRepo from '../repositories/auditRepo.js';
import { ValidationError } from '../errors.js';
import logger from '../logger.js';

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
      // HR module tables (GDPR special category — employee relations data)
      hrDisciplinary, hrGrievance, hrGrievanceActions, hrPerformance,
      hrRtwInterviews, hrOhReferrals, hrContracts, hrFamilyLeave,
      hrFlexWorking, hrEdi, hrTupe, hrRenewals, hrCaseNotes,
      onboarding, careCertificates, complaints, incidentAddenda,
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
        `SELECT * FROM incidents WHERE home_id = $1 AND staff_involved @> jsonb_build_array($2::text) AND deleted_at IS NULL`,
        [homeId, subjectId]),
      // Staff appears in fire drill staff_present JSONB array
      conn.query(
        `SELECT * FROM fire_drills WHERE home_id = $1 AND staff_present @> jsonb_build_array($2::text)`,
        [homeId, subjectId]),
      // Handover entries authored by this staff member (matched via staff name)
      conn.query(
        `SELECT * FROM handover_entries WHERE home_id = $1 AND author = (
          SELECT name FROM staff WHERE home_id = $1 AND id = $2
        )`, [homeId, subjectId]),
      // HR module — disciplinary, grievance, performance cases
      conn.query(`SELECT * FROM hr_disciplinary_cases WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
      conn.query(`SELECT * FROM hr_grievance_cases WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
      conn.query(
        `SELECT ga.* FROM hr_grievance_actions ga
         JOIN hr_grievance_cases gc ON gc.id = ga.grievance_id
         WHERE gc.home_id = $1 AND gc.staff_id = $2`, [homeId, subjectId]),
      conn.query(`SELECT * FROM hr_performance_cases WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
      // HR module — absence management
      conn.query(`SELECT * FROM hr_rtw_interviews WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
      conn.query(`SELECT * FROM hr_oh_referrals WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
      // HR module — contracts, family leave, flexible working, EDI
      conn.query(`SELECT * FROM hr_contracts WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
      conn.query(`SELECT * FROM hr_family_leave WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
      conn.query(`SELECT * FROM hr_flexible_working WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
      conn.query(`SELECT * FROM hr_edi_records WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
      // HR module — TUPE: employees JSONB array has no guaranteed staff_id field.
      // We filter on home_id only and return home-level TUPE records. TUPE data is
      // relatively non-sensitive (employer/transferor details) and contains no health
      // or special-category data. The SAR response notes this is home-scoped.
      conn.query(`SELECT * FROM hr_tupe_transfers WHERE home_id = $1 AND deleted_at IS NULL`, [homeId]),
      // HR module — DBS/RTW renewals
      conn.query(`SELECT * FROM hr_rtw_dbs_renewals WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
      // HR module — case notes authored by this staff member (matched by name, not staff_id)
      conn.query(
        `SELECT cn.* FROM hr_case_notes cn
         WHERE cn.home_id = $1 AND cn.author = (
           SELECT name FROM staff WHERE home_id = $1 AND id = $2
         )`, [homeId, subjectId]),
      // Onboarding data (DBS, RTW, references, etc.)
      conn.query(`SELECT * FROM onboarding WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
      // Care Certificate progress
      conn.query(`SELECT * FROM care_certificates WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
      // Complaints where staff is the complainant (name-based match)
      conn.query(
        `SELECT * FROM complaints WHERE home_id = $1 AND deleted_at IS NULL AND raised_by_name = (
           SELECT name FROM staff WHERE home_id = $1 AND id = $2
         )`, [homeId, subjectId]),
      // Post-freeze addenda authored by this staff member
      conn.query(
        `SELECT * FROM incident_addenda WHERE home_id = $1 AND author = (
           SELECT name FROM staff WHERE home_id = $1 AND id = $2
         ) ORDER BY created_at ASC`,
        [homeId, subjectId]
      ),
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
        // HR module — employee relations (GDPR special category)
        hr_disciplinary_cases: hrDisciplinary.rows,
        hr_grievance_cases: hrGrievance.rows,
        hr_grievance_actions: hrGrievanceActions.rows,
        hr_performance_cases: hrPerformance.rows,
        hr_rtw_interviews: hrRtwInterviews.rows,
        hr_oh_referrals: hrOhReferrals.rows,
        hr_contracts: hrContracts.rows,
        hr_family_leave: hrFamilyLeave.rows,
        hr_flexible_working: hrFlexWorking.rows,
        hr_edi_records: hrEdi.rows,
        hr_tupe_transfers: hrTupe.rows,
        tupe_note: 'TUPE records are home-level only; verify manually if subject was involved in a transfer',
        hr_rtw_dbs_renewals: hrRenewals.rows,
        hr_case_notes: hrCaseNotes.rows,
        onboarding: onboarding.rows,
        care_certificates: careCertificates.rows,
        complaints: complaints.rows,
        incident_addenda: incidentAddenda.rows,
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

    // Capture original name BEFORE anonymising — needed for name-keyed tables
    // (hr_case_notes.author, handover_entries.author, access_log.user_name)
    const { rows: [staffRow] } = await client.query(
      `SELECT name FROM staff WHERE home_id = $1 AND id = $2`, [homeId, staffId]
    );
    const originalName = staffRow?.name;

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

    // Anonymise HR module data — clear sensitive descriptions, retain case structure for audit trail
    // Disciplinary: clear allegation, investigation notes, suspension reason, hearing notes,
    // outcome reason, appeal grounds/reasons (special category employment data).
    // Retain: dates, statuses, category, outcome type — these form the audit skeleton.
    await client.query(
      `UPDATE hr_disciplinary_cases SET
         allegation_summary = $2, allegation_detail = NULL,
         investigation_notes = NULL, investigation_findings = NULL,
         suspension_reason = NULL,
         hearing_notes = NULL, hearing_employee_response = NULL,
         outcome_reason = NULL,
         appeal_grounds = NULL, appeal_outcome_reason = NULL
       WHERE home_id = $1 AND staff_id = $3`,
      [homeId, anon, staffId]
    );
    // Grievance: clear subject, investigation notes, hearing notes, outcome reason,
    // appeal grounds/reasons. No mediation_notes column exists.
    // Retain: dates, category, protected_characteristic (statistical), statuses.
    await client.query(
      `UPDATE hr_grievance_cases SET
         subject_summary = $2, subject_detail = NULL, desired_outcome = NULL,
         investigation_notes = NULL, investigation_findings = NULL,
         hearing_notes = NULL, employee_statement_at_hearing = NULL,
         outcome_reason = NULL,
         appeal_grounds = NULL, appeal_outcome_reason = NULL
       WHERE home_id = $1 AND staff_id = $3`,
      [homeId, anon, staffId]
    );
    // Performance: clear concern description, informal notes, hearing notes, outcome reason,
    // appeal grounds/reasons. No pip_notes or concerns columns — actual columns are
    // concern_summary, concern_detail, informal_discussion_notes.
    // Retain: dates, type, performance_area, statuses, pip dates and outcome type.
    await client.query(
      `UPDATE hr_performance_cases SET
         concern_summary = $2, concern_detail = NULL,
         informal_discussion_notes = NULL,
         hearing_notes = NULL,
         outcome_reason = NULL,
         appeal_grounds = NULL, appeal_outcome_reason = NULL
       WHERE home_id = $1 AND staff_id = $3`,
      [homeId, anon, staffId]
    );
    // OH referrals: clear reason, questions, report summary, adjustments (health data — special category).
    // Actual adjustments column is adjustments_implemented (not adjustments).
    // Also clear adjustments_recommended (free-text medical recommendation).
    // Retain: dates, consent flag, fit_for_role verdict, disability_likely flag.
    await client.query(
      `UPDATE hr_oh_referrals SET
         reason = $2, questions_for_oh = '[]'::jsonb,
         report_summary = NULL, adjustments_recommended = NULL,
         adjustments_implemented = '[]'::jsonb
       WHERE home_id = $1 AND staff_id = $3`,
      [homeId, anon, staffId]
    );
    // RTW interviews: clear notes, adjustments detail, fit note adjustments (health data).
    // Param is $2 not $3 — no anon value needed, just NULL.
    await client.query(
      `UPDATE hr_rtw_interviews SET
         notes = NULL, adjustments_detail = NULL, fit_note_adjustments = NULL
       WHERE home_id = $1 AND staff_id = $2`,
      [homeId, staffId]
    );
    // EDI records: clear description, condition description, outcome, notes (special category).
    // adjustments is the correct column name here (JSONB, distinct from OH adjustments_implemented).
    await client.query(
      `UPDATE hr_edi_records SET
         description = $2, condition_description = NULL,
         adjustments = '[]'::jsonb,
         outcome = NULL, notes = NULL
       WHERE home_id = $1 AND staff_id = $3`,
      [homeId, anon, staffId]
    );
    // Case notes: anonymise author and clear content.
    // Must use originalName (captured before staff UPDATE) — by this point staff.name is already [REDACTED].
    // Column is `content`, not `note`.
    if (originalName) {
      await client.query(
        `UPDATE hr_case_notes SET author = $1, content = '[REDACTED]'
         WHERE home_id = $2 AND author = $3`,
        [anon, homeId, originalName]
      );
    }

    // Anonymise incident addenda authored by this staff member (post-freeze notes)
    if (originalName) {
      await client.query(
        `UPDATE incident_addenda SET author = $1, content = '[REDACTED]'
         WHERE home_id = $2 AND author = $3`,
        [anon, homeId, originalName]
      );
    }

    // Remove onboarding data (pre-employment checks — not needed after erasure)
    await client.query(
      `DELETE FROM onboarding WHERE home_id = $1 AND staff_id = $2`,
      [homeId, staffId]
    );
    // Clear care certificate progress (supervisor name and assessment notes)
    await client.query(
      `UPDATE care_certificates SET supervisor = $1, standards = '{}'::jsonb
       WHERE home_id = $2 AND staff_id = $3`,
      [anon, homeId, staffId]
    );
    // Anonymise complaints where this staff member was the complainant
    if (originalName) {
      await client.query(
        `UPDATE complaints SET raised_by_name = $1, description = '[REDACTED]'
         WHERE home_id = $2 AND raised_by_name = $3 AND deleted_at IS NULL`,
        [anon, homeId, originalName]
      );
    }

    // Deliberately retained with staff_id linkage (pseudonymised via staff.name → [REDACTED]):
    // - timesheet_entries: operational hours data, retained per PAYE Regulations 2003 (6 years)
    // - payroll_lines/payroll_runs: salary records, retained per PAYE Regulations 2003 (6 years)
    // - ssp_periods: dates retained per Limitation Act 1980 s.11 (6 years), notes cleared above
    // - pension_enrolments/contributions: retained per Pension Schemes Act 1993 (6 years)
    // - shift_overrides: operational scheduling data, no PII beyond staff_id
    // - hr_contracts, hr_family_leave, hr_flexible_working: retained per Limitation Act (6 years)
    // - hr_rtw_dbs_renewals: retained for compliance audit trail

    // Mark the request as completed
    if (requestId) {
      await gdprRepo.updateRequest(requestId, homeId, {
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
  // HR module tables (6-year retention per Limitation Act 1980)
  'hr_disciplinary_cases', 'hr_grievance_cases', 'hr_performance_cases',
  'hr_rtw_interviews', 'hr_oh_referrals', 'hr_contracts', 'hr_family_leave',
  'hr_flexible_working', 'hr_edi_records', 'hr_tupe_transfers', 'hr_rtw_dbs_renewals',
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
    } catch (err) {
      logger.warn({ table, err: err?.message }, 'Retention scan: table query failed — skipping');
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
export async function updateRequest(id, homeId, data, client) { return gdprRepo.updateRequest(id, homeId, data, client); }

export async function findBreaches(homeId) { return gdprRepo.findBreaches(homeId); }
export async function findBreachById(id, homeId) { return gdprRepo.findBreachById(id, homeId); }
export async function createBreach(homeId, data) { return gdprRepo.createBreach(homeId, data); }
export async function updateBreach(id, homeId, data) {
  if (data.status && ['resolved', 'closed'].includes(data.status)) {
    const current = await gdprRepo.findBreachById(id, homeId);
    if (current?.ico_notifiable && !current?.ico_notified) {
      throw new ValidationError('ICO must be notified before resolving a notifiable breach');
    }
  }
  return gdprRepo.updateBreach(id, homeId, data);
}

export async function getRetentionSchedule() { return gdprRepo.getRetentionSchedule(); }

export async function findConsent(homeId) { return gdprRepo.findConsent(homeId); }
export async function createConsent(homeId, data) { return gdprRepo.createConsent(homeId, data); }
export async function updateConsent(id, homeId, data) { return gdprRepo.updateConsent(id, homeId, data); }

export async function findDPComplaints(homeId) { return gdprRepo.findDPComplaints(homeId); }
export async function createDPComplaint(homeId, data) { return gdprRepo.createDPComplaint(homeId, data); }
export async function updateDPComplaint(id, homeId, data) { return gdprRepo.updateDPComplaint(id, homeId, data); }

export async function getAccessLog({ limit = 100, offset = 0, homeSlug } = {}) {
  if (!homeSlug) {
    return gdprRepo.getAccessLog({ limit, offset });
  }
  // Filter by home — join access_log.home_id to homes.slug
  const { rows } = await pool.query(
    `SELECT al.* FROM access_log al
     JOIN homes h ON h.id = al.home_id
     WHERE h.slug = $1
     ORDER BY al.ts DESC LIMIT $2 OFFSET $3`,
    [homeSlug, limit, offset]
  );
  return rows;
}
