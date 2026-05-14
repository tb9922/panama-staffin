import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { app } from '../../server.js';
import { pool } from '../../db.js';
import { clearPortfolioCache } from '../../services/portfolioService.js';

const PREFIX = 'platform-admin-consistency';
const HOME_A = `${PREFIX}-home-a`;
const HOME_B = `${PREFIX}-home-b`;
const FLAGGED_USER = `${PREFIX}-flagged-viewer`;
const ADMIN_USER = `${PREFIX}-admin`;
const TARGET_USER = `${PREFIX}-target`;
const STAFF_B = 'PAC-STF-B';
const PASSWORD = 'PlatformAdmin1Test';

let homeAId;
let homeBId;
let targetUserId;
let flaggedToken;
let adminToken;

async function cleanup() {
  clearPortfolioCache();
  await pool.query(
    `DELETE FROM staff
      WHERE id = $1
         OR home_id IN (SELECT id FROM homes WHERE slug LIKE $2)`,
    [STAFF_B, `${PREFIX}-%`],
  ).catch(() => {});
  await pool.query(`DELETE FROM user_home_roles WHERE username LIKE $1`, [`${PREFIX}-%`]).catch(() => {});
  await pool.query(`DELETE FROM token_denylist WHERE username LIKE $1`, [`${PREFIX}-%`]).catch(() => {});
  await pool.query(`DELETE FROM users WHERE username LIKE $1`, [`${PREFIX}-%`]).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug LIKE $1`, [`${PREFIX}-%`]).catch(() => {});
}

beforeAll(async () => {
  await cleanup();

  const baseConfig = JSON.stringify({
    cycle_start_date: '2026-05-04',
    minimum_staffing: {
      early: { heads: 1, skill_points: 0 },
      late: { heads: 1, skill_points: 0 },
      night: { heads: 1, skill_points: 0 },
    },
  });
  const { rows: [homeA] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ($1, 'Platform Admin Home A', $2::jsonb) RETURNING id`,
    [HOME_A, baseConfig],
  );
  const { rows: [homeB] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ($1, 'Platform Admin Home B', $2::jsonb) RETURNING id`,
    [HOME_B, baseConfig],
  );
  homeAId = homeA.id;
  homeBId = homeB.id;

  const hash = await bcrypt.hash(PASSWORD, 4);
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by, is_platform_admin)
     VALUES
       ($1, $3, 'viewer', true, 'Flagged Non Admin', 'test-setup', true),
       ($2, $3, 'admin', true, 'Real Platform Admin', 'test-setup', true)`,
    [FLAGGED_USER, ADMIN_USER, hash],
  );
  const { rows: [target] } = await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by, is_platform_admin)
     VALUES ($1, $2, 'viewer', true, 'Target User', 'test-setup', false)
     RETURNING id`,
    [TARGET_USER, hash],
  );
  targetUserId = target.id;

  await pool.query(
    `INSERT INTO user_home_roles (username, home_id, role_id, granted_by)
     VALUES
       ($1, $3, 'home_manager', 'test-setup'),
       ($2, $3, 'viewer', 'test-setup')`,
    [FLAGGED_USER, TARGET_USER, homeAId],
  );

  await pool.query(
    `INSERT INTO staff (
       home_id, id, name, role, team, skill, hourly_rate, active, wtr_opt_out,
       start_date, contract_hours, willing_extras, willing_other_homes,
       max_weekly_hours_topup, internal_bank_status
     )
     VALUES (
       $1, $2, 'Cross Home Bank Candidate', 'Carer', 'Day A', 1, 12.5, true, false,
       '2026-01-01', 37.5, true, true, 16, 'available'
     )`,
    [homeBId, STAFF_B],
  );

  const flaggedLogin = await request(app).post('/api/login').send({ username: FLAGGED_USER, password: PASSWORD }).expect(200);
  const adminLogin = await request(app).post('/api/login').send({ username: ADMIN_USER, password: PASSWORD }).expect(200);
  flaggedToken = flaggedLogin.body.token;
  adminToken = adminLogin.body.token;
}, 20000);

afterAll(async () => {
  await cleanup();
});

describe('platform admin consistency', () => {
  it('does not issue a platform-admin client claim to a non-admin flagged row', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ username: FLAGGED_USER, password: PASSWORD })
      .expect(200);

    expect(res.body.role).toBe('viewer');
    expect(res.body.isPlatformAdmin).toBe(false);
  });

  it('keeps portfolio and setup reads platform-admin only', async () => {
    await request(app)
      .get('/api/portfolio/kpis')
      .set('Authorization', `Bearer ${flaggedToken}`)
      .expect(403);

    await request(app)
      .get('/api/home-setup')
      .set('Authorization', `Bearer ${flaggedToken}`)
      .expect(403);

    const adminPortfolio = await request(app)
      .get('/api/portfolio/kpis')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(adminPortfolio.body.homes.map(home => home.home_slug)).toEqual(expect.arrayContaining([HOME_A, HOME_B]));
  });

  it('does not widen internal-bank candidate search for a non-admin flagged row', async () => {
    const query = {
      home: HOME_A,
      shift_date: '2026-05-11',
      shift_code: 'AG-E',
      role: 'Carer',
    };

    const flagged = await request(app)
      .get('/api/internal-bank/candidates')
      .query(query)
      .set('Authorization', `Bearer ${flaggedToken}`)
      .expect(200);
    expect(flagged.body.candidates.map(candidate => candidate.home_slug)).not.toContain(HOME_B);

    const admin = await request(app)
      .get('/api/internal-bank/candidates')
      .query(query)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(admin.body.candidates.map(candidate => candidate.home_slug)).toContain(HOME_B);
  });

  it('keeps platform-only user-management operations behind a real platform admin', async () => {
    await request(app)
      .put(`/api/users/${targetUserId}/roles`)
      .query({ home: HOME_A })
      .set('Authorization', `Bearer ${flaggedToken}`)
      .send({ roleId: 'home_manager' })
      .expect(403);

    await request(app)
      .put(`/api/users/${targetUserId}/roles`)
      .query({ home: HOME_A })
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleId: 'home_manager' })
      .expect(200);
  });
});
