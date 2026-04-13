import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { app } from '../../server.js';
import { pool } from '../../db.js';
import * as cqcEvidenceFileRepo from '../../repositories/cqcEvidenceFileRepo.js';
import * as hrAttachmentsRepo from '../../repositories/hr/attachments.js';
import * as disciplinaryRepo from '../../repositories/hr/disciplinary.js';

const PREFIX = 'download-safety-test';
const HOME_SLUG = `${PREFIX}-home`;
const USERNAME = `${PREFIX}-manager`;
const PASSWORD = 'DownloadSafety1!';
const STAFF_ID = 'DST-001';

let homeId;
let token;
let hrAttachmentId;
let cqcEvidenceFileId;

beforeAll(async () => {
  await pool.query(`DELETE FROM hr_file_attachments WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM cqc_evidence_files WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM hr_disciplinary_cases WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM cqc_evidence WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM staff WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM user_home_roles WHERE username = $1`, [USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM token_denylist WHERE username = $1`, [USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM users WHERE username = $1`, [USERNAME]).catch(() => {});
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
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'viewer', true, 'Download Safety Manager', 'test-setup')`,
    [USERNAME, passwordHash]
  );
  await pool.query(
    `INSERT INTO user_home_roles (username, home_id, role_id, granted_by)
     VALUES ($1, $2, 'home_manager', 'test-setup')`,
    [USERNAME, homeId]
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

  const evidenceId = `cqc-${randomUUID()}`;
  await pool.query(
    `INSERT INTO cqc_evidence
       (id, home_id, quality_statement, type, title, description, added_by, added_at, created_at, version)
     VALUES ($1, $2, 'S1', 'qualitative', 'Download safety evidence', NULL, $3, NOW(), NOW(), 1)`,
    [evidenceId, homeId, USERNAME]
  );
  const cqcFile = await cqcEvidenceFileRepo.create(homeId, evidenceId, {
    original_name: 'cqc-missing-file.jpg',
    stored_name: 'cqc-missing-file.jpg',
    mime_type: 'image/jpeg',
    size_bytes: 2048,
    description: 'Missing physical file',
    uploaded_by: USERNAME,
  });
  cqcEvidenceFileId = cqcFile.id;

  const loginRes = await request(app)
    .post('/api/login')
    .send({ username: USERNAME, password: PASSWORD })
    .expect(200);
  token = loginRes.body.token;
}, 20000);

afterAll(async () => {
  await pool.query(`DELETE FROM hr_file_attachments WHERE home_id = $1`, [homeId]).catch(() => {});
  await pool.query(`DELETE FROM cqc_evidence_files WHERE home_id = $1`, [homeId]).catch(() => {});
  await pool.query(`DELETE FROM hr_disciplinary_cases WHERE home_id = $1`, [homeId]).catch(() => {});
  await pool.query(`DELETE FROM cqc_evidence WHERE home_id = $1`, [homeId]).catch(() => {});
  await pool.query(`DELETE FROM staff WHERE home_id = $1`, [homeId]).catch(() => {});
  await pool.query(`DELETE FROM user_home_roles WHERE username = $1`, [USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM token_denylist WHERE username = $1`, [USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM users WHERE username = $1`, [USERNAME]).catch(() => {});
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
  });
});
