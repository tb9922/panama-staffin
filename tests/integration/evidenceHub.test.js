import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app } from '../../server.js';
import { pool } from '../../db.js';
import * as cqcEvidenceRepo from '../../repositories/cqcEvidenceRepo.js';
import * as cqcEvidenceFileRepo from '../../repositories/cqcEvidenceFileRepo.js';
import * as onboardingAttachmentsRepo from '../../repositories/onboardingAttachments.js';
import * as trainingAttachmentsRepo from '../../repositories/trainingAttachments.js';
import * as recordAttachmentsRepo from '../../repositories/recordAttachments.js';
import * as hrAttachmentsRepo from '../../repositories/hr/attachments.js';
import * as disciplinaryRepo from '../../repositories/hr/disciplinary.js';

const PREFIX = 'evidence-hub-test';
const PREFIX_LIKE = `${PREFIX}%`;
const PASSWORD = 'EvidenceHub!2026';

const USERS = {
  manager: `${PREFIX}-manager`,
  hr: `${PREFIX}-hr`,
  training: `${PREFIX}-training`,
  finance: `${PREFIX}-finance`,
  viewer: `${PREFIX}-viewer`,
};

const STAFF_IDS = {
  homeA: 'EH-S001',
  homeB: 'EH-S002',
};

let homeId;
let homeSlug;
let homeTwoId;
let homeManagerToken;
let hrOfficerToken;
let trainingLeadToken;
let financeOfficerToken;
let viewerToken;

async function loginAndGetToken(username) {
  const response = await request(app)
    .post('/api/login')
    .send({ username, password: PASSWORD });
  return response.body.token;
}

describe('Evidence Hub integration', () => {
  beforeAll(async () => {
    await pool.query(`DELETE FROM hr_file_attachments WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE $1)`, [PREFIX_LIKE]);
    await pool.query(`DELETE FROM cqc_evidence_files WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE $1)`, [PREFIX_LIKE]);
    await pool.query(`DELETE FROM onboarding_file_attachments WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE $1)`, [PREFIX_LIKE]);
    await pool.query(`DELETE FROM training_file_attachments WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE $1)`, [PREFIX_LIKE]);
    await pool.query(`DELETE FROM record_file_attachments WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE $1)`, [PREFIX_LIKE]);
    await pool.query(`DELETE FROM hr_disciplinary_cases WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE $1)`, [PREFIX_LIKE]);
    await pool.query(`DELETE FROM cqc_evidence WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE $1)`, [PREFIX_LIKE]);
    await pool.query(`DELETE FROM onboarding WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE $1)`, [PREFIX_LIKE]);
    await pool.query(`DELETE FROM staff WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE $1)`, [PREFIX_LIKE]);
    await pool.query(`DELETE FROM user_home_roles WHERE username LIKE $1`, [PREFIX_LIKE]);
    await pool.query(`DELETE FROM token_denylist WHERE username LIKE $1`, [PREFIX_LIKE]);
    await pool.query(`DELETE FROM users WHERE username LIKE $1`, [PREFIX_LIKE]);
    await pool.query(`DELETE FROM homes WHERE slug LIKE $1`, [PREFIX_LIKE]);

    const { rows: [homeOne] } = await pool.query(
      `INSERT INTO homes (slug, name, config)
       VALUES ($1, 'Evidence Hub Home', $2)
       RETURNING id, slug, config`,
      [`${PREFIX}-a`, JSON.stringify({ home_name: 'Evidence Hub Home', registered_beds: 20 })]
    );
    homeId = homeOne.id;
    homeSlug = homeOne.slug;

    const { rows: [homeTwo] } = await pool.query(
      `INSERT INTO homes (slug, name, config)
       VALUES ($1, 'Evidence Hub Other Home', $2)
       RETURNING id, slug, config`,
      [`${PREFIX}-b`, JSON.stringify({ home_name: 'Evidence Hub Other Home', registered_beds: 12 })]
    );
    homeTwoId = homeTwo.id;

    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    for (const username of Object.values(USERS)) {
      await pool.query(
        `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
         VALUES ($1, $2, 'viewer', true, $1, 'test-setup')`,
        [username, passwordHash]
      );
    }

    await pool.query(
      `INSERT INTO user_home_roles (username, home_id, role_id, granted_by) VALUES
        ($1, $6, 'home_manager', 'test-setup'),
        ($2, $6, 'hr_officer', 'test-setup'),
        ($3, $6, 'training_lead', 'test-setup'),
        ($4, $6, 'finance_officer', 'test-setup'),
        ($5, $6, 'viewer', 'test-setup')`,
      [USERS.manager, USERS.hr, USERS.training, USERS.finance, USERS.viewer, homeId]
    );

    await pool.query(
      `INSERT INTO staff (id, home_id, name, role, team, pref, skill, hourly_rate, active, wtr_opt_out, start_date)
       VALUES
       ($3, $1, 'Alice Evidence', 'Carer', 'Day A', 'E', 1, 13.50, true, false, '2026-01-01'),
       ($4, $2, 'Bob Other', 'Carer', 'Day B', 'L', 1, 12.75, true, false, '2026-01-01')`,
      [homeId, homeTwoId, STAFF_IDS.homeA, STAFF_IDS.homeB]
    );

    const caseRecord = await disciplinaryRepo.createDisciplinary(homeId, {
      staff_id: STAFF_IDS.homeA,
      date_raised: '2026-04-01',
      raised_by: 'Manager',
      category: 'misconduct',
      allegation_summary: 'Late handover',
      allegation_detail: 'Evidence hub parent label test',
      created_by: USERS.manager,
    });

    await hrAttachmentsRepo.createAttachment(homeId, 'disciplinary', caseRecord.id, {
      original_name: 'hr-evidence-note.pdf',
      stored_name: 'hr-evidence-note.pdf',
      mime_type: 'application/pdf',
      size_bytes: 1200,
      description: 'HR disciplinary attachment',
      uploaded_by: 'hr.user',
    });

    const cqcEvidence = await cqcEvidenceRepo.upsert(homeId, {
      quality_statement: 'S1',
      type: 'qualitative',
      title: 'Learning culture audit',
      description: 'Snapshot of learning culture evidence',
      evidence_category: 'partner_feedback',
      evidence_owner: 'Compliance Lead',
      review_due: '2026-08-01',
      added_by: USERS.manager,
    });

    await cqcEvidenceFileRepo.create(homeId, cqcEvidence.id, {
      original_name: 'cqc-learning-photo.jpg',
      stored_name: 'cqc-learning-photo.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 2048,
      description: 'CQC evidence file',
      uploaded_by: 'compliance.user',
    });

    await onboardingAttachmentsRepo.create(homeId, STAFF_IDS.homeA, 'dbs_check', {
      original_name: 'onboarding-dbs-check.docx',
      stored_name: 'onboarding-dbs-check.docx',
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size_bytes: 4096,
      description: 'Onboarding DBS file',
      uploaded_by: 'compliance.user',
    });

    await trainingAttachmentsRepo.create(homeId, STAFF_IDS.homeA, 'fire-safety', {
      original_name: 'training-certificate.pdf',
      stored_name: 'training-certificate.pdf',
      mime_type: 'application/pdf',
      size_bytes: 1800,
      description: 'Training certificate',
      uploaded_by: 'training.user',
    });

    await recordAttachmentsRepo.create(homeId, 'incident', 'INC-42', {
      original_name: 'incident-photo.jpg',
      stored_name: 'incident-photo.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 1500,
      description: 'Operational incident evidence',
      uploaded_by: 'compliance.user',
    });

    await recordAttachmentsRepo.create(homeId, 'finance_invoice', 'INV-42', {
      original_name: 'resident-invoice.pdf',
      stored_name: 'resident-invoice.pdf',
      mime_type: 'application/pdf',
      size_bytes: 2200,
      description: 'Resident invoice evidence',
      uploaded_by: 'finance.user',
    });

    await recordAttachmentsRepo.create(homeId, 'staff_register', STAFF_IDS.homeA, {
      original_name: 'staff-profile-note.txt',
      stored_name: 'staff-profile-note.txt',
      mime_type: 'text/plain',
      size_bytes: 750,
      description: 'Staff register evidence',
      uploaded_by: 'staff.user',
    });

    const homeTwoCase = await disciplinaryRepo.createDisciplinary(homeTwoId, {
      staff_id: STAFF_IDS.homeB,
      date_raised: '2026-04-02',
      raised_by: 'Other Manager',
      category: 'misconduct',
      allegation_summary: 'Other home case',
      created_by: USERS.manager,
    });
    await hrAttachmentsRepo.createAttachment(homeTwoId, 'disciplinary', homeTwoCase.id, {
      original_name: 'other-home-hidden.pdf',
      stored_name: 'other-home-hidden.pdf',
      mime_type: 'application/pdf',
      size_bytes: 1500,
      description: 'Should not leak',
      uploaded_by: 'other.user',
    });
    await recordAttachmentsRepo.create(homeTwoId, 'finance_invoice', 'INV-99', {
      original_name: 'other-home-invoice.pdf',
      stored_name: 'other-home-invoice.pdf',
      mime_type: 'application/pdf',
      size_bytes: 1600,
      description: 'Should not leak either',
      uploaded_by: 'other.user',
    });

    homeManagerToken = await loginAndGetToken(USERS.manager);
    hrOfficerToken = await loginAndGetToken(USERS.hr);
    trainingLeadToken = await loginAndGetToken(USERS.training);
    financeOfficerToken = await loginAndGetToken(USERS.finance);
    viewerToken = await loginAndGetToken(USERS.viewer);
  }, 20000);

  afterAll(async () => {
    await pool.query(`DELETE FROM hr_file_attachments WHERE home_id IN ($1, $2)`, [homeId, homeTwoId]).catch(() => {});
    await pool.query(`DELETE FROM cqc_evidence_files WHERE home_id IN ($1, $2)`, [homeId, homeTwoId]).catch(() => {});
    await pool.query(`DELETE FROM onboarding_file_attachments WHERE home_id IN ($1, $2)`, [homeId, homeTwoId]).catch(() => {});
    await pool.query(`DELETE FROM training_file_attachments WHERE home_id IN ($1, $2)`, [homeId, homeTwoId]).catch(() => {});
    await pool.query(`DELETE FROM record_file_attachments WHERE home_id IN ($1, $2)`, [homeId, homeTwoId]).catch(() => {});
    await pool.query(`DELETE FROM hr_disciplinary_cases WHERE home_id IN ($1, $2)`, [homeId, homeTwoId]).catch(() => {});
    await pool.query(`DELETE FROM cqc_evidence WHERE home_id IN ($1, $2)`, [homeId, homeTwoId]).catch(() => {});
    await pool.query(`DELETE FROM onboarding WHERE home_id IN ($1, $2)`, [homeId, homeTwoId]).catch(() => {});
    await pool.query(`DELETE FROM staff WHERE home_id IN ($1, $2)`, [homeId, homeTwoId]).catch(() => {});
    await pool.query(`DELETE FROM user_home_roles WHERE username LIKE $1`, [PREFIX_LIKE]).catch(() => {});
    await pool.query(`DELETE FROM token_denylist WHERE username LIKE $1`, [PREFIX_LIKE]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE username LIKE $1`, [PREFIX_LIKE]).catch(() => {});
    await pool.query(`DELETE FROM homes WHERE slug LIKE $1`, [PREFIX_LIKE]).catch(() => {});
  });

  it('home manager sees all evidence sources with labels', async () => {
    const response = await request(app)
      .get(`/api/evidence-hub/search?home=${homeSlug}`)
      .set('Authorization', `Bearer ${homeManagerToken}`)
      .expect(200);

    expect(response.body.total).toBe(7);
    expect(response.body.rows).toHaveLength(7);
    expect([...new Set(response.body.rows.map((row) => row.sourceModule))].sort()).toEqual([
      'cqc_evidence',
      'hr',
      'onboarding',
      'record',
      'training',
    ]);

    const hrRow = response.body.rows.find((row) => row.sourceModule === 'hr');
    expect(hrRow.parentLabel).toMatch(/Disciplinary/i);
    expect(hrRow.parentLabel).toMatch(/Late handover/);
    expect(hrRow.staffName).toBe('Alice Evidence');
    expect(hrRow.canDelete).toBe(true);

    const trainingRow = response.body.rows.find((row) => row.sourceModule === 'training');
    expect(trainingRow.parentLabel).toMatch(/Training - Fire Safety/);
    expect(trainingRow.staffName).toBe('Alice Evidence');

    const cqcRow = response.body.rows.find((row) => row.sourceModule === 'cqc_evidence');
    expect(cqcRow.qualityStatementId).toBe('S1');
    expect(cqcRow.evidenceCategory).toBe('partner_feedback');
    expect(cqcRow.evidenceOwner).toBe('Compliance Lead');
    expect(cqcRow.reviewDueAt).toBe('2026-08-01');
    expect(cqcRow.freshness).toBeTruthy();

    const onboardingRow = response.body.rows.find((row) => row.sourceModule === 'onboarding');
    expect(onboardingRow.parentLabel).toBe('Onboarding - Enhanced DBS Check');

    const incidentRow = response.body.rows.find((row) => row.sourceModule === 'record' && row.sourceSubType === 'incident');
    expect(incidentRow.parentLabel).toBe('Incident - INC-42');

    const financeRow = response.body.rows.find((row) => row.sourceModule === 'record' && row.sourceSubType === 'finance_invoice');
    expect(financeRow.parentLabel).toBe('Invoice - INV-42');

    const staffRow = response.body.rows.find((row) => row.sourceModule === 'record' && row.sourceSubType === 'staff_register');
    expect(staffRow.parentLabel).toBe(`Staff Register - ${STAFF_IDS.homeA}`);
  });

  it('hr officer sees HR plus permitted record evidence only', async () => {
    const response = await request(app)
      .get(`/api/evidence-hub/search?home=${homeSlug}`)
      .set('Authorization', `Bearer ${hrOfficerToken}`)
      .expect(200);

    expect(response.body.rows.map((row) => row.sourceModule).sort()).toEqual(['hr', 'record', 'record']);
    expect(response.body.rows.filter((row) => row.sourceModule === 'record').map((row) => row.sourceSubType).sort()).toEqual([
      'finance_invoice',
      'staff_register',
    ]);
    expect(response.body.rows.every((row) => row.sourceModule !== 'cqc_evidence')).toBe(true);
  });

  it('training lead sees compliance, training, and permitted operational evidence', async () => {
    const response = await request(app)
      .get(`/api/evidence-hub/search?home=${homeSlug}`)
      .set('Authorization', `Bearer ${trainingLeadToken}`)
      .expect(200);

    expect(response.body.rows.map((row) => row.sourceModule).sort()).toEqual([
      'cqc_evidence',
      'onboarding',
      'record',
      'record',
      'record',
      'training',
    ]);
    expect(response.body.rows.every((row) => row.sourceModule !== 'hr')).toBe(true);
  });

  it('finance officer sees only finance/payroll-backed operational evidence', async () => {
    const response = await request(app)
      .get(`/api/evidence-hub/search?home=${homeSlug}`)
      .set('Authorization', `Bearer ${financeOfficerToken}`)
      .expect(200);

    expect(response.body.total).toBe(1);
    expect(response.body.rows).toHaveLength(1);
    expect(response.body.rows[0].sourceModule).toBe('record');
    expect(response.body.rows[0].sourceSubType).toBe('finance_invoice');
    expect(response.body.rows[0].canDelete).toBe(true);
  });

  it('viewer sees only staff-backed operational evidence', async () => {
    const response = await request(app)
      .get(`/api/evidence-hub/search?home=${homeSlug}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);

    expect(response.body.total).toBe(1);
    expect(response.body.rows).toHaveLength(1);
    expect(response.body.rows[0].sourceModule).toBe('record');
    expect(response.body.rows[0].sourceSubType).toBe('staff_register');
    expect(response.body.rows[0].canDelete).toBe(false);
  });

  it('supports source, uploader, search, and pagination filters without leaking other homes', async () => {
    const filtered = await request(app)
      .get(`/api/evidence-hub/search?home=${homeSlug}&modules=onboarding&q=dbs&uploadedBy=compliance.user`)
      .set('Authorization', `Bearer ${homeManagerToken}`)
      .expect(200);

    expect(filtered.body.total).toBe(1);
    expect(filtered.body.rows).toHaveLength(1);
    expect(filtered.body.rows[0].sourceModule).toBe('onboarding');
    expect(filtered.body.rows[0].originalName).toBe('onboarding-dbs-check.docx');

    const pageOne = await request(app)
      .get(`/api/evidence-hub/search?home=${homeSlug}&limit=2&offset=0`)
      .set('Authorization', `Bearer ${homeManagerToken}`)
      .expect(200);
    const pageTwo = await request(app)
      .get(`/api/evidence-hub/search?home=${homeSlug}&limit=2&offset=2`)
      .set('Authorization', `Bearer ${homeManagerToken}`)
      .expect(200);

    expect(pageOne.body.total).toBe(7);
    expect(pageOne.body.rows).toHaveLength(2);
    expect(pageTwo.body.total).toBe(7);
    expect(pageTwo.body.rows).toHaveLength(2);
    expect(pageOne.body.rows.some((row) => row.originalName === 'other-home-hidden.pdf')).toBe(false);
  });

  it('returns uploader options only for visible evidence sources', async () => {
    const managerResponse = await request(app)
      .get(`/api/evidence-hub/uploaders?home=${homeSlug}`)
      .set('Authorization', `Bearer ${homeManagerToken}`)
      .expect(200);
    expect(managerResponse.body).toEqual(['compliance.user', 'finance.user', 'hr.user', 'staff.user', 'training.user']);

    const financeResponse = await request(app)
      .get(`/api/evidence-hub/uploaders?home=${homeSlug}`)
      .set('Authorization', `Bearer ${financeOfficerToken}`)
      .expect(200);
    expect(financeResponse.body).toEqual(['finance.user']);

    const viewerResponse = await request(app)
      .get(`/api/evidence-hub/uploaders?home=${homeSlug}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(viewerResponse.body).toEqual(['staff.user']);
  });
});
