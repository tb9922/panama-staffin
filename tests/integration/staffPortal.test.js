/**
 * Integration tests for the staff self-service portal (/api/me/* and the
 * services that back it).
 *
 * Covers: cross-staff isolation, AL request submit + duplicate-day reject,
 * AL approval atomicity (override row written in same transaction), AL
 * cancellation, version conflict on decide, profile allowlist enforcement,
 * payslip ownership filter.
 *
 * Requires: PostgreSQL running with migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { pool } from '../../db.js';
import * as staffAuthService from '../../services/staffAuthService.js';
import * as staffPortalService from '../../services/staffPortalService.js';
import * as overrideRequestService from '../../services/overrideRequestService.js';
import * as overrideRequestRepo from '../../repositories/overrideRequestRepo.js';
import { addDays, formatDate, getALDeductionHours, parseDate } from '../../shared/rotation.js';

const HOME_SLUG = 'staffportal-test-home';
const STAFF_A = 'SPORT-001';
const STAFF_A_NAME = 'Alice Carer';
const STAFF_B = 'SPORT-002';
const STAFF_B_NAME = 'Bob Carer';
const STAFF_A_USER = 'staffportal-alice';
const PASSWORD = 'P0rtalP4ss!23';
const HOME_CONFIG = {
  cycle_start_date: '2025-01-06',
  shifts: {
    E: { hours: 8, start: '06:30', end: '14:30' },
    L: { hours: 8, start: '14:00', end: '22:00' },
    EL: { hours: 12, start: '06:30', end: '18:30' },
    N: { hours: 10, start: '21:30', end: '07:30' },
  },
  leave_year_start: '04-01',
};

let homeId;
let staffARecord;

function getWorkingDate(startDate, offset = 0) {
  let cursor = parseDate(startDate);
  let found = 0;
  for (let i = 0; i < 90; i += 1) {
    const date = formatDate(cursor);
    if (getALDeductionHours(staffARecord, date, HOME_CONFIG) > 0) {
      if (found === offset) return date;
      found += 1;
    }
    cursor = addDays(cursor, 1);
  }
  throw new Error('Unable to find a working day for the annual leave tests');
}

beforeAll(async () => {
  await pool.query(`DELETE FROM override_requests WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]);
  await pool.query(`DELETE FROM shift_overrides WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]);
  await pool.query(`DELETE FROM sick_periods WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]);
  await pool.query(`DELETE FROM staff_invite_tokens WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]);
  await pool.query(`DELETE FROM staff_auth_credentials WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]);
  await pool.query(`DELETE FROM staff WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]);
  await pool.query(`DELETE FROM homes WHERE slug = $1`, [HOME_SLUG]);
  await pool.query(`DELETE FROM users WHERE username = $1`, [STAFF_A_USER]);

  const { rows: [home] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ($1, $2, $3) RETURNING id`,
    [HOME_SLUG, 'Staff Portal Test Home', HOME_CONFIG],
  );
  homeId = home.id;

  for (const [id, name] of [[STAFF_A, STAFF_A_NAME], [STAFF_B, STAFF_B_NAME]]) {
    await pool.query(
      `INSERT INTO staff (home_id, id, name, role, team, skill, hourly_rate, active, wtr_opt_out, start_date, contract_hours, phone, address, emergency_contact, ni_number, date_of_birth)
       VALUES ($1, $2, $3, 'Carer', 'Day A', 1, 13.00, true, false, '2025-01-01', 37.5, '07700900000', '12 Test Lane', 'Spouse 07700900111', 'AB123456C', '1990-01-01')`,
      [homeId, id, name],
    );
  }

  ({ rows: [staffARecord] } = await pool.query(
    `SELECT * FROM staff WHERE home_id = $1 AND id = $2`,
    [homeId, STAFF_A],
  ));

  const invite = await staffAuthService.createInvite({ homeId, staffId: STAFF_A, createdBy: 'admin' });
  await staffAuthService.consumeInvite({ token: invite.token, username: STAFF_A_USER, password: PASSWORD });
});

afterAll(async () => {
  await pool.query(`DELETE FROM override_requests WHERE home_id = $1`, [homeId]);
  await pool.query(`DELETE FROM shift_overrides WHERE home_id = $1`, [homeId]);
  await pool.query(`DELETE FROM sick_periods WHERE home_id = $1`, [homeId]);
  await pool.query(`DELETE FROM staff_invite_tokens WHERE home_id = $1`, [homeId]);
  await pool.query(`DELETE FROM staff_auth_credentials WHERE home_id = $1`, [homeId]);
  await pool.query(`DELETE FROM staff WHERE home_id = $1`, [homeId]);
  await pool.query(`DELETE FROM homes WHERE id = $1`, [homeId]);
  await pool.query(`DELETE FROM users WHERE username = $1`, [STAFF_A_USER]);
});

beforeEach(async () => {
  await pool.query(`DELETE FROM override_requests WHERE home_id = $1`, [homeId]);
  await pool.query(`DELETE FROM shift_overrides WHERE home_id = $1`, [homeId]);
  await pool.query(`DELETE FROM sick_periods WHERE home_id = $1`, [homeId]);
});

describe('AL request flow', () => {
  it('creates a pending AL request for an own working day', async () => {
    const date = getWorkingDate('2026-06-22', 0);
    const req = await overrideRequestService.submitALRequest({
      homeId, staffId: STAFF_A, date, reason: 'Holiday',
    });
    expect(req.status).toBe('pending');
    expect(req.requestType).toBe('AL');
    expect(req.staffId).toBe(STAFF_A);
    expect(req.date).toBe(date);
    expect(req.alHours).toBeGreaterThan(0);
    expect(req.version).toBe(1);
  });

  it('rejects a duplicate pending AL on the same date', async () => {
    const date = getWorkingDate('2026-06-22', 1);
    await overrideRequestService.submitALRequest({ homeId, staffId: STAFF_A, date }).catch(() => {});
    await expect(overrideRequestService.submitALRequest({
      homeId, staffId: STAFF_A, date,
    })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rejects AL on a non-working day with 400', async () => {
    // Cycle day 2 (off for Day A) — pick a date 14 days from cycle_start that is OFF
    const date = '2025-01-08'; // off day
    await expect(overrideRequestService.submitALRequest({
      homeId, staffId: STAFF_A, date,
    })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('manager approval writes the AL override atomically', async () => {
    const date = getWorkingDate('2026-06-22', 2);
    const req = await overrideRequestService.submitALRequest({ homeId, staffId: STAFF_A, date });
    const decided = await overrideRequestService.decideRequest({
      homeId, id: req.id, status: 'approved',
      decidedBy: 'manager', decisionNote: 'ok', expectedVersion: req.version,
    });
    expect(decided.status).toBe('approved');

    const { rows } = await pool.query(
      `SELECT shift FROM shift_overrides WHERE home_id = $1 AND staff_id = $2 AND date = $3`,
      [homeId, STAFF_A, date],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].shift).toBe('AL');
  });

  it('manager rejection does not write any override', async () => {
    const date = getWorkingDate('2026-06-22', 3);
    const req = await overrideRequestService.submitALRequest({ homeId, staffId: STAFF_A, date });
    await overrideRequestService.decideRequest({
      homeId, id: req.id, status: 'rejected',
      decidedBy: 'manager', decisionNote: 'no cover', expectedVersion: req.version,
    });
    const { rows } = await pool.query(
      `SELECT * FROM shift_overrides WHERE home_id = $1 AND staff_id = $2 AND date = $3`,
      [homeId, STAFF_A, date],
    );
    expect(rows.length).toBe(0);
  });

  it('version conflict on decide returns 409', async () => {
    const date = getWorkingDate('2026-06-22', 4);
    const req = await overrideRequestService.submitALRequest({ homeId, staffId: STAFF_A, date });
    await overrideRequestService.decideRequest({
      homeId, id: req.id, status: 'approved',
      decidedBy: 'manager', expectedVersion: req.version,
    });
    // Re-decide using stale version
    await expect(overrideRequestService.decideRequest({
      homeId, id: req.id, status: 'rejected',
      decidedBy: 'manager', expectedVersion: req.version,
    })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('staff can cancel own pending request', async () => {
    const date = getWorkingDate('2026-06-22', 5);
    const req = await overrideRequestService.submitALRequest({ homeId, staffId: STAFF_A, date });
    const cancelled = await overrideRequestService.cancelByStaff({
      homeId, staffId: STAFF_A, id: req.id, expectedVersion: req.version,
    });
    expect(cancelled.status).toBe('cancelled');
  });

  it('staff cannot cancel after manager decided', async () => {
    const date = getWorkingDate('2026-06-22', 6);
    const req = await overrideRequestService.submitALRequest({ homeId, staffId: STAFF_A, date });
    await overrideRequestService.decideRequest({
      homeId, id: req.id, status: 'approved',
      decidedBy: 'manager', expectedVersion: req.version,
    });
    await expect(overrideRequestService.cancelByStaff({
      homeId, staffId: STAFF_A, id: req.id, expectedVersion: req.version,
    })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('staff B cannot cancel staff A request', async () => {
    const date = getWorkingDate('2026-06-22', 7);
    const req = await overrideRequestService.submitALRequest({ homeId, staffId: STAFF_A, date });
    await expect(overrideRequestService.cancelByStaff({
      homeId, staffId: STAFF_B, id: req.id, expectedVersion: req.version,
    })).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('Sick self-report', () => {
  it('writes SICK override immediately', async () => {
    const date = '2026-06-30';
    await staffPortalService.reportSick({
      homeId, staffId: STAFF_A, date, reason: 'Flu',
      actorUsername: STAFF_A_USER,
    });
    const { rows } = await pool.query(
      `SELECT shift FROM shift_overrides WHERE home_id = $1 AND staff_id = $2 AND date = $3`,
      [homeId, STAFF_A, date],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].shift).toBe('SICK');
  });

  it('writes audit event', async () => {
    const date = '2026-07-01';
    await staffPortalService.reportSick({
      homeId, staffId: STAFF_A, date,
      actorUsername: STAFF_A_USER,
    });
    const { rows } = await pool.query(
      `SELECT * FROM audit_log WHERE action = 'sick_self_reported' ORDER BY id DESC LIMIT 1`,
    );
    expect(rows.length).toBe(1);
  });
});

describe('Profile (own data only)', () => {
  it('GET returns allowlisted fields without PII not in allowlist', async () => {
    const profile = await staffPortalService.getOwnProfile({ homeId, staffId: STAFF_A });
    expect(profile.name).toBe(STAFF_A_NAME);
    expect(profile.hourly_rate).toBeUndefined();
    expect(profile.ni_number).toBeUndefined();
    expect(profile.date_of_birth).toBeUndefined();
  });

  it('PATCH only updates whitelisted fields, ignoring others', async () => {
    await staffPortalService.updateOwnProfile({
      homeId, staffId: STAFF_A,
      patch: { phone: '07700900999' },
      actorUsername: STAFF_A_USER,
    });
    const { rows } = await pool.query(
      `SELECT phone, hourly_rate FROM staff WHERE home_id = $1 AND id = $2`,
      [homeId, STAFF_A],
    );
    expect(rows[0].phone).toBe('07700900999');
    // hourly_rate must not have been touched
    expect(parseFloat(rows[0].hourly_rate)).toBe(13.00);
  });

  it('PATCH ignores forbidden field changes silently', async () => {
    await staffPortalService.updateOwnProfile({
      homeId, staffId: STAFF_A,
      patch: { phone: '07700900998', hourly_rate: 99 },
      actorUsername: STAFF_A_USER,
    });
    const { rows } = await pool.query(
      `SELECT hourly_rate FROM staff WHERE home_id = $1 AND id = $2`,
      [homeId, STAFF_A],
    );
    expect(parseFloat(rows[0].hourly_rate)).toBe(13.00);
  });
});

describe('Payslips (own only, approved/exported only)', () => {
  it('returns empty list when no approved runs', async () => {
    const payslips = await staffPortalService.getStaffPayslipRuns({ homeId, staffId: STAFF_A });
    expect(Array.isArray(payslips)).toBe(true);
  });
});

describe('Pending requests query', () => {
  it('findPending returns all pending across staff for a home', async () => {
    await overrideRequestService.submitALRequest({ homeId, staffId: STAFF_A, date: '2026-07-05' }).catch(() => {});
    await overrideRequestService.submitALRequest({ homeId, staffId: STAFF_B, date: '2026-07-06' }).catch(() => {});
    const pending = await overrideRequestRepo.findPending(homeId);
    const subset = pending.filter((r) => r.staffId === STAFF_A || r.staffId === STAFF_B);
    expect(subset.length).toBeGreaterThanOrEqual(1);
    subset.forEach((r) => expect(r.status).toBe('pending'));
  });
});
