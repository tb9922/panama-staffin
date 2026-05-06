import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { pool } from '../../db.js';
import { app } from '../../server.js';

process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);

const PREFIX = 'hr-seam-test';
const USERNAME = `${PREFIX}-manager`;
const LIMITED_USERNAME = `${PREFIX}-training-lead`;
const PASSWORD = 'HrSeamPass1Test';
const HOME_SLUG = `${PREFIX}-home`;
const STAFF_ID = 'HRS001';

let token;
let limitedToken;
let homeId;

beforeAll(async () => {
  await pool.query(`DELETE FROM hr_flexible_working WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM hr_oh_referrals WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM hr_edi_records WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM hr_tupe_transfers WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM hr_rtw_dbs_renewals WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM hr_investigation_meetings WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM hr_disciplinary_cases WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM cqc_evidence_links WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM action_items WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM audit_log WHERE home_slug = $1`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM staff WHERE id = $1`, [STAFF_ID]).catch(() => {});
  await pool.query(`DELETE FROM user_home_roles WHERE username = $1`, [USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM user_home_roles WHERE username = $1`, [LIMITED_USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM token_denylist WHERE username = $1`, [USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM token_denylist WHERE username = $1`, [LIMITED_USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM users WHERE username = $1`, [USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM users WHERE username = $1`, [LIMITED_USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug = $1`, [HOME_SLUG]).catch(() => {});

  const { rows: [home] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ($1, 'HR Seam Test Home', '{}') RETURNING id`,
    [HOME_SLUG]
  );
  homeId = home.id;

  await pool.query(
    `INSERT INTO staff (id, home_id, name, role, team, pref, skill, hourly_rate, active, wtr_opt_out, start_date)
     VALUES ($1, $2, 'HR Seam Staff', 'Carer', 'Day A', 'E', 1, 13.00, true, false, '2026-01-01')`,
    [STAFF_ID, homeId]
  );

  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'admin', true, 'HR Seam Manager', 'test-setup'),
            ($3, $2, 'viewer', true, 'HR Seam Training Lead', 'test-setup')`,
    [USERNAME, passwordHash, LIMITED_USERNAME]
  );
  await pool.query(
    `INSERT INTO user_home_roles (username, home_id, role_id, granted_by)
     VALUES ($1, $2, 'home_manager', 'test-setup'),
            ($3, $2, 'training_lead', 'test-setup')`,
    [USERNAME, homeId, LIMITED_USERNAME]
  );

  const loginRes = await request(app)
    .post('/api/login')
    .send({ username: USERNAME, password: PASSWORD })
    .expect(200);
  token = loginRes.body.token;
  const limitedLoginRes = await request(app)
    .post('/api/login')
    .send({ username: LIMITED_USERNAME, password: PASSWORD })
    .expect(200);
  limitedToken = limitedLoginRes.body.token;
});

afterAll(async () => {
  await pool.query(`DELETE FROM hr_flexible_working WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM hr_oh_referrals WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM hr_edi_records WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM hr_tupe_transfers WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM hr_rtw_dbs_renewals WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM hr_investigation_meetings WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM hr_disciplinary_cases WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM cqc_evidence_links WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM action_items WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM audit_log WHERE home_slug = $1`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM staff WHERE id = $1`, [STAFF_ID]).catch(() => {});
  await pool.query(`DELETE FROM user_home_roles WHERE username = $1`, [USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM user_home_roles WHERE username = $1`, [LIMITED_USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM token_denylist WHERE username = $1`, [USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM token_denylist WHERE username = $1`, [LIMITED_USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM users WHERE username = $1`, [USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM users WHERE username = $1`, [LIMITED_USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug = $1`, [HOME_SLUG]).catch(() => {});
});

function authed(method, path) {
  return request(app)[method](path)
    .query({ home: HOME_SLUG })
    .set('Authorization', `Bearer ${token}`);
}

function limitedAuthed(method, path) {
  return request(app)[method](path)
    .query({ home: HOME_SLUG })
    .set('Authorization', `Bearer ${limitedToken}`);
}

describe('HR route save seams', () => {
  it('auto-computes the flexible working decision deadline from the request date when omitted', async () => {
    const createRes = await authed('post', '/api/hr/flexible-working').send({
      staff_id: STAFF_ID,
      request_date: '2026-03-01',
      requested_change: 'Compressed hours over 4 days',
      status: 'pending',
    }).expect(201);

    expect(createRes.body.decision_deadline).toBe('2026-05-01');
  });

  it('allows withdrawing a flexible working request with free-text decision notes', async () => {
    const createRes = await authed('post', '/api/hr/flexible-working').send({
      staff_id: STAFF_ID,
      request_date: '2026-03-01',
      requested_change: 'Compressed hours over 4 days',
      decision_deadline: '2026-05-01',
      status: 'pending',
    }).expect(201);

    const updateRes = await authed('put', `/api/hr/flexible-working/${createRes.body.id}`).send({
      _version: createRes.body.version,
      decision: 'withdrawn',
      status: 'withdrawn',
      decision_reason: 'Employee withdrew request',
    }).expect(200);

    expect(updateRes.body.status).toBe('withdrawn');
    expect(updateRes.body.decision).toBe('withdrawn');
    expect(updateRes.body.decision_reason).toBe('Employee withdrew request');
  });

  it('creates and updates a reasonable adjustment EDI record with free-text category', async () => {
    const createRes = await authed('post', '/api/hr/edi').send({
      record_type: 'reasonable_adjustment',
      staff_id: STAFF_ID,
      date_recorded: '2026-03-02',
      category: 'Physical',
      condition_description: 'Back injury requiring adapted workstation',
      adjustments: ['Height-adjustable desk'],
      status: 'open',
    }).expect(201);

    expect(createRes.body.category).toBe('Physical');
    expect(createRes.body.adjustments).toEqual(['Height-adjustable desk']);

    const { rows: [stored] } = await pool.query(
      `SELECT condition_description, adjustments, sensitive_encrypted, sensitive_iv, sensitive_tag
         FROM hr_edi_records
        WHERE id = $1 AND home_id = $2`,
      [createRes.body.id, homeId]
    );
    expect(stored.condition_description).toBeNull();
    expect(stored.adjustments).toEqual([]);
    expect(stored.sensitive_encrypted).toBeTruthy();
    expect(stored.sensitive_iv).toBeTruthy();
    expect(stored.sensitive_tag).toBeTruthy();

    const updateRes = await authed('put', `/api/hr/edi/${createRes.body.id}`).send({
      _version: createRes.body.version,
      category: 'Sensory',
      adjustments: ['Screen reader software'],
    }).expect(200);

    expect(updateRes.body.category).toBe('Sensory');
    expect(updateRes.body.adjustments).toEqual(['Screen reader software']);
  });

  it('links HR case notes to the staff subject automatically', async () => {
    const disciplinary = await authed('post', '/api/hr/cases/disciplinary').send({
      staff_id: STAFF_ID,
      date_raised: '2026-03-10',
      category: 'conduct',
      allegation_summary: 'Case note subject-link test',
      raised_by: 'HR Seam Manager',
      source: 'observation',
      status: 'open',
    }).expect(201);

    const noteRes = await authed('post', `/api/hr/case-notes/disciplinary/${disciplinary.body.id}`).send({
      note: 'Linked note for disciplinary case',
    }).expect(201);

    expect(noteRes.body.subject_type).toBe('staff');
    expect(noteRes.body.subject_id).toBe(STAFF_ID);
  });

  it('rejects malformed structured disciplinary JSON instead of wiping it', async () => {
    const disciplinary = await authed('post', '/api/hr/cases/disciplinary').send({
      staff_id: STAFF_ID,
      date_raised: '2026-03-10',
      category: 'conduct',
      allegation_summary: 'Malformed structured JSON test',
      raised_by: 'HR Seam Manager',
      source: 'observation',
      status: 'open',
    }).expect(201);

    await authed('put', `/api/hr/cases/disciplinary/${disciplinary.body.id}`).send({
      _version: disciplinary.body.version,
      witnesses: 'not-json',
    }).expect(400);
  });

  it('requires the current version before deleting an HR case', async () => {
    const disciplinary = await authed('post', '/api/hr/cases/disciplinary').send({
      staff_id: STAFF_ID,
      date_raised: '2026-03-10',
      category: 'conduct',
      allegation_summary: 'Versioned delete test',
      raised_by: 'HR Seam Manager',
      source: 'observation',
      status: 'open',
    }).expect(201);

    const updated = await authed('put', `/api/hr/cases/disciplinary/${disciplinary.body.id}`).send({
      _version: disciplinary.body.version,
      status: 'investigation',
    }).expect(200);

    await authed('delete', `/api/hr/cases/disciplinary/${disciplinary.body.id}`).send({
      _version: disciplinary.body.version,
    }).expect(409);

    await authed('delete', `/api/hr/cases/disciplinary/${disciplinary.body.id}`).send({
      _version: updated.body.version,
    }).expect(204);
  });

  it('requires the current version before deleting an investigation meeting', async () => {
    const disciplinary = await authed('post', '/api/hr/cases/disciplinary').send({
      staff_id: STAFF_ID,
      date_raised: '2026-03-15',
      category: 'conduct',
      allegation_summary: 'Meeting delete version test',
      raised_by: 'HR Seam Manager',
      source: 'observation',
      status: 'open',
    }).expect(201);

    const meeting = await authed('post', `/api/hr/meetings/disciplinary/${disciplinary.body.id}`).send({
      meeting_date: '2026-03-20',
      meeting_type: 'interview',
      attendees: [
        { name: 'Manager', role_in_meeting: 'investigator' },
        { name: 'Employee', role_in_meeting: 'subject' },
      ],
      summary: 'Initial meeting summary',
    }).expect(201);

    const updated = await authed('put', `/api/hr/meetings/${meeting.body.id}`).send({
      _version: meeting.body.version,
      summary: 'Updated meeting summary',
    }).expect(200);

    await authed('delete', `/api/hr/meetings/${meeting.body.id}`).send({
      _version: meeting.body.version,
    }).expect(409);

    await authed('delete', `/api/hr/meetings/${meeting.body.id}`).send({
      _version: updated.body.version,
    }).expect(204);
  });

  it('audits HR audit exports and rejects malformed export dates', async () => {
    await authed('get', '/api/hr/admin/audit-export')
      .query({ from: 'bad-date', to: '2026-12-31' })
      .expect(400);
    await authed('get', '/api/hr/admin/audit-export')
      .query({ from: '2026-02-31', to: '2026-12-31' })
      .expect(400);

    await pool.query(
      `INSERT INTO audit_log (action, home_slug, user_name, details)
       VALUES ('hr_export_seed', $1, $2, '{}'::jsonb)`,
      [HOME_SLUG, USERNAME]
    );

    await authed('get', '/api/hr/admin/audit-export')
      .query({ from: '2026-01-01', to: '2026-12-31' })
      .expect(200);

    const { rows } = await pool.query(
      `SELECT details
         FROM audit_log
        WHERE home_slug = $1
          AND action = 'hr_audit_export_download'
        ORDER BY id DESC
        LIMIT 1`,
      [HOME_SLUG]
    );
    expect(rows).toHaveLength(1);
    const details = typeof rows[0].details === 'string'
      ? JSON.parse(rows[0].details)
      : rows[0].details;
    expect(details.from).toBe('2026-01-01');
    expect(details.to).toBe('2026-12-31');
    expect(details.row_count).toBeGreaterThanOrEqual(1);
  });

  it('cancels linked manager actions when grievance actions are cancelled or de-scheduled', async () => {
    const grievance = await authed('post', '/api/hr/cases/grievance').send({
      staff_id: STAFF_ID,
      date_raised: '2026-03-10',
      raised_by_method: 'written',
      category: 'working_conditions',
      description: 'Grievance action sync test',
      status: 'open',
    }).expect(201);

    const action = await authed('post', `/api/hr/cases/grievance/${grievance.body.id}/actions`).send({
      description: 'Follow up with staff member',
      responsible: 'HR Seam Manager',
      due_date: '2026-03-20',
      status: 'pending',
    }).expect(201);

    const sourceActionKey = `grievance_action:${action.body.id}`;
    let item = await pool.query(
      `SELECT status
         FROM action_items
        WHERE home_id = $1
          AND source_type = 'hr_grievance'
          AND source_id = $2
          AND source_action_key = $3
          AND deleted_at IS NULL`,
      [homeId, String(grievance.body.id), sourceActionKey]
    );
    expect(item.rows[0].status).toBe('open');

    const cancelled = await authed('put', `/api/hr/grievance-actions/${action.body.id}`).send({
      _version: action.body.version,
      status: 'cancelled',
    }).expect(200);

    item = await pool.query(
      `SELECT status, escalation_level
         FROM action_items
        WHERE home_id = $1
          AND source_type = 'hr_grievance'
          AND source_id = $2
          AND source_action_key = $3
          AND deleted_at IS NULL`,
      [homeId, String(grievance.body.id), sourceActionKey]
    );
    expect(item.rows[0].status).toBe('cancelled');
    expect(item.rows[0].escalation_level).toBe(0);

    const reactivated = await authed('put', `/api/hr/grievance-actions/${action.body.id}`).send({
      _version: cancelled.body.version,
      status: 'in_progress',
      due_date: '2026-03-25',
    }).expect(200);
    expect(reactivated.body.status).toBe('in_progress');

    item = await pool.query(
      `SELECT status
         FROM action_items
        WHERE home_id = $1
          AND source_type = 'hr_grievance'
          AND source_id = $2
          AND source_action_key = $3
          AND deleted_at IS NULL`,
      [homeId, String(grievance.body.id), sourceActionKey]
    );
    expect(item.rows[0].status).toBe('open');
  });

  it('redacts grievance action manager-actions and retires links when the case is deleted', async () => {
    const grievance = await authed('post', '/api/hr/cases/grievance').send({
      staff_id: STAFF_ID,
      date_raised: '2026-03-12',
      raised_by_method: 'written',
      category: 'harassment',
      description: 'Sensitive grievance narrative for redaction test',
      status: 'open',
    }).expect(201);

    const action = await authed('post', `/api/hr/cases/grievance/${grievance.body.id}/actions`).send({
      description: 'Investigate harassment allegation with named witness',
      responsible: 'HR Seam Manager',
      due_date: '2026-03-22',
      status: 'pending',
    }).expect(201);

    const sourceActionKey = `grievance_action:${action.body.id}`;
    let item = await pool.query(
      `SELECT title, description, status
         FROM action_items
        WHERE home_id = $1
          AND source_type = 'hr_grievance'
          AND source_id = $2
          AND source_action_key = $3
          AND deleted_at IS NULL`,
      [homeId, String(grievance.body.id), sourceActionKey]
    );
    expect(item.rows[0].status).toBe('open');
    expect(item.rows[0].title).not.toContain('harassment allegation');
    expect(item.rows[0].description).toContain('Restricted HR grievance action');

    const link = await pool.query(
      `INSERT INTO cqc_evidence_links (
         home_id, source_module, source_id, quality_statement, evidence_category,
         rationale, auto_linked, requires_review, linked_by
       )
       VALUES ($1, 'hr_grievance', $2, 'S3', 'processes', 'Manual HR evidence link', false, false, $3)
       RETURNING id`,
      [homeId, String(grievance.body.id), USERNAME]
    );

    await authed('delete', `/api/hr/cases/grievance/${grievance.body.id}`).send({
      _version: grievance.body.version,
    }).expect(204);

    item = await pool.query(
      `SELECT status, escalation_level
         FROM action_items
        WHERE home_id = $1
          AND source_type = 'hr_grievance'
          AND source_id = $2
          AND source_action_key = $3
          AND deleted_at IS NULL`,
      [homeId, String(grievance.body.id), sourceActionKey]
    );
    expect(item.rows[0].status).toBe('cancelled');
    expect(item.rows[0].escalation_level).toBe(0);

    const retired = await pool.query(
      `SELECT deleted_at
         FROM cqc_evidence_links
        WHERE id = $1
          AND home_id = $2`,
      [link.rows[0].id, homeId]
    );
    expect(retired.rows[0].deleted_at).not.toBeNull();
  });

  it('does not cancel linked actions when a stale grievance delete conflicts', async () => {
    const grievance = await authed('post', '/api/hr/cases/grievance').send({
      staff_id: STAFF_ID,
      date_raised: '2026-03-14',
      raised_by_method: 'written',
      category: 'working_conditions',
      description: 'Stale delete side-effect test',
      status: 'open',
    }).expect(201);

    const action = await authed('post', `/api/hr/cases/grievance/${grievance.body.id}/actions`).send({
      description: 'Check rota allocation concern',
      responsible: 'HR Seam Manager',
      due_date: '2026-03-28',
      status: 'pending',
    }).expect(201);

    const updated = await authed('put', `/api/hr/cases/grievance/${grievance.body.id}`).send({
      _version: grievance.body.version,
      status: 'investigating',
    }).expect(200);

    await authed('delete', `/api/hr/cases/grievance/${grievance.body.id}`).send({
      _version: grievance.body.version,
    }).expect(409);

    let item = await pool.query(
      `SELECT status
         FROM action_items
        WHERE home_id = $1
          AND source_type = 'hr_grievance'
          AND source_id = $2
          AND source_action_key = $3
          AND deleted_at IS NULL`,
      [homeId, String(grievance.body.id), `grievance_action:${action.body.id}`]
    );
    expect(item.rows[0].status).toBe('open');

    await authed('delete', `/api/hr/cases/grievance/${grievance.body.id}`).send({
      _version: updated.body.version,
    }).expect(204);

    item = await pool.query(
      `SELECT status
         FROM action_items
        WHERE home_id = $1
          AND source_type = 'hr_grievance'
          AND source_id = $2
          AND source_action_key = $3
          AND deleted_at IS NULL`,
      [homeId, String(grievance.body.id), `grievance_action:${action.body.id}`]
    );
    expect(item.rows[0].status).toBe('cancelled');
  });

  it('hides HR CQC links from compliance-only roles', async () => {
    const grievance = await authed('post', '/api/hr/cases/grievance').send({
      staff_id: STAFF_ID,
      date_raised: '2026-03-16',
      raised_by_method: 'written',
      category: 'harassment',
      description: 'Restricted CQC link visibility test',
      status: 'open',
    }).expect(201);

    const link = await pool.query(
      `INSERT INTO cqc_evidence_links (
         home_id, source_module, source_id, quality_statement, evidence_category,
         rationale, auto_linked, requires_review, linked_by
       )
       VALUES ($1, 'hr_grievance', $2, 'S3', 'processes',
               'Sensitive HR grievance rationale', false, true, $3)
       RETURNING id`,
      [homeId, String(grievance.body.id), USERNAME]
    );

    const listRes = await limitedAuthed('get', '/api/cqc-evidence-links').expect(200);
    expect(listRes.body.rows.some((row) => row.id === link.rows[0].id)).toBe(false);

    await limitedAuthed('get', `/api/cqc-evidence-links/source/hr_grievance/${grievance.body.id}`)
      .expect(403);
    await limitedAuthed('post', '/api/cqc-evidence-links').send({
      source_module: 'hr_grievance',
      source_id: String(grievance.body.id),
      quality_statement: 'S3',
      evidence_category: 'processes',
      rationale: 'Attempted restricted link',
    }).expect(403);
    await limitedAuthed('put', `/api/cqc-evidence-links/${link.rows[0].id}`).send({
      rationale: 'Attempted restricted update',
      _version: 1,
    }).expect(403);

    const updateRes = await authed('put', `/api/cqc-evidence-links/${link.rows[0].id}`).send({
      rationale: 'Updated sensitive HR rationale',
      _version: 1,
    }).expect(200);
    expect(updateRes.body.rationale).toBe('Updated sensitive HR rationale');

    const audit = await pool.query(
      `SELECT details
         FROM audit_log
        WHERE home_slug = $1
          AND action = 'cqc_evidence_link_update'
        ORDER BY id DESC
        LIMIT 1`,
      [HOME_SLUG]
    );
    const details = typeof audit.rows[0].details === 'string'
      ? JSON.parse(audit.rows[0].details)
      : audit.rows[0].details;
    expect(JSON.stringify(details)).not.toContain('Updated sensitive HR rationale');
    expect(JSON.stringify(details)).toContain('[REDACTED]');
  });

  it('does not surface stale HR CQC links when the parent case is already deleted', async () => {
    const grievance = await authed('post', '/api/hr/cases/grievance').send({
      staff_id: STAFF_ID,
      date_raised: '2026-03-17',
      raised_by_method: 'written',
      category: 'working_conditions',
      description: 'Stale HR evidence link test',
      status: 'open',
    }).expect(201);

    const link = await pool.query(
      `INSERT INTO cqc_evidence_links (
         home_id, source_module, source_id, quality_statement, evidence_category,
         rationale, auto_linked, requires_review, linked_by
       )
       VALUES ($1, 'hr_grievance', $2, 'S3', 'processes',
               'Stale HR link', false, false, $3)
       RETURNING id`,
      [homeId, String(grievance.body.id), USERNAME]
    );

    await pool.query(
      `UPDATE hr_grievance_cases
          SET deleted_at = NOW()
        WHERE home_id = $1
          AND id = $2`,
      [homeId, grievance.body.id]
    );

    const listRes = await authed('get', '/api/cqc-evidence-links').expect(200);
    expect(listRes.body.rows.some((row) => row.id === link.rows[0].id)).toBe(false);
  });

  it('persists OH referral consent audit fields on create and update', async () => {
    const createRes = await authed('post', '/api/hr/oh-referrals').send({
      staff_id: STAFF_ID,
      referral_date: '2026-03-12',
      referred_by: 'HR Seam Manager',
      reason: 'Back pain review',
      employee_consent_obtained: true,
      consent_date: '2026-03-11',
      consent_method: 'written',
      consent_witness: 'Deputy Manager',
      questions_for_oh: 'Can they return safely?',
    }).expect(201);

    expect(createRes.body.employee_consent_obtained).toBe(true);
    expect(createRes.body.consent_date).toBe('2026-03-11');
    expect(createRes.body.consent_method).toBe('written');
    expect(createRes.body.consent_witness).toBe('Deputy Manager');
    expect(createRes.body.reason).toBe('Back pain review');
    expect(createRes.body.questions_for_oh).toEqual(['Can they return safely?']);

    const { rows: [stored] } = await pool.query(
      `SELECT reason, questions_for_oh, report_summary, adjustments_recommended,
              sensitive_encrypted, sensitive_iv, sensitive_tag
         FROM hr_oh_referrals
        WHERE id = $1 AND home_id = $2`,
      [createRes.body.id, homeId]
    );
    expect(stored.reason).toBe('[encrypted]');
    expect(stored.questions_for_oh).toEqual([]);
    expect(stored.report_summary).toBeNull();
    expect(stored.adjustments_recommended).toBeNull();
    expect(stored.sensitive_encrypted).toBeTruthy();
    expect(stored.sensitive_iv).toBeTruthy();
    expect(stored.sensitive_tag).toBeTruthy();

    const updateRes = await authed('put', `/api/hr/oh-referrals/${createRes.body.id}`).send({
      _version: createRes.body.version,
      consent_method: 'email',
      consent_witness: 'Registered Manager',
    }).expect(200);

    expect(updateRes.body.consent_method).toBe('email');
    expect(updateRes.body.consent_witness).toBe('Registered Manager');
  });

  it('encrypts RTW and fit-note health narratives at rest', async () => {
    const createRes = await authed('post', '/api/hr/rtw-interviews').send({
      staff_id: STAFF_ID,
      absence_start_date: '2026-03-08',
      absence_end_date: '2026-03-09',
      absence_days: 2,
      absence_reason: 'Surgery recovery',
      rtw_date: '2026-03-10',
      conducted_by: 'HR Seam Manager',
      fit_for_work: true,
      adjustments: 'No heavy lifting for two weeks',
      underlying_condition: true,
      fit_note_received: true,
      fit_note_date: '2026-03-08',
      fit_note_type: 'may_be_fit',
      fit_note_adjustments: 'Phased return',
    }).expect(201);

    expect(createRes.body.absence_reason).toBe('Surgery recovery');
    expect(createRes.body.adjustments_detail).toBe('No heavy lifting for two weeks');
    expect(createRes.body.underlying_condition).toBe(true);
    expect(createRes.body.fit_note_adjustments).toBe('Phased return');

    const { rows: [stored] } = await pool.query(
      `SELECT absence_reason, adjustments_detail, underlying_condition, fit_note_type,
              fit_note_adjustments, sensitive_encrypted, sensitive_iv, sensitive_tag
         FROM hr_rtw_interviews
        WHERE id = $1 AND home_id = $2`,
      [createRes.body.id, homeId]
    );
    expect(stored.absence_reason).toBeNull();
    expect(stored.adjustments_detail).toBeNull();
    expect(stored.underlying_condition).toBe(false);
    expect(stored.fit_note_type).toBeNull();
    expect(stored.fit_note_adjustments).toBeNull();
    expect(stored.sensitive_encrypted).toBeTruthy();
    expect(stored.sensitive_iv).toBeTruthy();
    expect(stored.sensitive_tag).toBeTruthy();
  });

  it('rejects TUPE consultation windows shorter than 30 days', async () => {
    const createRes = await authed('post', '/api/hr/tupe').send({
      transfer_type: 'incoming',
      transfer_date: '2026-06-01',
      transferor_name: 'OldCo Care Services',
      transferee_name: 'NewCo Care Group',
      staff_affected: 12,
      consultation_start: '2026-04-01',
      consultation_end: '2026-04-15',
      status: 'consultation',
    }).expect(400);

    expect(createRes.body.error).toMatch(/at least 30 days/i);
  });

  it('persists TUPE consultation, ELI, and measures fields on create and update', async () => {
    const createRes = await authed('post', '/api/hr/tupe').send({
      transfer_type: 'incoming',
      transfer_date: '2026-06-01',
      transferor_name: 'OldCo Care Services',
      transferee_name: 'NewCo Care Group',
      staff_affected: 12,
      consultation_start: '2026-04-01',
      consultation_end: '2026-05-15',
      eli_sent_date: '2026-03-15',
      measures_proposed: 'No redundancies planned',
      status: 'consultation',
    }).expect(201);

    expect(createRes.body.staff_affected).toBe(12);
    expect(createRes.body.consultation_start).toBe('2026-04-01');
    expect(createRes.body.consultation_end).toBe('2026-05-15');
    expect(createRes.body.eli_sent_date).toBe('2026-03-15');
    expect(createRes.body.measures_proposed).toBe('No redundancies planned');

    const updateRes = await authed('put', `/api/hr/tupe/${createRes.body.id}`).send({
      _version: createRes.body.version,
      consultation_end: '2026-05-20',
      eli_sent_date: '2026-03-20',
      measures_proposed: 'Revised consultation pack issued',
    }).expect(200);

    expect(updateRes.body.consultation_end).toBe('2026-05-20');
    expect(updateRes.body.eli_sent_date).toBe('2026-03-20');
    expect(updateRes.body.measures_proposed).toBe('Revised consultation pack issued');
  });

  it('accepts user-facing RTW document labels and normalizes them', async () => {
    const createRes = await authed('post', '/api/hr/renewals').send({
      staff_id: STAFF_ID,
      check_type: 'rtw',
      last_checked: '2026-03-03',
      expiry_date: '2027-03-03',
      document_type: 'BRP',
      status: 'current',
    }).expect(201);

    expect(createRes.body.document_type).toBe('brp');
    expect(createRes.body.last_checked).toBe('2026-03-03');
    expect(createRes.body.expiry_date).toBe('2027-03-03');
  });
});
