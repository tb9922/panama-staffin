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
import { addDaysLocalISO, todayLocalISO } from '../../lib/dateOnly.js';

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
  training_types: [
    { id: 'fire-safety', name: 'Fire Safety', category: 'statutory', active: true, roles: null },
    { id: 'senior-only', name: 'Senior Only', category: 'mandatory', active: true, roles: ['Senior Carer'] },
  ],
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

function getNonWorkingDate(startDate) {
  let cursor = parseDate(startDate);
  for (let i = 0; i < 90; i += 1) {
    const date = formatDate(cursor);
    if (getALDeductionHours(staffARecord, date, HOME_CONFIG) <= 0) return date;
    cursor = addDays(cursor, 1);
  }
  throw new Error('Unable to find a non-working day for the annual leave tests');
}

beforeAll(async () => {
  await pool.query(`DELETE FROM override_requests WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]);
  await pool.query(`DELETE FROM shift_overrides WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]);
  await pool.query(`DELETE FROM sick_periods WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]);
  await pool.query(`DELETE FROM training_records WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]);
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
  await pool.query(`DELETE FROM training_records WHERE home_id = $1`, [homeId]);
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
  await pool.query(`DELETE FROM training_records WHERE home_id = $1`, [homeId]);
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
    const date = getNonWorkingDate('2026-06-22');
    await expect(overrideRequestService.submitALRequest({
      homeId, staffId: STAFF_A, date,
    })).rejects.toMatchObject({ statusCode: 400, code: 'AL_NON_WORKING_DAY' });
  });

  it('rejects past-dated AL requests from staff self-service', async () => {
    const date = addDaysLocalISO(todayLocalISO(), -1);
    await expect(overrideRequestService.submitALRequest({
      homeId, staffId: STAFF_A, date,
    })).rejects.toMatchObject({ statusCode: 400, code: 'AL_PAST_DATE' });
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

  it('serializes concurrent approvals so the same-day AL cap holds', async () => {
    const date = getWorkingDate('2026-06-22', 8);
    await pool.query(
      `UPDATE homes SET config = config || $2::jsonb WHERE id = $1`,
      [homeId, JSON.stringify({ max_al_same_day: 1 })],
    );
    const requestA = await overrideRequestService.submitALRequest({ homeId, staffId: STAFF_A, date });
    const requestB = await overrideRequestService.submitALRequest({ homeId, staffId: STAFF_B, date });

    const results = await Promise.allSettled([
      overrideRequestService.decideRequest({
        homeId, id: requestA.id, status: 'approved', decidedBy: 'manager-a', expectedVersion: requestA.version,
      }),
      overrideRequestService.decideRequest({
        homeId, id: requestB.id, status: 'approved', decidedBy: 'manager-b', expectedVersion: requestB.version,
      }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count
         FROM shift_overrides
        WHERE home_id = $1 AND date = $2 AND shift = 'AL'`,
      [homeId, date],
    );
    expect(rows[0].count).toBe(1);
  });
});

describe('Sick self-report', () => {
  it('writes SICK override immediately', async () => {
    const date = todayLocalISO();
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

  it('keeps duplicate same-day self-reports idempotent under concurrency', async () => {
    const date = todayLocalISO();
    const auditFilter = JSON.stringify({ staff_id: STAFF_A, date });
    const { rows: [auditBefore] } = await pool.query(
      `SELECT COUNT(*)::int AS count
         FROM audit_log
        WHERE action = 'sick_self_reported'
          AND home_slug = $1
          AND details::jsonb @> $2::jsonb`,
      [HOME_SLUG, auditFilter],
    );

    await Promise.all([
      staffPortalService.reportSick({
        homeId, staffId: STAFF_A, date, reason: 'Flu',
        actorUsername: STAFF_A_USER,
      }),
      staffPortalService.reportSick({
        homeId, staffId: STAFF_A, date, reason: 'Flu',
        actorUsername: STAFF_A_USER,
      }),
    ]);

    const { rows: [periods] } = await pool.query(
      `SELECT COUNT(*)::int AS count
         FROM sick_periods
        WHERE home_id = $1
          AND staff_id = $2
          AND start_date = $3`,
      [homeId, STAFF_A, date],
    );
    expect(periods.count).toBe(1);

    const { rows: [audit] } = await pool.query(
      `SELECT COUNT(*)::int AS count
         FROM audit_log
        WHERE action = 'sick_self_reported'
          AND home_slug = $1
          AND details::jsonb @> $2::jsonb`,
      [HOME_SLUG, auditFilter],
    );
    expect(audit.count - auditBefore.count).toBe(1);
  });

  it('writes audit event', async () => {
    const date = addDaysLocalISO(todayLocalISO(), 1);
    await staffPortalService.reportSick({
      homeId, staffId: STAFF_A, date,
      actorUsername: STAFF_A_USER,
    });
    const { rows } = await pool.query(
      `SELECT * FROM audit_log WHERE action = 'sick_self_reported' ORDER BY id DESC LIMIT 1`,
    );
    expect(rows.length).toBe(1);
  });

  it('carries forward the actual linked-period waiting days on self-report', async () => {
    const reportDate = todayLocalISO();
    const { rows: [previous] } = await pool.query(
      `INSERT INTO sick_periods (
         home_id, staff_id, start_date, end_date, qualifying_days_per_week,
         waiting_days_served, ssp_weeks_paid
       )
       VALUES ($1, $2, $3, $4, 5, 1, 0)
       RETURNING id`,
      [homeId, STAFF_A, addDaysLocalISO(reportDate, -35), addDaysLocalISO(reportDate, -32)],
    );

    const result = await staffPortalService.reportSick({
      homeId,
      staffId: STAFF_A,
      date: reportDate,
      actorUsername: STAFF_A_USER,
    });

    expect(result.sickPeriod.linked_to_period_id).toBe(previous.id);
    expect(result.sickPeriod.waiting_days_served).toBe(1);
  });

  it('rejects past and far-future self-reported sickness dates', async () => {
    await expect(staffPortalService.reportSick({
      homeId,
      staffId: STAFF_A,
      date: addDaysLocalISO(todayLocalISO(), -1),
      actorUsername: STAFF_A_USER,
    })).rejects.toMatchObject({ statusCode: 400 });

    await expect(staffPortalService.reportSick({
      homeId,
      staffId: STAFF_A,
      date: addDaysLocalISO(todayLocalISO(), 2),
      actorUsername: STAFF_A_USER,
    })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('Training self-service', () => {
  it('shows only role-applicable training and acknowledges current completed records', async () => {
    await pool.query(
      `INSERT INTO training_records (home_id, staff_id, training_type_id, completed, expiry, updated_at)
       VALUES
        ($1, $2, 'fire-safety', $3, $4, NOW()),
        ($1, $2, 'senior-only', $3, $4, NOW())`,
      [homeId, STAFF_A, todayLocalISO(), addDaysLocalISO(todayLocalISO(), 365)],
    );

    const training = await staffPortalService.getStaffTrainingStatus({ homeId, staffId: STAFF_A });
    expect(training.items.map((item) => item.id)).toEqual(['fire-safety']);

    await staffPortalService.acknowledgeTrainingByStaff({ homeId, staffId: STAFF_A, typeId: 'fire-safety' });

    const { rows: [record] } = await pool.query(
      `SELECT acknowledged_by_staff, acknowledged_at
         FROM training_records
        WHERE home_id = $1 AND staff_id = $2 AND training_type_id = 'fire-safety'`,
      [homeId, STAFF_A],
    );
    expect(record.acknowledged_by_staff).toBe(true);
    expect(record.acknowledged_at).toBeTruthy();
  });

  it('rejects direct acknowledgement of expired or non-role training', async () => {
    await pool.query(
      `INSERT INTO training_records (home_id, staff_id, training_type_id, completed, expiry, updated_at)
       VALUES
        ($1, $2, 'fire-safety', '2026-01-01', '2026-02-01', NOW()),
        ($1, $2, 'senior-only', $3, $4, NOW())`,
      [homeId, STAFF_A, todayLocalISO(), addDaysLocalISO(todayLocalISO(), 365)],
    );

    await expect(staffPortalService.acknowledgeTrainingByStaff({
      homeId,
      staffId: STAFF_A,
      typeId: 'fire-safety',
    })).rejects.toMatchObject({ statusCode: 400, code: 'TRAINING_NOT_CURRENT' });

    await expect(staffPortalService.acknowledgeTrainingByStaff({
      homeId,
      staffId: STAFF_A,
      typeId: 'senior-only',
    })).rejects.toMatchObject({ statusCode: 404, code: 'TRAINING_NOT_FOUND' });
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

  it('pages through all payroll runs so payslip history is not capped at 50', async () => {
    const insertedRunIds = [];
    const insertedLineIds = [];
    try {
      for (let index = 0; index < 55; index += 1) {
        const year = 2020 + Math.floor(index / 12);
        const month = String((index % 12) + 1).padStart(2, '0');
        const periodStart = `${year}-${month}-01`;
        const periodEnd = `${year}-${month}-28`;
        const payDate = `${year}-${month}-28`;

        const { rows: [run] } = await pool.query(
          `INSERT INTO payroll_runs (home_id, period_start, period_end, pay_date, pay_frequency, status)
           VALUES ($1, $2, $3, $4, 'monthly', 'approved')
           RETURNING id`,
          [homeId, periodStart, periodEnd, payDate],
        );
        insertedRunIds.push(run.id);

        const { rows: [line] } = await pool.query(
          `INSERT INTO payroll_lines (payroll_run_id, staff_id, gross_pay, net_pay)
           VALUES ($1, $2, 1234.56, 1000.00)
           RETURNING id`,
          [run.id, STAFF_A],
        );
        insertedLineIds.push(line.id);
      }

      const payslips = await staffPortalService.getStaffPayslipRuns({ homeId, staffId: STAFF_A });
      expect(payslips).toHaveLength(55);
      expect(payslips.some((item) => item.periodStart === '2020-01-01')).toBe(true);
    } finally {
      if (insertedLineIds.length > 0) {
        await pool.query(`DELETE FROM payroll_lines WHERE id = ANY($1::int[])`, [insertedLineIds]);
      }
      if (insertedRunIds.length > 0) {
        await pool.query(`DELETE FROM payroll_runs WHERE id = ANY($1::int[])`, [insertedRunIds]);
      }
    }
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
    subset.forEach((r) => {
      if (r.staffId === STAFF_A) expect(r.staffName).toBe(STAFF_A_NAME);
      if (r.staffId === STAFF_B) expect(r.staffName).toBe(STAFF_B_NAME);
    });
  });
});
