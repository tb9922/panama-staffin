import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { app } from '../../server.js';
import { pool } from '../../db.js';
import { clearPortfolioCache } from '../../services/portfolioService.js';

const PREFIX = 'portfolio-test';
const HOME_A = `${PREFIX}-home-a`;
const HOME_B = `${PREFIX}-home-b`;
const HOME_C = `${PREFIX}-home-c`;
const MANAGER = `${PREFIX}-manager`;
const PASSWORD = 'PortfolioTest1!';
const MINIMUM_STAFFING_CONFIG = {
  cycle_start_date: '2026-04-01',
  minimum_staffing: {
    early: { heads: 1, skill_points: 0 },
    late: { heads: 0, skill_points: 0 },
    night: { heads: 0, skill_points: 0 },
  },
};

let homeAId;
let homeBId;
let homeCId;
let managerToken;

async function cleanup() {
  clearPortfolioCache();
  const { rows } = await pool.query(`SELECT id FROM homes WHERE slug LIKE $1`, [`${PREFIX}-%`]);
  const homeIds = rows.map(row => row.id);
  for (const homeId of homeIds) {
    await pool.query(`DELETE FROM action_items WHERE home_id = $1`, [homeId]).catch(() => {});
    await pool.query(`DELETE FROM agency_shifts WHERE home_id = $1`, [homeId]).catch(() => {});
    await pool.query(`DELETE FROM agency_approval_attempts WHERE home_id = $1`, [homeId]).catch(() => {});
    await pool.query(`DELETE FROM agency_providers WHERE home_id = $1`, [homeId]).catch(() => {});
  }
  await pool.query(`DELETE FROM audit_log WHERE home_slug LIKE $1`, [`${PREFIX}-%`]).catch(() => {});
  await pool.query(`DELETE FROM user_home_roles WHERE username LIKE $1`, [`${PREFIX}-%`]).catch(() => {});
  await pool.query(`DELETE FROM token_denylist WHERE username LIKE $1`, [`${PREFIX}-%`]).catch(() => {});
  await pool.query(`DELETE FROM users WHERE username LIKE $1`, [`${PREFIX}-%`]).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug LIKE $1`, [`${PREFIX}-%`]).catch(() => {});
}

beforeAll(async () => {
  await cleanup();

  const { rows: [homeA] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ($1, 'Portfolio Home A', $2::jsonb) RETURNING id`,
    [HOME_A, JSON.stringify(MINIMUM_STAFFING_CONFIG)]
  );
  const { rows: [homeB] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ($1, 'Portfolio Home B', '{}'::jsonb) RETURNING id`,
    [HOME_B]
  );
  const { rows: [homeC] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ($1, 'Portfolio Home C', '{}'::jsonb) RETURNING id`,
    [HOME_C]
  );
  homeAId = homeA.id;
  homeBId = homeB.id;
  homeCId = homeC.id;

  const hash = await bcrypt.hash(PASSWORD, 4);
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'viewer', true, 'Portfolio Manager', 'test-setup')`,
    [MANAGER, hash]
  );

  await pool.query(
    `INSERT INTO user_home_roles (username, home_id, role_id, granted_by)
     VALUES ($1, $2, 'home_manager', 'test-setup'), ($1, $3, 'viewer', 'test-setup')`,
    [MANAGER, homeAId, homeBId]
  );

  await pool.query(
    `INSERT INTO action_items (home_id, source_type, title, category, priority, due_date, status, escalation_level)
     VALUES ($1, 'standalone', 'Overdue portfolio action', 'governance', 'high', CURRENT_DATE - INTERVAL '1 day', 'open', 1)`,
    [homeAId]
  );

  const { rows: [provider] } = await pool.query(
    `INSERT INTO agency_providers (home_id, name, active) VALUES ($1, 'Portfolio Agency', true) RETURNING id`,
    [homeAId]
  );
  const { rows: [shift] } = await pool.query(
    `INSERT INTO agency_shifts (home_id, agency_id, date, shift_code, hours, hourly_rate, total_cost, role_covered)
     VALUES ($1, $2, CURRENT_DATE, 'AG-E', 8, 22, 176, 'Care Assistant')
     RETURNING id`,
    [homeAId, provider.id]
  );
  const { rows: [linkedAttempt] } = await pool.query(
    `INSERT INTO agency_approval_attempts (
       home_id, gap_date, shift_code, role_needed, reason, internal_bank_checked,
       internal_bank_candidate_count, viable_internal_candidate_count, emergency_override,
       emergency_override_reason, outcome, linked_agency_shift_id
     ) VALUES (
       $1, CURRENT_DATE, 'AG-E', 'Care Assistant', 'Emergency portfolio test',
       true, 1, 1, true, 'No safe internal cover at handover', 'emergency_agency', $2
     )
     RETURNING id`,
    [homeAId, shift.id]
  );
  await pool.query(`UPDATE agency_shifts SET agency_attempt_id = $1 WHERE id = $2`, [linkedAttempt.id, shift.id]);
  await pool.query(
    `INSERT INTO agency_approval_attempts (
       home_id, gap_date, shift_code, role_needed, reason, internal_bank_checked,
       internal_bank_candidate_count, viable_internal_candidate_count, emergency_override,
       emergency_override_reason, outcome
     ) VALUES (
       $1, CURRENT_DATE, 'AG-L', 'Care Assistant', 'Pending emergency test',
       true, 1, 1, true, 'Pending manager escalation before booking', 'emergency_agency'
     )`,
    [homeAId]
  );

  const login = await request(app).post('/api/login').send({ username: MANAGER, password: PASSWORD }).expect(200);
  managerToken = login.body.token;
}, 20000);

afterAll(async () => {
  await cleanup();
});

describe('portfolio KPI API', () => {
  it('returns only report-visible homes with manager action and agency signals', async () => {
    void homeCId;
    const res = await request(app)
      .get('/api/portfolio/kpis')
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);

    expect(Array.isArray(res.body.homes)).toBe(true);
    const slugs = res.body.homes.map(home => home.home_slug);
    expect(slugs).toContain(HOME_A);
    expect(slugs).toContain(HOME_B);
    expect(slugs).not.toContain(HOME_C);

    const homeA = res.body.homes.find(home => home.home_slug === HOME_A);
    expect(homeA.manager_actions.open).toBe(1);
    expect(homeA.manager_actions.overdue).toBe(1);
    expect(homeA.staffing.gaps_7d).toBe(7);
    expect(homeA.staffing.gaps_per_100_planned_shifts).toBe(100);
    expect(homeA.rag.staffing).toBe('red');
    expect(homeA.agency.shifts_28d).toBe(1);
    expect(homeA.agency.emergency_override_pct).toBe(100);
    expect(homeA.rag.manager_actions).toBe('amber');
    expect(homeA.rag).toHaveProperty('overall');
  });

  it('generates an audited portfolio board-pack payload for visible homes', async () => {
    const res = await request(app)
      .get('/api/portfolio/board-pack')
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);

    expect(res.body.summary.home_count).toBe(2);
    expect(res.body.homes.map(home => home.home_slug)).toEqual(expect.arrayContaining([HOME_A, HOME_B]));
    expect(res.body.homes.map(home => home.home_slug)).not.toContain(HOME_C);
    expect(res.body.weakest_homes.length).toBeGreaterThan(0);
    expect(res.body.agency_pressure.find(row => row.home_slug === HOME_A).emergency_override_pct).toBe(100);

    const { rows } = await pool.query(
      `SELECT home_slug, details
         FROM audit_log
        WHERE action = 'portfolio_board_pack_download'
          AND home_slug = ANY($1::varchar[])
        ORDER BY ts DESC`,
      [[HOME_A, HOME_B]]
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const details = JSON.parse(rows[0].details);
    expect(details.home_slugs).toEqual(expect.arrayContaining([HOME_A, HOME_B]));
    expect(details.home_slugs).not.toContain(HOME_C);
  });
});
