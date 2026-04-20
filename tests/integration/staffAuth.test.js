/**
 * Integration tests for staff authentication.
 *
 * Covers: invite create / consume / expire, login (route-level), lockout after 5
 * failures, session_version invalidation on password change + revoke, username
 * collision with admin/manager users, ON DELETE CASCADE from staff.
 *
 * Requires: PostgreSQL running with migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { pool } from '../../db.js';
import { app } from '../../server.js';
import * as staffAuthService from '../../services/staffAuthService.js';
import * as staffAuthRepo from '../../repositories/staffAuthRepo.js';

const HOME_SLUG = 'staffauth-test-home';
const STAFF_ID = 'SAUTH-001';
const STAFF_NAME = 'Alice Carer';
const PORTAL_USERNAME = 'staffauth-alice';
const PORTAL_PASSWORD = 'P0rtalP4ss!23';

let homeId;

beforeAll(async () => {
  await pool.query(`DELETE FROM staff_invite_tokens WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]);
  await pool.query(`DELETE FROM staff_auth_credentials WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]);
  await pool.query(`DELETE FROM staff WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]);
  await pool.query(`DELETE FROM homes WHERE slug = $1`, [HOME_SLUG]);
  await pool.query(`DELETE FROM users WHERE username = $1`, [PORTAL_USERNAME]);

  const { rows: [home] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ($1, $2, $3) RETURNING id`,
    [HOME_SLUG, 'Staff Auth Test Home', { cycle_start_date: '2025-01-06' }],
  );
  homeId = home.id;

  await pool.query(
    `INSERT INTO staff (home_id, id, name, role, team, skill, hourly_rate, active, wtr_opt_out, start_date, contract_hours)
     VALUES ($1, $2, $3, 'Carer', 'Day A', 1, 13.00, true, false, '2025-01-01', 37.5)`,
    [homeId, STAFF_ID, STAFF_NAME],
  );
});

afterAll(async () => {
  await pool.query(`DELETE FROM staff_invite_tokens WHERE home_id = $1`, [homeId]);
  await pool.query(`DELETE FROM staff_auth_credentials WHERE home_id = $1`, [homeId]);
  await pool.query(`DELETE FROM staff WHERE home_id = $1`, [homeId]);
  await pool.query(`DELETE FROM homes WHERE id = $1`, [homeId]);
  await pool.query(`DELETE FROM users WHERE username = $1`, [PORTAL_USERNAME]);
});

beforeEach(async () => {
  // Reset credentials + invites between tests so each test sees a clean slate.
  await pool.query(`DELETE FROM staff_invite_tokens WHERE home_id = $1`, [homeId]);
  await pool.query(`DELETE FROM staff_auth_credentials WHERE home_id = $1`, [homeId]);
  await pool.query(`DELETE FROM users WHERE username = $1`, [PORTAL_USERNAME]);
  await pool.query(`UPDATE staff SET active = true, deleted_at = NULL WHERE home_id = $1`, [homeId]);
});

describe('staff invite — create', () => {
  it('creates a 64-char hex token with future expiry', async () => {
    const invite = await staffAuthService.createInvite({
      homeId,
      staffId: STAFF_ID,
      createdBy: 'admin',
    });
    expect(invite.token).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(invite.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(invite.inviteUrl).toContain(invite.token);
  });

  it('rejects inviting inactive staff', async () => {
    await pool.query(`UPDATE staff SET active = false WHERE home_id = $1 AND id = $2`, [homeId, STAFF_ID]);
    await expect(staffAuthService.createInvite({
      homeId, staffId: STAFF_ID, createdBy: 'admin',
    })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects when staff already has credentials', async () => {
    const a = await staffAuthService.createInvite({ homeId, staffId: STAFF_ID, createdBy: 'admin' });
    await staffAuthService.consumeInvite({ token: a.token, username: PORTAL_USERNAME, password: PORTAL_PASSWORD });
    await expect(staffAuthService.createInvite({
      homeId, staffId: STAFF_ID, createdBy: 'admin',
    })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('revokes earlier open invites when a new one is issued', async () => {
    const first = await staffAuthService.createInvite({ homeId, staffId: STAFF_ID, createdBy: 'admin' });
    await staffAuthService.createInvite({ homeId, staffId: STAFF_ID, createdBy: 'admin' });
    // First token should now be effectively unusable (consumed_at set by revokeOpenInvites).
    await expect(staffAuthService.consumeInvite({
      token: first.token, username: PORTAL_USERNAME, password: PORTAL_PASSWORD,
    })).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('staff invite — consume', () => {
  it('creates credentials from a valid invite', async () => {
    const invite = await staffAuthService.createInvite({ homeId, staffId: STAFF_ID, createdBy: 'admin' });
    const result = await staffAuthService.consumeInvite({
      token: invite.token, username: PORTAL_USERNAME, password: PORTAL_PASSWORD,
    });
    expect(result.username).toBe(PORTAL_USERNAME);
    expect(result.role).toBe('staff_member');

    const creds = await staffAuthRepo.findByStaff(homeId, STAFF_ID);
    expect(creds).toBeTruthy();
    expect(creds.username).toBe(PORTAL_USERNAME);
  });

  it('rejects an already-used invite', async () => {
    const invite = await staffAuthService.createInvite({ homeId, staffId: STAFF_ID, createdBy: 'admin' });
    await staffAuthService.consumeInvite({ token: invite.token, username: PORTAL_USERNAME, password: PORTAL_PASSWORD });
    await expect(staffAuthService.consumeInvite({
      token: invite.token, username: PORTAL_USERNAME + '2', password: PORTAL_PASSWORD,
    })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rejects an expired invite', async () => {
    const invite = await staffAuthService.createInvite({ homeId, staffId: STAFF_ID, createdBy: 'admin' });
    await pool.query(
      `UPDATE staff_invite_tokens SET expires_at = NOW() - INTERVAL '1 day' WHERE token = $1`,
      [invite.token],
    );
    await expect(staffAuthService.consumeInvite({
      token: invite.token, username: PORTAL_USERNAME, password: PORTAL_PASSWORD,
    })).rejects.toMatchObject({ statusCode: 410 });
  });

  it('rejects username collision with existing user', async () => {
    await pool.query(
      `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
       VALUES ($1, $2, 'viewer', true, 'Other', 'test-setup')`,
      [PORTAL_USERNAME, await bcrypt.hash('irrelevant1234', 4)],
    );
    const invite = await staffAuthService.createInvite({ homeId, staffId: STAFF_ID, createdBy: 'admin' });
    await expect(staffAuthService.consumeInvite({
      token: invite.token, username: PORTAL_USERNAME, password: PORTAL_PASSWORD,
    })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rejects weak password', async () => {
    const invite = await staffAuthService.createInvite({ homeId, staffId: STAFF_ID, createdBy: 'admin' });
    await expect(staffAuthService.consumeInvite({
      token: invite.token, username: PORTAL_USERNAME, password: 'short',
    })).rejects.toThrow();
  });
});

describe('staff login (POST /api/login)', () => {
  beforeEach(async () => {
    const invite = await staffAuthService.createInvite({ homeId, staffId: STAFF_ID, createdBy: 'admin' });
    await staffAuthService.consumeInvite({
      token: invite.token, username: PORTAL_USERNAME, password: PORTAL_PASSWORD,
    });
  });

  it('returns 200 + sets cookie on valid credentials', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ username: PORTAL_USERNAME, password: PORTAL_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.username).toBe(PORTAL_USERNAME);
    expect(res.body.role).toBe('staff_member');
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('rejects wrong password with 401', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ username: PORTAL_USERNAME, password: 'wrong-password' });
    expect(res.status).toBe(401);
  });

  it('locks account after 5 failed attempts', async () => {
    for (let i = 0; i < 5; i += 1) {
      await request(app)
        .post('/api/login')
        .send({ username: PORTAL_USERNAME, password: 'wrong-password' });
    }
    // 6th attempt — even with correct password — should be locked.
    const res = await request(app)
      .post('/api/login')
      .send({ username: PORTAL_USERNAME, password: PORTAL_PASSWORD });
    expect([401, 423, 429]).toContain(res.status);
    const creds = await staffAuthRepo.findByStaff(homeId, STAFF_ID);
    expect(creds.failedLoginCount).toBeGreaterThanOrEqual(5);
    expect(creds.lockedUntil).not.toBeNull();
  });

  it('still locks the account when wrong-password attempts arrive in parallel', async () => {
    await Promise.all(
      Array.from({ length: 6 }, () =>
        request(app)
          .post('/api/login')
          .send({ username: PORTAL_USERNAME, password: 'wrong-password' })
      ),
    );

    const locked = await request(app)
      .post('/api/login')
      .send({ username: PORTAL_USERNAME, password: PORTAL_PASSWORD });

    expect([401, 423, 429]).toContain(locked.status);
    const creds = await staffAuthRepo.findByStaff(homeId, STAFF_ID);
    expect(creds.failedLoginCount).toBeGreaterThanOrEqual(5);
    expect(creds.lockedUntil).not.toBeNull();
  });

  it('resets failed count on successful login', async () => {
    for (let i = 0; i < 3; i += 1) {
      await request(app)
        .post('/api/login')
        .send({ username: PORTAL_USERNAME, password: 'wrong-password' });
    }
    await request(app)
      .post('/api/login')
      .send({ username: PORTAL_USERNAME, password: PORTAL_PASSWORD });
    const creds = await staffAuthRepo.findByStaff(homeId, STAFF_ID);
    expect(creds.failedLoginCount).toBe(0);
    expect(creds.lockedUntil).toBeNull();
  });

  it('login attempt for unknown username takes >= 50ms (timing-safe)', async () => {
    const started = Date.now();
    await request(app)
      .post('/api/login')
      .send({ username: 'unknown-staff-user-xyz', password: 'anything123' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
  });
});

describe('change password and revoke', () => {
  beforeEach(async () => {
    const invite = await staffAuthService.createInvite({ homeId, staffId: STAFF_ID, createdBy: 'admin' });
    await staffAuthService.consumeInvite({
      token: invite.token, username: PORTAL_USERNAME, password: PORTAL_PASSWORD,
    });
  });

  it('changePassword requires correct current password', async () => {
    await expect(staffAuthService.changePassword({
      homeId, staffId: STAFF_ID,
      currentPassword: 'wrong',
      newPassword: 'AnotherP4ss!56',
      actorUsername: PORTAL_USERNAME,
    })).rejects.toMatchObject({ statusCode: 403 });
  });

  it('changePassword bumps session_version', async () => {
    const before = await staffAuthRepo.findByStaff(homeId, STAFF_ID);
    await staffAuthService.changePassword({
      homeId, staffId: STAFF_ID,
      currentPassword: PORTAL_PASSWORD,
      newPassword: 'AnotherP4ss!56',
      actorUsername: PORTAL_USERNAME,
    });
    const after = await staffAuthRepo.findByStaff(homeId, STAFF_ID);
    expect(after.sessionVersion).toBe(before.sessionVersion + 1);
  });

  it('revokeStaffSessions bumps session_version', async () => {
    const before = await staffAuthRepo.findByStaff(homeId, STAFF_ID);
    await staffAuthService.revokeStaffSessions({
      homeId, staffId: STAFF_ID, actor: 'admin',
    });
    const after = await staffAuthRepo.findByStaff(homeId, STAFF_ID);
    expect(after.sessionVersion).toBe(before.sessionVersion + 1);
  });

  it('credentials are removed when staff is hard-deleted (CASCADE)', async () => {
    const exists = await staffAuthRepo.findByStaff(homeId, STAFF_ID);
    expect(exists).toBeTruthy();
    await pool.query(`DELETE FROM staff WHERE home_id = $1 AND id = $2`, [homeId, STAFF_ID]);
    const gone = await staffAuthRepo.findByStaff(homeId, STAFF_ID);
    expect(gone).toBeNull();
    // Re-seed for afterAll cleanup parity
    await pool.query(
      `INSERT INTO staff (home_id, id, name, role, team, skill, hourly_rate, active, wtr_opt_out, start_date, contract_hours)
       VALUES ($1, $2, $3, 'Carer', 'Day A', 1, 13.00, true, false, '2025-01-01', 37.5)`,
      [homeId, STAFF_ID, STAFF_NAME],
    );
  });
});
