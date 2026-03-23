import fs from 'node:fs/promises';
import path from 'node:path';
import { pool, withTransaction } from '../db.js';
import * as gdprRepo from '../repositories/gdprRepo.js';
import * as auditRepo from '../repositories/auditRepo.js';
import { ValidationError } from '../errors.js';
import { config as appConfig } from '../config.js';
import logger from '../logger.js';

/** Deduplicate rows by id. Assumes id is a non-null SERIAL PRIMARY KEY. */
function dedupeById(rows) {
  const seen = new Set();
  return rows.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
}

// ── SAR Data Gathering ───────────────────────────────────────────────────────

/**
 * Gather all personal data for a subject across all tables.
 * Used for Subject Access Requests. Returns a structured object.
 */
export async function gatherPersonalData(subjectType, subjectId, homeId, client, subjectName) {
  // Use a single dedicated client to avoid exhausting the pool (31 queries for staff SAR).
  // If caller already provided a client (e.g. inside a transaction), reuse it.
  const ownClient = !client;
  const conn = client || await pool.connect();
  try {
    // Snapshot isolation: wrap in read-only transaction so concurrent writes
    // cannot produce an inconsistent SAR export across our 31 queries.
    if (ownClient) await conn.query('BEGIN TRANSACTION READ ONLY');

    if (subjectType === 'staff') {
      // Resolve staff name once — avoids 6 redundant subqueries
      const { rows: [staffRow] } = await conn.query(
        `SELECT name FROM staff WHERE home_id = $1 AND id = $2`, [homeId, subjectId]
      );
      const staffName = staffRow?.name;

      const [
        staff, overrides, training, supervisions, appraisals,
        timesheets, payrollLines, taxCodes, sspPeriods,
        pensionEnrolment, pensionContributions, accessLog,
        incidents, fireDrills, handoverEntries,
        // HR module tables (GDPR special category — employee relations data)
        hrDisciplinary, hrGrievance, hrGrievanceActions, hrPerformance,
        hrRtwInterviews, hrOhReferrals, hrContracts, hrFamilyLeave,
        hrFlexWorking, hrEdi, hrTupe, hrRenewals, hrCaseNotes, hrCaseNotesOnCases,
        onboarding, careCertificates, complaints, incidentAddenda,
        payrollYtd, hrMeetings, hrAttachments,
        payrollLineShifts, userAccount, userHomeRoles,
        // GDPR module own tables — the subject may be the requester or consent giver
        consentRecords, dataRequests, dpComplaints,
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
        conn.query(`SELECT * FROM sick_periods WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
        conn.query(`SELECT * FROM pension_enrolments WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
        conn.query(
          `SELECT pc.* FROM pension_contributions pc
           WHERE pc.home_id = $1 AND pc.staff_id = $2`, [homeId, subjectId]),
        // access_log has no home_id column (global table) — user_name stores the login username.
        // Resolve username from users table (matching by display_name or username) then query.
        // All homes' access entries for this user are included in the SAR per Article 15.
        staffName
          ? conn.query(
              `SELECT * FROM access_log WHERE user_name = $1
                 OR user_name IN (SELECT username FROM users WHERE display_name = $1)
               ORDER BY ts DESC LIMIT 500`, [staffName])
          : { rows: [] },
        // Staff appears in incident staff_involved JSONB array
        conn.query(
          `SELECT * FROM incidents WHERE home_id = $1 AND staff_involved @> jsonb_build_array($2::text) AND deleted_at IS NULL`,
          [homeId, subjectId]),
        // Staff appears in fire drill staff_present JSONB array
        conn.query(
          `SELECT * FROM fire_drills WHERE home_id = $1 AND staff_present @> jsonb_build_array($2::text)`,
          [homeId, subjectId]),
        staffName
          ? conn.query(`SELECT * FROM handover_entries WHERE home_id = $1 AND author = $2`, [homeId, staffName])
          : { rows: [] },
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
        // HR module — TUPE: not auto-included in SAR. The employees JSONB field has no
        // guaranteed staff_id, so reliable subject-scoped filtering is not possible.
        // Including all home-level TUPE records would over-disclose other employees' data
        // (UK GDPR Recital 63 — must not adversely affect others' rights/freedoms).
        // A data controller note is included in the response; manual review is required.
        Promise.resolve({ rows: [] }),
        // HR module — DBS/RTW renewals
        conn.query(`SELECT * FROM hr_rtw_dbs_renewals WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
        // HR module — case notes authored by this staff member (pre-resolved name)
        staffName
          ? conn.query(`SELECT * FROM hr_case_notes WHERE home_id = $1 AND author = $2`, [homeId, staffName])
          : { rows: [] },
        // HR module — case notes on this staff member's cases (written by anyone)
        conn.query(
          `SELECT cn.* FROM hr_case_notes cn
           WHERE cn.home_id = $1 AND (
             (cn.case_type = 'disciplinary' AND cn.case_id IN (SELECT id FROM hr_disciplinary_cases WHERE home_id = $1 AND staff_id = $2))
             OR (cn.case_type = 'grievance' AND cn.case_id IN (SELECT id FROM hr_grievance_cases WHERE home_id = $1 AND staff_id = $2))
             OR (cn.case_type = 'performance' AND cn.case_id IN (SELECT id FROM hr_performance_cases WHERE home_id = $1 AND staff_id = $2))
           )`, [homeId, subjectId]),
        // Onboarding data (DBS, RTW, references, etc.)
        conn.query(`SELECT * FROM onboarding WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
        // Care Certificate progress
        conn.query(`SELECT * FROM care_certificates WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
        // Complaints where staff is the complainant (pre-resolved name)
        staffName
          ? conn.query(
              `SELECT * FROM complaints WHERE home_id = $1 AND deleted_at IS NULL AND raised_by_name = $2`,
              [homeId, staffName])
          : { rows: [] },
        // Post-freeze addenda authored by this staff member (pre-resolved name)
        staffName
          ? conn.query(
              `SELECT * FROM incident_addenda WHERE home_id = $1 AND author = $2 ORDER BY created_at ASC`,
              [homeId, staffName])
          : { rows: [] },
        // Payroll year-to-date accumulations
        conn.query(`SELECT * FROM payroll_ytd WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
        // HR investigation meetings (linked via case tables)
        conn.query(
          `SELECT m.* FROM hr_investigation_meetings m
           WHERE m.home_id = $1 AND (
             (m.case_type = 'disciplinary' AND m.case_id IN (SELECT id FROM hr_disciplinary_cases WHERE home_id = $1 AND staff_id = $2))
             OR (m.case_type = 'grievance' AND m.case_id IN (SELECT id FROM hr_grievance_cases WHERE home_id = $1 AND staff_id = $2))
             OR (m.case_type = 'performance' AND m.case_id IN (SELECT id FROM hr_performance_cases WHERE home_id = $1 AND staff_id = $2))
           )`, [homeId, subjectId]),
        // HR file attachments (linked via case tables)
        conn.query(
          `SELECT a.* FROM hr_file_attachments a
           WHERE a.home_id = $1 AND (
             (a.case_type = 'disciplinary' AND a.case_id IN (SELECT id FROM hr_disciplinary_cases WHERE home_id = $1 AND staff_id = $2))
             OR (a.case_type = 'grievance' AND a.case_id IN (SELECT id FROM hr_grievance_cases WHERE home_id = $1 AND staff_id = $2))
             OR (a.case_type = 'performance' AND a.case_id IN (SELECT id FROM hr_performance_cases WHERE home_id = $1 AND staff_id = $2))
           )`, [homeId, subjectId]),
        // Payroll shift detail (per-day hours, rates, amounts)
        conn.query(
          `SELECT pls.* FROM payroll_line_shifts pls
           JOIN payroll_lines pl ON pl.id = pls.payroll_line_id
           JOIN payroll_runs pr ON pr.id = pl.payroll_run_id
           WHERE pr.home_id = $1 AND pl.staff_id = $2`, [homeId, subjectId]),
        // System user account (if staff member has a login)
        staffName
          ? conn.query(
              `SELECT u.id, u.username, u.display_name, u.role, u.is_platform_admin, u.active, u.last_login_at, u.created_at
               FROM users u
               WHERE (u.display_name = $1 OR u.username = $1)
                 AND EXISTS (SELECT 1 FROM user_home_roles uhr WHERE uhr.username = u.username AND uhr.home_id = $2)`,
              [staffName, homeId])
          : { rows: [] },
        // Home role assignments — scoped to this home only (user_home_roles uses username)
        staffName
          ? conn.query(
              `SELECT uhr.* FROM user_home_roles uhr
               JOIN users u ON u.username = uhr.username
               WHERE (u.display_name = $1 OR u.username = $1) AND uhr.home_id = $2`, [staffName, homeId])
          : { rows: [] },
        // GDPR module own tables — consent records and data requests where subject is this staff member
        conn.query(`SELECT * FROM consent_records WHERE home_id = $1 AND subject_id = $2 AND deleted_at IS NULL`, [homeId, subjectId]),
        conn.query(`SELECT * FROM data_requests WHERE home_id = $1 AND subject_id = $2 AND deleted_at IS NULL`, [homeId, subjectId]),
        // DP complaints where this staff member is the complainant (matched by name)
        staffName
          ? conn.query(`SELECT * FROM dp_complaints WHERE home_id = $1 AND complainant_name = $2 AND deleted_at IS NULL`, [homeId, staffName])
          : { rows: [] },
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
          sick_periods: sspPeriods.rows,
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
          tupe_note: 'TUPE records are excluded from automated SAR to prevent over-disclosure of other employees\' data. Please review hr_tupe_transfers manually for any transfers involving this subject.',
          hr_rtw_dbs_renewals: hrRenewals.rows,
          hr_case_notes: dedupeById([...hrCaseNotes.rows, ...hrCaseNotesOnCases.rows]),
          onboarding: onboarding.rows,
          care_certificates: careCertificates.rows,
          complaints: complaints.rows,
          incident_addenda: incidentAddenda.rows,
          payroll_ytd: payrollYtd.rows,
          hr_investigation_meetings: hrMeetings.rows,
          hr_file_attachments: hrAttachments.rows,
          payroll_line_shifts: payrollLineShifts.rows,
          user_account: userAccount.rows,
          user_home_roles: userHomeRoles.rows,
          // GDPR module own tables
          consent_records: consentRecords.rows,
          data_requests: dataRequests.rows,
          dp_complaints: dpComplaints.rows,
        },
      };
    }

    if (subjectType === 'resident') {
      // Resolve resident PK for robust identity matching (avoids name collisions)
      let residentPk = null;
      if (subjectName) {
        const { rows: [fr] } = await conn.query(
          `SELECT id FROM finance_residents WHERE home_id = $1 AND (id::text = $2 OR resident_name = $3) AND deleted_at IS NULL LIMIT 1`,
          [homeId, subjectId, subjectName]
        );
        residentPk = fr?.id || null;
      }

      const queries = [
        // Prefer resident_id FK when available, fall back to resident_name.
        // Null params with unknown type cause PG "could not determine data type" errors,
        // so use separate query strings with reindexed params for each branch.
        subjectName
          ? conn.query(
              residentPk
                ? `SELECT * FROM dols WHERE home_id = $1 AND (resident_id = $2 OR resident_name = $3) AND deleted_at IS NULL`
                : `SELECT * FROM dols WHERE home_id = $1 AND resident_name = $2 AND deleted_at IS NULL`,
              residentPk ? [homeId, residentPk, subjectName] : [homeId, subjectName])
          : { rows: [] },
        subjectName
          ? conn.query(
              residentPk
                ? `SELECT * FROM mca_assessments WHERE home_id = $1 AND (resident_id = $2 OR resident_name = $3) AND deleted_at IS NULL`
                : `SELECT * FROM mca_assessments WHERE home_id = $1 AND resident_name = $2 AND deleted_at IS NULL`,
              residentPk ? [homeId, residentPk, subjectName] : [homeId, subjectName])
          : { rows: [] },
        // Finance: resident record, invoices, fee changes, invoice lines, payment schedule, chase
        subjectName
          ? conn.query(`SELECT * FROM finance_residents WHERE home_id = $1 AND resident_name = $2 AND deleted_at IS NULL`, [homeId, subjectName])
          : { rows: [] },
        subjectName
          ? conn.query(
              `SELECT fi.* FROM finance_invoices fi
               JOIN finance_residents fr ON fr.id = fi.resident_id AND fr.home_id = fi.home_id
               WHERE fi.home_id = $1 AND fr.resident_name = $2 AND fi.deleted_at IS NULL`,
              [homeId, subjectName])
          : { rows: [] },
        // Beds and bed transitions — linked via finance_residents by name
        subjectName
          ? conn.query(
              `SELECT b.* FROM beds b
               JOIN finance_residents fr ON fr.id = b.resident_id AND fr.home_id = b.home_id
               WHERE b.home_id = $1 AND fr.resident_name = $2`, [homeId, subjectName])
          : { rows: [] },
        subjectName
          ? conn.query(
              `SELECT bt.* FROM bed_transitions bt
               JOIN beds b ON b.id = bt.bed_id AND b.home_id = bt.home_id
               JOIN finance_residents fr ON fr.id = b.resident_id AND fr.home_id = b.home_id
               WHERE bt.home_id = $1 AND fr.resident_name = $2 ORDER BY bt.changed_at DESC`, [homeId, subjectName])
          : { rows: [] },
        // Finance detail tables (linked via resident_id on finance_residents)
        subjectName
          ? conn.query(
              `SELECT fc.* FROM finance_fee_changes fc
               JOIN finance_residents fr ON fr.id = fc.resident_id AND fr.home_id = $1
               WHERE fr.resident_name = $2`, [homeId, subjectName])
          : { rows: [] },
        subjectName
          ? conn.query(
              `SELECT fil.* FROM finance_invoice_lines fil
               JOIN finance_invoices fi ON fi.id = fil.invoice_id
               JOIN finance_residents fr ON fr.id = fi.resident_id AND fr.home_id = fi.home_id
               WHERE fi.home_id = $1 AND fr.resident_name = $2 AND fi.deleted_at IS NULL`,
              [homeId, subjectName])
          : { rows: [] },
        // finance_payment_schedule is AP (supplier schedules) — no resident_id column.
        // Not included in resident SAR.
        subjectName
          ? conn.query(
              `SELECT ic.* FROM finance_invoice_chase ic
               JOIN finance_invoices fi ON fi.id = ic.invoice_id
               JOIN finance_residents fr ON fr.id = fi.resident_id AND fr.home_id = fi.home_id
               WHERE fi.home_id = $1 AND fr.resident_name = $2`, [homeId, subjectName])
          : { rows: [] },
        // GDPR module own tables — consent records and data requests by subject_id
        conn.query(`SELECT * FROM consent_records WHERE home_id = $1 AND subject_id = $2 AND deleted_at IS NULL`, [homeId, subjectId]),
        conn.query(`SELECT * FROM data_requests WHERE home_id = $1 AND subject_id = $2 AND deleted_at IS NULL`, [homeId, subjectId]),
        // DP complaints matched by resident name (dp_complaints has no resident_id FK)
        subjectName
          ? conn.query(`SELECT * FROM dp_complaints WHERE home_id = $1 AND complainant_name = $2 AND deleted_at IS NULL`, [homeId, subjectName])
          : { rows: [] },
      ];
      // Name-based queries for incidents/complaints
      if (subjectName) {
        queries.push(
          conn.query(
            residentPk
              ? `SELECT * FROM incidents WHERE home_id = $1 AND (resident_id = $2 OR person_affected_name = $3) AND deleted_at IS NULL`
              : `SELECT * FROM incidents WHERE home_id = $1 AND person_affected_name = $2 AND deleted_at IS NULL`,
            residentPk ? [homeId, residentPk, subjectName] : [homeId, subjectName]),
          conn.query(
            residentPk
              ? `SELECT * FROM complaints WHERE home_id = $1 AND (resident_id = $2 OR raised_by_name = $3) AND deleted_at IS NULL`
              : `SELECT * FROM complaints WHERE home_id = $1 AND raised_by_name = $2 AND deleted_at IS NULL`,
            residentPk ? [homeId, residentPk, subjectName] : [homeId, subjectName]),
          // Post-freeze addenda on incidents involving this resident (Article 15 completeness)
          conn.query(
            residentPk
              ? `SELECT ia.* FROM incident_addenda ia
                 JOIN incidents i ON i.id = ia.incident_id AND i.home_id = ia.home_id
                 WHERE ia.home_id = $1 AND (i.resident_id = $2 OR i.person_affected_name = $3) AND i.deleted_at IS NULL
                 ORDER BY ia.created_at ASC`
              : `SELECT ia.* FROM incident_addenda ia
                 JOIN incidents i ON i.id = ia.incident_id AND i.home_id = ia.home_id
                 WHERE ia.home_id = $1 AND i.person_affected_name = $2 AND i.deleted_at IS NULL
                 ORDER BY ia.created_at ASC`,
            residentPk ? [homeId, residentPk, subjectName] : [homeId, subjectName]),
        );
      }
      const results = await Promise.all(queries);
      return {
        subject_type: 'resident',
        subject_id: subjectId,
        gathered_at: new Date().toISOString(),
        incomplete: !subjectName ? 'subject_name not provided — DoLS, MCA assessments, incidents, complaints, and finance detail not searched' : undefined,
        data: {
          dols: results[0].rows,
          mca_assessments: results[1].rows,
          finance_residents: results[2].rows,
          finance_invoices: results[3].rows,
          beds: results[4].rows,
          bed_transitions: results[5].rows,
          finance_fee_changes: results[6].rows,
          finance_invoice_lines: results[7].rows,
          finance_invoice_chase: results[8].rows,
          // GDPR module own tables (indices 9-11, always present)
          consent_records: results[9].rows,
          data_requests: results[10].rows,
          dp_complaints: results[11].rows,
          // Incident/complaint queries pushed conditionally (indices 12-14)
          incidents: results[12]?.rows || [],
          complaints: results[13]?.rows || [],
          incident_addenda: results[14]?.rows || [],
        },
      };
    }

    return { subject_type: subjectType, subject_id: subjectId, data: {} };
  } finally {
    if (ownClient) {
      await conn.query('COMMIT').catch(() => {});
      conn.release();
    }
  }
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
      `UPDATE sick_periods SET notes = NULL WHERE home_id = $1 AND staff_id = $2`,
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
    // Case notes: anonymise notes authored BY the staff member (using originalName)
    if (originalName) {
      await client.query(
        `UPDATE hr_case_notes SET author = $1, content = '[REDACTED]'
         WHERE home_id = $2 AND author = $3`,
        [anon, homeId, originalName]
      );
    }
    // Case notes: anonymise notes ON the staff member's cases (written by anyone)
    await client.query(
      `UPDATE hr_case_notes SET content = '[REDACTED]'
       WHERE home_id = $1 AND (
         (case_type = 'disciplinary' AND case_id IN (SELECT id FROM hr_disciplinary_cases WHERE home_id = $1 AND staff_id = $2))
         OR (case_type = 'grievance' AND case_id IN (SELECT id FROM hr_grievance_cases WHERE home_id = $1 AND staff_id = $2))
         OR (case_type = 'performance' AND case_id IN (SELECT id FROM hr_performance_cases WHERE home_id = $1 AND staff_id = $2))
       )`,
      [homeId, staffId]
    );

    // Delete HR file attachments linked to this staff member's cases (documents may contain personal data)
    const hrCaseCondition = `
      (a.case_type = 'disciplinary' AND a.case_id IN (SELECT id FROM hr_disciplinary_cases WHERE home_id = $1 AND staff_id = $2))
      OR (a.case_type = 'grievance' AND a.case_id IN (SELECT id FROM hr_grievance_cases WHERE home_id = $1 AND staff_id = $2))
      OR (a.case_type = 'performance' AND a.case_id IN (SELECT id FROM hr_performance_cases WHERE home_id = $1 AND staff_id = $2))`;
    const { rows: attachments } = await client.query(
      `SELECT a.stored_name, a.case_type, a.case_id FROM hr_file_attachments a
       WHERE a.home_id = $1 AND (${hrCaseCondition})`,
      [homeId, staffId]
    );
    // Delete physical files from disk
    for (const att of attachments) {
      const filePath = path.join(appConfig.upload.dir, String(homeId), att.case_type, String(att.case_id), att.stored_name);
      try { await fs.unlink(filePath); } catch { /* file already removed */ }
    }
    // Delete attachment metadata
    await client.query(
      `DELETE FROM hr_file_attachments a WHERE a.home_id = $1 AND (${hrCaseCondition})`,
      [homeId, staffId]
    );

    // Anonymise incidents where this staff member was the affected person
    if (originalName) {
      await client.query(
        `UPDATE incidents SET person_affected_name = $1, witnesses = '[]'::jsonb
         WHERE home_id = $2 AND deleted_at IS NULL
           AND person_affected_name = $3 AND person_affected = 'staff'`,
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

    // Anonymise access/audit log entries for this staff member.
    // access_log.home_id is always NULL — cannot scope by home.
    // Only redact if no OTHER staff member (across all homes) shares the same display name,
    // to prevent cross-tenant access log destruction. Note: staff.name for this record was
    // already anonymised earlier in this transaction, so the exclusion predicate is
    // explicit for clarity and future-ordering safety.
    if (originalName) {
      const { rows: nameCount } = await client.query(
        `SELECT COUNT(*) AS cnt FROM staff WHERE name = $1 AND NOT (home_id = $2 AND id = $3)`,
        [originalName, homeId, staffId]
      );
      if (parseInt(nameCount[0]?.cnt, 10) === 0) {
        await client.query(
          `UPDATE access_log SET user_name = '[REDACTED]' WHERE user_name = $1`,
          [originalName]
        );
      }
    }

    // Anonymise handover entries authored by this staff member
    if (originalName) {
      await client.query(
        `UPDATE handover_entries SET author = '[REDACTED]', content = '[REDACTED]'
         WHERE home_id = $1 AND author = $2`,
        [homeId, originalName]
      );
    }

    // Anonymise consent records where this staff member was the subject
    await client.query(
      `UPDATE consent_records SET subject_name = $2, notes = NULL
       WHERE home_id = $1 AND subject_id = $3 AND deleted_at IS NULL`,
      [homeId, anon, staffId]
    );
    // Anonymise data requests where this staff member was the subject
    await client.query(
      `UPDATE data_requests SET subject_name = $2, notes = NULL
       WHERE home_id = $1 AND subject_id = $3 AND deleted_at IS NULL`,
      [homeId, anon, staffId]
    );
    // Anonymise DP complaints where this staff member was the complainant (matched by name)
    if (originalName) {
      await client.query(
        `UPDATE dp_complaints SET complainant_name = $2, description = '[REDACTED]'
         WHERE home_id = $1 AND complainant_name = $3 AND deleted_at IS NULL`,
        [homeId, anon, originalName]
      );
    }

    // Anonymise grievance action descriptions linked to this staff member's grievance cases
    await client.query(
      `UPDATE hr_grievance_actions SET description = '[REDACTED]'
       WHERE grievance_id IN (SELECT id FROM hr_grievance_cases WHERE home_id = $1 AND staff_id = $2)`,
      [homeId, staffId]
    );

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
         WHERE home_id = $2 AND raised_by_name = $3`,
        [anon, homeId, originalName]
      );
    }

    // Clear shift_overrides.reason — can contain health data (e.g. sick reasons)
    await client.query(
      `UPDATE shift_overrides SET reason = NULL WHERE home_id = $1 AND staff_id = $2`,
      [homeId, staffId]
    );

    // Redact audit_log entries containing this staff member's name in details.
    // audit_log.details is TEXT (not JSONB) — replace name references.
    if (originalName) {
      await client.query(
        `UPDATE audit_log SET details = REPLACE(details, $1, $2)
         WHERE details LIKE '%' || $1 || '%'`,
        [originalName, anon]
      );
    }

    // Clear webhook delivery payloads that may reference this staff member.
    // payload is JSONB — cast to TEXT for LIKE matching.
    await client.query(
      `UPDATE webhook_deliveries SET payload = '"[REDACTED]"'::jsonb
       FROM webhooks w
       WHERE w.id = webhook_deliveries.webhook_id AND w.home_id = $1
         AND webhook_deliveries.payload::text LIKE '%' || $2 || '%'`,
      [homeId, staffId]
    );

    // Anonymise hr_investigation_meetings linked to this staff member's cases
    const meetingCaseCondition = `
      (case_type = 'disciplinary' AND case_id IN (SELECT id FROM hr_disciplinary_cases WHERE home_id = $1 AND staff_id = $2))
      OR (case_type = 'grievance' AND case_id IN (SELECT id FROM hr_grievance_cases WHERE home_id = $1 AND staff_id = $2))
      OR (case_type = 'performance' AND case_id IN (SELECT id FROM hr_performance_cases WHERE home_id = $1 AND staff_id = $2))`;
    // Clear content fields (may contain subject PII). Preserve recorded_by — it is the
    // manager's username, not the subject's data. Only anonymise recorded_by if it matches
    // the subject's name (rare case where the subject recorded their own meeting).
    await client.query(
      `UPDATE hr_investigation_meetings SET
         attendees = '[]'::jsonb, summary = NULL, key_points = NULL, outcome = NULL
       WHERE home_id = $1 AND (${meetingCaseCondition})`,
      [homeId, staffId]
    );
    if (originalName) {
      await client.query(
        `UPDATE hr_investigation_meetings SET recorded_by = $3
         WHERE home_id = $1 AND recorded_by = $4 AND (${meetingCaseCondition})`,
        [homeId, staffId, anon, originalName]
      );
    }

    // Clear free-text fields from retained HR records before pseudonymisation takes effect.
    // Structure/dates are kept for legal/audit reasons; free-text may contain special-category data.
    await client.query(
      `UPDATE hr_contracts SET notes = NULL WHERE home_id = $1 AND staff_id = $2`,
      [homeId, staffId]
    );
    await client.query(
      `UPDATE hr_family_leave SET notes = NULL WHERE home_id = $1 AND staff_id = $2`,
      [homeId, staffId]
    );
    await client.query(
      `UPDATE hr_flexible_working SET reason = NULL, notes = NULL WHERE home_id = $1 AND staff_id = $2`,
      [homeId, staffId]
    );
    await client.query(
      `UPDATE hr_rtw_dbs_renewals SET notes = NULL, dbs_certificate_number = '[REDACTED]'
       WHERE home_id = $1 AND staff_id = $2 AND dbs_certificate_number IS NOT NULL`,
      [homeId, staffId]
    );

    // Deliberately retained with staff_id linkage (pseudonymised via staff.name → [REDACTED]):
    // - timesheet_entries: operational hours data, retained per PAYE Regulations 2003 (6 years)
    // - payroll_lines/payroll_runs: salary records, retained per PAYE Regulations 2003 (6 years)
    // - payroll_ytd: cumulative tax year totals, retained alongside payroll_lines (reconstructable)
    // - sick_periods: dates retained per Limitation Act 1980 s.11 (6 years), notes cleared above
    // - pension_enrolments/contributions: retained per Pension Schemes Act 1993 (6 years)
    // - shift_overrides: dates/shift codes retained as operational data, reason cleared above
    // - hr_contracts, hr_family_leave, hr_flexible_working: structure/dates retained per Limitation
    //   Act (6 years); free-text notes/reason cleared above
    // - hr_rtw_dbs_renewals: retained for compliance audit trail; notes/DBS cert number cleared above

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

/**
 * Execute right-to-erasure for a RESIDENT by anonymising personal data.
 * Uses transaction — all-or-nothing. Preserves record structure for CQC Reg 17 auditability.
 *
 * Article 17 UK GDPR exemptions for care homes:
 * - DoLS authorisations: CANNOT erase if authorisation is active (legal obligation under MCA 2005)
 * - Financial records: anonymise name but retain amounts for CQC financial viability auditing
 * - Incident/complaint records: anonymise name but retain event structure (CQC Reg 12/16/17)
 */
export async function executeResidentErasure(subjectId, homeId, requestId, username, homeSlug, subjectName) {
  return withTransaction(async (client) => {
    const anon = `[REDACTED-RES-${(subjectId || '').slice(0, 4)}]`;

    // Resolve resident PK from finance_residents to avoid name-collision erasure.
    // subjectId may be the finance_residents PK (numeric) or a string identifier.
    const { rows: residentRows } = await client.query(
      `SELECT id, resident_name FROM finance_residents
       WHERE home_id = $1 AND (id::text = $2 OR resident_name = $3) AND deleted_at IS NULL
       LIMIT 1`,
      [homeId, subjectId, subjectName || subjectId]
    );
    const resident = residentRows[0];
    const residentPk = resident?.id;
    const matchName = subjectName || resident?.resident_name || subjectId;

    // Block erasure of residents with active DoLS authorisations (MCA 2005 legal obligation)
    // Use resident_id FK when available for robust matching, fall back to name
    const { rows: activeDols } = residentPk
      ? await client.query(
          `SELECT id FROM dols WHERE home_id = $1 AND (resident_id = $2 OR resident_name = $3)
           AND (expiry_date IS NULL OR expiry_date > CURRENT_DATE) AND deleted_at IS NULL`,
          [homeId, residentPk, matchName])
      : await client.query(
          `SELECT id FROM dols WHERE home_id = $1 AND resident_name = $2
           AND (expiry_date IS NULL OR expiry_date > CURRENT_DATE) AND deleted_at IS NULL`,
          [homeId, matchName]);
    if (activeDols.length > 0) {
      throw new ValidationError('Cannot erase resident with active DoLS authorisation (MCA 2005 legal obligation)');
    }

    // Anonymise DoLS records (expired/review_due only — actives blocked above)
    if (residentPk) {
      await client.query(
        `UPDATE dols SET resident_name = $1, dob = NULL, notes = NULL
         WHERE home_id = $2 AND (resident_id = $3 OR resident_name = $4) AND deleted_at IS NULL`,
        [anon, homeId, residentPk, matchName]);
    } else {
      await client.query(
        `UPDATE dols SET resident_name = $1, dob = NULL, notes = NULL
         WHERE home_id = $2 AND resident_name = $3 AND deleted_at IS NULL`,
        [anon, homeId, matchName]);
    }

    // Anonymise MCA assessments — same pattern
    if (residentPk) {
      await client.query(
        `UPDATE mca_assessments SET resident_name = $1, notes = NULL
         WHERE home_id = $2 AND (resident_id = $3 OR resident_name = $4) AND deleted_at IS NULL`,
        [anon, homeId, residentPk, matchName]);
    } else {
      await client.query(
        `UPDATE mca_assessments SET resident_name = $1, notes = NULL
         WHERE home_id = $2 AND resident_name = $3 AND deleted_at IS NULL`,
        [anon, homeId, matchName]);
    }

    // Anonymise finance_residents — use PK if resolved, else fall back to name
    // Table has: resident_name, room_number, notes, top_up_contact (PII fields)
    if (residentPk) {
      await client.query(
        `UPDATE finance_residents SET resident_name = $1, top_up_contact = NULL, notes = NULL
         WHERE home_id = $2 AND id = $3 AND deleted_at IS NULL`,
        [anon, homeId, residentPk]
      );
    } else {
      await client.query(
        `UPDATE finance_residents SET resident_name = $1, top_up_contact = NULL, notes = NULL
         WHERE home_id = $2 AND resident_name = $3 AND deleted_at IS NULL`,
        [anon, homeId, matchName]
      );
    }

    // Anonymise incident_addenda content BEFORE anonymising incidents — the subquery
    // below uses person_affected_name which must still hold the original name at this point.
    if (residentPk) {
      await client.query(
        `UPDATE incident_addenda SET content = '[REDACTED]'
         WHERE home_id = $1 AND incident_id IN (
           SELECT id FROM incidents WHERE home_id = $1
           AND (resident_id = $2 OR person_affected_name = $3) AND deleted_at IS NULL
         )`,
        [homeId, residentPk, matchName]);
    } else {
      await client.query(
        `UPDATE incident_addenda SET content = '[REDACTED]'
         WHERE home_id = $1 AND incident_id IN (
           SELECT id FROM incidents WHERE home_id = $1
           AND person_affected_name = $2 AND deleted_at IS NULL
         )`,
        [homeId, matchName]);
    }

    // Anonymise incidents where resident was the affected person — use FK when available
    // Clear all free-text narrative fields that may contain the resident's name
    if (residentPk) {
      await client.query(
        `UPDATE incidents SET person_affected_name = $1,
           description = '[Redacted — subject erasure]', immediate_action = '[Redacted]',
           root_cause = '[Redacted]', lessons_learned = '[Redacted]', witnesses = '[]'::jsonb
         WHERE home_id = $2 AND (resident_id = $3 OR person_affected_name = $4) AND deleted_at IS NULL`,
        [anon, homeId, residentPk, matchName]);
    } else {
      await client.query(
        `UPDATE incidents SET person_affected_name = $1,
           description = '[Redacted — subject erasure]', immediate_action = '[Redacted]',
           root_cause = '[Redacted]', lessons_learned = '[Redacted]', witnesses = '[]'::jsonb
         WHERE home_id = $2 AND person_affected_name = $3 AND deleted_at IS NULL`,
        [anon, homeId, matchName]);
    }

    // Anonymise complaints raised by or about the resident — use FK when available
    // Clear all free-text narrative fields that may contain the resident's name
    if (residentPk) {
      await client.query(
        `UPDATE complaints SET raised_by_name = $1, description = '[REDACTED]',
           investigation_notes = '[Redacted]', resolution = '[Redacted]',
           root_cause = '[Redacted]', improvements = '[Redacted]', lessons_learned = '[Redacted]'
         WHERE home_id = $2 AND (resident_id = $3 OR raised_by_name = $4) AND deleted_at IS NULL`,
        [anon, homeId, residentPk, matchName]);
    } else {
      await client.query(
        `UPDATE complaints SET raised_by_name = $1, description = '[REDACTED]',
           investigation_notes = '[Redacted]', resolution = '[Redacted]',
           root_cause = '[Redacted]', improvements = '[Redacted]', lessons_learned = '[Redacted]'
         WHERE home_id = $2 AND raised_by_name = $3 AND deleted_at IS NULL`,
        [anon, homeId, matchName]);
    }

    // Anonymise bed occupancy + finance records
    if (residentPk) {
      await client.query(
        `UPDATE bed_transitions SET reason = NULL WHERE home_id = $1 AND resident_id = $2`,
        [homeId, residentPk]);
      await client.query(
        `UPDATE finance_invoices SET notes = NULL WHERE home_id = $1 AND resident_id = $2 AND deleted_at IS NULL`,
        [homeId, residentPk]);
      // Finance detail tables — fee changes, invoice chase
      await client.query(
        `UPDATE finance_fee_changes SET notes = NULL WHERE home_id = $1 AND resident_id = $2`,
        [homeId, residentPk]);
      await client.query(
        `UPDATE finance_invoice_chase SET notes = NULL WHERE invoice_id IN (SELECT id FROM finance_invoices WHERE home_id = $1 AND resident_id = $2)`,
        [homeId, residentPk]);
    }

    // Anonymise GDPR module own tables where resident was the subject
    await client.query(
      `UPDATE consent_records SET subject_name = $2, notes = NULL
       WHERE home_id = $1 AND subject_id = $3 AND deleted_at IS NULL`,
      [homeId, anon, subjectId]
    );
    await client.query(
      `UPDATE data_requests SET subject_name = $2, notes = NULL
       WHERE home_id = $1 AND subject_id = $3 AND deleted_at IS NULL`,
      [homeId, anon, subjectId]
    );
    if (matchName) {
      await client.query(
        `UPDATE dp_complaints SET complainant_name = $2, description = '[REDACTED]'
         WHERE home_id = $1 AND complainant_name = $3 AND deleted_at IS NULL`,
        [homeId, anon, matchName]
      );
    }

    // Mark the request as completed
    if (requestId) {
      await gdprRepo.updateRequest(requestId, homeId, {
        status: 'completed',
        completed_date: new Date().toISOString().slice(0, 10),
        completed_by: username,
      }, client);
    }

    await auditRepo.log('erasure', homeSlug || null, username, `Erased resident "${subjectName || subjectId}" from home ${homeId}`, client);

    return { anonymised: true, subject_type: 'resident', subject_id: subjectId };
  });
}

// ── Retention Scan ───────────────────────────────────────────────────────────

/**
 * Read-only scan of data against retention schedule.
 * Returns a report of what data exists and whether it's past retention.
 */
// Tables allowed in retention scan queries — prevents SQL injection via applies_to_table
const RETENTION_ALLOWED_TABLES = new Set([
  'staff', 'sick_periods', 'training_records', 'onboarding', 'payroll_runs',
  'pension_enrolments', 'incidents', 'complaints', 'dols', 'audit_log',
  'access_log', 'risk_register', 'whistleblowing_concerns', 'maintenance',
  'retention_schedule',
  // HR module tables (6-year retention per Limitation Act 1980)
  'hr_disciplinary_cases', 'hr_grievance_cases', 'hr_performance_cases',
  'hr_rtw_interviews', 'hr_oh_referrals', 'hr_contracts', 'hr_family_leave',
  'hr_flexible_working', 'hr_edi_records', 'hr_tupe_transfers', 'hr_rtw_dbs_renewals',
  // Finance tables (6-year retention per Companies Act / HMRC)
  'finance_invoices', 'finance_expenses',
]);

// Global tables skipped from per-home retention scan (see scanRetention).
// These lack meaningful per-home scoping — their counts reflect all homes combined.
const GLOBAL_TABLES = new Set(['retention_schedule', 'access_log', 'audit_log']);

// Date column overrides for tables that don't use 'created_at'
const TS_TABLES = new Set([]); // access_log/audit_log used 'ts' but are now skipped as global

// Tables that use 'updated_at' instead of 'created_at'
const UPDATED_AT_TABLES = new Set(['onboarding', 'pension_enrolments']);

export async function scanRetention(homeId) {
  const schedule = await gdprRepo.getRetentionSchedule();

  const results = [];
  for (const rule of schedule) {
    if (!rule.applies_to_table) continue;
    if (!RETENTION_ALLOWED_TABLES.has(rule.applies_to_table)) continue;

    const table = rule.applies_to_table;
    // Skip global tables from per-home retention scoring — their counts reflect
    // all homes combined, which distorts individual home compliance posture.
    if (GLOBAL_TABLES.has(table)) continue;
    const dateCol = TS_TABLES.has(table) ? 'ts' : UPDATED_AT_TABLES.has(table) ? 'updated_at' : 'created_at';
    let count = 0;
    let expiredCount = 0;

    try {
      // Count total records (always scoped by home_id — global tables skipped above)
      const totalResult = await pool.query(
        `SELECT COUNT(*) AS cnt FROM ${table} WHERE home_id = $1`,
        [homeId]
      );
      count = parseInt(totalResult.rows[0].cnt, 10);

      // Count records past retention
      const expiredResult = await pool.query(
        `SELECT COUNT(*) AS cnt FROM ${table} WHERE home_id = $1 AND ${dateCol} < NOW() - INTERVAL '1 day' * $2`,
        [homeId, rule.retention_days]
      );
      expiredCount = parseInt(expiredResult.rows[0].cnt, 10);
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
// Server-side breach risk assessment — mirrors src/lib/gdpr.js assessBreachRisk
// but adds ICO deadline and detailed factors for the API response.
export function assessBreachRisk(breachData) {
  const severityWeights = { low: 1, medium: 2, high: 3, critical: 4 };
  const riskWeights = { unlikely: 1, possible: 2, likely: 3, high: 4 };

  const sevScore = severityWeights[breachData.severity] || 1;
  const riskScore = riskWeights[breachData.risk_to_rights] || 1;
  const affectedScore = Math.min(4, breachData.individuals_affected ?? 1);

  const specialCats = (breachData.data_categories || []).filter(c =>
    ['staff_health', 'dbs', 'resident_health', 'dols', 'mca'].includes(c)
  );
  const identityRiskCats = (breachData.data_categories || []).filter(c =>
    ['personal_data', 'payroll', 'tax', 'pension'].includes(c)
  );

  let multiplier = 1.0;
  if (specialCats.length > 0) multiplier = 1.5;
  if (identityRiskCats.length > 0) multiplier = Math.max(multiplier, 1.3);

  const rawScore = ((sevScore + riskScore + affectedScore) / 3) * multiplier;
  const score = Math.round(rawScore * 10) / 10;

  let riskLevel;
  if (score >= 3.0) riskLevel = 'critical';
  else if (score >= 2.0) riskLevel = 'high';
  else if (score >= 1.0) riskLevel = 'medium';
  else riskLevel = 'low';

  const icoNotifiable = riskLevel !== 'low';

  // ICO deadline: 72 hours from discovery (UK GDPR Article 33).
  // Append Z to date-only strings so they parse as UTC, not local time (BST-safe).
  const discoveredRaw = breachData.discovered_date;
  const discoveredDate = discoveredRaw
    ? new Date(discoveredRaw.length === 10 ? discoveredRaw + 'T00:00:00Z' : discoveredRaw)
    : null;
  const icoDeadline = discoveredDate && !isNaN(discoveredDate.getTime())
    ? new Date(discoveredDate.getTime() + 72 * 60 * 60 * 1000)
    : null;

  return {
    score,
    riskLevel,
    icoNotifiable,
    icoDeadline: icoDeadline ? icoDeadline.toISOString() : null,
    specialCategoryDataInvolved: specialCats.length > 0,
    factors: {
      severity: sevScore,
      riskToRights: riskScore,
      affected: affectedScore,
      multiplier,
    },
  };
}

// ── Passthrough to repo ──────────────────────────────────────────────────────

export async function findRequests(homeId) { const r = await gdprRepo.findRequests(homeId); return r.rows; }
export async function findRequestById(id, homeId) { return gdprRepo.findRequestById(id, homeId); }
export async function createRequest(homeId, data) { return gdprRepo.createRequest(homeId, data); }
export async function updateRequest(id, homeId, data, client, version) { return gdprRepo.updateRequest(id, homeId, data, client, version); }

export async function findBreaches(homeId) { const r = await gdprRepo.findBreaches(homeId); return r.rows; }
export async function findBreachById(id, homeId) { return gdprRepo.findBreachById(id, homeId); }
export async function createBreach(homeId, data) { return gdprRepo.createBreach(homeId, data); }
export async function updateBreach(id, homeId, data, version) {
  return withTransaction(async (client) => {
    if (data.status && ['resolved', 'closed'].includes(data.status)) {
      const current = await gdprRepo.findBreachById(id, homeId, client);
      if (current?.ico_notifiable && !current?.ico_notified) {
        throw new ValidationError('ICO must be notified before resolving a notifiable breach');
      }
    }
    return gdprRepo.updateBreach(id, homeId, data, client, version);
  });
}

export async function getRetentionSchedule() { return gdprRepo.getRetentionSchedule(); }

export async function findConsent(homeId) { const r = await gdprRepo.findConsent(homeId); return r.rows; }
export async function findConsentById(id, homeId) { return gdprRepo.findConsentById(id, homeId); }
export async function createConsent(homeId, data) { return gdprRepo.createConsent(homeId, data); }
export async function updateConsent(id, homeId, data, version) { return gdprRepo.updateConsent(id, homeId, data, null, version); }

export async function findDPComplaints(homeId) { const r = await gdprRepo.findDPComplaints(homeId); return r.rows; }
export async function findDPComplaintById(id, homeId) { return gdprRepo.findDPComplaintById(id, homeId); }
export async function createDPComplaint(homeId, data) { return gdprRepo.createDPComplaint(homeId, data); }
export async function updateDPComplaint(id, homeId, data, version) { return gdprRepo.updateDPComplaint(id, homeId, data, null, version); }

export async function getAccessLog({ limit = 100, offset = 0, homeSlugs } = {}) {
  if (!homeSlugs || homeSlugs.length === 0) {
    return gdprRepo.getAccessLog({ limit, offset });
  }
  return gdprRepo.getAccessLogByHomeSlugs(homeSlugs, { limit, offset });
}
