/**
 * Integration tests for GPS clock-in (C4).
 *
 * Covers: haversine within/outside geofence, accuracy boundary tolerance,
 * manual fallback when GPS missing, paired in/out → timesheet feed,
 * orphan-out detection (no matching in → no timesheet), audit log entry.
 *
 * Requires: PostgreSQL running with migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { pool } from '../../db.js';
import * as clockInService from '../../services/clockInService.js';
import * as clockInRepo from '../../repositories/clockInRepo.js';

const HOME_SLUG = 'clockin-test-home';
const STAFF_ID = 'CLOCK-001';
const STAFF_NAME = 'Alice Carer';
const HOME_LAT = 51.5074;
const HOME_LNG = -0.1278;
const HOME_RADIUS_M = 150;

let homeId;

beforeAll(async () => {
  await pool.query(`DELETE FROM clock_ins WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]);
  await pool.query(`DELETE FROM timesheets WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]);
  await pool.query(`DELETE FROM staff WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]);
  await pool.query(`DELETE FROM homes WHERE slug = $1`, [HOME_SLUG]);

  const { rows: [home] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ($1, $2, $3) RETURNING id`,
    [HOME_SLUG, 'Clock-In Test Home', {
      cycle_start_date: '2025-01-06',
      shifts: { E: { hours: 8, start: '06:30', end: '14:30' }, L: { hours: 8, start: '14:00', end: '22:00' }, EL: { hours: 12, start: '06:30', end: '18:30' }, N: { hours: 10, start: '21:30', end: '07:30' } },
      geofence_lat: HOME_LAT,
      geofence_lng: HOME_LNG,
      geofence_radius_m: HOME_RADIUS_M,
      clock_in_early_min: 30,
      clock_in_late_min: 30,
      clock_in_required: false,
    }],
  );
  homeId = home.id;

  await pool.query(
    `INSERT INTO staff (home_id, id, name, role, team, skill, hourly_rate, active, wtr_opt_out, start_date, contract_hours)
     VALUES ($1, $2, $3, 'Carer', 'Day A', 1, 13.00, true, false, '2025-01-01', 37.5)`,
    [homeId, STAFF_ID, STAFF_NAME],
  );
});

afterAll(async () => {
  await pool.query(`DELETE FROM clock_ins WHERE home_id = $1`, [homeId]);
  await pool.query(`DELETE FROM timesheets WHERE home_id = $1`, [homeId]);
  await pool.query(`DELETE FROM staff WHERE home_id = $1`, [homeId]);
  await pool.query(`DELETE FROM homes WHERE id = $1`, [homeId]);
});

beforeEach(async () => {
  await pool.query(`DELETE FROM clock_ins WHERE home_id = $1`, [homeId]);
  await pool.query(`DELETE FROM timesheets WHERE home_id = $1`, [homeId]);
});

describe('Geofence boundary math', () => {
  it('records within-geofence with small accuracy', async () => {
    // ~55m offset (well inside 150m radius)
    const result = await clockInService.recordClockIn({
      homeId, staffId: STAFF_ID,
      payload: {
        clockType: 'in',
        lat: HOME_LAT + 0.0005,
        lng: HOME_LNG,
        accuracyM: 20,
        clientTime: new Date().toISOString(),
      },
    });
    expect(result.withinGeofence).toBe(true);
    expect(result.distanceM).toBeLessThan(HOME_RADIUS_M);
    expect(result.source).toBe('gps');
  });

  it('records as outside-geofence when far away', async () => {
    // ~1.1km offset
    const result = await clockInService.recordClockIn({
      homeId, staffId: STAFF_ID,
      payload: {
        clockType: 'in',
        lat: HOME_LAT + 0.01,
        lng: HOME_LNG,
        accuracyM: 20,
      },
    });
    expect(result.withinGeofence).toBe(false);
    expect(result.autoApproved).toBe(false);
  });

  it('accuracy is added to radius — 145m + 30m accuracy passes (boundary)', async () => {
    // ~145m offset (just inside) with 30m accuracy → within = (145 <= 150 + 30) = true
    const result = await clockInService.recordClockIn({
      homeId, staffId: STAFF_ID,
      payload: {
        clockType: 'in',
        lat: HOME_LAT + 0.0013,
        lng: HOME_LNG,
        accuracyM: 30,
      },
    });
    expect(result.withinGeofence).toBe(true);
  });

  it('flags as manual when no GPS coords supplied', async () => {
    const result = await clockInService.recordClockIn({
      homeId, staffId: STAFF_ID,
      payload: { clockType: 'in', lat: null, lng: null, accuracyM: null },
    });
    expect(result.source).toBe('manual');
    expect(result.autoApproved).toBe(false);
  });

  it('rejects clock-in for inactive staff', async () => {
    await pool.query(`UPDATE staff SET active = false WHERE home_id = $1 AND id = $2`, [homeId, STAFF_ID]);
    await expect(clockInService.recordClockIn({
      homeId, staffId: STAFF_ID,
      payload: { clockType: 'in', lat: HOME_LAT, lng: HOME_LNG, accuracyM: 10 },
    })).rejects.toMatchObject({ statusCode: 404 });
    await pool.query(`UPDATE staff SET active = true WHERE home_id = $1 AND id = $2`, [homeId, STAFF_ID]);
  });
});

describe('Audit + state', () => {
  it('writes a clock_in_recorded audit entry', async () => {
    await clockInService.recordClockIn({
      homeId, staffId: STAFF_ID,
      payload: { clockType: 'in', lat: HOME_LAT, lng: HOME_LNG, accuracyM: 10 },
    });
    const { rows } = await pool.query(
      `SELECT * FROM audit_log WHERE event_type = 'clock_in_recorded' ORDER BY id DESC LIMIT 1`,
    );
    expect(rows.length).toBe(1);
  });

  it('getOwnClockState returns nextAction=in when no clock', async () => {
    const state = await clockInService.getOwnClockState({ homeId, staffId: STAFF_ID });
    expect(state.nextAction).toBe('in');
    expect(state.lastClock).toBeNull();
  });
});

describe('Pairing in/out → timesheet feed', () => {
  it('paired in then out (both approved) creates a timesheet row', async () => {
    // Create + approve an in record manually so we don't depend on auto-approval shift-window logic
    const today = new Date().toISOString().slice(0, 10);
    const inRow = await clockInRepo.create({
      homeId, staffId: STAFF_ID, clockType: 'in', clientTime: null,
      lat: HOME_LAT, lng: HOME_LNG, accuracyM: 10, distanceM: 0,
      withinGeofence: true, source: 'gps', shiftDate: today,
      expectedShift: null, note: null,
    });
    await clockInRepo.approve({ homeId, id: inRow.id, approvedBy: 'system' });
    // Insert out record 8 hours later
    await pool.query(
      `INSERT INTO clock_ins (home_id, staff_id, clock_type, server_time, lat, lng, accuracy_m, distance_m, within_geofence, source, shift_date, expected_shift)
       VALUES ($1, $2, 'out', NOW() + INTERVAL '8 hours', $3, $4, 10, 0, true, 'gps', $5, NULL)`,
      [homeId, STAFF_ID, HOME_LAT, HOME_LNG, today],
    );
    const { rows: [outRow] } = await pool.query(
      `SELECT id FROM clock_ins WHERE home_id = $1 AND staff_id = $2 AND clock_type = 'out' ORDER BY id DESC LIMIT 1`,
      [homeId, STAFF_ID],
    );
    await clockInService.approveClockIn({
      homeId, id: outRow.id, approvedBy: 'manager', note: null,
    });

    const { rows: tsRows } = await pool.query(
      `SELECT * FROM timesheets WHERE home_id = $1 AND staff_id = $2 AND date = $3`,
      [homeId, STAFF_ID, today],
    );
    expect(tsRows.length).toBe(1);
    expect(parseFloat(tsRows[0].payable_hours)).toBeCloseTo(8, 1);
  });

  it('orphan out (no matching in) does not create a timesheet', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await pool.query(
      `INSERT INTO clock_ins (home_id, staff_id, clock_type, server_time, lat, lng, accuracy_m, distance_m, within_geofence, source, shift_date, expected_shift)
       VALUES ($1, $2, 'out', NOW(), $3, $4, 10, 0, true, 'gps', $5, NULL)`,
      [homeId, STAFF_ID, HOME_LAT, HOME_LNG, today],
    );
    const { rows: [outRow] } = await pool.query(
      `SELECT id FROM clock_ins WHERE home_id = $1 AND staff_id = $2 AND clock_type = 'out' ORDER BY id DESC LIMIT 1`,
      [homeId, STAFF_ID],
    );
    await clockInService.approveClockIn({
      homeId, id: outRow.id, approvedBy: 'manager', note: null,
    });
    const { rows } = await pool.query(
      `SELECT * FROM timesheets WHERE home_id = $1 AND staff_id = $2 AND date = $3`,
      [homeId, STAFF_ID, today],
    );
    expect(rows.length).toBe(0);
  });
});

describe('Manual clock-in (manager-recorded)', () => {
  it('writes a manual record with note', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const record = await clockInService.manualClockIn({
      homeId, staffId: STAFF_ID, clockType: 'in', shiftDate: today,
      note: 'Off-site community visit', actor: 'manager',
    });
    expect(record.source).toBe('manual');
    expect(record.note).toBe('Off-site community visit');
    expect(record.lat).toBeNull();
  });

  it('writes a clock_in_manual audit entry', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await clockInService.manualClockIn({
      homeId, staffId: STAFF_ID, clockType: 'in', shiftDate: today,
      note: 'Test', actor: 'manager',
    });
    const { rows } = await pool.query(
      `SELECT * FROM audit_log WHERE event_type = 'clock_in_manual' ORDER BY id DESC LIMIT 1`,
    );
    expect(rows.length).toBe(1);
  });
});

describe('Approve flow', () => {
  it('rejects approving a non-existent clock-in', async () => {
    await expect(clockInService.approveClockIn({
      homeId, id: 999_999, approvedBy: 'manager',
    })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects double-approval', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const record = await clockInService.manualClockIn({
      homeId, staffId: STAFF_ID, clockType: 'in', shiftDate: today,
      note: 'Test', actor: 'manager',
    });
    await clockInService.approveClockIn({ homeId, id: record.id, approvedBy: 'manager' });
    await expect(clockInService.approveClockIn({
      homeId, id: record.id, approvedBy: 'manager',
    })).rejects.toMatchObject({ statusCode: 404 });
  });
});
