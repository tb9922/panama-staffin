import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { pool } from '../../db.js';
import { app } from '../../server.js';

const PREFIX = 'sched-route-hardening';
const USERNAME = `${PREFIX}-manager`;
const PASSWORD = 'SchedRoute!2026';
const EDIT_LOCK_PIN = '2468';

let homeId;
let homeSlug;
let token;

function utcDateOffset(offsetDays) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function authRequest(method, path) {
  return request(app)[method](path).set('Authorization', `Bearer ${token}`);
}

beforeAll(async () => {
  await pool.query(`DELETE FROM user_home_roles WHERE username = $1`, [USERNAME]);
  await pool.query(`DELETE FROM token_denylist WHERE username = $1`, [USERNAME]);
  await pool.query(`DELETE FROM training_records WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [`${PREFIX}-home`]);
  await pool.query(`DELETE FROM day_notes WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [`${PREFIX}-home`]);
  await pool.query(`DELETE FROM shift_overrides WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [`${PREFIX}-home`]);
  await pool.query(`DELETE FROM staff WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [`${PREFIX}-home`]);
  await pool.query(`DELETE FROM users WHERE username = $1`, [USERNAME]);
  await pool.query(`DELETE FROM homes WHERE slug = $1`, [`${PREFIX}-home`]);

  const config = {
    home_name: 'Scheduling Route Hardening Home',
    cycle_start_date: '2025-01-06',
    edit_lock_pin: EDIT_LOCK_PIN,
    enforce_training_blocking: false,
    shifts: {
      E: { hours: 8 },
      L: { hours: 8 },
      EL: { hours: 12 },
      N: { hours: 10 },
    },
    training_types: [
      { id: 'fire-safety', name: 'Fire Safety', active: true, roles: ['Carer'] },
    ],
  };
  const { rows: [home] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ($1, 'Scheduling Route Hardening Home', $2) RETURNING id, slug`,
    [`${PREFIX}-home`, JSON.stringify(config)],
  );
  homeId = home.id;
  homeSlug = home.slug;

  await pool.query(
    `INSERT INTO staff (home_id, id, name, role, team, skill, hourly_rate, active)
     VALUES ($1, 'sched-route-s1', 'Route Test Carer', 'Carer', 'Day A', 1, 14.50, true)`,
    [homeId],
  );

  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'viewer', true, 'Scheduling Route Manager', 'test-setup')`,
    [USERNAME, passwordHash],
  );
  await pool.query(
    `INSERT INTO user_home_roles (username, home_id, role_id, staff_id, granted_by)
     VALUES ($1, $2, 'home_manager', NULL, 'test-setup')`,
    [USERNAME, homeId],
  );

  const loginRes = await request(app).post('/api/login').send({ username: USERNAME, password: PASSWORD }).expect(200);
  token = loginRes.body.token;
}, 15000);

afterEach(async () => {
  await pool.query(`DELETE FROM training_records WHERE home_id = $1`, [homeId]).catch(() => {});
  await pool.query(`DELETE FROM day_notes WHERE home_id = $1`, [homeId]).catch(() => {});
  await pool.query(`DELETE FROM shift_overrides WHERE home_id = $1`, [homeId]).catch(() => {});
});

afterAll(async () => {
  await pool.query(`DELETE FROM user_home_roles WHERE username = $1`, [USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM token_denylist WHERE username = $1`, [USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM training_records WHERE home_id = $1`, [homeId]).catch(() => {});
  await pool.query(`DELETE FROM day_notes WHERE home_id = $1`, [homeId]).catch(() => {});
  await pool.query(`DELETE FROM shift_overrides WHERE home_id = $1`, [homeId]).catch(() => {});
  await pool.query(`DELETE FROM staff WHERE home_id = $1`, [homeId]).catch(() => {});
  await pool.query(`DELETE FROM users WHERE username = $1`, [USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE id = $1`, [homeId]).catch(() => {});
});

describe('scheduling route hardening', () => {
  it('rejects past-date single overrides without the edit lock PIN', async () => {
    const res = await authRequest('put', `/api/scheduling/overrides?home=${homeSlug}`)
      .send({ date: utcDateOffset(-2), staffId: 'sched-route-s1', shift: 'AL' });

    expect(res.status).toBe(423);
    expect(res.body.error).toMatch(/edit PIN/i);
  });

  it('allows past-date single overrides with the edit lock PIN', async () => {
    const pastDate = utcDateOffset(-3);
    const res = await authRequest('put', `/api/scheduling/overrides?home=${homeSlug}`)
      .set('X-Edit-Lock-Pin', EDIT_LOCK_PIN)
      .send({ date: pastDate, staffId: 'sched-route-s1', shift: 'SICK' });

    expect(res.status).toBe(200);
    const { rows } = await pool.query(
      `SELECT shift FROM shift_overrides WHERE home_id = $1 AND date = $2 AND staff_id = 'sched-route-s1'`,
      [homeId, pastDate],
    );
    expect(rows[0]?.shift).toBe('SICK');
  });

  it('rejects past-date day notes without the edit lock PIN', async () => {
    const res = await authRequest('put', `/api/scheduling/day-notes?home=${homeSlug}`)
      .send({ date: utcDateOffset(-1), note: 'Retro handover note' });

    expect(res.status).toBe(423);
    expect(res.body.error).toMatch(/edit PIN/i);
  });

  it('rejects past-date bulk overrides without the edit lock PIN', async () => {
    const res = await authRequest('post', `/api/scheduling/overrides/bulk?home=${homeSlug}`)
      .send({
        overrides: [
          { date: utcDateOffset(-4), staffId: 'sched-route-s1', shift: 'SICK', reason: 'Backfill' },
        ],
      });

    expect(res.status).toBe(423);
  });

  it('rejects reverting past-month overrides without the edit lock PIN', async () => {
    const firstPastDate = utcDateOffset(-7);
    const secondPastDate = utcDateOffset(-6);
    await pool.query(
      `INSERT INTO shift_overrides (home_id, date, staff_id, shift, source)
       VALUES ($1, $2, 'sched-route-s1', 'SICK', 'test'),
              ($1, $3, 'sched-route-s1', 'AL', 'test')`,
      [homeId, firstPastDate, secondPastDate],
    );

    const res = await authRequest('delete', `/api/scheduling/overrides/month?home=${homeSlug}&fromDate=${firstPastDate}&toDate=${secondPastDate}`);
    expect(res.status).toBe(423);
  });

  it('checks mandatory training against the target shift date, not today', async () => {
    const futureShiftDate = utcDateOffset(30);
    const expiryBeforeShift = utcDateOffset(10);
    await pool.query(
      `INSERT INTO training_records (home_id, staff_id, training_type_id, completed, expiry, trainer, method)
       VALUES ($1, 'sched-route-s1', 'fire-safety', $2, $3, 'Route Test Trainer', 'classroom')`,
      [homeId, utcDateOffset(-30), expiryBeforeShift],
    );

    const res = await authRequest('put', `/api/scheduling/overrides?home=${homeSlug}`)
      .send({ date: futureShiftDate, staffId: 'sched-route-s1', shift: 'E' });

    expect(res.status).toBe(200);
    expect(res.body.warnings).toBeDefined();
    expect(res.body.warnings[0]).toMatch(/Fire Safety/i);
  });
});
