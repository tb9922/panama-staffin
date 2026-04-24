import fs from 'node:fs/promises';
import path from 'node:path';
import { pool, withTransaction } from '../db.js';
import * as gdprRepo from '../repositories/gdprRepo.js';
import * as auditRepo from '../repositories/auditRepo.js';
import * as hrRepo from '../repositories/hrRepo.js';
import { ConflictError, ValidationError } from '../errors.js';
import { config as appConfig } from '../config.js';
import * as authService from './authService.js';
import logger from '../logger.js';

/** Deduplicate rows by id. Assumes id is a non-null SERIAL PRIMARY KEY. */
function dedupeById(rows) {
  const seen = new Set();
  return rows.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
}

function normaliseMatchValues(values) {
  return [...new Set((values || [])
    .map((value) => typeof value === 'string' ? value.trim() : '')
    .filter(Boolean))];
}

async function findWebhookDeliveriesByPayload(conn, homeId, values) {
  const matchValues = normaliseMatchValues(values);
  if (matchValues.length === 0) return { rows: [] };
  return conn.query(
    `SELECT wd.* FROM webhook_deliveries wd
     JOIN webhooks w ON w.id = wd.webhook_id
     WHERE w.home_id = $1
       AND EXISTS (
         SELECT 1
           FROM unnest($2::text[]) AS target(val)
          WHERE jsonb_path_exists(
            wd.payload,
            '$.** ? (@ == $target)',
            jsonb_build_object('target', to_jsonb(target.val))
          )
       )`,
    [homeId, matchValues],
  );
}

async function redactWebhookDeliveriesByPayload(conn, homeId, values) {
  const matchValues = normaliseMatchValues(values);
  if (matchValues.length === 0) return { rowCount: 0 };
  return conn.query(
    `UPDATE webhook_deliveries
        SET payload = '"[REDACTED]"'::jsonb
       FROM webhooks w
      WHERE w.id = webhook_deliveries.webhook_id
        AND w.home_id = $1
        AND EXISTS (
          SELECT 1
            FROM unnest($2::text[]) AS target(val)
           WHERE jsonb_path_exists(
             webhook_deliveries.payload,
             '$.** ? (@ == $target)',
             jsonb_build_object('target', to_jsonb(target.val))
           )
        )`,
    [homeId, matchValues],
  );
}

async function runSequentialQueries(tasks) {
  const results = [];
  for (const task of tasks) {
    results.push(await task());
  }
  return results;
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
      const { rows: linkedUserRows } = staffName
        ? await conn.query(
            `SELECT u.username
               FROM users u
              WHERE (u.display_name = $1 OR u.username = $1)
                AND EXISTS (
                  SELECT 1 FROM user_home_roles uhr
                   WHERE uhr.username = u.username
                     AND uhr.home_id = $2
                )`,
            [staffName, homeId]
          )
        : { rows: [] };
      const linkedUsernames = linkedUserRows.map((row) => row.username);

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
        trainingAttachments, onboardingAttachments,
        payrollLineShifts, userAccount, userHomeRoles,
        // GDPR module own tables — the subject may be the requester or consent giver
        consentRecords, dataRequests, dpComplaints,
        // Operational/CQC tables matched by name (no staff FK)
        agencyShifts, complaintSurveys, webhookDeliveries, cqcNarratives,
        cqcEvidence, cqcPartnerFeedback, cqcObservations, cqcEvidenceLinks,
      ] = await runSequentialQueries([
        () => conn.query(`SELECT * FROM staff WHERE home_id = $1 AND id = $2`, [homeId, subjectId]),
        () => conn.query(`SELECT * FROM shift_overrides WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
        () => conn.query(`SELECT * FROM training_records WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
        () => conn.query(`SELECT * FROM supervisions WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
        () => conn.query(`SELECT * FROM appraisals WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
        () => conn.query(`SELECT * FROM timesheet_entries WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
        () => conn.query(
          `SELECT pl.* FROM payroll_lines pl
           JOIN payroll_runs pr ON pr.id = pl.payroll_run_id
           WHERE pr.home_id = $1 AND pl.staff_id = $2`, [homeId, subjectId]),
        () => conn.query(`SELECT * FROM tax_codes WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
        () => conn.query(`SELECT * FROM sick_periods WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
        () => conn.query(`SELECT * FROM pension_enrolments WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
        () => conn.query(
          `SELECT pc.* FROM pension_contributions pc
           WHERE pc.home_id = $1 AND pc.staff_id = $2`, [homeId, subjectId]),
        // access_log is home-scoped; include only entries for this controller/home.
        // Resolve username from users table (matching by display_name or username at this home).
        () => staffName
          ? conn.query(
              `SELECT * FROM access_log
                 WHERE home_id = $1
                   AND (
                     user_name = $2
                     OR user_name IN (
                       SELECT username FROM users
                        WHERE display_name = $2
                          AND EXISTS (
                            SELECT 1 FROM user_home_roles
                             WHERE user_home_roles.username = users.username
                               AND user_home_roles.home_id = $1
                          )
                     )
                   )
                 ORDER BY ts DESC LIMIT 500`,
              [homeId, staffName],
            )
          : { rows: [] },
        // Staff appears in incident staff_involved JSONB array
        () => conn.query(
          `SELECT * FROM incidents WHERE home_id = $1 AND staff_involved @> jsonb_build_array($2::text) AND deleted_at IS NULL`,
          [homeId, subjectId]),
        // Staff appears in fire drill staff_present JSONB array
        () => conn.query(
          `SELECT * FROM fire_drills WHERE home_id = $1 AND staff_present @> jsonb_build_array($2::text)`,
          [homeId, subjectId]),
        () => staffName
          ? conn.query(`SELECT * FROM handover_entries WHERE home_id = $1 AND author = $2`, [homeId, staffName])
          : { rows: [] },
        // HR module — disciplinary, grievance, performance cases
        () => conn.query(`SELECT * FROM hr_disciplinary_cases WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
        () => conn.query(`SELECT * FROM hr_grievance_cases WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
        () => conn.query(
          `SELECT ga.* FROM hr_grievance_actions ga
           JOIN hr_grievance_cases gc ON gc.id = ga.grievance_id
           WHERE gc.home_id = $1 AND gc.staff_id = $2`, [homeId, subjectId]),
        () => conn.query(`SELECT * FROM hr_performance_cases WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
        // HR module — absence management
        () => conn.query(`SELECT * FROM hr_rtw_interviews WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
        () => conn.query(`SELECT * FROM hr_oh_referrals WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
        // HR module — contracts, family leave, flexible working, EDI
        () => conn.query(`SELECT * FROM hr_contracts WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
        () => conn.query(`SELECT * FROM hr_family_leave WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
        () => conn.query(`SELECT * FROM hr_flexible_working WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
        () => hrRepo.findEdi(homeId, { staffId: subjectId }, conn, { limit: 500, offset: 0 }).then(result => ({ rows: result.rows })),
        // HR module — TUPE: include only rows where the subject is explicitly present
        // in the employees JSON payload by staff ID or resolved name.
        () => staffName
          ? conn.query(
              `SELECT * FROM hr_tupe_transfers
               WHERE home_id = $1 AND deleted_at IS NULL
                 AND (
                   employees::text LIKE '%' || $2 || '%'
                   OR employees::text LIKE '%' || $3 || '%'
                 )`,
              [homeId, String(subjectId), staffName])
          : conn.query(
              `SELECT * FROM hr_tupe_transfers
               WHERE home_id = $1 AND deleted_at IS NULL
                 AND employees::text LIKE '%' || $2 || '%'`,
              [homeId, String(subjectId)]),
        // HR module — DBS/RTW renewals
        () => conn.query(`SELECT * FROM hr_rtw_dbs_renewals WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
        // HR module — case notes authored by this staff member (pre-resolved name)
        () => staffName
          ? conn.query(`SELECT * FROM hr_case_notes WHERE home_id = $1 AND author = $2`, [homeId, staffName])
          : { rows: [] },
        // HR module — case notes on this staff member's cases (written by anyone)
        () => conn.query(
          `SELECT cn.* FROM hr_case_notes cn
           WHERE cn.home_id = $1 AND (
             (cn.subject_type = 'staff' AND cn.subject_id = $2)
             OR
             (cn.case_type = 'disciplinary' AND cn.case_id IN (SELECT id FROM hr_disciplinary_cases WHERE home_id = $1 AND staff_id = $2))
             OR (cn.case_type = 'grievance' AND cn.case_id IN (SELECT id FROM hr_grievance_cases WHERE home_id = $1 AND staff_id = $2))
             OR (cn.case_type = 'performance' AND cn.case_id IN (SELECT id FROM hr_performance_cases WHERE home_id = $1 AND staff_id = $2))
           )`, [homeId, subjectId]),
        // Onboarding data (DBS, RTW, references, etc.)
        () => conn.query(`SELECT * FROM onboarding WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
        // Care Certificate progress
        () => conn.query(`SELECT * FROM care_certificates WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
        // Complaints where staff is the complainant (pre-resolved name)
        () => staffName
          ? conn.query(
              `SELECT * FROM complaints WHERE home_id = $1 AND deleted_at IS NULL AND raised_by_name = $2`,
              [homeId, staffName])
          : { rows: [] },
        // Post-freeze addenda authored by this staff member (pre-resolved name)
        () => staffName
          ? conn.query(
              `SELECT * FROM incident_addenda WHERE home_id = $1 AND author = $2 ORDER BY created_at ASC`,
              [homeId, staffName])
          : { rows: [] },
        // Payroll year-to-date accumulations
        () => conn.query(`SELECT * FROM payroll_ytd WHERE home_id = $1 AND staff_id = $2`, [homeId, subjectId]),
        // HR investigation meetings (linked via case tables)
        () => conn.query(
          `SELECT m.* FROM hr_investigation_meetings m
           WHERE m.home_id = $1 AND (
             (m.case_type = 'disciplinary' AND m.case_id IN (SELECT id FROM hr_disciplinary_cases WHERE home_id = $1 AND staff_id = $2))
             OR (m.case_type = 'grievance' AND m.case_id IN (SELECT id FROM hr_grievance_cases WHERE home_id = $1 AND staff_id = $2))
             OR (m.case_type = 'performance' AND m.case_id IN (SELECT id FROM hr_performance_cases WHERE home_id = $1 AND staff_id = $2))
           )`, [homeId, subjectId]),
        // HR file attachments (linked via case tables)
        () => conn.query(
          `SELECT a.* FROM hr_file_attachments a
           WHERE a.home_id = $1 AND (
             (a.case_type = 'disciplinary' AND a.case_id IN (SELECT id FROM hr_disciplinary_cases WHERE home_id = $1 AND staff_id = $2))
             OR (a.case_type = 'grievance' AND a.case_id IN (SELECT id FROM hr_grievance_cases WHERE home_id = $1 AND staff_id = $2))
             OR (a.case_type = 'performance' AND a.case_id IN (SELECT id FROM hr_performance_cases WHERE home_id = $1 AND staff_id = $2))
           )`, [homeId, subjectId]),
        () => conn.query(
          `SELECT * FROM training_file_attachments WHERE home_id = $1 AND staff_id = $2 AND deleted_at IS NULL`,
          [homeId, subjectId]),
        () => conn.query(
          `SELECT * FROM onboarding_file_attachments WHERE home_id = $1 AND staff_id = $2 AND deleted_at IS NULL`,
          [homeId, subjectId]),
        // Payroll shift detail (per-day hours, rates, amounts)
        () => conn.query(
          `SELECT pls.* FROM payroll_line_shifts pls
           JOIN payroll_lines pl ON pl.id = pls.payroll_line_id
           JOIN payroll_runs pr ON pr.id = pl.payroll_run_id
           WHERE pr.home_id = $1 AND pl.staff_id = $2`, [homeId, subjectId]),
        // System user account (if staff member has a login)
        () => staffName
          ? conn.query(
              `SELECT u.id, u.username, u.display_name, u.role, u.is_platform_admin, u.active, u.last_login_at, u.created_at
               FROM users u
               WHERE (u.display_name = $1 OR u.username = $1)
                 AND EXISTS (SELECT 1 FROM user_home_roles uhr WHERE uhr.username = u.username AND uhr.home_id = $2)`,
              [staffName, homeId])
          : { rows: [] },
        // Home role assignments — scoped to this home only (user_home_roles uses username)
        () => staffName
          ? conn.query(
              `SELECT uhr.* FROM user_home_roles uhr
               JOIN users u ON u.username = uhr.username
               WHERE (u.display_name = $1 OR u.username = $1) AND uhr.home_id = $2`, [staffName, homeId])
          : { rows: [] },
        // GDPR module own tables — consent records and data requests where subject is this staff member
        () => conn.query(`SELECT * FROM consent_records WHERE home_id = $1 AND subject_id = $2 AND deleted_at IS NULL`, [homeId, subjectId]),
        () => conn.query(`SELECT * FROM data_requests WHERE home_id = $1 AND subject_id = $2 AND deleted_at IS NULL`, [homeId, subjectId]),
        // DP complaints linked to this staff member, preferring stable subject_id linkage
        () => staffName
          ? conn.query(
              `SELECT * FROM dp_complaints
               WHERE home_id = $1
                 AND deleted_at IS NULL
                 AND (
                   (subject_type = 'staff' AND subject_id = $2)
                   OR (subject_id IS NULL AND complainant_name = $3)
                 )`,
              [homeId, subjectId, staffName],
            )
          : { rows: [] },
        // Agency shifts where this staff member was the worker (matched by name — no staff FK)
        () => staffName
          ? conn.query(`SELECT * FROM agency_shifts WHERE home_id = $1 AND worker_name = $2`, [homeId, staffName])
          : { rows: [] },
        // Complaint surveys conducted by this staff member (matched by name — no staff FK)
        () => staffName
          ? conn.query(`SELECT * FROM complaint_surveys WHERE home_id = $1 AND conducted_by = $2 AND deleted_at IS NULL`, [homeId, staffName])
          : { rows: [] },
        () => subjectId || staffName || linkedUsernames.length > 0
          ? findWebhookDeliveriesByPayload(conn, homeId, [subjectId, staffName, ...linkedUsernames])
          : { rows: [] },
        // CQC self-assessment narratives reviewed by this staff member
        () => staffName
          ? conn.query(
              `SELECT * FROM cqc_statement_narratives
               WHERE home_id = $1 AND reviewed_by = $2 AND deleted_at IS NULL`,
              [homeId, staffName])
          : { rows: [] },
        () => (staffName || linkedUsernames.length > 0)
          ? conn.query(
              `SELECT * FROM cqc_evidence
               WHERE home_id = $1
                 AND deleted_at IS NULL
                 AND (
                   ($2::TEXT IS NOT NULL AND evidence_owner = $2)
                   OR ($3::TEXT[] IS NOT NULL AND added_by = ANY($3))
                 )`,
              [homeId, staffName || null, linkedUsernames.length > 0 ? linkedUsernames : null])
          : { rows: [] },
        () => staffName
          ? conn.query(
              `SELECT * FROM cqc_partner_feedback
               WHERE home_id = $1
                 AND deleted_at IS NULL
                 AND (partner_name = $2 OR evidence_owner = $2)`,
              [homeId, staffName])
          : { rows: [] },
        () => staffName
          ? conn.query(
              `SELECT * FROM cqc_observations
               WHERE home_id = $1
                 AND deleted_at IS NULL
                 AND (observer = $2 OR evidence_owner = $2)`,
              [homeId, staffName])
          : { rows: [] },
        () => (staffName || linkedUsernames.length > 0)
          ? conn.query(
              `SELECT * FROM cqc_evidence_links
               WHERE home_id = $1
                 AND deleted_at IS NULL
                 AND (
                   ($2::TEXT IS NOT NULL AND linked_by = $2)
                   OR ($3::TEXT[] IS NOT NULL AND linked_by = ANY($3))
                 )`,
              [homeId, staffName || null, linkedUsernames.length > 0 ? linkedUsernames : null])
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
          hr_rtw_dbs_renewals: hrRenewals.rows,
          hr_case_notes: dedupeById([...hrCaseNotes.rows, ...hrCaseNotesOnCases.rows]),
          onboarding: onboarding.rows,
          care_certificates: careCertificates.rows,
          complaints: complaints.rows,
          incident_addenda: incidentAddenda.rows,
          payroll_ytd: payrollYtd.rows,
          hr_investigation_meetings: hrMeetings.rows,
          hr_file_attachments: hrAttachments.rows,
          training_file_attachments: trainingAttachments.rows,
          onboarding_file_attachments: onboardingAttachments.rows,
          payroll_line_shifts: payrollLineShifts.rows,
          user_account: userAccount.rows,
          user_home_roles: userHomeRoles.rows,
          // GDPR module own tables
          consent_records: consentRecords.rows,
          data_requests: dataRequests.rows,
          dp_complaints: dpComplaints.rows,
          // Operational/CQC tables matched by name (no staff FK)
          agency_shifts: agencyShifts.rows,
          complaint_surveys: complaintSurveys.rows,
          webhook_deliveries: webhookDeliveries.rows,
          cqc_statement_narratives: cqcNarratives.rows,
          cqc_evidence: cqcEvidence.rows,
          cqc_partner_feedback: cqcPartnerFeedback.rows,
          cqc_observations: cqcObservations.rows,
          cqc_evidence_links: cqcEvidenceLinks.rows,
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
        () => subjectName
          ? conn.query(
              residentPk
                ? `SELECT * FROM dols WHERE home_id = $1 AND (resident_id = $2 OR resident_name = $3) AND deleted_at IS NULL`
                : `SELECT * FROM dols WHERE home_id = $1 AND resident_name = $2 AND deleted_at IS NULL`,
              residentPk ? [homeId, residentPk, subjectName] : [homeId, subjectName])
          : { rows: [] },
        () => subjectName
          ? conn.query(
              residentPk
                ? `SELECT * FROM mca_assessments WHERE home_id = $1 AND (resident_id = $2 OR resident_name = $3) AND deleted_at IS NULL`
                : `SELECT * FROM mca_assessments WHERE home_id = $1 AND resident_name = $2 AND deleted_at IS NULL`,
              residentPk ? [homeId, residentPk, subjectName] : [homeId, subjectName])
          : { rows: [] },
        // Finance: resident record, invoices, fee changes, invoice lines, payment schedule, chase
        () => subjectName
          ? conn.query(`SELECT * FROM finance_residents WHERE home_id = $1 AND resident_name = $2 AND deleted_at IS NULL`, [homeId, subjectName])
          : { rows: [] },
        () => subjectName
          ? conn.query(
              `SELECT fi.* FROM finance_invoices fi
               JOIN finance_residents fr ON fr.id = fi.resident_id AND fr.home_id = fi.home_id
               WHERE fi.home_id = $1 AND fr.resident_name = $2 AND fi.deleted_at IS NULL`,
              [homeId, subjectName])
          : { rows: [] },
        // Beds and bed transitions — linked via finance_residents by name
        () => subjectName
          ? conn.query(
              `SELECT b.* FROM beds b
               JOIN finance_residents fr ON fr.id = b.resident_id AND fr.home_id = b.home_id
               WHERE b.home_id = $1 AND fr.resident_name = $2`, [homeId, subjectName])
          : { rows: [] },
        () => subjectName
          ? conn.query(
              `SELECT bt.* FROM bed_transitions bt
               JOIN beds b ON b.id = bt.bed_id AND b.home_id = bt.home_id
               JOIN finance_residents fr ON fr.id = b.resident_id AND fr.home_id = b.home_id
               WHERE bt.home_id = $1 AND fr.resident_name = $2 ORDER BY bt.changed_at DESC`, [homeId, subjectName])
          : { rows: [] },
        // Finance detail tables (linked via resident_id on finance_residents)
        () => subjectName
          ? conn.query(
              `SELECT fc.* FROM finance_fee_changes fc
               JOIN finance_residents fr ON fr.id = fc.resident_id AND fr.home_id = $1
               WHERE fr.resident_name = $2`, [homeId, subjectName])
          : { rows: [] },
        () => subjectName
          ? conn.query(
              `SELECT fil.* FROM finance_invoice_lines fil
               JOIN finance_invoices fi ON fi.id = fil.invoice_id
               JOIN finance_residents fr ON fr.id = fi.resident_id AND fr.home_id = fi.home_id
               WHERE fi.home_id = $1 AND fr.resident_name = $2 AND fi.deleted_at IS NULL`,
              [homeId, subjectName])
          : { rows: [] },
        // finance_payment_schedule is AP (supplier schedules) — no resident_id column.
        // Not included in resident SAR.
        () => subjectName
          ? conn.query(
              `SELECT ic.* FROM finance_invoice_chase ic
               JOIN finance_invoices fi ON fi.id = ic.invoice_id
               JOIN finance_residents fr ON fr.id = fi.resident_id AND fr.home_id = fi.home_id
               WHERE fi.home_id = $1 AND fr.resident_name = $2`, [homeId, subjectName])
          : { rows: [] },
        // GDPR module own tables — consent records and data requests by subject_id
        () => conn.query(`SELECT * FROM consent_records WHERE home_id = $1 AND subject_id = $2 AND deleted_at IS NULL`, [homeId, subjectId]),
        () => conn.query(`SELECT * FROM data_requests WHERE home_id = $1 AND subject_id = $2 AND deleted_at IS NULL`, [homeId, subjectId]),
        // DP complaints linked to this resident, preferring stable subject_id linkage
        () => subjectName
          ? conn.query(
              `SELECT * FROM dp_complaints
               WHERE home_id = $1
                 AND deleted_at IS NULL
                 AND (
                   (subject_type = 'resident' AND subject_id = $2)
                   OR (subject_id IS NULL AND complainant_name = $3)
                 )`,
              [homeId, subjectId, subjectName],
            )
          : { rows: [] },
        () => subjectId || subjectName
          ? findWebhookDeliveriesByPayload(conn, homeId, [subjectId, subjectName])
          : { rows: [] },
      ];
      // Name-based queries for incidents/complaints
      if (subjectName) {
        queries.push(
          () => conn.query(
            residentPk
              ? `SELECT * FROM incidents WHERE home_id = $1 AND (resident_id = $2 OR person_affected_name = $3) AND deleted_at IS NULL`
              : `SELECT * FROM incidents WHERE home_id = $1 AND person_affected_name = $2 AND deleted_at IS NULL`,
            residentPk ? [homeId, residentPk, subjectName] : [homeId, subjectName]),
          () => conn.query(
            residentPk
              ? `SELECT * FROM complaints WHERE home_id = $1 AND (resident_id = $2 OR raised_by_name = $3) AND deleted_at IS NULL`
              : `SELECT * FROM complaints WHERE home_id = $1 AND raised_by_name = $2 AND deleted_at IS NULL`,
            residentPk ? [homeId, residentPk, subjectName] : [homeId, subjectName]),
          // Post-freeze addenda on incidents involving this resident (Article 15 completeness)
          () => conn.query(
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
      const results = await runSequentialQueries(queries);
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
          // GDPR module own tables (indices 9-12, always present)
          consent_records: results[9].rows,
          data_requests: results[10].rows,
          dp_complaints: results[11].rows,
          webhook_deliveries: results[12].rows,
          // Incident/complaint queries pushed conditionally (indices 13-15)
          incidents: results[13]?.rows || [],
          complaints: results[14]?.rows || [],
          incident_addenda: results[15]?.rows || [],
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
  const filesToDelete = [];

  const result = await withTransaction(async (client) => {
    if (requestId) {
      const request = await gdprRepo.findRequestById(requestId, homeId, client);
      if (!request) throw new ValidationError('Data request not found');
      if (request.status === 'completed') {
        throw new ConflictError('Erasure request has already been completed');
      }
    }

    const anon = `[REDACTED-${staffId.slice(0, 4)}]`;

    // Capture original name BEFORE anonymising — needed for name-keyed tables
    // (hr_case_notes.author, handover_entries.author, access_log.user_name)
    const { rows: [staffRow] } = await client.query(
      `SELECT name FROM staff WHERE home_id = $1 AND id = $2`, [homeId, staffId]
    );
    const originalName = staffRow?.name;
    if (originalName?.startsWith('[REDACTED-')) {
      throw new ConflictError('Staff has already been anonymised');
    }
    const { rows: linkedUsers } = originalName
      ? await client.query(
          `SELECT u.username FROM users u
           WHERE (u.display_name = $1 OR u.username = $1)
             AND EXISTS (
               SELECT 1 FROM user_home_roles uhr
               WHERE uhr.username = u.username AND uhr.home_id = $2
             )`,
          [originalName, homeId]
        )
      : { rows: [] };
    const linkedUsernames = linkedUsers.map((row) => row.username);

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
    const { rows: trainingAttachments } = await client.query(
      `SELECT stored_name, training_type
         FROM training_file_attachments
        WHERE home_id = $1 AND staff_id = $2 AND deleted_at IS NULL`,
      [homeId, staffId]
    );
    for (const attachment of trainingAttachments) {
      filesToDelete.push(path.join(
        appConfig.upload.dir,
        String(homeId),
        'training',
        String(staffId),
        String(attachment.training_type),
        attachment.stored_name,
      ));
    }
    await client.query(
      `DELETE FROM training_file_attachments WHERE home_id = $1 AND staff_id = $2`,
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
         outcome = NULL, notes = NULL,
         harassment_category = NULL,
         respondent_name = NULL,
         reasonable_steps_evidence = '[]'::jsonb,
         access_to_work_reference = NULL,
         sensitive_encrypted = NULL,
         sensitive_iv = NULL,
         sensitive_tag = NULL
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
      filesToDelete.push(path.join(appConfig.upload.dir, String(homeId), att.case_type, String(att.case_id), att.stored_name));
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

    // Anonymise access_log entries for this staff member, scoped to this home.
    // Only redact when the original name is unique within the home so a common
    // display name cannot erase another staff member's audit trail.
    if (originalName) {
      const { rows: nameCount } = await client.query(
        `SELECT COUNT(*) AS cnt
           FROM staff
          WHERE home_id = $2
            AND name = $1
            AND id <> $3`,
        [originalName, homeId, staffId]
      );
      if (parseInt(nameCount[0]?.cnt, 10) === 0) {
        await client.query(
          `UPDATE access_log
              SET user_name = '[REDACTED]'
            WHERE home_id = $1
              AND (
                user_name = $2
                OR ($3::TEXT[] IS NOT NULL AND user_name = ANY($3))
              )`,
          [homeId, originalName, linkedUsernames.length > 0 ? linkedUsernames : null]
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
    // Anonymise DP complaints where this staff member was the complainant.
    if (originalName) {
      await client.query(
        `UPDATE dp_complaints SET complainant_name = $2, description = '[REDACTED]'
         WHERE home_id = $1
           AND deleted_at IS NULL
           AND (
             (subject_type = 'staff' AND subject_id = $3)
             OR (subject_id IS NULL AND complainant_name = $4)
           )`,
        [homeId, anon, staffId, originalName]
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
    const { rows: onboardingAttachments } = await client.query(
      `SELECT stored_name, section
         FROM onboarding_file_attachments
        WHERE home_id = $1 AND staff_id = $2 AND deleted_at IS NULL`,
      [homeId, staffId]
    );
    for (const attachment of onboardingAttachments) {
      filesToDelete.push(path.join(
        appConfig.upload.dir,
        String(homeId),
        'onboarding',
        String(staffId),
        String(attachment.section),
        attachment.stored_name,
      ));
    }
    await client.query(
      `DELETE FROM onboarding_file_attachments WHERE home_id = $1 AND staff_id = $2`,
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

    // Anonymise agency_shifts where this staff member was the worker (no staff FK — name match)
    if (originalName) {
      await client.query(
        `UPDATE agency_shifts SET worker_name = $1 WHERE home_id = $2 AND worker_name = $3`,
        [anon, homeId, originalName]
      );
    }

    // Anonymise complaint_surveys conducted by this staff member (no staff FK — name match)
    if (originalName) {
      await client.query(
        `UPDATE complaint_surveys SET conducted_by = $1
         WHERE home_id = $2 AND conducted_by = $3 AND deleted_at IS NULL`,
        [anon, homeId, originalName]
      );
    }

    // Anonymise CQC self-assessment reviewer attribution while preserving the narrative itself.
    if (originalName) {
      await client.query(
        `UPDATE cqc_statement_narratives
            SET reviewed_by = $1
          WHERE home_id = $2 AND reviewed_by = $3 AND deleted_at IS NULL`,
        [anon, homeId, originalName]
      );
      await client.query(
        `UPDATE cqc_evidence
            SET evidence_owner = $1
          WHERE home_id = $2
            AND deleted_at IS NULL
            AND evidence_owner = $3`,
        [anon, homeId, originalName]
      );
      await client.query(
        `UPDATE cqc_partner_feedback
            SET partner_name = $1,
                evidence_owner = $1
          WHERE home_id = $2
            AND deleted_at IS NULL
            AND (partner_name = $3 OR evidence_owner = $3)`,
        [anon, homeId, originalName]
      );
      await client.query(
        `UPDATE cqc_observations
            SET observer = $1,
                evidence_owner = $1
          WHERE home_id = $2
            AND deleted_at IS NULL
            AND (observer = $3 OR evidence_owner = $3)`,
        [anon, homeId, originalName]
      );
    }
    if (linkedUsernames.length > 0 || originalName) {
      await client.query(
        `UPDATE cqc_evidence_links
            SET linked_by = $1,
                rationale = NULL
          WHERE home_id = $2
            AND deleted_at IS NULL
            AND (
              ($3::TEXT IS NOT NULL AND linked_by = $3)
              OR ($4::TEXT[] IS NOT NULL AND linked_by = ANY($4))
            )`,
        [anon, homeId, originalName || null, linkedUsernames.length > 0 ? linkedUsernames : null]
      );
    }

    // Clear shift_overrides.reason — can contain health data (e.g. sick reasons)
    await client.query(
      `UPDATE shift_overrides SET reason = NULL WHERE home_id = $1 AND staff_id = $2`,
      [homeId, staffId]
    );

    // Redact audit_log entries containing this staff member's name in details.
    // Scoped to this home's slug to prevent cross-tenant collateral redaction
    // (common names like "John Smith" must not redact audit entries at other homes).
    if (originalName) {
      await auditRepo.replaceInDetails({
        homeSlug: homeSlug || null,
        findText: originalName,
        replacement: anon,
        client,
      });
    }

    // Clear webhook delivery payloads that may reference this staff member.
    await redactWebhookDeliveriesByPayload(client, homeId, [staffId, originalName, ...linkedUsernames]);

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
    await client.query(
      `UPDATE pension_enrolments SET notes = NULL WHERE home_id = $1 AND staff_id = $2`,
      [homeId, staffId]
    );
    // - shift_overrides: dates/shift codes retained as operational data, reason cleared above
    // - hr_contracts, hr_family_leave, hr_flexible_working: structure/dates retained per Limitation
    //   Act (6 years); free-text notes/reason cleared above
    // - hr_rtw_dbs_renewals: retained for compliance audit trail; notes/DBS cert number cleared above

    // Anonymise linked user account (Article 17 — display_name is personal data).
    // Removes home-level role access and deactivates the account to prevent future logins.
    // username is preserved (it is the login identifier, not the subject's full name).
    if (linkedUsernames.length > 0) {
      for (const linkedUsername of linkedUsernames) {
        await client.query(
          `UPDATE users SET display_name = $1, active = false WHERE username = $2`,
          [anon, linkedUsername]
        );
        await client.query(
          `DELETE FROM user_home_roles WHERE username = $1 AND home_id = $2`,
          [linkedUsername, homeId]
        );
        await authService.revokeUser(linkedUsername, 'admin', client);
      }
    }

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

  await Promise.all(filesToDelete.map(async (filePath) => {
    try {
      await fs.unlink(filePath);
    } catch (err) {
      if (err?.code !== 'ENOENT') {
        logger.warn({ filePath, err: err?.message }, 'GDPR erasure could not remove attachment after commit');
      }
    }
  }));

  return result;
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

    // Resolve the resident record as safely as possible. If a name maps to
    // multiple resident rows, fail closed instead of erasing the wrong person.
    let residentPk = null;
    let matchName = subjectName || subjectId || null;
    let allowNameFallback = false;

    const { rows: residentByIdRows } = await client.query(
      `SELECT id, resident_name
         FROM finance_residents
        WHERE home_id = $1
          AND id::text = $2
          AND deleted_at IS NULL`,
      [homeId, String(subjectId)]
    );
    if (residentByIdRows.length > 0) {
      residentPk = residentByIdRows[0].id;
      matchName = subjectName || residentByIdRows[0].resident_name || matchName;
      if (matchName) {
        const { rows: [nameMatch] } = await client.query(
          `SELECT COUNT(*)::int AS count
             FROM finance_residents
            WHERE home_id = $1
              AND resident_name = $2
              AND deleted_at IS NULL`,
          [homeId, matchName]
        );
        allowNameFallback = Number(nameMatch?.count || 0) === 1;
      }
    } else if (matchName) {
      const { rows: residentByNameRows } = await client.query(
        `SELECT id, resident_name
           FROM finance_residents
          WHERE home_id = $1
            AND resident_name = $2
            AND deleted_at IS NULL`,
        [homeId, matchName]
      );
      if (residentByNameRows.length > 1) {
        throw new ValidationError('Multiple residents share this name. Use the resident ID to erase safely.');
      }
      if (residentByNameRows.length === 1) {
        residentPk = residentByNameRows[0].id;
        matchName = residentByNameRows[0].resident_name;
        allowNameFallback = true;
      }
    }

    // Block erasure of residents with active DoLS authorisations (MCA 2005 legal obligation)
    // Use resident_id FK when available for robust matching, fall back to name
    const { rows: activeDols } = residentPk
      ? await client.query(
          `SELECT id FROM dols WHERE home_id = $1 AND (
             resident_id = $2
             OR ($3::boolean = true AND resident_id IS NULL AND resident_name = $4)
           )
           AND (expiry_date IS NULL OR expiry_date > CURRENT_DATE) AND deleted_at IS NULL`,
          [homeId, residentPk, allowNameFallback, matchName])
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
         WHERE home_id = $2 AND (
           resident_id = $3
           OR ($4::boolean = true AND resident_id IS NULL AND resident_name = $5)
         ) AND deleted_at IS NULL`,
        [anon, homeId, residentPk, allowNameFallback, matchName]);
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
         WHERE home_id = $2 AND (
           resident_id = $3
           OR ($4::boolean = true AND resident_id IS NULL AND resident_name = $5)
         ) AND deleted_at IS NULL`,
        [anon, homeId, residentPk, allowNameFallback, matchName]);
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
           AND (
             resident_id = $2
             OR ($3::boolean = true AND resident_id IS NULL AND person_affected_name = $4)
           ) AND deleted_at IS NULL
         )`,
        [homeId, residentPk, allowNameFallback, matchName]);
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
         WHERE home_id = $2 AND (
           resident_id = $3
           OR ($4::boolean = true AND resident_id IS NULL AND person_affected_name = $5)
         ) AND deleted_at IS NULL`,
        [anon, homeId, residentPk, allowNameFallback, matchName]);
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
         WHERE home_id = $2 AND (
           resident_id = $3
           OR ($4::boolean = true AND resident_id IS NULL AND raised_by_name = $5)
         ) AND deleted_at IS NULL`,
        [anon, homeId, residentPk, allowNameFallback, matchName]);
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
         WHERE home_id = $1
           AND deleted_at IS NULL
           AND (
             (subject_type = 'resident' AND subject_id = $3)
             OR (subject_id IS NULL AND complainant_name = $4)
           )`,
        [homeId, anon, subjectId, matchName]
      );
      await client.query(
        `UPDATE handover_entries SET content = '[REDACTED]'
         WHERE home_id = $1 AND content LIKE '%' || $2 || '%'`,
        [homeId, matchName]
      );
    }
    await redactWebhookDeliveriesByPayload(client, homeId, [subjectId, matchName]);

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
  'retention_schedule', 'cqc_statement_narratives',
  // HR module tables (6-year retention per Limitation Act 1980)
  'hr_disciplinary_cases', 'hr_grievance_cases', 'hr_performance_cases',
  'hr_rtw_interviews', 'hr_oh_referrals', 'hr_contracts', 'hr_family_leave',
  'hr_flexible_working', 'hr_edi_records', 'hr_tupe_transfers', 'hr_rtw_dbs_renewals',
  // Finance tables (6-year retention per Companies Act / HMRC)
  'finance_invoices', 'finance_expenses',
]);

// Global tables skipped from per-home retention scan (see scanRetention).
// These lack meaningful per-home scoping — their counts reflect all homes combined.
const GLOBAL_TABLES = new Set(['retention_schedule']);

// Date column overrides for tables that don't use 'created_at'
const TS_TABLES = new Set(['access_log', 'audit_log']);

// Tables that use 'updated_at' instead of 'created_at'
const UPDATED_AT_TABLES = new Set(['onboarding', 'pension_enrolments']);

export async function scanRetention(homeId) {
  const schedule = await gdprRepo.getRetentionSchedule();
  const {
    rows: [homeRow],
  } = await pool.query(`SELECT slug FROM homes WHERE id = $1 AND deleted_at IS NULL`, [homeId]);
  const homeSlug = homeRow?.slug || null;

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
      if (table === 'access_log') {
        const totalResult = await pool.query(
          `SELECT COUNT(*) AS cnt FROM access_log WHERE home_id = $1`,
          [homeId],
        );
        count = parseInt(totalResult.rows[0].cnt, 10);

        const expiredResult = await pool.query(
          `SELECT COUNT(*) AS cnt
             FROM access_log
            WHERE home_id = $1
              AND ts < NOW() - INTERVAL '1 day' * $2`,
          [homeId, rule.retention_days],
        );
        expiredCount = parseInt(expiredResult.rows[0].cnt, 10);
      } else if (table === 'audit_log') {
        if (homeSlug) {
          const totalResult = await pool.query(
            `SELECT COUNT(*) AS cnt FROM audit_log WHERE home_slug = $1`,
            [homeSlug],
          );
          count = parseInt(totalResult.rows[0].cnt, 10);

          const expiredResult = await pool.query(
            `SELECT COUNT(*) AS cnt
               FROM audit_log
              WHERE home_slug = $1
                AND ts < NOW() - INTERVAL '1 day' * $2`,
            [homeSlug, rule.retention_days],
          );
          expiredCount = parseInt(expiredResult.rows[0].cnt, 10);
        }
      } else {
        const totalResult = await pool.query(
          `SELECT COUNT(*) AS cnt FROM ${table} WHERE home_id = $1`,
          [homeId]
        );
        count = parseInt(totalResult.rows[0].cnt, 10);

        const expiredResult = await pool.query(
          `SELECT COUNT(*) AS cnt FROM ${table} WHERE home_id = $1 AND ${dateCol} < NOW() - INTERVAL '1 day' * $2`,
          [homeId, rule.retention_days]
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
  const emptyCategories = (breachData.data_categories || []).length === 0;
  const vulnerableAdultContext = specialCats.some((category) =>
    ['resident_health', 'dols', 'mca'].includes(category)
  ) || emptyCategories;

  let multiplier = 1.0;
  if (specialCats.length > 0) multiplier = 1.5;
  if (identityRiskCats.length > 0) multiplier = Math.max(multiplier, 1.3);
  if (vulnerableAdultContext) multiplier = Math.max(multiplier, 1.5);

  const rawScore = ((sevScore + riskScore + affectedScore) / 3) * multiplier;
  const score = Math.round(rawScore * 10) / 10;

  let riskLevel;
  if (score >= 3.0) riskLevel = 'critical';
  else if (score >= 2.0) riskLevel = 'high';
  else if (score >= 1.0) riskLevel = 'medium';
  else riskLevel = 'low';

  const icoNotifiable = riskLevel !== 'low';

  // ICO deadline: 72 hours from discovery (UK GDPR Article 33).
  // For date-only entries, assume end-of-day UTC so we do not undercount the
  // statutory window by implicitly treating awareness as 00:00.
  const discoveredRaw = breachData.discovered_date;
  const discoveredDate = discoveredRaw
    ? new Date(discoveredRaw.length === 10 ? `${discoveredRaw}T23:59:59Z` : discoveredRaw)
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

export async function findProcessors(homeId) { return gdprRepo.findProcessors(homeId); }
export async function findProcessorById(id, homeId) { return gdprRepo.findProcessorById(id, homeId); }
export async function createProcessor(homeId, data) { return gdprRepo.createProcessor(homeId, data); }
export async function updateProcessor(id, homeId, data, version) { return gdprRepo.updateProcessor(id, homeId, data, null, version); }

export async function findDPComplaints(homeId) { const r = await gdprRepo.findDPComplaints(homeId); return r.rows; }
export async function findDPComplaintById(id, homeId) { return gdprRepo.findDPComplaintById(id, homeId); }
export async function createDPComplaint(homeId, data) { return gdprRepo.createDPComplaint(homeId, data); }
export async function updateDPComplaint(id, homeId, data, version) { return gdprRepo.updateDPComplaint(id, homeId, data, null, version); }

export async function getAccessLog({ limit = 100, offset = 0, homeSlugs } = {}) {
  if (!homeSlugs || homeSlugs.length === 0) {
    return [];
  }
  return gdprRepo.getAccessLogByHomeSlugs(homeSlugs, { limit, offset });
}
