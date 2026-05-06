import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import request from 'supertest';
import { app } from '../../server.js';
import { pool } from '../../db.js';
import { config } from '../../config.js';
import * as cqcEvidenceFileRepo from '../../repositories/cqcEvidenceFileRepo.js';
import * as hrAttachmentsRepo from '../../repositories/hr/attachments.js';
import * as disciplinaryRepo from '../../repositories/hr/disciplinary.js';
import * as onboardingAttachmentsRepo from '../../repositories/onboardingAttachments.js';
import * as recordAttachmentsRepo from '../../repositories/recordAttachments.js';
import * as trainingAttachmentsRepo from '../../repositories/trainingAttachments.js';

const PREFIX = 'download-safety-test';
const HOME_SLUG = `${PREFIX}-home`;
const USERNAME = `${PREFIX}-manager`;
const TRAINING_USERNAME = `${PREFIX}-training`;
const PASSWORD = 'DownloadSafety1!';
const TRAINING_PASSWORD = 'DownloadSafetyTraining1!';
const STAFF_ID = 'DST-001';
const MCA_ID = 'DST-MCA-001';

let homeId;
let token;
let trainingToken;
let hrAttachmentId;
let cqcEvidenceId;
let cqcEvidenceFileId;
let cqcStoredFilePath;
let recordAttachmentId;
let recordStoredFilePath;

beforeAll(async () => {
    await pool.query(`DELETE FROM hr_file_attachments WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
    await pool.query(`DELETE FROM cqc_evidence_files WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
    await pool.query(`DELETE FROM record_file_attachments WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
    await pool.query(`DELETE FROM onboarding_file_attachments WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
    await pool.query(`DELETE FROM training_file_attachments WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM audit_log WHERE home_slug = $1`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM hr_disciplinary_cases WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM mca_assessments WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM cqc_evidence WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM staff WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM user_home_roles WHERE username IN ($1, $2)`, [USERNAME, TRAINING_USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM token_denylist WHERE username IN ($1, $2)`, [USERNAME, TRAINING_USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM users WHERE username IN ($1, $2)`, [USERNAME, TRAINING_USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug = $1`, [HOME_SLUG]).catch(() => {});

  const { rows: [home] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ($1, 'Download Safety Home', '{}'::jsonb) RETURNING id`,
    [HOME_SLUG]
  );
  homeId = home.id;

  await pool.query(
    `INSERT INTO staff (id, home_id, name, role, team, pref, skill, hourly_rate, active, wtr_opt_out, start_date)
     VALUES ($1, $2, 'Download Safety Staff', 'Carer', 'Day A', 'E', 1, 13.50, true, false, '2026-01-01')`,
    [STAFF_ID, homeId]
  );

  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const trainingPasswordHash = await bcrypt.hash(TRAINING_PASSWORD, 4);
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'viewer', true, 'Download Safety Manager', 'test-setup')`,
    [USERNAME, passwordHash]
  );
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'viewer', true, 'Download Safety Training Lead', 'test-setup')`,
    [TRAINING_USERNAME, trainingPasswordHash]
  );
  await pool.query(
    `INSERT INTO user_home_roles (username, home_id, role_id, granted_by)
     VALUES ($1, $2, 'home_manager', 'test-setup')`,
    [USERNAME, homeId]
  );
  await pool.query(
    `INSERT INTO user_home_roles (username, home_id, role_id, granted_by)
     VALUES ($1, $2, 'training_lead', 'test-setup')`,
    [TRAINING_USERNAME, homeId]
  );

  const disciplinary = await disciplinaryRepo.createDisciplinary(homeId, {
    staff_id: STAFF_ID,
    date_raised: '2026-04-01',
    raised_by: 'Manager',
    category: 'misconduct',
    allegation_summary: 'Download safety case',
    created_by: USERNAME,
  });
  const hrAttachment = await hrAttachmentsRepo.createAttachment(homeId, 'disciplinary', disciplinary.id, {
    original_name: 'hr-missing-file.pdf',
    stored_name: 'hr-missing-file.pdf',
    mime_type: 'application/pdf',
    size_bytes: 1200,
    description: 'Missing physical file',
    uploaded_by: USERNAME,
  });
  hrAttachmentId = hrAttachment.id;

  cqcEvidenceId = `cqc-${randomUUID()}`;
  await pool.query(
    `INSERT INTO cqc_evidence
       (id, home_id, quality_statement, type, title, description, added_by, added_at, created_at, version)
     VALUES ($1, $2, 'S1', 'qualitative', 'Download safety evidence', NULL, $3, NOW(), NOW(), 1)`,
    [cqcEvidenceId, homeId, USERNAME]
  );
  const cqcFile = await cqcEvidenceFileRepo.create(homeId, cqcEvidenceId, {
    original_name: 'cqc-missing-file.jpg',
    stored_name: 'cqc-missing-file.jpg',
    mime_type: 'image/jpeg',
    size_bytes: 2048,
    description: 'Missing physical file',
    uploaded_by: USERNAME,
  });
  cqcEvidenceFileId = cqcFile.id;
  cqcStoredFilePath = path.join(
    config.upload.dir,
    String(homeId),
    'cqc_evidence',
    cqcEvidenceId,
    'cqc-missing-file.jpg'
  );
  await pool.query(
    `INSERT INTO mca_assessments
       (id, home_id, resident_name, assessment_date, assessor, decision_area, lacks_capacity, best_interest_decision, next_review_date, notes, created_at, updated_at, version)
     VALUES ($1, $2, 'Sensitive Resident', '2026-04-01', 'Manager', 'Care decision', true, 'Sensitive best-interest detail', '2026-07-01', 'Sensitive MCA note', NOW(), NOW(), 1)`,
    [MCA_ID, homeId]
  );
  const recordAttachment = await recordAttachmentsRepo.create(homeId, 'mca_assessment', MCA_ID, {
    original_name: 'mca-sensitive.pdf',
    stored_name: 'mca-sensitive.pdf',
    mime_type: 'application/pdf',
    size_bytes: 4096,
    description: 'Sensitive MCA attachment',
    uploaded_by: USERNAME,
  });
  recordAttachmentId = recordAttachment.id;
  recordStoredFilePath = path.join(
    config.upload.dir,
    String(homeId),
    'mca_assessment',
    MCA_ID,
    'mca-sensitive.pdf'
  );

  await onboardingAttachmentsRepo.create(homeId, STAFF_ID, 'dbs_check', {
    original_name: 'onboarding.pdf',
    stored_name: 'onboarding.pdf',
    mime_type: 'application/pdf',
    size_bytes: 1024,
    uploaded_by: USERNAME,
  });
  await trainingAttachmentsRepo.create(homeId, STAFF_ID, 'safeguarding', {
    original_name: 'training.pdf',
    stored_name: 'training.pdf',
    mime_type: 'application/pdf',
    size_bytes: 1024,
    uploaded_by: USERNAME,
  });

  const loginRes = await request(app)
    .post('/api/login')
    .send({ username: USERNAME, password: PASSWORD })
    .expect(200);
  token = loginRes.body.token;
  const trainingLoginRes = await request(app)
    .post('/api/login')
    .send({ username: TRAINING_USERNAME, password: TRAINING_PASSWORD })
    .expect(200);
  trainingToken = trainingLoginRes.body.token;
}, 20000);

afterAll(async () => {
  if (cqcStoredFilePath) await fs.unlink(cqcStoredFilePath).catch(() => {});
  if (recordStoredFilePath) await fs.unlink(recordStoredFilePath).catch(() => {});
  await pool.query(`DELETE FROM hr_file_attachments WHERE home_id = $1`, [homeId]).catch(() => {});
  await pool.query(`DELETE FROM cqc_evidence_files WHERE home_id = $1`, [homeId]).catch(() => {});
  await pool.query(`DELETE FROM record_file_attachments WHERE home_id = $1`, [homeId]).catch(() => {});
  await pool.query(`DELETE FROM onboarding_file_attachments WHERE home_id = $1`, [homeId]).catch(() => {});
  await pool.query(`DELETE FROM training_file_attachments WHERE home_id = $1`, [homeId]).catch(() => {});
  await pool.query(`DELETE FROM audit_log WHERE home_slug = $1`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM hr_disciplinary_cases WHERE home_id = $1`, [homeId]).catch(() => {});
  await pool.query(`DELETE FROM mca_assessments WHERE home_id = $1`, [homeId]).catch(() => {});
  await pool.query(`DELETE FROM cqc_evidence WHERE home_id = $1`, [homeId]).catch(() => {});
  await pool.query(`DELETE FROM staff WHERE home_id = $1`, [homeId]).catch(() => {});
  await pool.query(`DELETE FROM user_home_roles WHERE username IN ($1, $2)`, [USERNAME, TRAINING_USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM token_denylist WHERE username IN ($1, $2)`, [USERNAME, TRAINING_USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM users WHERE username IN ($1, $2)`, [USERNAME, TRAINING_USERNAME]).catch(() => {});
  if (homeId) await pool.query(`DELETE FROM homes WHERE id = $1`, [homeId]).catch(() => {});
});

describe('attachment download safety', () => {
  it('returns 404 instead of hanging when the stored file is missing', async () => {
    const paths = [
      `/api/hr/attachments/download/${hrAttachmentId}?home=${HOME_SLUG}`,
      `/api/cqc-evidence/files/${cqcEvidenceFileId}/download?home=${HOME_SLUG}`,
    ];

    for (const path of paths) {
      const response = await request(app)
        .get(path)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
      expect(response.body.error).toMatch(/missing/i);
    }

    const { rows } = await pool.query(
      `SELECT details FROM audit_log
        WHERE home_slug = $1
          AND action IN ('hr_attachment_download', 'cqc_evidence_file_download')`,
      [HOME_SLUG]
    );
    const matchingHrRows = rows.filter((row) => {
      const details = typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
      return details.id === hrAttachmentId;
    });
    const matchingCqcRows = rows.filter((row) => {
      const details = typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
      return details.fileId === cqcEvidenceFileId;
    });
    expect(matchingHrRows).toHaveLength(0);
    expect(matchingCqcRows).toHaveLength(0);
  });

  it('audits successful CQC evidence file downloads after confirming the file exists', async () => {
    await fs.mkdir(path.dirname(cqcStoredFilePath), { recursive: true });
    await fs.writeFile(cqcStoredFilePath, 'download-safety-cqc-file');

    await request(app)
      .get(`/api/cqc-evidence/files/${cqcEvidenceFileId}/download?home=${HOME_SLUG}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const { rows } = await pool.query(
      `SELECT details FROM audit_log
        WHERE home_slug = $1
          AND action = 'cqc_evidence_file_download'`,
      [HOME_SLUG]
    );
    const matchingRows = rows.filter((row) => {
      const details = typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
      return details.fileId === cqcEvidenceFileId && details.evidenceId === cqcEvidenceId;
    });
    expect(matchingRows).toHaveLength(1);
  });

  it('restricts and audits sensitive generic record attachment downloads', async () => {
    await fs.mkdir(path.dirname(recordStoredFilePath), { recursive: true });
    await fs.writeFile(recordStoredFilePath, 'download-safety-mca-file');

    await request(app)
      .get(`/api/record-attachments/download/${recordAttachmentId}?home=${HOME_SLUG}`)
      .set('Authorization', `Bearer ${trainingToken}`)
      .expect(403);

    await request(app)
      .get(`/api/record-attachments/download/${recordAttachmentId}?home=${HOME_SLUG}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const { rows } = await pool.query(
      `SELECT details FROM audit_log
        WHERE home_slug = $1
          AND action = 'record_attachment_download'`,
      [HOME_SLUG]
    );
    const matchingRows = rows.filter((row) => {
      const details = typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
      return details.fileId === recordAttachmentId
        && details.module === 'mca_assessment'
        && details.recordId === MCA_ID;
    });
    expect(matchingRows).toHaveLength(1);
  });

  it('retains regulated staff evidence but hides deleted parent record attachments', async () => {
    await pool.query(`UPDATE staff SET deleted_at = NOW() WHERE home_id = $1 AND id = $2`, [homeId, STAFF_ID]);
    await pool.query(`UPDATE hr_disciplinary_cases SET deleted_at = NOW() WHERE home_id = $1`, [homeId]);
    await pool.query(`UPDATE cqc_evidence SET deleted_at = NOW() WHERE home_id = $1`, [homeId]);

    const onboardingRes = await request(app)
      .get(`/api/onboarding/${STAFF_ID}/dbs_check/files?home=${HOME_SLUG}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(onboardingRes.body).toHaveLength(1);
    expect(onboardingRes.body[0].original_name).toBe('onboarding.pdf');

    const trainingRes = await request(app)
      .get(`/api/training/${STAFF_ID}/safeguarding/files?home=${HOME_SLUG}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(trainingRes.body).toHaveLength(1);
    expect(trainingRes.body[0].original_name).toBe('training.pdf');

    await request(app)
      .delete(`/api/hr/attachments/${hrAttachmentId}?home=${HOME_SLUG}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    await request(app)
      .delete(`/api/cqc-evidence/files/${cqcEvidenceFileId}?home=${HOME_SLUG}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
