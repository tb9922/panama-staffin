/**
 * Integration tests for Onboarding module.
 *
 * Validates: upsertSection (deep merge), clearSection, findByHome,
 * cross-home isolation, section-level operations.
 *
 * Requires: PostgreSQL running with migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { pool } from '../../db.js';
import { app } from '../../server.js';
import * as onboardingRepo from '../../repositories/onboardingRepo.js';

let homeA, homeB;
let adminToken, trainingToken, hrToken, shiftToken;
const staffIds = [];
const ADMIN_USER = 'onb-test-admin';
const TRAINING_USER = 'onb-test-training';
const HR_USER = 'onb-test-hr';
const SHIFT_USER = 'onb-test-shift';
const PASSWORD = 'OnboardingTest!2026';

beforeAll(async () => {
  await pool.query(`DELETE FROM onboarding WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'onb-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM staff WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'onb-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM document_intake_items WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'onb-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM onboarding_file_attachments WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'onb-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM user_home_roles WHERE username IN ($1, $2, $3, $4)`, [ADMIN_USER, TRAINING_USER, HR_USER, SHIFT_USER]).catch(() => {});
  await pool.query(`DELETE FROM token_denylist WHERE username IN ($1, $2, $3, $4)`, [ADMIN_USER, TRAINING_USER, HR_USER, SHIFT_USER]).catch(() => {});
  await pool.query(`DELETE FROM users WHERE username IN ($1, $2, $3, $4)`, [ADMIN_USER, TRAINING_USER, HR_USER, SHIFT_USER]).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug LIKE 'onb-test-%'`);

  const { rows: [ha] } = await pool.query(
    `INSERT INTO homes (slug, name, config)
     VALUES ('onb-test-a', 'Onboarding Test Home A', '{"scan_intake_enabled":true,"scan_intake_targets":["onboarding","finance_ap"]}')
     RETURNING id`
  );
  const { rows: [hb] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('onb-test-b', 'Onboarding Test Home B') RETURNING id`
  );
  homeA = ha.id;
  homeB = hb.id;

  for (const s of [
    { id: 'ONB-S001', name: 'New Hire 1' },
    { id: 'ONB-S002', name: 'New Hire 2' },
  ]) {
    await pool.query(
      `INSERT INTO staff (id, home_id, name, role, team, pref, skill, hourly_rate, active, wtr_opt_out, start_date)
       VALUES ($1, $2, $3, 'Carer', 'Day A', 'E', 1, 13.00, true, false, '2026-01-01')`,
      [s.id, homeA, s.name]
    );
    staffIds.push(s.id);
  }

  const hash = await bcrypt.hash(PASSWORD, 4);
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $3, 'viewer', true, 'Onboarding Admin', 'test-setup'),
            ($2, $3, 'viewer', true, 'Onboarding Training', 'test-setup'),
            ($4, $3, 'viewer', true, 'Onboarding HR', 'test-setup'),
            ($5, $3, 'viewer', true, 'Onboarding Shift', 'test-setup')`,
    [ADMIN_USER, TRAINING_USER, hash, HR_USER, SHIFT_USER],
  );
  await pool.query(
    `INSERT INTO user_home_roles (username, home_id, role_id, granted_by)
     VALUES ($1, $3, 'home_manager', 'test-setup'),
            ($2, $3, 'training_lead', 'test-setup'),
            ($4, $3, 'hr_officer', 'test-setup'),
            ($5, $3, 'shift_coordinator', 'test-setup')`,
    [ADMIN_USER, TRAINING_USER, homeA, HR_USER, SHIFT_USER],
  );
  adminToken = (await request(app).post('/api/login').send({ username: ADMIN_USER, password: PASSWORD }).expect(200)).body.token;
  trainingToken = (await request(app).post('/api/login').send({ username: TRAINING_USER, password: PASSWORD }).expect(200)).body.token;
  hrToken = (await request(app).post('/api/login').send({ username: HR_USER, password: PASSWORD }).expect(200)).body.token;
  shiftToken = (await request(app).post('/api/login').send({ username: SHIFT_USER, password: PASSWORD }).expect(200)).body.token;
});

afterAll(async () => {
  await pool.query(`DELETE FROM onboarding WHERE home_id IN ($1, $2)`, [homeA, homeB]).catch(() => {});
  await pool.query(`DELETE FROM document_intake_items WHERE home_id IN ($1, $2)`, [homeA, homeB]).catch(() => {});
  await pool.query(`DELETE FROM onboarding_file_attachments WHERE home_id IN ($1, $2)`, [homeA, homeB]).catch(() => {});
  for (const sid of staffIds) {
    await pool.query('DELETE FROM staff WHERE id = $1', [sid]).catch(() => {});
  }
  await pool.query(`DELETE FROM user_home_roles WHERE username IN ($1, $2, $3, $4)`, [ADMIN_USER, TRAINING_USER, HR_USER, SHIFT_USER]).catch(() => {});
  await pool.query(`DELETE FROM token_denylist WHERE username IN ($1, $2, $3, $4)`, [ADMIN_USER, TRAINING_USER, HR_USER, SHIFT_USER]).catch(() => {});
  await pool.query(`DELETE FROM users WHERE username IN ($1, $2, $3, $4)`, [ADMIN_USER, TRAINING_USER, HR_USER, SHIFT_USER]).catch(() => {});
  if (homeA) await pool.query('DELETE FROM homes WHERE id = $1', [homeA]);
  if (homeB) await pool.query('DELETE FROM homes WHERE id = $1', [homeB]);
});

// ── Upsert Section ──────────────────────────────────────────────────────────

describe('Onboarding: upsert section', () => {
  it('creates DBS check section', async () => {
    const result = await onboardingRepo.upsertSection(homeA, 'ONB-S001', 'dbs_check', {
      status: 'completed',
      certificate_number: 'DBS-2026-001',
      date_issued: '2026-01-10',
      checked_by: 'HR Manager',
    });

    expect(result.dbs_check).toBeDefined();
    expect(result.dbs_check.status).toBe('completed');
    expect(result.dbs_check.certificate_number).toBe('DBS-2026-001');
  });

  it('deep-merges additional section without overwriting existing', async () => {
    const result = await onboardingRepo.upsertSection(homeA, 'ONB-S001', 'right_to_work', {
      status: 'completed',
      document_type: 'UK Passport',
      expiry_date: '2036-05-15',
    });

    // Both sections should exist
    expect(result.dbs_check).toBeDefined();
    expect(result.dbs_check.status).toBe('completed');
    expect(result.right_to_work).toBeDefined();
    expect(result.right_to_work.document_type).toBe('UK Passport');
  });

  it('updates existing section in-place', async () => {
    const result = await onboardingRepo.upsertSection(homeA, 'ONB-S001', 'dbs_check', {
      status: 'completed',
      certificate_number: 'DBS-2026-002',
      date_issued: '2026-02-01',
      checked_by: 'Updated Manager',
    });

    expect(result.dbs_check.certificate_number).toBe('DBS-2026-002');
    expect(result.dbs_check.checked_by).toBe('Updated Manager');
    // Other sections preserved
    expect(result.right_to_work).toBeDefined();
  });

  it('preserves first concurrent section writes for a new staff member', async () => {
    await Promise.all([
      onboardingRepo.upsertSection(homeA, 'ONB-S002', 'qualifications', { status: 'completed', notes: 'NVQ L2' }),
      onboardingRepo.upsertSection(homeA, 'ONB-S002', 'day1_induction', { status: 'completed', notes: 'Day one done' }),
    ]);

    const reloaded = await onboardingRepo.findByStaffId(homeA, 'ONB-S002');
    expect(reloaded.qualifications?.status).toBe('completed');
    expect(reloaded.day1_induction?.status).toBe('completed');
  });
});

describe('Onboarding: route RBAC and audit redaction', () => {
  it('redacts sensitive sections for non-HR compliance readers', async () => {
    await onboardingRepo.upsertSection(homeA, 'ONB-S001', 'dbs_check', { status: 'completed', reference: 'DBS-SECRET' });
    await onboardingRepo.upsertSection(homeA, 'ONB-S001', 'qualifications', { status: 'completed', reference: 'NVQ' });

    const res = await request(app)
      .get('/api/onboarding')
      .query({ home: 'onb-test-a' })
      .set('Authorization', `Bearer ${trainingToken}`)
      .expect(200);

    expect(res.body.onboarding['ONB-S001'].dbs_check).toBeUndefined();
    expect(res.body.onboarding['ONB-S001'].qualifications).toBeDefined();
  });

  it('blocks non-HR compliance writers from sensitive sections', async () => {
    await request(app)
      .put('/api/onboarding/ONB-S001/dbs_check')
      .query({ home: 'onb-test-a' })
      .set('Authorization', `Bearer ${trainingToken}`)
      .send({ status: 'completed', reference: 'DBS-SECRET' })
      .expect(403);
  });

  it('allows HR officers to manage sensitive onboarding evidence without compliance module access', async () => {
    const getRes = await request(app)
      .get('/api/onboarding')
      .query({ home: 'onb-test-a' })
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);

    expect(getRes.body.onboarding['ONB-S001'].dbs_check).toBeDefined();

    await request(app)
      .put('/api/onboarding/ONB-S001/dbs_check')
      .query({ home: 'onb-test-a' })
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ status: 'completed', reference: 'HR-DBS-OK' })
      .expect(200);
  });

  it('hides sensitive onboarding document counts from broad compliance readers', async () => {
    await pool.query(
      `INSERT INTO onboarding_file_attachments
         (home_id, staff_id, section, original_name, stored_name, mime_type, size_bytes, description, uploaded_by)
       VALUES
         ($1, 'ONB-S001', 'dbs_check', 'dbs.pdf', 'dbs.pdf', 'application/pdf', 10, NULL, 'test'),
         ($1, 'ONB-S001', 'qualifications', 'nvq.pdf', 'nvq.pdf', 'application/pdf', 10, NULL, 'test')`,
      [homeA],
    );

    const trainingRes = await request(app)
      .get('/api/docs/onboarding')
      .query({ home: 'onb-test-a' })
      .set('Authorization', `Bearer ${trainingToken}`)
      .expect(200);
    expect(trainingRes.body.summary.total_documents).toBe(1);

    const hrRes = await request(app)
      .get('/api/docs/onboarding')
      .query({ home: 'onb-test-a' })
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);
    expect(hrRes.body.summary.total_documents).toBeGreaterThanOrEqual(2);
  });

  it('scopes scan inbox reads by target permissions', async () => {
    const sha = 'a'.repeat(64);
    const { rows: [item] } = await pool.query(
      `INSERT INTO document_intake_items
         (home_id, status, source_file_sha256, stored_name, original_name, mime_type, size_bytes,
          classification_target, created_by)
       VALUES ($1, 'ready_for_review', $2, 'hr.pdf', 'hr.pdf', 'application/pdf', 10, 'hr_attachment', 'test')
       RETURNING id`,
      [homeA, sha],
    );

    await request(app)
      .get(`/api/scan-intake/${item.id}`)
      .query({ home: 'onb-test-a' })
      .set('Authorization', `Bearer ${trainingToken}`)
      .expect(403);

    await request(app)
      .post(`/api/scan-intake/${item.id}/confirm`)
      .query({ home: 'onb-test-a' })
      .set('Authorization', `Bearer ${trainingToken}`)
      .send({
        target: 'onboarding',
        onboarding: { staff_id: 'ONB-S001', section: 'qualifications' },
      })
      .expect(403);

    const listRes = await request(app)
      .get('/api/scan-intake')
      .query({ home: 'onb-test-a' })
      .set('Authorization', `Bearer ${trainingToken}`)
      .expect(200);
    expect(listRes.body.rows.some((row) => row.id === item.id)).toBe(false);
  });

  it('treats unreviewed onboarding scans as sensitive until routed', async () => {
    const sha = 'b'.repeat(64);
    const { rows: [item] } = await pool.query(
      `INSERT INTO document_intake_items
         (home_id, status, source_file_sha256, stored_name, original_name, mime_type, size_bytes,
          classification_target, created_by)
       VALUES ($1, 'ready_for_review', $2, 'onboarding.pdf', 'onboarding.pdf', 'application/pdf', 10, 'onboarding', 'test')
       RETURNING id`,
      [homeA, sha],
    );

    await request(app)
      .get(`/api/scan-intake/${item.id}`)
      .query({ home: 'onb-test-a' })
      .set('Authorization', `Bearer ${trainingToken}`)
      .expect(403);

    const listRes = await request(app)
      .get('/api/scan-intake')
      .query({ home: 'onb-test-a' })
      .set('Authorization', `Bearer ${trainingToken}`)
      .expect(200);
    expect(listRes.body.rows.some((row) => row.id === item.id)).toBe(false);

    await request(app)
      .get(`/api/scan-intake/${item.id}`)
      .query({ home: 'onb-test-a' })
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);
  });

  it('lets uploaders keep seeing their own unclassified scan items', async () => {
    const sha = 'c'.repeat(64);
    const { rows: [item] } = await pool.query(
      `INSERT INTO document_intake_items
         (home_id, status, source_file_sha256, stored_name, original_name, mime_type, size_bytes,
          classification_target, created_by)
       VALUES ($1, 'ready_for_review', $2, 'unclassified.pdf', 'unclassified.pdf', 'application/pdf', 10, NULL, $3)
       RETURNING id`,
      [homeA, sha, HR_USER],
    );

    await request(app)
      .get(`/api/scan-intake/${item.id}`)
      .query({ home: 'onb-test-a' })
      .set('Authorization', `Bearer ${trainingToken}`)
      .expect(403);

    const listRes = await request(app)
      .get('/api/scan-intake')
      .query({ home: 'onb-test-a' })
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);
    expect(listRes.body.rows.some((row) => row.id === item.id)).toBe(true);

    await request(app)
      .get(`/api/scan-intake/${item.id}`)
      .query({ home: 'onb-test-a' })
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);
  });

  it('lists own unclassified scans even when no configured targets are readable', async () => {
    const sha = 'd'.repeat(64);
    const { rows: [item] } = await pool.query(
      `INSERT INTO document_intake_items
         (home_id, status, source_file_sha256, stored_name, original_name, mime_type, size_bytes,
          classification_target, created_by)
       VALUES ($1, 'ready_for_review', $2, 'shift-unclassified.pdf', 'shift-unclassified.pdf', 'application/pdf', 10, NULL, $3)
       RETURNING id`,
      [homeA, sha, SHIFT_USER],
    );

    const listRes = await request(app)
      .get('/api/scan-intake')
      .query({ home: 'onb-test-a' })
      .set('Authorization', `Bearer ${shiftToken}`)
      .expect(200);
    expect(listRes.body.rows.some((row) => row.id === item.id)).toBe(true);

    await request(app)
      .get(`/api/scan-intake/${item.id}`)
      .query({ home: 'onb-test-a' })
      .set('Authorization', `Bearer ${shiftToken}`)
      .expect(200);
  });

  it('strips unknown onboarding keys before storing or auditing', async () => {
    await request(app)
      .put('/api/onboarding/ONB-S001/day1_induction')
      .query({ home: 'onb-test-a' })
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'completed', notes: 'Done', passport_number: 'SECRET-PASSPORT' })
      .expect(200);

    const stored = await onboardingRepo.findByStaffId(homeA, 'ONB-S001');
    expect(stored.day1_induction.passport_number).toBeUndefined();
    const { rows } = await pool.query(
      `SELECT details FROM audit_log
        WHERE action = 'onboarding_update'
        ORDER BY id DESC
        LIMIT 1`,
    );
    expect(JSON.stringify(rows[0].details)).not.toContain('SECRET-PASSPORT');
  });

  it('preserves known section-specific fields while stripping unknown keys', async () => {
    await request(app)
      .put('/api/onboarding/ONB-S001/dbs_check')
      .query({ home: 'onb-test-a' })
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        status: 'completed',
        dbs_number: 'DBS-12345',
        barred_list_checked: true,
        passport_number: 'SECRET-PASSPORT',
      })
      .expect(200);

    const stored = await onboardingRepo.findByStaffId(homeA, 'ONB-S001');
    expect(stored.dbs_check.dbs_number).toBe('DBS-12345');
    expect(stored.dbs_check.barred_list_checked).toBe(true);
    expect(stored.dbs_check.passport_number).toBeUndefined();

    await request(app)
      .put('/api/onboarding/ONB-S001/day1_induction')
      .query({ home: 'onb-test-a' })
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        status: 'completed',
        fire_safety_orientation: true,
        emergency_procedures: true,
        safeguarding_briefing: false,
      })
      .expect(200);

    await request(app)
      .put('/api/onboarding/ONB-S001/policy_acknowledgement')
      .query({ home: 'onb-test-a' })
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        status: 'completed',
        safeguarding_policy: true,
        data_protection_policy: true,
      })
      .expect(200);

    await request(app)
      .put('/api/onboarding/ONB-S001/contract')
      .query({ home: 'onb-test-a' })
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        status: 'completed',
        signed_copy_received: '2026-02-02',
      })
      .expect(200);

    await request(app)
      .put('/api/onboarding/ONB-S001/employment_history')
      .query({ home: 'onb-test-a' })
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        status: 'completed',
        gap_explanations: {
          '2025-01-01:2025-02-15': 'Career break evidence reviewed',
        },
      })
      .expect(200);

    const reloaded = await onboardingRepo.findByStaffId(homeA, 'ONB-S001');
    expect(reloaded.day1_induction.fire_safety_orientation).toBe(true);
    expect(reloaded.day1_induction.emergency_procedures).toBe(true);
    expect(reloaded.policy_acknowledgement.safeguarding_policy).toBe(true);
    expect(reloaded.policy_acknowledgement.data_protection_policy).toBe(true);
    expect(reloaded.contract.signed_copy_received).toBe('2026-02-02');
    expect(reloaded.employment_history.gap_explanations['2025-01-01:2025-02-15']).toBe('Career break evidence reviewed');
  });
});

// ── Find By Home ────────────────────────────────────────────────────────────

describe('Onboarding: findByHome', () => {
  it('returns keyed by staffId', async () => {
    const result = await onboardingRepo.findByHome(homeA);
    expect(result['ONB-S001']).toBeDefined();
    expect(result['ONB-S001'].dbs_check).toBeDefined();
  });

  it('returns empty for other home', async () => {
    const result = await onboardingRepo.findByHome(homeB);
    expect(Object.keys(result)).toHaveLength(0);
  });
});

// ── Clear Section ───────────────────────────────────────────────────────────

describe('Onboarding: clear section', () => {
  beforeAll(async () => {
    // Set up ONB-S002 with two sections
    await onboardingRepo.upsertSection(homeA, 'ONB-S002', 'references', {
      status: 'pending',
      ref1: { name: 'Previous Employer', received: false },
    });
    await onboardingRepo.upsertSection(homeA, 'ONB-S002', 'identity', {
      status: 'completed',
      photo_id_checked: true,
    });
  });

  it('clears a single section without affecting others', async () => {
    const result = await onboardingRepo.clearSection(homeA, 'ONB-S002', 'references');
    expect(result.references).toBeUndefined();
    expect(result.identity).toBeDefined();
    expect(result.identity.photo_id_checked).toBe(true);
  });

  it('returns null for non-existent staff', async () => {
    const result = await onboardingRepo.clearSection(homeA, 'ONB-NONEXISTENT', 'dbs_check');
    expect(result).toBeNull();
  });
});
