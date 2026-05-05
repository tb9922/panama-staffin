import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { pool } from '../../db.js';
import { app } from '../../server.js';
import { addDays, formatDate, getCycleDay, getScheduledShift, parseDate } from '../../shared/rotation.js';

const PREFIX = 'sched-route-hardening';
const USERNAME = `${PREFIX}-manager`;
const COORD_USERNAME = `${PREFIX}-coordinator`;
const VIEWER_USERNAME = `${PREFIX}-viewer`;
const PASSWORD = 'SchedRoute!2026';
const EDIT_LOCK_PIN = '2468';
const BASE_CONFIG = {
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

let homeId;
let homeSlug;
let token;
let coordinatorToken;
let viewerToken;

function utcDateOffset(offsetDays) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function authRequest(method, path) {
  return request(app)[method](path).set('Authorization', `Bearer ${token}`);
}

function coordinatorRequest(method, path) {
  return request(app)[method](path).set('Authorization', `Bearer ${coordinatorToken}`);
}

function viewerRequest(method, path) {
  return request(app)[method](path).set('Authorization', `Bearer ${viewerToken}`);
}

beforeAll(async () => {
  await pool.query(`DELETE FROM user_home_roles WHERE username LIKE $1`, [`${PREFIX}-%`]);
  await pool.query(`DELETE FROM token_denylist WHERE username LIKE $1`, [`${PREFIX}-%`]);
  await pool.query(`DELETE FROM training_records WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [`${PREFIX}-home`]);
  await pool.query(`DELETE FROM audit_log WHERE home_slug = $1`, [`${PREFIX}-home`]).catch(() => {});
  await pool.query(`DELETE FROM override_requests WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [`${PREFIX}-home`]).catch(() => {});
  await pool.query(`DELETE FROM day_notes WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [`${PREFIX}-home`]);
  await pool.query(`DELETE FROM shift_overrides WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [`${PREFIX}-home`]);
  await pool.query(`DELETE FROM staff WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [`${PREFIX}-home`]);
  await pool.query(`DELETE FROM users WHERE username LIKE $1`, [`${PREFIX}-%`]);
  await pool.query(`DELETE FROM homes WHERE slug = $1`, [`${PREFIX}-home`]);

  const { rows: [home] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ($1, 'Scheduling Route Hardening Home', $2) RETURNING id, slug`,
    [`${PREFIX}-home`, JSON.stringify(BASE_CONFIG)],
  );
  homeId = home.id;
  homeSlug = home.slug;

  await pool.query(
    `INSERT INTO staff (home_id, id, name, role, team, skill, hourly_rate, active, date_of_birth, ni_number)
     VALUES ($1, 'sched-route-s1', 'Route Test Carer', 'Carer', 'Day A', 1, 14.50, true, '1980-01-01', 'QQ123456C')`,
    [homeId],
  );

  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'viewer', true, 'Scheduling Route Manager', 'test-setup')`,
    [USERNAME, passwordHash],
  );
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'viewer', true, 'Scheduling Route Coordinator', 'test-setup')`,
    [COORD_USERNAME, passwordHash],
  );
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'viewer', true, 'Scheduling Route Viewer', 'test-setup')`,
    [VIEWER_USERNAME, passwordHash],
  );
  await pool.query(
    `INSERT INTO user_home_roles (username, home_id, role_id, staff_id, granted_by)
     VALUES ($1, $2, 'home_manager', NULL, 'test-setup')`,
    [USERNAME, homeId],
  );
  await pool.query(
    `INSERT INTO user_home_roles (username, home_id, role_id, staff_id, granted_by)
     VALUES ($1, $2, 'shift_coordinator', NULL, 'test-setup')`,
    [COORD_USERNAME, homeId],
  );
  await pool.query(
    `INSERT INTO user_home_roles (username, home_id, role_id, staff_id, granted_by)
     VALUES ($1, $2, 'viewer', NULL, 'test-setup')`,
    [VIEWER_USERNAME, homeId],
  );

  const loginRes = await request(app).post('/api/login').send({ username: USERNAME, password: PASSWORD }).expect(200);
  token = loginRes.body.token;
  const coordinatorLogin = await request(app).post('/api/login').send({ username: COORD_USERNAME, password: PASSWORD }).expect(200);
  coordinatorToken = coordinatorLogin.body.token;
  const viewerLogin = await request(app).post('/api/login').send({ username: VIEWER_USERNAME, password: PASSWORD }).expect(200);
  viewerToken = viewerLogin.body.token;
}, 15000);

afterEach(async () => {
  await pool.query(`DELETE FROM training_records WHERE home_id = $1`, [homeId]).catch(() => {});
  await pool.query(`DELETE FROM day_notes WHERE home_id = $1`, [homeId]).catch(() => {});
  await pool.query(`DELETE FROM shift_overrides WHERE home_id = $1`, [homeId]).catch(() => {});
  await pool.query(`DELETE FROM audit_log WHERE home_slug = $1`, [homeSlug]).catch(() => {});
  await pool.query(`DELETE FROM override_requests WHERE home_id = $1`, [homeId]).catch(() => {});
  await pool.query(`UPDATE homes SET config = $2::jsonb WHERE id = $1`, [homeId, JSON.stringify(BASE_CONFIG)]).catch(() => {});
});

afterAll(async () => {
  await pool.query(`DELETE FROM user_home_roles WHERE username LIKE $1`, [`${PREFIX}-%`]).catch(() => {});
  await pool.query(`DELETE FROM token_denylist WHERE username LIKE $1`, [`${PREFIX}-%`]).catch(() => {});
  await pool.query(`DELETE FROM training_records WHERE home_id = $1`, [homeId]).catch(() => {});
  await pool.query(`DELETE FROM day_notes WHERE home_id = $1`, [homeId]).catch(() => {});
  await pool.query(`DELETE FROM shift_overrides WHERE home_id = $1`, [homeId]).catch(() => {});
  await pool.query(`DELETE FROM audit_log WHERE home_slug = $1`, [homeSlug]).catch(() => {});
  await pool.query(`DELETE FROM override_requests WHERE home_id = $1`, [homeId]).catch(() => {});
  await pool.query(`DELETE FROM staff WHERE home_id = $1`, [homeId]).catch(() => {});
  await pool.query(`DELETE FROM users WHERE username LIKE $1`, [`${PREFIX}-%`]).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE id = $1`, [homeId]).catch(() => {});
});

describe('scheduling route hardening', () => {
  it('redacts the raw edit lock PIN from scheduling config responses', async () => {
    const res = await authRequest('get', `/api/scheduling?home=${homeSlug}`).expect(200);

    expect(res.body.config.edit_lock_enabled).toBe(true);
    expect(res.body.config.edit_lock_pin).toBeUndefined();
  });

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

  it('rejects raw agency rota overrides so agency guard evidence is required', async () => {
    const shiftDate = utcDateOffset(7);
    const res = await authRequest('put', `/api/scheduling/overrides?home=${homeSlug}`)
      .send({ date: shiftDate, staffId: 'AG-RAW-1', shift: 'AG-E', reason: 'Direct agency booking' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Agency Tracker/i);
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM shift_overrides WHERE home_id = $1 AND date = $2 AND shift LIKE 'AG-%'`,
      [homeId, shiftDate],
    );
    expect(rows[0].cnt).toBe(0);
  });

  it('rejects raw agency rows in bulk rota overrides', async () => {
    const shiftDate = utcDateOffset(8);
    const res = await authRequest('post', `/api/scheduling/overrides/bulk?home=${homeSlug}`)
      .send({
        overrides: [
          { date: shiftDate, staffId: 'AG-RAW-2', shift: 'AG-N', reason: 'Bulk direct agency booking' },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Agency Tracker/i);
  });

  it('rejects client-supplied agency tracker sources on scheduling writes', async () => {
    const singleDate = utcDateOffset(8);
    const single = await authRequest('put', `/api/scheduling/overrides?home=${homeSlug}`)
      .send({ date: singleDate, staffId: 'sched-route-s1', shift: 'SICK', source: 'agency_tracker' });
    expect(single.status).toBe(400);
    expect(single.body.error).toMatch(/server-owned override source/i);

    const bulkDate = utcDateOffset(9);
    const bulk = await authRequest('post', `/api/scheduling/overrides/bulk?home=${homeSlug}`)
      .send({
        overrides: [
          { date: bulkDate, staffId: 'sched-route-s1', shift: 'SICK', source: 'agency_tracker' },
        ],
      });
    expect(bulk.status).toBe(400);
    expect(bulk.body.error).toMatch(/server-owned override source/i);

    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS cnt
         FROM shift_overrides
        WHERE home_id = $1 AND source = 'agency_tracker'
          AND staff_id = 'sched-route-s1'
          AND date IN ($2, $3)`,
      [homeId, singleDate, bulkDate],
    );
    expect(rows[0].cnt).toBe(0);
  });

  it('rejects legacy /api/data scheduling override writes', async () => {
    const shiftDate = utcDateOffset(10);
    const res = await authRequest('post', `/api/data?home=${homeSlug}`)
      .send({
        config: BASE_CONFIG,
        staff: [{ id: 'sched-route-s1', name: 'Route Test Carer', role: 'Carer', active: true }],
        overrides: {
          [shiftDate]: {
            'sched-route-s1': { shift: 'SICK', reason: 'Legacy bypass attempt' },
          },
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Legacy \/api\/data no longer accepts rota overrides/i);
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM shift_overrides WHERE home_id = $1 AND date = $2`,
      [homeId, shiftDate],
    );
    expect(rows[0].cnt).toBe(0);
  });

  it('redacts deprecated /api/data reads for broad scheduling readers', async () => {
    const shiftDate = utcDateOffset(10);
    await pool.query(
      `INSERT INTO shift_overrides (home_id, date, staff_id, shift, reason, source)
       VALUES ($1, $2, 'sched-route-s1', 'SICK', 'Migraine and medication side effects', 'manual')`,
      [homeId, shiftDate],
    );
    await pool.query(
      `INSERT INTO day_notes (home_id, date, note)
       VALUES ($1, $2, 'Clinical note that must not leak through legacy data endpoint')`,
      [homeId, shiftDate],
    );

    const res = await coordinatorRequest('get', `/api/data?home=${homeSlug}`).expect(200);

    expect(res.headers['x-deprecated']).toMatch(/Use \/api\/scheduling/i);
    expect(res.body.config.edit_lock_pin).toBeUndefined();
    expect(res.body.day_notes).toEqual({});
    expect(res.body.staff[0].hourly_rate).toBeUndefined();
    expect(res.body.staff[0].date_of_birth).toBeUndefined();
    expect(res.body.staff[0].ni_number).toBeUndefined();
    expect(res.body.staff[0].contract_hours).toBeUndefined();
    expect(res.body.staff[0].wtr_opt_out).toBeUndefined();
    expect(res.body.staff[0].al_entitlement).toBeUndefined();
    expect(res.body.staff[0].al_carryover).toBeUndefined();
    expect(res.body.overrides[shiftDate]['sched-route-s1'].reason).toBeUndefined();
    expect(res.body.overrides[shiftDate]['sched-route-s1'].reason_category).toBe('absence');
  });

  it('rejects deprecated /api/data writes for viewer and shift coordinator roles', async () => {
    const payload = {
      config: BASE_CONFIG,
      staff: [{ id: 'sched-route-s1', name: 'Route Test Carer', role: 'Carer', active: true }],
    };

    const viewerRes = await viewerRequest('post', `/api/data?home=${homeSlug}`).send(payload);
    expect(viewerRes.status).toBe(403);

    const coordinatorRes = await coordinatorRequest('post', `/api/data?home=${homeSlug}`).send(payload);
    expect(coordinatorRes.status).toBe(403);
  });

  it('redacts override reasons for scheduling readers below manager level', async () => {
    const shiftDate = utcDateOffset(9);
    await pool.query(
      `INSERT INTO shift_overrides (home_id, date, staff_id, shift, reason, source)
       VALUES ($1, $2, 'sched-route-s1', 'SICK', 'Migraine and medication side effects', 'manual')`,
      [homeId, shiftDate],
    );
    await pool.query(
      `INSERT INTO day_notes (home_id, date, note)
       VALUES ($1, $2, 'Clinical staffing note for managers only')`,
      [homeId, shiftDate],
    );

    const managerRes = await authRequest('get', `/api/scheduling?home=${homeSlug}&from=${shiftDate}&to=${shiftDate}`).expect(200);
    expect(managerRes.body.overrides[shiftDate]['sched-route-s1'].reason).toMatch(/Migraine/i);
    expect(managerRes.body.day_notes[shiftDate]).toMatch(/Clinical staffing note/i);
    expect(managerRes.body.permissions.can_edit_day_notes).toBe(true);

    const coordRes = await coordinatorRequest('get', `/api/scheduling?home=${homeSlug}&from=${shiftDate}&to=${shiftDate}`).expect(200);
    expect(coordRes.body.overrides[shiftDate]['sched-route-s1'].reason).toBeUndefined();
    expect(coordRes.body.overrides[shiftDate]['sched-route-s1'].reason_category).toBe('absence');
    expect(coordRes.body.day_notes).toEqual({});
    expect(coordRes.body.permissions.can_edit_day_notes).toBe(false);
  });

  it('restricts staff override request review and decisions to managers', async () => {
    const { rows: [requestRow] } = await pool.query(
      `INSERT INTO override_requests (home_id, staff_id, request_type, date, requested_shift, reason)
       VALUES ($1, 'sched-route-s1', 'OTHER', $2, 'L', 'Hospital appointment detail')
       RETURNING id, version`,
      [homeId, utcDateOffset(13)],
    );

    const managerList = await authRequest('get', `/api/staff/override-requests?home=${homeSlug}`).expect(200);
    expect(managerList.body[0].reason).toMatch(/Hospital appointment/i);

    const coordinatorList = await coordinatorRequest('get', `/api/staff/override-requests?home=${homeSlug}`);
    expect(coordinatorList.status).toBe(403);

    const coordinatorDecision = await coordinatorRequest('post', `/api/staff/override-requests/${requestRow.id}/decision?home=${homeSlug}`)
      .send({ status: 'approved', decisionNote: 'not allowed', expectedVersion: requestRow.version });
    expect(coordinatorDecision.status).toBe(403);
  });

  it('allows OC cover links and rejects stale cover links on non-OC shifts', async () => {
    const shiftDate = utcDateOffset(11);
    await authRequest('put', `/api/scheduling/overrides?home=${homeSlug}`)
      .send({ date: shiftDate, staffId: 'sched-route-s1', shift: 'OC-E', replaces_staff_id: 'absent-1' })
      .expect(200);

    const saved = await pool.query(
      `SELECT replaces_staff_id FROM shift_overrides WHERE home_id = $1 AND date = $2 AND staff_id = 'sched-route-s1'`,
      [homeId, shiftDate],
    );
    expect(saved.rows[0]?.replaces_staff_id).toBe('absent-1');

    const nonOc = await authRequest('put', `/api/scheduling/overrides?home=${homeSlug}`)
      .send({ date: utcDateOffset(12), staffId: 'sched-route-s1', shift: 'E', replaces_staff_id: 'absent-1' });
    expect(nonOc.status).toBe(400);
    expect(nonOc.body.error).toMatch(/Cover link only valid for OC shifts/i);
  });

  it('rejects self-cover links in single and bulk override routes', async () => {
    const single = await authRequest('put', `/api/scheduling/overrides?home=${homeSlug}`)
      .send({ date: utcDateOffset(13), staffId: 'sched-route-s1', shift: 'OC-E', replaces_staff_id: 'sched-route-s1' });
    expect(single.status).toBe(400);
    expect(single.body.error).toMatch(/cannot cover themselves/i);

    const bulk = await authRequest('post', `/api/scheduling/overrides/bulk?home=${homeSlug}`)
      .send({
        overrides: [
          { date: utcDateOffset(14), staffId: 'sched-route-s1', shift: 'OC-E', replaces_staff_id: 'sched-route-s1' },
        ],
      });
    expect(bulk.status).toBe(400);
    expect(bulk.body.error).toMatch(/cannot cover themselves/i);
  });

  it('rejects past-date day notes without the edit lock PIN', async () => {
    const res = await authRequest('put', `/api/scheduling/day-notes?home=${homeSlug}`)
      .send({ date: utcDateOffset(-1), note: 'Retro handover note' });

    expect(res.status).toBe(423);
    expect(res.body.error).toMatch(/edit PIN/i);
  });

  it('blocks non-manager day-note edits without erasing hidden notes', async () => {
    const noteDate = utcDateOffset(18);
    await pool.query(
      `INSERT INTO day_notes (home_id, date, note)
       VALUES ($1, $2, 'Manager-only staffing note')`,
      [homeId, noteDate],
    );

    const res = await coordinatorRequest('put', `/api/scheduling/day-notes?home=${homeSlug}`)
      .send({ date: noteDate, note: 'Coordinator replacement note' });

    expect(res.status).toBe(403);
    const { rows: [saved] } = await pool.query(
      `SELECT note FROM day_notes WHERE home_id = $1 AND date = $2`,
      [homeId, noteDate],
    );
    expect(saved.note).toBe('Manager-only staffing note');

    const coordRead = await coordinatorRequest('get', `/api/scheduling?home=${homeSlug}&from=${noteDate}&to=${noteDate}`).expect(200);
    expect(coordRead.body.day_notes).toEqual({});
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

  it('protects Agency Tracker coverage from scheduling deletes', async () => {
    const agencyDate = utcDateOffset(23);
    const manualDate = utcDateOffset(24);
    await pool.query(
      `INSERT INTO shift_overrides (home_id, date, staff_id, shift, source)
       VALUES ($1, $2, 'AG-9001', 'AG-E', 'agency_tracker'),
              ($1, $3, 'sched-route-s1', 'SICK', 'manual')`,
      [homeId, agencyDate, manualDate],
    );

    const overwrite = await authRequest('put', `/api/scheduling/overrides?home=${homeSlug}`)
      .send({ date: agencyDate, staffId: 'AG-9001', shift: 'OFF', reason: 'Manual revert attempt' });
    expect(overwrite.status).toBe(409);
    expect(overwrite.body.error).toMatch(/Agency Tracker/i);

    const bulkOverwrite = await authRequest('post', `/api/scheduling/overrides/bulk?home=${homeSlug}`)
      .send({
        overrides: [
          { date: agencyDate, staffId: 'AG-9001', shift: 'OFF', reason: 'Bulk revert attempt' },
        ],
      });
    expect(bulkOverwrite.status).toBe(409);
    expect(bulkOverwrite.body.error).toMatch(/Agency Tracker/i);

    const single = await authRequest('delete', `/api/scheduling/overrides?home=${homeSlug}&date=${agencyDate}&staffId=AG-9001`);
    expect(single.status).toBe(409);
    expect(single.body.error).toMatch(/Agency Tracker/i);

    const month = await authRequest('delete', `/api/scheduling/overrides/month?home=${homeSlug}&fromDate=${agencyDate}&toDate=${manualDate}`)
      .expect(200);
    expect(month.body.deleted).toBe(1);
    expect(month.body.skipped_agency_tracker).toBe(1);

    const { rows } = await pool.query(
      `SELECT staff_id, source
         FROM shift_overrides
        WHERE home_id = $1 AND date IN ($2, $3)
        ORDER BY staff_id`,
      [homeId, agencyDate, manualDate],
    );
    expect(rows).toEqual([{ staff_id: 'AG-9001', source: 'agency_tracker' }]);
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

  it('blocks standard added shifts that breach WTR, not only OC shifts', async () => {
    const shifts = { E: { hours: 8 }, L: { hours: 8 }, EL: { hours: 12 }, N: { hours: 10 } };
    const mondayDate = new Date(Date.UTC(2099, 8, 1));
    while (mondayDate.getUTCDay() !== 1) mondayDate.setUTCDate(mondayDate.getUTCDate() + 1);
    const monday = formatDate(mondayDate);
    const staffShape = { id: 'sched-route-s1', team: 'Day A', pref: 'E' };
    const weekDates = Array.from({ length: 7 }, (_, i) => formatDate(addDays(parseDate(monday), i)));
    const offDays = weekDates.filter((date) => {
      const cycleDay = getCycleDay(date, monday);
      return getScheduledShift(staffShape, cycleDay, date, { cycle_start_date: monday, shifts }) === 'OFF';
    });
    expect(offDays.length).toBeGreaterThanOrEqual(2);

    await pool.query(`UPDATE staff SET pref = 'E', wtr_opt_out = false WHERE home_id = $1 AND id = 'sched-route-s1'`, [homeId]);
    await pool.query(
      `UPDATE homes
         SET config = jsonb_set(config, '{cycle_start_date}', to_jsonb($2::text), true)
       WHERE id = $1`,
      [homeId, monday],
    );

    const res = await authRequest('post', `/api/scheduling/overrides/bulk?home=${homeSlug}`)
      .send({
        overrides: [
          { date: offDays[0], staffId: 'sched-route-s1', shift: 'E', reason: 'Extra early 1' },
          { date: offDays[1], staffId: 'sched-route-s1', shift: 'E', reason: 'Extra early 2' },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/48h/i);
  });

  it('blocks added working shifts that exceed max consecutive days', async () => {
    const target = utcDateOffset(45);
    const priorDates = [-3, -2, -1].map(offset => formatDate(addDays(parseDate(target), offset)));
    const fatigueConfig = {
      ...BASE_CONFIG,
      max_consecutive_days: 3,
      shifts: { E: { hours: 1 }, L: { hours: 1 }, EL: { hours: 1 }, N: { hours: 1 } },
    };
    await pool.query(`UPDATE homes SET config = $2::jsonb WHERE id = $1`, [homeId, JSON.stringify(fatigueConfig)]);
    for (const date of priorDates) {
      await pool.query(
        `INSERT INTO shift_overrides (home_id, date, staff_id, shift, reason, source)
         VALUES ($1, $2, 'sched-route-s1', 'E', 'Consecutive-day setup', 'test')`,
        [homeId, date],
      );
    }

    const res = await authRequest('put', `/api/scheduling/overrides?home=${homeSlug}`)
      .send({ date: target, staffId: 'sched-route-s1', shift: 'E', reason: 'Fourth day' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/consecutive working days/i);
  });

  it('records compact targets in bulk rota audit details', async () => {
    const shiftDate = utcDateOffset(31);
    const res = await authRequest('post', `/api/scheduling/overrides/bulk?home=${homeSlug}`)
      .send({
        overrides: [
          { date: shiftDate, staffId: 'sched-route-s1', shift: 'SICK', reason: 'Bulk audit test', source: 'manual' },
        ],
      });

    expect(res.status).toBe(200);
    const { rows } = await pool.query(
      `SELECT details
         FROM audit_log
        WHERE home_slug = $1 AND action = 'override_bulk_upsert'
        ORDER BY ts DESC
        LIMIT 1`,
      [homeSlug],
    );
    const details = JSON.parse(rows[0].details);
    expect(details.targets).toEqual([
      expect.objectContaining({ date: shiftDate, staff_id: 'sched-route-s1', shift: 'SICK', source: 'manual' }),
    ]);
    expect(JSON.stringify(details.targets)).not.toMatch(/Bulk audit test/);
  });

  it('bulk OT WTR enforcement sees the batch final state, not one row at a time', async () => {
    const shifts = { E: { hours: 8 }, L: { hours: 8 }, EL: { hours: 12 }, N: { hours: 10 } };
    const mondayDate = new Date(Date.UTC(2099, 7, 1));
    while (mondayDate.getUTCDay() !== 1) mondayDate.setUTCDate(mondayDate.getUTCDate() + 1);
    const monday = formatDate(mondayDate);
    const staffShape = { id: 'sched-route-s1', team: 'Day A', pref: 'E' };
    const weekDates = Array.from({ length: 7 }, (_, i) => formatDate(addDays(parseDate(monday), i)));
    const offDays = weekDates.filter((date) => {
      const cycleDay = getCycleDay(date, monday);
      return getScheduledShift(staffShape, cycleDay, date, { cycle_start_date: monday, shifts }) === 'OFF';
    });
    expect(offDays.length).toBeGreaterThanOrEqual(2);

    await pool.query(`UPDATE staff SET pref = 'E', wtr_opt_out = false WHERE home_id = $1 AND id = 'sched-route-s1'`, [homeId]);
    await pool.query(
      `UPDATE homes
         SET config = jsonb_set(config, '{cycle_start_date}', to_jsonb($2::text), true)
       WHERE id = $1`,
      [homeId, monday],
    );

    const res = await authRequest('post', `/api/scheduling/overrides/bulk?home=${homeSlug}`)
      .send({
        overrides: [
          { date: offDays[0], staffId: 'sched-route-s1', shift: 'OC-E', reason: 'OT 1' },
          { date: offDays[1], staffId: 'sched-route-s1', shift: 'OC-E', reason: 'OT 2' },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/48h/i);
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM shift_overrides
       WHERE home_id = $1 AND staff_id = 'sched-route-s1' AND date = ANY($2::date[])`,
      [homeId, offDays],
    );
    expect(rows[0].cnt).toBe(0);
  });

  it('rejects invalid calendar dates on scheduling bundle queries', async () => {
    const res = await authRequest('get', `/api/scheduling?home=${homeSlug}&from=2025-99-99&to=2025-12-01`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid from date/i);
  });

  it('rejects invalid calendar dates on month revert requests', async () => {
    const res = await authRequest('delete', `/api/scheduling/overrides/month?home=${homeSlug}&fromDate=2025-99-99&toDate=2025-12-01`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid date/i);
  });
});
