/**
 * Integration tests for GDPR service — data requests, breaches, consent,
 * gatherPersonalData (SAR), executeErasure, scanRetention, and cross-home isolation.
 *
 * These tests hit the real database to verify that every GDPR operation correctly
 * queries, anonymises, and isolates personal data across 30+ tables.
 *
 * Requires: PostgreSQL running with all migrations applied.
 * Locally: `docker compose up -d` + `node scripts/migrate.js` first.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../../db.js';
import { config as appConfig } from '../../config.js';
import * as gdprService from '../../services/gdprService.js';

// ── Test identifiers ─────────────────────────────────────────────────────────

const SLUG_A = 'test-gdpr-home-a';
const SLUG_B = 'test-gdpr-home-b';
const STAFF = ['gdpr-S001', 'gdpr-S002', 'gdpr-S003'];
const STAFF_NAMES = ['Alice GDPR', 'Bob GDPR', 'Charlie GDPR'];
const LINK_USERNAME = 'gdpr-link-user';
const ERASURE_FILE_PATHS = {};

let homeA, homeB;
const cleanup = {
  dataRequests: [],
  breaches: [],
  consent: [],
  dpComplaints: [],
};

async function createUploadFixture(relativePath, content = 'gdpr-fixture') {
  const fullPath = path.join(appConfig.upload.dir, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content);
  return fullPath;
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Wipe any leftover test data from previous failed runs
  for (const slug of [SLUG_A, SLUG_B]) {
    const { rows } = await pool.query(`SELECT id FROM homes WHERE slug = $1`, [slug]);
    if (rows.length > 0) {
      const hid = rows[0].id;
      await cleanHome(hid);
      await pool.query(`DELETE FROM homes WHERE id = $1`, [hid]);
    }
  }

  // Create two test homes
  const { rows: [ha] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ($1, 'GDPR Test Home A') RETURNING id`, [SLUG_A]
  );
  const { rows: [hb] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ($1, 'GDPR Test Home B') RETURNING id`, [SLUG_B]
  );
  homeA = ha.id;
  homeB = hb.id;

  // ── Staff records ──────────────────────────────────────────────────────
  for (let i = 0; i < STAFF.length; i++) {
    await pool.query(
      `INSERT INTO staff (id, home_id, name, role, team, skill, hourly_rate, active, wtr_opt_out, al_carryover)
       VALUES ($1, $2, $3, 'Carer', 'Day A', 1, 13.00, true, false, 0)`,
      [STAFF[i], homeA, STAFF_NAMES[i]]
    );
  }
  // One staff in home B for isolation tests
  await pool.query(
    `INSERT INTO staff (id, home_id, name, role, team, skill, hourly_rate, active, wtr_opt_out, al_carryover)
     VALUES ('gdpr-S001', $1, 'Alice GDPR HomeB', 'Carer', 'Day A', 1, 13.00, true, false, 0)`,
    [homeB]
  );
  await pool.query(
    `INSERT INTO users (username, password_hash, role, display_name, active, created_by)
     VALUES ($1, 'hash-not-used', 'viewer', $2, true, 'test-runner')`,
    [LINK_USERNAME, STAFF_NAMES[0]]
  );
  await pool.query(
    `INSERT INTO user_home_roles (username, home_id, role_id, staff_id, granted_by)
     VALUES ($1, $2, 'viewer', $3, 'test-runner')`,
    [LINK_USERNAME, homeA, STAFF[0]]
  );

  // ── Training records ───────────────────────────────────────────────────
  await pool.query(
    `INSERT INTO training_records (home_id, staff_id, training_type_id, completed, expiry, trainer, method)
     VALUES ($1, $2, 'fire-safety', '2025-06-01', '2026-06-01', 'Jane Trainer', 'classroom')`,
    [homeA, STAFF[0]]
  );
  await pool.query(
    `INSERT INTO training_records (home_id, staff_id, training_type_id, completed, expiry, trainer, method)
     VALUES ($1, $2, 'moving-handling', '2025-07-01', '2026-07-01', 'Bob Trainer', 'practical')`,
    [homeA, STAFF[0]]
  );
  await pool.query(
    `INSERT INTO training_file_attachments
       (home_id, staff_id, training_type, original_name, stored_name, mime_type, size_bytes, description, uploaded_by)
     VALUES ($1, $2, 'fire-safety', 'fire-cert.pdf', 'gdpr-training-cert.pdf', 'application/pdf', 18, 'Training certificate', 'test-runner')`,
    [homeA, STAFF[0]]
  );
  ERASURE_FILE_PATHS.training = await createUploadFixture(
    path.join(String(homeA), 'training', STAFF[0], 'fire-safety', 'gdpr-training-cert.pdf')
  );

  // ── Supervisions ───────────────────────────────────────────────────────
  await pool.query(
    `INSERT INTO supervisions (id, home_id, staff_id, date, supervisor, topics, actions, notes)
     VALUES ('sup-gdpr-001', $1, $2, '2025-06-15', 'Jane Supervisor', 'Performance review', 'Continue CPD', 'Good progress')`,
    [homeA, STAFF[0]]
  );

  // ── Appraisals ─────────────────────────────────────────────────────────
  await pool.query(
    `INSERT INTO appraisals (id, home_id, staff_id, date, appraiser, objectives, training_needs, development_plan, notes)
     VALUES ('apr-gdpr-001', $1, $2, '2025-04-15', 'John Manager', 'Obj1', 'TN1', 'DP1', 'Good year')`,
    [homeA, STAFF[0]]
  );

  await pool.query(
    `INSERT INTO pension_enrolments (home_id, staff_id, status, enrolled_date, notes)
     VALUES ($1, $2, 'eligible_enrolled', '2025-04-06', 'Sensitive pension note')`,
    [homeA, STAFF[0]]
  );

  // ── HR Disciplinary ────────────────────────────────────────────────────
  await pool.query(
    `INSERT INTO hr_disciplinary_cases
       (home_id, staff_id, date_raised, raised_by, category, allegation_summary, allegation_detail,
        investigation_notes, investigation_findings, status, created_by)
     VALUES ($1, $2, '2025-08-01', 'HR Manager', 'misconduct',
       'Late attendance pattern', 'Arrived late 5 times in August',
       'Investigated attendance records', 'Pattern confirmed',
       'open', 'test-runner')`,
    [homeA, STAFF[0]]
  );

  // ── HR Grievance + Actions ─────────────────────────────────────────────
  const { rows: [grv] } = await pool.query(
    `INSERT INTO hr_grievance_cases
       (home_id, staff_id, date_raised, raised_by_method, category,
        subject_summary, subject_detail, desired_outcome,
        investigation_notes, investigation_findings,
        hearing_notes, employee_statement_at_hearing,
        outcome_reason, appeal_grounds, appeal_outcome_reason,
        status, created_by)
     VALUES ($1, $2, '2025-09-01', 'written', 'bullying',
       'Workplace bullying allegation', 'Detailed description of events',
       'Formal apology and mediation',
       'Interviewed witnesses', 'Some corroboration found',
       'Both parties heard', 'I felt targeted',
       'Partially upheld — mediation recommended',
       'Process not followed correctly', 'Appeal ground valid but outcome stands',
       'open', 'test-runner')
     RETURNING id`,
    [homeA, STAFF[0]]
  );
  await pool.query(
    `INSERT INTO hr_grievance_actions (grievance_id, home_id, description, responsible, due_date, status)
     VALUES ($1, $2, 'Arrange mediation session', 'HR Lead', '2025-10-01', 'pending')`,
    [grv.id, homeA]
  );

  // ── HR Case Notes (author = staff name) ────────────────────────────────
  const { rows: [disc] } = await pool.query(
    `SELECT id FROM hr_disciplinary_cases WHERE home_id = $1 AND staff_id = $2 LIMIT 1`,
    [homeA, STAFF[0]]
  );
  await pool.query(
    `INSERT INTO hr_case_notes (home_id, case_type, case_id, content, author)
     VALUES ($1, 'disciplinary', $2, 'Staff provided written statement', $3)`,
    [homeA, disc.id, STAFF_NAMES[0]]
  );
  await pool.query(
    `INSERT INTO hr_file_attachments
       (home_id, case_type, case_id, original_name, stored_name, mime_type, size_bytes, description, uploaded_by)
     VALUES ($1, 'disciplinary', $2, 'disciplinary-note.pdf', 'gdpr-hr-attachment.pdf', 'application/pdf', 24, 'Disciplinary attachment', 'test-runner')`,
    [homeA, disc.id]
  );
  ERASURE_FILE_PATHS.hr = await createUploadFixture(
    path.join(String(homeA), 'disciplinary', String(disc.id), 'gdpr-hr-attachment.pdf')
  );

  // ── Incidents (staff_involved JSONB array) ─────────────────────────────
  await pool.query(
    `INSERT INTO incidents (id, home_id, date, type, severity, description, person_affected, person_affected_name, staff_involved, investigation_status)
     VALUES ('inc-gdpr-001', $1, '2025-07-10', 'fall', 'moderate', 'Resident fall in corridor',
       'resident', 'Margaret Resident', $2::jsonb, 'open')`,
    [homeA, JSON.stringify([STAFF[0]])]
  );

  // ── Incident Addenda (author = staff name) ─────────────────────────────
  await pool.query(
    `INSERT INTO incident_addenda (incident_id, home_id, author, content)
     VALUES ('inc-gdpr-001', $1, $2, 'Follow-up: resident seen by GP')`,
    [homeA, STAFF_NAMES[0]]
  );

  // ── Handover Entries (author = staff name) ─────────────────────────────
  await pool.query(
    `INSERT INTO handover_entries (home_id, entry_date, shift, category, priority, content, author)
     VALUES ($1, '2025-07-10', 'E', 'clinical', 'action', 'Resident needs medication review', $2)`,
    [homeA, STAFF_NAMES[0]]
  );

  // ── Onboarding ─────────────────────────────────────────────────────────
  await pool.query(
    `INSERT INTO onboarding (home_id, staff_id, data) VALUES ($1, $2, $3)`,
    [homeA, STAFF[0], JSON.stringify({ dbs_check: { status: 'clear', date: '2025-01-01' } })]
  );
  await pool.query(
    `INSERT INTO onboarding_file_attachments
       (home_id, staff_id, section, original_name, stored_name, mime_type, size_bytes, description, uploaded_by)
     VALUES ($1, $2, 'contract', 'contract.pdf', 'gdpr-onboarding-doc.pdf', 'application/pdf', 22, 'Signed contract', 'test-runner')`,
    [homeA, STAFF[0]]
  );
  ERASURE_FILE_PATHS.onboarding = await createUploadFixture(
    path.join(String(homeA), 'onboarding', STAFF[0], 'contract', 'gdpr-onboarding-doc.pdf')
  );

  // ── Care Certificate ───────────────────────────────────────────────────
  await pool.query(
    `INSERT INTO care_certificates (home_id, staff_id, start_date, supervisor, status, standards)
     VALUES ($1, $2, '2025-03-01', 'Jane CC Supervisor', 'in_progress', $3)`,
    [homeA, STAFF[0], JSON.stringify({ 'std-1': { status: 'completed' } })]
  );

  // ── Complaints (raised_by_name = staff name) ──────────────────────────
  await pool.query(
    `INSERT INTO complaints (id, home_id, date, raised_by, raised_by_name, category, title, description, status)
     VALUES ('cmp-gdpr-001', $1, '2025-08-15', 'staff', $2, 'staffing', 'Understaffing complaint', 'Not enough staff on nights', 'open')`,
    [homeA, STAFF_NAMES[0]]
  );

  // ── CQC name-keyed records ────────────────────────────────────────────────
  await pool.query(
    `INSERT INTO cqc_evidence
       (id, home_id, quality_statement, type, title, description, date_from, date_to,
        evidence_category, evidence_owner, review_due, added_by, added_at)
     VALUES ('cqc-gdpr-001', $1, 'S1', 'qualitative', 'GDPR smoke evidence', 'CQC evidence owner test',
       '2025-08-01', '2025-08-15', 'peoples_experience', $2, '2025-09-01', 'test-runner', NOW())`,
    [homeA, STAFF_NAMES[0]]
  );
  await pool.query(
    `INSERT INTO cqc_partner_feedback
       (id, home_id, quality_statement, feedback_date, title, partner_name, partner_role, relationship,
        summary, response_action, evidence_owner, review_due, added_by)
     VALUES ('cpf-gdpr-001', $1, 'S1', '2025-08-15', 'Family feedback', $2, 'Relative', 'Daughter',
       'Positive feedback', 'Shared with team', $2, '2025-09-01', 'test-runner')`,
    [homeA, STAFF_NAMES[0]]
  );
  await pool.query(
    `INSERT INTO cqc_observations
       (id, home_id, quality_statement, observed_at, title, area, observer, notes, actions,
        evidence_owner, review_due, added_by)
     VALUES ('cqo-gdpr-001', $1, 'S1', '2025-08-15T10:00:00Z', 'Medication round', 'Unit A', $2,
       'Observed calm support', 'Keep current practice', $2, '2025-09-01', 'test-runner')`,
    [homeA, STAFF_NAMES[0]]
  );
  await pool.query(
    `INSERT INTO cqc_evidence_links
       (home_id, source_module, source_id, quality_statement, evidence_category, rationale,
        auto_linked, requires_review, linked_by, source_recorded_at)
     VALUES ($1, 'cqc_evidence', 'cqc-gdpr-001', 'S1', 'peoples_experience', 'Linked by user account',
       true, true, $2, '2025-08-15T00:00:00Z')`,
    [homeA, LINK_USERNAME]
  );

  // ── DoLS (resident data for resident SAR) ──────────────────────────────
  await pool.query(
    `INSERT INTO dols (id, home_id, resident_name, dob, room_number, application_type, application_date, authorised)
     VALUES ('dols-gdpr-001', $1, 'Margaret Resident', '1935-03-20', '12B', 'dols', '2025-06-01', true)`,
    [homeA]
  );

  // ── MCA Assessments (resident data) ────────────────────────────────────
  await pool.query(
    `INSERT INTO mca_assessments (id, home_id, resident_name, assessment_date, assessor, decision_area, lacks_capacity, best_interest_decision)
     VALUES ('mca-gdpr-001', $1, 'Margaret Resident', '2025-06-15', 'Dr Smith', 'Financial decisions', true, 'Court of Protection appointment')`,
    [homeA]
  );

  // ── Access Log (user_name = staff name) ────────────────────────────────
  await pool.query(
    `INSERT INTO access_log (user_name, user_role, method, endpoint, home_id, status_code)
     VALUES ($1, 'edit', 'GET', '/api/data', $2, 200)`,
    [STAFF_NAMES[0], homeA]
  );
  await pool.query(
    `INSERT INTO access_log (user_name, user_role, method, endpoint, home_id, status_code)
     VALUES ($1, 'edit', 'GET', '/api/data', $2, 200)`,
    [STAFF_NAMES[0], homeB]
  );

  // ── Home B isolation data ──────────────────────────────────────────────
  await pool.query(
    `INSERT INTO training_records (home_id, staff_id, training_type_id, completed, expiry, trainer, method)
     VALUES ($1, 'gdpr-S001', 'fire-safety', '2025-06-01', '2026-06-01', 'HomeB Trainer', 'classroom')`,
    [homeB]
  );
  await pool.query(
    `INSERT INTO incidents (id, home_id, date, type, severity, description, person_affected, staff_involved, investigation_status)
     VALUES ('inc-gdpr-b01', $1, '2025-07-10', 'fall', 'minor', 'Home B incident', 'staff', '[]'::jsonb, 'open')`,
    [homeB]
  );
}, 30000);

// ── Teardown ─────────────────────────────────────────────────────────────────

async function cleanHome(hid) {
  // Reverse FK order cleanup
  const tables = [
    { sql: `DELETE FROM cqc_evidence_files WHERE evidence_id IN (SELECT id FROM cqc_evidence WHERE home_id = $1)` },
    { sql: `DELETE FROM cqc_evidence_links WHERE home_id = $1` },
    { sql: `DELETE FROM cqc_partner_feedback WHERE home_id = $1` },
    { sql: `DELETE FROM cqc_observations WHERE home_id = $1` },
    { sql: `DELETE FROM cqc_statement_narratives WHERE home_id = $1` },
    { sql: `DELETE FROM cqc_evidence WHERE home_id = $1` },
    { sql: `DELETE FROM hr_grievance_actions WHERE grievance_id IN (SELECT id FROM hr_grievance_cases WHERE home_id = $1)` },
    { sql: `DELETE FROM hr_case_notes WHERE home_id = $1` },
    { sql: `DELETE FROM hr_disciplinary_cases WHERE home_id = $1` },
    { sql: `DELETE FROM hr_grievance_cases WHERE home_id = $1` },
    { sql: `DELETE FROM hr_performance_cases WHERE home_id = $1` },
    { sql: `DELETE FROM hr_rtw_interviews WHERE home_id = $1` },
    { sql: `DELETE FROM hr_oh_referrals WHERE home_id = $1` },
    { sql: `DELETE FROM hr_contracts WHERE home_id = $1` },
    { sql: `DELETE FROM hr_family_leave WHERE home_id = $1` },
    { sql: `DELETE FROM hr_flexible_working WHERE home_id = $1` },
    { sql: `DELETE FROM hr_edi_records WHERE home_id = $1` },
    { sql: `DELETE FROM hr_tupe_transfers WHERE home_id = $1` },
    { sql: `DELETE FROM hr_rtw_dbs_renewals WHERE home_id = $1` },
    { sql: `DELETE FROM incident_addenda WHERE home_id = $1` },
    { sql: `DELETE FROM incidents WHERE home_id = $1` },
    { sql: `DELETE FROM complaints WHERE home_id = $1` },
    { sql: `DELETE FROM handover_entries WHERE home_id = $1` },
    { sql: `DELETE FROM training_records WHERE home_id = $1` },
    { sql: `DELETE FROM supervisions WHERE home_id = $1` },
    { sql: `DELETE FROM appraisals WHERE home_id = $1` },
    { sql: `DELETE FROM pension_enrolments WHERE home_id = $1` },
    { sql: `DELETE FROM onboarding WHERE home_id = $1` },
    { sql: `DELETE FROM care_certificates WHERE home_id = $1` },
    { sql: `DELETE FROM dols WHERE home_id = $1` },
    { sql: `DELETE FROM mca_assessments WHERE home_id = $1` },
    { sql: `DELETE FROM data_requests WHERE home_id = $1` },
    { sql: `DELETE FROM data_breaches WHERE home_id = $1` },
    { sql: `DELETE FROM consent_records WHERE home_id = $1` },
    { sql: `DELETE FROM dp_complaints WHERE home_id = $1` },
    { sql: `DELETE FROM access_log WHERE home_id = $1` },
    { sql: `DELETE FROM user_home_roles WHERE home_id = $1` },
    { sql: `DELETE FROM shift_overrides WHERE home_id = $1` },
    { sql: `DELETE FROM staff WHERE home_id = $1` },
  ];
  for (const { sql } of tables) {
    await pool.query(sql, [hid]).catch(() => {});
  }
}

afterAll(async () => {
  await Promise.all(
    Object.values(ERASURE_FILE_PATHS).map((filePath) => fs.rm(filePath, { force: true }).catch(() => {}))
  );
  // Clean tracked GDPR records
  for (const id of cleanup.dataRequests) {
    await pool.query('DELETE FROM data_requests WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of cleanup.breaches) {
    await pool.query('DELETE FROM data_breaches WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of cleanup.consent) {
    await pool.query('DELETE FROM consent_records WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of cleanup.dpComplaints) {
    await pool.query('DELETE FROM dp_complaints WHERE id = $1', [id]).catch(() => {});
  }

  // Clean audit log entries from erasure
  await pool.query(`DELETE FROM audit_log WHERE home_slug IN ($1, $2)`, [SLUG_A, SLUG_B]);
  // Clean access log entries with staff names
  await pool.query(`DELETE FROM access_log WHERE user_name = ANY($1)`, [STAFF_NAMES]);
  await pool.query(`DELETE FROM access_log WHERE user_name = '[REDACTED]' AND home_id IN ($1, $2)`, [homeA, homeB]);
  await pool.query('DELETE FROM user_home_roles WHERE username = $1', [LINK_USERNAME]).catch(() => {});
  await pool.query('DELETE FROM token_denylist WHERE username = $1', [LINK_USERNAME]).catch(() => {});
  await pool.query('DELETE FROM users WHERE username = $1', [LINK_USERNAME]).catch(() => {});

  if (homeA) { await cleanHome(homeA); await pool.query('DELETE FROM homes WHERE id = $1', [homeA]); }
  if (homeB) { await cleanHome(homeB); await pool.query('DELETE FROM homes WHERE id = $1', [homeB]); }
}, 30000);

// ── CRUD: Data Requests ──────────────────────────────────────────────────────

describe('CRUD: data requests', () => {
  let requestId;

  it('creates a SAR request', async () => {
    const req = await gdprService.createRequest(homeA, {
      request_type: 'sar',
      subject_type: 'staff',
      subject_id: STAFF[0],
      subject_name: STAFF_NAMES[0],
      date_received: '2026-01-15',
      deadline: '2026-02-15',
      identity_verified: true,
      status: 'received',
      notes: 'Test SAR request',
    });
    requestId = req.id;
    cleanup.dataRequests.push(req.id);

    expect(req.id).toBeDefined();
    expect(req.request_type).toBe('sar');
    expect(req.subject_id).toBe(STAFF[0]);
    expect(req.status).toBe('received');
  });

  it('finds requests for a home', async () => {
    const rows = await gdprService.findRequests(homeA);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const found = rows.find(r => r.id === requestId);
    expect(found).toBeDefined();
    expect(found.subject_name).toBe(STAFF_NAMES[0]);
  });

  it('finds request by ID', async () => {
    const req = await gdprService.findRequestById(requestId, homeA);
    expect(req).not.toBeNull();
    expect(req.request_type).toBe('sar');
  });

  it('updates request status', async () => {
    const updated = await gdprService.updateRequest(requestId, homeA, {
      status: 'in_progress',
      notes: 'Identity verified, gathering data',
    });
    expect(updated).not.toBeNull();
    expect(updated.status).toBe('in_progress');
  });

  it('returns null for request in wrong home', async () => {
    const req = await gdprService.findRequestById(requestId, homeB);
    expect(req).toBeNull();
  });
});

// ── CRUD: Data Breaches ──────────────────────────────────────────────────────

describe('CRUD: data breaches', () => {
  let breachId;

  it('creates a breach', async () => {
    const breach = await gdprService.createBreach(homeA, {
      title: 'Test email breach',
      description: 'Staff list emailed to wrong recipient',
      discovered_date: '2026-02-01',
      data_categories: ['staff_health', 'dbs'],
      individuals_affected: 15,
      severity: 'high',
      risk_to_rights: 'likely',
      ico_notifiable: true,
      ico_notification_deadline: '2026-02-04T00:00:00Z',
      status: 'open',
    });
    breachId = breach.id;
    cleanup.breaches.push(breach.id);

    expect(breach.id).toBeDefined();
    expect(breach.severity).toBe('high');
    expect(breach.ico_notifiable).toBe(true);
    expect(breach.version).toBe(1);
  });

  it('finds breaches for a home', async () => {
    const rows = await gdprService.findBreaches(homeA);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const found = rows.find(b => b.id === breachId);
    expect(found.title).toBe('Test email breach');
  });

  it('finds breach by ID', async () => {
    const breach = await gdprService.findBreachById(breachId, homeA);
    expect(breach).not.toBeNull();
    expect(breach.individuals_affected).toBe(15);
  });

  it('updates breach with containment actions', async () => {
    const updated = await gdprService.updateBreach(breachId, homeA, {
      containment_actions: 'Recalled email, notified all affected staff',
      status: 'contained',
    }, 1);
    expect(updated).not.toBeNull();
    expect(updated.status).toBe('contained');
    expect(updated.version).toBe(2);
  });

  it('rejects resolve without ICO notification', async () => {
    await expect(
      gdprService.updateBreach(breachId, homeA, { status: 'resolved' }, 2)
    ).rejects.toThrow(/ICO must be notified/);
  });

  it('optimistic locking rejects stale version', async () => {
    const result = await gdprService.updateBreach(breachId, homeA, {
      containment_actions: 'Stale update attempt',
    }, 1); // version 1 is now stale (current is 2)
    expect(result).toBeNull();
  });
});

// ── CRUD: Consent Records ────────────────────────────────────────────────────

describe('CRUD: consent records', () => {
  let consentId;

  it('creates a consent record', async () => {
    const consent = await gdprService.createConsent(homeA, {
      subject_type: 'staff',
      subject_id: STAFF[1],
      subject_name: STAFF_NAMES[1],
      purpose: 'Photo on staff noticeboard',
      legal_basis: 'consent',
      given: '2026-01-10T09:00:00Z',
    });
    consentId = consent.id;
    cleanup.consent.push(consent.id);

    expect(consent.id).toBeDefined();
    expect(consent.purpose).toBe('Photo on staff noticeboard');
    expect(consent.version).toBe(1);
  });

  it('finds consent records for a home', async () => {
    const rows = await gdprService.findConsent(homeA);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const found = rows.find(c => c.id === consentId);
    expect(found).toBeDefined();
  });

  it('updates consent — records withdrawal', async () => {
    const updated = await gdprService.updateConsent(consentId, homeA, {
      withdrawn: '2026-02-15T10:00:00Z',
      notes: 'Staff requested photo removal',
    }, 1);
    expect(updated).not.toBeNull();
    expect(updated.withdrawn).toBeTruthy();
    expect(updated.version).toBe(2);
  });

  it('optimistic locking rejects stale version', async () => {
    const result = await gdprService.updateConsent(consentId, homeA, {
      notes: 'Stale update',
    }, 1);
    expect(result).toBeNull();
  });
});

// ── gatherPersonalData: staff ────────────────────────────────────────────────

describe('gatherPersonalData: staff', () => {
  let result;

  beforeAll(async () => {
    result = await gdprService.gatherPersonalData('staff', STAFF[0], homeA);
  });

  it('returns correct structure with all expected data keys', () => {
    expect(result.subject_type).toBe('staff');
    expect(result.subject_id).toBe(STAFF[0]);
    expect(result.gathered_at).toBeTruthy();
    expect(result.data).toBeDefined();
    const keys = Object.keys(result.data);
    const required = [
      'staff', 'shift_overrides', 'training_records', 'supervisions', 'appraisals',
      'timesheet_entries', 'payroll_lines', 'tax_codes', 'sick_periods',
      'pension_enrolment', 'pension_contributions', 'access_log',
      'incidents', 'fire_drills', 'handover_entries',
      'hr_disciplinary_cases', 'hr_grievance_cases', 'hr_grievance_actions',
      'hr_performance_cases', 'hr_rtw_interviews', 'hr_oh_referrals',
      'hr_contracts', 'hr_family_leave', 'hr_flexible_working',
      'hr_edi_records', 'hr_tupe_transfers', 'hr_rtw_dbs_renewals',
      'hr_case_notes', 'onboarding', 'care_certificates', 'complaints', 'incident_addenda',
      'cqc_evidence_links',
    ];
    for (const key of required) {
      expect(keys).toContain(key);
    }
  });

  it('includes staff, training, supervisions, appraisals', () => {
    expect(result.data.staff).toHaveLength(1);
    expect(result.data.staff[0].name).toBe(STAFF_NAMES[0]);

    expect(result.data.training_records.length).toBeGreaterThanOrEqual(2);
    const types = result.data.training_records.map(t => t.training_type_id);
    expect(types).toContain('fire-safety');
    expect(types).toContain('moving-handling');

    expect(result.data.supervisions.length).toBeGreaterThanOrEqual(1);
    expect(result.data.supervisions[0].supervisor).toBe('Jane Supervisor');

    expect(result.data.appraisals.length).toBeGreaterThanOrEqual(1);
    expect(result.data.appraisals[0].appraiser).toBe('John Manager');
  });

  it('includes HR cases (disciplinary, grievance, actions)', () => {
    expect(result.data.hr_disciplinary_cases.length).toBeGreaterThanOrEqual(1);
    expect(result.data.hr_disciplinary_cases[0].allegation_summary).toBe('Late attendance pattern');

    expect(result.data.hr_grievance_cases.length).toBeGreaterThanOrEqual(1);
    expect(result.data.hr_grievance_actions.length).toBeGreaterThanOrEqual(1);
    expect(result.data.hr_grievance_actions[0].description).toBe('Arrange mediation session');
  });

  it('includes DP complaints linked by subject_id even when the complainant name differs', async () => {
    const { rows: [complaint] } = await pool.query(
      `INSERT INTO dp_complaints
         (home_id, date_received, complainant_name, subject_type, subject_id, category, description, severity, status)
       VALUES ($1, CURRENT_DATE, 'Alias Name', 'staff', $2, 'access', 'Linked by subject id', 'medium', 'open')
       RETURNING id`,
      [homeA, STAFF[0]],
    );

    try {
      const linked = await gdprService.gatherPersonalData('staff', STAFF[0], homeA);
      expect(linked.data.dp_complaints.some(c => c.id === complaint.id)).toBe(true);
    } finally {
      await pool.query('DELETE FROM dp_complaints WHERE id = $1', [complaint.id]).catch(() => {});
    }
  });

  it('matches webhook payloads by exact scalar values instead of substring text search', async () => {
    const { rows: [hook] } = await pool.query(
      `INSERT INTO webhooks (home_id, url, secret, events, active)
       VALUES ($1, 'https://example.com/webhook', 'legacy-secret', ARRAY['incident.created'], true)
       RETURNING id`,
      [homeA],
    );
    try {
      const { rows: [exact] } = await pool.query(
        `INSERT INTO webhook_deliveries (webhook_id, event, payload, status)
         VALUES ($1, 'incident.created', '{"staff_id":"gdpr-S001","status":"open"}'::jsonb, 'delivered')
         RETURNING id`,
        [hook.id],
      );
      const { rows: [substringOnly] } = await pool.query(
        `INSERT INTO webhook_deliveries (webhook_id, event, payload, status)
         VALUES ($1, 'incident.created', '{"status":"gdpr-S001-completed"}'::jsonb, 'delivered')
         RETURNING id`,
        [hook.id],
      );

      const result = await gdprService.gatherPersonalData('staff', STAFF[0], homeA);
      const deliveryIds = result.data.webhook_deliveries.map((row) => row.id);
      expect(deliveryIds).toContain(exact.id);
      expect(deliveryIds).not.toContain(substringOnly.id);
    } finally {
      await pool.query('DELETE FROM webhooks WHERE id = $1', [hook.id]).catch(() => {});
    }
  });

  it('includes incidents (via staff_involved JSONB) and addenda', () => {
    expect(result.data.incidents.length).toBeGreaterThanOrEqual(1);
    expect(result.data.incidents[0].id).toBe('inc-gdpr-001');

    expect(result.data.incident_addenda.length).toBeGreaterThanOrEqual(1);
    expect(result.data.incident_addenda[0].content).toContain('GP');
  });

  it('includes name-keyed records (handovers, case notes, complaints)', () => {
    expect(result.data.handover_entries.length).toBeGreaterThanOrEqual(1);
    expect(result.data.handover_entries[0].content).toContain('medication review');

    expect(result.data.hr_case_notes.length).toBeGreaterThanOrEqual(1);
    expect(result.data.hr_case_notes[0].content).toContain('written statement');

    expect(result.data.complaints.length).toBeGreaterThanOrEqual(1);
    expect(result.data.complaints[0].raised_by_name).toBe(STAFF_NAMES[0]);
  });

  it('includes onboarding and care certificates', () => {
    expect(result.data.onboarding.length).toBeGreaterThanOrEqual(1);

    expect(result.data.care_certificates.length).toBeGreaterThanOrEqual(1);
    expect(result.data.care_certificates[0].supervisor).toBe('Jane CC Supervisor');
  });
});

// ── gatherPersonalData: resident ─────────────────────────────────────────────

// resident_id in finance_residents is cast via id::text in the service query,
// so a string subject_id is handled correctly.
describe('gatherPersonalData: resident', () => {
  it('returns dols and mca for resident by ID', async () => {
    const result = await gdprService.gatherPersonalData('resident', 'dols-gdpr-001', homeA, null, 'Margaret Resident');
    expect(result.subject_type).toBe('resident');
    expect(result.data.dols.length).toBeGreaterThanOrEqual(1);
    expect(result.data.dols[0].resident_name).toBe('Margaret Resident');
  });

  it('returns incidents where resident is person_affected_name', async () => {
    const result = await gdprService.gatherPersonalData('resident', 'dols-gdpr-001', homeA, null, 'Margaret Resident');
    expect(result.data.incidents.length).toBeGreaterThanOrEqual(1);
    expect(result.data.incidents[0].person_affected_name).toBe('Margaret Resident');
  });

  it('flags incomplete when subject_name not provided', async () => {
    const result = await gdprService.gatherPersonalData('resident', 'dols-gdpr-001', homeA);
    expect(result.incomplete).toBeTruthy();
    expect(result.data.incidents).toHaveLength(0);
  });
});

// ── executeErasure ───────────────────────────────────────────────────────────

describe('executeErasure', () => {
  const targetStaff = STAFF[0]; // gdpr-S001 / Alice GDPR
  let erasureRequestId;

  beforeAll(async () => {
    // Create an erasure request to be marked complete
    const req = await gdprService.createRequest(homeA, {
      request_type: 'erasure',
      subject_type: 'staff',
      subject_id: targetStaff,
      subject_name: STAFF_NAMES[0],
      date_received: '2026-02-20',
      deadline: '2026-03-20',
      identity_verified: true,
    });
    erasureRequestId = req.id;
    cleanup.dataRequests.push(req.id);
  });

  it('anonymises staff record', async () => {
    await gdprService.executeErasure(targetStaff, homeA, erasureRequestId, 'test-admin', SLUG_A);

    const { rows } = await pool.query(
      `SELECT * FROM staff WHERE home_id = $1 AND id = $2`, [homeA, targetStaff]
    );
    expect(rows).toHaveLength(1);
    const staff = rows[0];
    expect(staff.name).toBe('[REDACTED-gdpr]');
    expect(staff.date_of_birth).toBeNull();
    expect(staff.ni_number).toBeNull();
    expect(staff.hourly_rate).toBe('0.00');
    expect(staff.active).toBe(false);
  });

  it('deletes training records', async () => {
    const { rows } = await pool.query(
      `SELECT * FROM training_records WHERE home_id = $1 AND staff_id = $2`, [homeA, targetStaff]
    );
    expect(rows).toHaveLength(0);
  });

  it('deletes attachment metadata and physical files after commit', async () => {
    const { rows: trainingFiles } = await pool.query(
      `SELECT * FROM training_file_attachments WHERE home_id = $1 AND staff_id = $2`,
      [homeA, targetStaff]
    );
    expect(trainingFiles).toHaveLength(0);

    const { rows: onboardingFiles } = await pool.query(
      `SELECT * FROM onboarding_file_attachments WHERE home_id = $1 AND staff_id = $2`,
      [homeA, targetStaff]
    );
    expect(onboardingFiles).toHaveLength(0);

    const { rows: hrFiles } = await pool.query(
      `SELECT * FROM hr_file_attachments WHERE home_id = $1`,
      [homeA]
    );
    expect(hrFiles).toHaveLength(0);

    await expect(fs.access(ERASURE_FILE_PATHS.training)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(ERASURE_FILE_PATHS.onboarding)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(ERASURE_FILE_PATHS.hr)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('anonymises supervisions', async () => {
    const { rows } = await pool.query(
      `SELECT * FROM supervisions WHERE home_id = $1 AND staff_id = $2`, [homeA, targetStaff]
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].supervisor).toBe('[REDACTED-gdpr]');
    expect(rows[0].topics).toBeNull();
    expect(rows[0].actions).toBeNull();
    expect(rows[0].notes).toBeNull();
  });

  it('anonymises appraisals', async () => {
    const { rows } = await pool.query(
      `SELECT * FROM appraisals WHERE home_id = $1 AND staff_id = $2`, [homeA, targetStaff]
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].appraiser).toBe('[REDACTED-gdpr]');
    expect(rows[0].objectives).toBeNull();
    expect(rows[0].training_needs).toBeNull();
    expect(rows[0].development_plan).toBeNull();
    expect(rows[0].notes).toBeNull();
  });

  it('retains pension enrolments but clears notes', async () => {
    const { rows } = await pool.query(
      `SELECT status, notes FROM pension_enrolments WHERE home_id = $1 AND staff_id = $2`,
      [homeA, targetStaff]
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].status).toBe('eligible_enrolled');
    expect(rows[0].notes).toBeNull();
  });

  it('anonymises HR disciplinary cases', async () => {
    const { rows } = await pool.query(
      `SELECT * FROM hr_disciplinary_cases WHERE home_id = $1 AND staff_id = $2`, [homeA, targetStaff]
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].allegation_summary).toBe('[REDACTED-gdpr]');
    expect(rows[0].allegation_detail).toBeNull();
    expect(rows[0].investigation_notes).toBeNull();
    expect(rows[0].investigation_findings).toBeNull();
    // Skeleton preserved — dates and status still present
    expect(rows[0].date_raised).toBeTruthy();
    expect(rows[0].status).toBeTruthy();
  });

  it('anonymises HR grievance cases and redacts their actions', async () => {
    const { rows } = await pool.query(
      `SELECT * FROM hr_grievance_cases WHERE home_id = $1 AND staff_id = $2`, [homeA, targetStaff]
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].subject_summary).toBe('[REDACTED-gdpr]');
    expect(rows[0].subject_detail).toBeNull();
    expect(rows[0].desired_outcome).toBeNull();
    expect(rows[0].investigation_notes).toBeNull();
    expect(rows[0].hearing_notes).toBeNull();
    expect(rows[0].outcome_reason).toBeNull();
    expect(rows[0].appeal_grounds).toBeNull();

    // Grievance actions also redacted
    for (const gc of rows) {
      const { rows: actions } = await pool.query(
        `SELECT * FROM hr_grievance_actions WHERE grievance_id = $1`, [gc.id]
      );
      for (const a of actions) {
        expect(a.description).toBe('[REDACTED]');
      }
    }
  });

  it('redacts name-keyed records (case notes, addenda, handovers)', async () => {
    // HR case notes — author replaced with anon, content redacted
    const { rows: notes } = await pool.query(
      `SELECT * FROM hr_case_notes WHERE home_id = $1 AND author = $2`,
      [homeA, '[REDACTED-gdpr]']
    );
    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(notes[0].content).toBe('[REDACTED]');

    // Incident addenda — same pattern
    const { rows: addenda } = await pool.query(
      `SELECT * FROM incident_addenda WHERE home_id = $1 AND author = $2`,
      [homeA, '[REDACTED-gdpr]']
    );
    expect(addenda.length).toBeGreaterThanOrEqual(1);
    expect(addenda[0].content).toBe('[REDACTED]');

    // Handover entries — author and content both fully redacted
    const { rows: handovers } = await pool.query(
      `SELECT * FROM handover_entries WHERE home_id = $1 AND author = '[REDACTED]'`, [homeA]
    );
    expect(handovers.length).toBeGreaterThanOrEqual(1);
    expect(handovers[0].content).toBe('[REDACTED]');
  });

  it('deletes onboarding, anonymises care certs and complaints', async () => {
    // Onboarding deleted entirely (pre-employment checks)
    const { rows: ob } = await pool.query(
      `SELECT * FROM onboarding WHERE home_id = $1 AND staff_id = $2`, [homeA, targetStaff]
    );
    expect(ob).toHaveLength(0);

    // Care certificate — supervisor anonymised, standards cleared
    const { rows: cc } = await pool.query(
      `SELECT * FROM care_certificates WHERE home_id = $1 AND staff_id = $2`, [homeA, targetStaff]
    );
    expect(cc.length).toBeGreaterThanOrEqual(1);
    expect(cc[0].supervisor).toBe('[REDACTED-gdpr]');
    expect(cc[0].standards).toEqual({});

    // Complaints — raised_by_name anonymised, description redacted
    const { rows: cmp } = await pool.query(
      `SELECT * FROM complaints WHERE home_id = $1 AND raised_by_name = $2`, [homeA, '[REDACTED-gdpr]']
    );
    expect(cmp.length).toBeGreaterThanOrEqual(1);
    expect(cmp[0].description).toBe('[REDACTED]');
  });

  it('anonymises CQC name-keyed records', async () => {
    const { rows: evidence } = await pool.query(
      `SELECT evidence_owner FROM cqc_evidence WHERE home_id = $1 AND id = 'cqc-gdpr-001'`,
      [homeA]
    );
    expect(evidence).toHaveLength(1);
    expect(evidence[0].evidence_owner).toBe('[REDACTED-gdpr]');

    const { rows: feedback } = await pool.query(
      `SELECT partner_name, evidence_owner FROM cqc_partner_feedback WHERE home_id = $1 AND id = 'cpf-gdpr-001'`,
      [homeA]
    );
    expect(feedback).toHaveLength(1);
    expect(feedback[0].partner_name).toBe('[REDACTED-gdpr]');
    expect(feedback[0].evidence_owner).toBe('[REDACTED-gdpr]');

    const { rows: observations } = await pool.query(
      `SELECT observer, evidence_owner FROM cqc_observations WHERE home_id = $1 AND id = 'cqo-gdpr-001'`,
      [homeA]
    );
    expect(observations).toHaveLength(1);
    expect(observations[0].observer).toBe('[REDACTED-gdpr]');
    expect(observations[0].evidence_owner).toBe('[REDACTED-gdpr]');

    const { rows: links } = await pool.query(
      `SELECT linked_by, rationale FROM cqc_evidence_links
        WHERE home_id = $1 AND source_id = 'cqc-gdpr-001'`,
      [homeA]
    );
    expect(links).toHaveLength(1);
    expect(links[0].linked_by).toBe('[REDACTED-gdpr]');
    expect(links[0].rationale).toBeNull();
  });

  it('anonymises access log entries', async () => {
    // After erasure, original name entries should be gone or redacted
    const { rows: original } = await pool.query(
      `SELECT * FROM access_log WHERE user_name = $1`, [STAFF_NAMES[0]]
    );
    expect(original.filter((row) => row.home_id === homeA)).toHaveLength(0);
  });

  it('redacts only exact webhook payload values during staff erasure', async () => {
    const exactStaffId = STAFF[1];
    const { rows: [hook] } = await pool.query(
      `INSERT INTO webhooks (home_id, url, secret, events, active)
       VALUES ($1, 'https://example.com/webhook', 'legacy-secret', ARRAY['incident.created'], true)
       RETURNING id`,
      [homeA],
    );
    try {
      const { rows: [exact] } = await pool.query(
        `INSERT INTO webhook_deliveries (webhook_id, event, payload, status)
         VALUES ($1, 'incident.created', $2::jsonb, 'delivered')
         RETURNING id`,
        [hook.id, JSON.stringify({ staff_id: exactStaffId })],
      );
      const { rows: [substringOnly] } = await pool.query(
        `INSERT INTO webhook_deliveries (webhook_id, event, payload, status)
         VALUES ($1, 'incident.created', $2::jsonb, 'delivered')
         RETURNING id`,
        [hook.id, JSON.stringify({ status: `${exactStaffId}-completed` })],
      );

      await gdprService.executeErasure(exactStaffId, homeA, null, 'admin', SLUG_A);

      const { rows } = await pool.query(
        `SELECT id, payload::text AS payload
           FROM webhook_deliveries
          WHERE id = ANY($1::int[])
          ORDER BY id`,
        [[exact.id, substringOnly.id]],
      );
      const payloadMap = new Map(rows.map((row) => [row.id, row.payload]));
      expect(payloadMap.get(exact.id)).toBe('"[REDACTED]"');
      expect(payloadMap.get(substringOnly.id)).toContain(`${exactStaffId}-completed`);
    } finally {
      await pool.query('DELETE FROM webhooks WHERE id = $1', [hook.id]).catch(() => {});
    }
  });

  it('preserves same-name access log entries in other homes', async () => {
    const { rows } = await pool.query(
      `SELECT * FROM access_log WHERE home_id = $1 AND user_name = $2`,
      [homeB, STAFF_NAMES[0]]
    );
    expect(rows).toHaveLength(1);
  });

  it('revokes linked user sessions during erasure', async () => {
    const { rows } = await pool.query(
      `SELECT * FROM token_denylist WHERE username = $1 AND scope = 'admin'`,
      [LINK_USERNAME]
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('marks erasure request as completed', async () => {
    const req = await gdprService.findRequestById(erasureRequestId, homeA);
    expect(req.status).toBe('completed');
    expect(req.completed_by).toBe('test-admin');
    expect(req.completed_date).toBeTruthy();
  });

  it('blocks executing the same erasure request twice', async () => {
    await expect(
      gdprService.executeErasure(targetStaff, homeA, erasureRequestId, 'test-admin', SLUG_A)
    ).rejects.toThrow(/already been completed|already been anonymised/i);
  });

  it('creates audit log entry for erasure', async () => {
    const { rows } = await pool.query(
      `SELECT * FROM audit_log
        WHERE home_slug = $1
          AND action = 'erasure'
          AND details LIKE '%' || $2 || '%'
        ORDER BY ts DESC
        LIMIT 1`,
      [SLUG_A, targetStaff],
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].details).toContain(targetStaff);
    expect(rows[0].user_name).toBe('test-admin');
  });

  it('preserves operational records (incidents still exist)', async () => {
    // Incidents are retained — staff_involved still has the staff_id
    const { rows } = await pool.query(
      `SELECT * FROM incidents WHERE home_id = $1 AND id = 'inc-gdpr-001'`, [homeA]
    );
    expect(rows).toHaveLength(1);
    // Incident body preserved for CQC audit trail
    expect(rows[0].description).toBe('Resident fall in corridor');
  });
});

// ── scanRetention ────────────────────────────────────────────────────────────

describe('scanRetention', () => {
  it('returns shaped results with data_category, retention_days, counts', async () => {
    const results = await gdprService.scanRetention(homeA);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r).toHaveProperty('data_category');
      expect(r).toHaveProperty('retention_period');
      expect(r).toHaveProperty('retention_days');
      expect(typeof r.retention_days).toBe('number');
      expect(r).toHaveProperty('total_records');
      expect(r).toHaveProperty('expired_records');
      expect(r).toHaveProperty('action_needed');
    }
  });

  it('counts training records correctly for home B after home A erasure', async () => {
    const results = await gdprService.scanRetention(homeB);
    const training = results.find(r => r.data_category === 'Training records');
    if (training) {
      expect(training.total_records).toBeGreaterThanOrEqual(1);
    }
  });

  it('scopes access_log and audit_log counts to the current home', async () => {
    await pool.query(
      `INSERT INTO access_log (home_id, user_name, user_role, method, endpoint, status_code)
       VALUES
         ($1, 'gdpr-a', 'admin', 'GET', '/api/gdpr/requests', 200),
         ($2, 'gdpr-b', 'admin', 'GET', '/api/gdpr/requests', 200)`,
      [homeA, homeB],
    );
    await pool.query(
      `INSERT INTO audit_log (action, home_slug, user_name, details)
       VALUES
         ('gdpr_retention_test', $1, 'gdpr-a', '{"home":"a"}'),
         ('gdpr_retention_test', $2, 'gdpr-b', '{"home":"b"}')`,
      [SLUG_A, SLUG_B],
    );

    const results = await gdprService.scanRetention(homeA);
    const access = results.find(r => r.data_category === 'Access log');
    const audit = results.find(r => r.data_category === 'Audit log');

    expect(access).toBeTruthy();
    expect(audit).toBeTruthy();
    expect(access.total_records).toBeGreaterThanOrEqual(1);
    expect(audit.total_records).toBeGreaterThanOrEqual(1);
  });
});

// ── assessBreachRisk (pure function) ─────────────────────────────────────────

describe('assessBreachRisk', () => {
  it('flags high severity + special category as ICO notifiable', () => {
    const result = gdprService.assessBreachRisk({
      severity: 'high',
      risk_to_rights: 'likely',
      individuals_affected: 30,
      data_categories: ['staff_health', 'dbs'],
      discovered_date: '2026-02-01T10:00:00Z',
    });
    expect(result.icoNotifiable).toBe(true);
    expect(result.riskLevel).toMatch(/high|critical/);
    expect(result.specialCategoryDataInvolved).toBe(true);
    expect(result.icoDeadline).toBeTruthy();
  });

  it('minimum-input breach scores medium (ICO notifiable)', () => {
    const result = gdprService.assessBreachRisk({
      severity: 'low',
      risk_to_rights: 'unlikely',
      individuals_affected: 1,
      data_categories: [],
      discovered_date: '2026-02-01T10:00:00Z',
    });
    // (1+1+1)/3 * 1.0 = 1.0 → medium; ICO notifiable because riskLevel !== 'low'
    expect(result.icoNotifiable).toBe(true);
    expect(result.riskLevel).toBe('medium');
    expect(result.specialCategoryDataInvolved).toBe(false);
  });

  it('calculates ICO deadline as 72 hours from discovery', () => {
    const result = gdprService.assessBreachRisk({
      severity: 'medium',
      risk_to_rights: 'possible',
      individuals_affected: 5,
      data_categories: [],
      discovered_date: '2026-02-01T10:00:00Z',
    });
    const deadline = new Date(result.icoDeadline);
    const discovery = new Date('2026-02-01T10:00:00Z');
    const diffHours = (deadline - discovery) / (1000 * 60 * 60);
    expect(diffHours).toBe(72);
  });

  it('uses end-of-day UTC for date-only discovery values', () => {
    const result = gdprService.assessBreachRisk({
      severity: 'medium',
      risk_to_rights: 'possible',
      individuals_affected: 5,
      data_categories: [],
      discovered_date: '2026-02-01',
    });
    expect(result.icoDeadline).toBe('2026-02-04T23:59:59.000Z');
  });

  it('fails closed for empty breach categories in care-home context', () => {
    const result = gdprService.assessBreachRisk({
      severity: 'low',
      risk_to_rights: 'unlikely',
      individuals_affected: 0,
      data_categories: [],
      discovered_date: '2026-02-01T10:00:00Z',
    });
    expect(result.riskLevel).toBe('medium');
    expect(result.icoNotifiable).toBe(true);
    expect(result.factors.multiplier).toBe(1.5);
  });
});

// ── Cross-home Isolation ─────────────────────────────────────────────────────

describe('cross-home isolation', () => {
  it('gatherPersonalData for home B does not return home A data', async () => {
    // Same staff ID exists in both homes — data must be scoped
    const result = await gdprService.gatherPersonalData('staff', 'gdpr-S001', homeB);
    expect(result.data.staff).toHaveLength(1);
    expect(result.data.staff[0].name).toBe('Alice GDPR HomeB');
    expect(result.data.access_log).toHaveLength(0);

    // Training from home B only
    const trTypes = result.data.training_records.map(t => t.training_type_id);
    expect(trTypes).toContain('fire-safety');
    // Home A's moving-handling should NOT appear
    expect(trTypes).not.toContain('moving-handling');
  });

  it('findBreaches returns only the correct home', async () => {
    // Create breach in home B
    const b = await gdprService.createBreach(homeB, {
      title: 'Home B breach',
      discovered_date: '2026-02-10',
      severity: 'low',
      risk_to_rights: 'unlikely',
    });
    cleanup.breaches.push(b.id);

    const rowsA = await gdprService.findBreaches(homeA);
    const rowsB = await gdprService.findBreaches(homeB);
    expect(rowsA.find(r => r.title === 'Home B breach')).toBeUndefined();
    expect(rowsB.find(r => r.title === 'Home B breach')).toBeDefined();
  });

  it('erasure in home A does not affect home B staff', async () => {
    // After home A erasure of gdpr-S001, home B's gdpr-S001 should be untouched
    const { rows } = await pool.query(
      `SELECT * FROM staff WHERE home_id = $1 AND id = 'gdpr-S001'`, [homeB]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Alice GDPR HomeB');
    expect(rows[0].active).toBe(true);
    expect(rows[0].hourly_rate).not.toBe('0.00');
  });

  it('erasure in home A does not delete home B training records', async () => {
    const { rows } = await pool.query(
      `SELECT * FROM training_records WHERE home_id = $1 AND staff_id = 'gdpr-S001'`, [homeB]
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].trainer).toBe('HomeB Trainer');
  });
});

describe('resident erasure safety', () => {
  it('fails closed when multiple residents share the same name', async () => {
    const duplicateName = 'Duplicate Resident';
    const { rows: inserted } = await pool.query(
      `INSERT INTO finance_residents (
         home_id,
         resident_name,
         room_number,
         admission_date,
         care_type,
         funding_type,
         weekly_fee,
         status,
         created_by
       )
       VALUES
         ($1, $2, 'D1', '2026-01-01', 'residential', 'self_funded', 1000, 'active', 'test-admin'),
         ($1, $2, 'D2', '2026-01-01', 'residential', 'self_funded', 1000, 'active', 'test-admin')
       RETURNING id`,
      [homeA, duplicateName]
    );

    try {
      await expect(
        gdprService.executeResidentErasure('missing-resident-id', homeA, null, 'test-admin', SLUG_A, duplicateName)
      ).rejects.toThrow(/multiple residents share this name/i);
    } finally {
      await pool.query(
        `DELETE FROM finance_residents WHERE id = ANY($1::int[])`,
        [inserted.map((row) => row.id)]
      );
    }
  });
});
