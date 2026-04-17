import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../../db.js';
import * as hrRepo from '../../repositories/hrRepo.js';

let homeId;
const staffId = 'perf-test-01';
const createdIds = [];

beforeAll(async () => {
  await pool.query(`DELETE FROM hr_performance_cases WHERE home_id IN (SELECT id FROM homes WHERE slug = 'perf-test-home')`).catch(() => {});
  await pool.query(`DELETE FROM staff WHERE id = $1`, [staffId]).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug = 'perf-test-home'`).catch(() => {});

  const { rows: [home] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('perf-test-home', 'Performance Test Home') RETURNING id`
  );
  homeId = home.id;

  await pool.query(
    `INSERT INTO staff (id, home_id, name, role, team, skill, hourly_rate, active, wtr_opt_out, start_date)
     VALUES ($1, $2, 'Performance Test Staff', 'Carer', 'Day A', 1, 13.00, true, false, '2026-01-01')`,
    [staffId, homeId]
  );
});

afterAll(async () => {
  for (const id of createdIds) {
    await pool.query('DELETE FROM hr_performance_cases WHERE id = $1', [id]).catch(() => {});
  }
  await pool.query('DELETE FROM staff WHERE id = $1', [staffId]).catch(() => {});
  if (homeId) await pool.query('DELETE FROM homes WHERE id = $1', [homeId]).catch(() => {});
});

describe('Performance cases: audit timestamps', () => {
  it('updates updated_at when a performance case changes', async () => {
    const created = await hrRepo.createPerformance(homeId, {
      staff_id: staffId,
      type: 'capability',
      date_raised: '2026-04-01',
      raised_by: 'Manager',
      concern_summary: 'Initial concern',
      performance_area: 'communication',
      status: 'open',
      created_by: 'test-suite',
    });
    createdIds.push(created.id);

    const before = await hrRepo.findPerformanceById(created.id, homeId);
    const updated = await hrRepo.updatePerformance(created.id, homeId, {
      informal_discussion_notes: 'Coaching started',
      status: 'informal',
    }, null, before.version);

    expect(updated.version).toBe(before.version + 1);
    expect(updated.status).toBe('informal');
    expect(updated.updated_at).not.toBe(before.updated_at);
  });
});
