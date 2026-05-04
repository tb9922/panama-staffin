import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../db.js';
import * as timesheetRepo from '../../repositories/timesheetRepo.js';

let homeId;

function makeEntry(overrides = {}) {
  return {
    staff_id: 'TSI01',
    date: '2099-08-01',
    scheduled_start: '07:00',
    scheduled_end: '15:00',
    actual_start: '07:00',
    actual_end: '15:00',
    break_minutes: 30,
    payable_hours: 7.5,
    notes: 'original hours',
    ...overrides,
  };
}

beforeAll(async () => {
  await pool.query(`DELETE FROM timesheet_entries WHERE home_id IN (SELECT id FROM homes WHERE slug = 'timesheet-integrity-test')`).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug = 'timesheet-integrity-test'`).catch(() => {});
  const { rows: [home] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('timesheet-integrity-test', 'Timesheet Integrity Test') RETURNING id`,
  );
  homeId = home.id;
});

afterAll(async () => {
  if (homeId) await pool.query('DELETE FROM timesheet_entries WHERE home_id = $1', [homeId]).catch(() => {});
  if (homeId) await pool.query('DELETE FROM homes WHERE id = $1', [homeId]).catch(() => {});
});

describe('timesheetRepo immutability', () => {
  it('does not mutate an approved timesheet through upsert or status replay', async () => {
    const created = await timesheetRepo.upsert(homeId, makeEntry());
    const approved = await timesheetRepo.approve(created.id, homeId, 'manager-a');

    const replay = await timesheetRepo.upsert(homeId, makeEntry({
      actual_start: '09:00',
      payable_hours: 3,
      notes: 'changed after approval',
    }));

    expect(replay.id).toBe(created.id);
    expect(replay.status).toBe('approved');
    expect(replay.actual_start).toBe('07:00');
    expect(replay.payable_hours).toBe(7.5);
    expect(replay.notes).toBe('original hours');
    expect(await timesheetRepo.approve(created.id, homeId, 'manager-b')).toBeNull();
    expect(await timesheetRepo.dispute(created.id, homeId, 'late dispute')).toBeNull();

    const found = await timesheetRepo.findByStaffDate(homeId, 'TSI01', '2099-08-01');
    expect(found.approved_by).toBe('manager-a');
    expect(found.approved_at).toBe(approved.approved_at);
  });

  it('does not mutate a locked timesheet through single or bulk upsert', async () => {
    const created = await timesheetRepo.upsert(homeId, makeEntry({
      staff_id: 'TSI02',
      date: '2099-08-02',
      payable_hours: 8,
      notes: 'locked original',
    }));
    await timesheetRepo.approve(created.id, homeId, 'manager-a');
    await timesheetRepo.lockByPeriod(homeId, '2099-08-02', '2099-08-02');

    const singleReplay = await timesheetRepo.upsert(homeId, makeEntry({
      staff_id: 'TSI02',
      date: '2099-08-02',
      actual_start: '10:00',
      payable_hours: 2,
      notes: 'changed after lock',
    }));
    const bulkReplay = await timesheetRepo.bulkUpsert(homeId, [
      makeEntry({
        staff_id: 'TSI02',
        date: '2099-08-02',
        actual_start: '11:00',
        payable_hours: 1,
        notes: 'changed in bulk',
      }),
    ]);

    expect(singleReplay.status).toBe('locked');
    expect(singleReplay.actual_start).toBe('07:00');
    expect(singleReplay.payable_hours).toBe(8);
    expect(singleReplay.notes).toBe('locked original');
    expect(bulkReplay).toHaveLength(1);
    expect(bulkReplay[0].status).toBe('locked');
    expect(bulkReplay[0].payable_hours).toBe(8);

    const found = await timesheetRepo.findByStaffDate(homeId, 'TSI02', '2099-08-02');
    expect(found.actual_start).toBe('07:00');
    expect(found.notes).toBe('locked original');
  });
});
