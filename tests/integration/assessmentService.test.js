import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../db.js';
import { computeSnapshot } from '../../services/assessmentService.js';
import { MOCK_CONFIG } from '../../src/test/fixtures/schedulingData.js';

let homeId;

beforeAll(async () => {
  await pool.query(`DELETE FROM cqc_statement_narratives WHERE home_id IN (SELECT id FROM homes WHERE slug = 'assess-ready-home')`).catch(() => {});
  await pool.query(`DELETE FROM cqc_evidence WHERE home_id IN (SELECT id FROM homes WHERE slug = 'assess-ready-home')`).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug = 'assess-ready-home'`).catch(() => {});

  const { rows: [home] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ('assess-ready-home', 'Assessment Ready Home', $1) RETURNING id`,
    [JSON.stringify(MOCK_CONFIG)]
  );
  homeId = home.id;

  await pool.query(
    `INSERT INTO cqc_evidence (
       id, home_id, quality_statement, type, title, description,
       date_from, evidence_category, evidence_owner, review_due, added_by, added_at
     ) VALUES ($1,$2,'S1','qualitative','Learning review','Weekly learning review',
       '2026-03-01','processes','Deputy Manager','2026-06-01','admin','2026-03-02T09:00:00Z')`,
    ['snap-ev-1', homeId]
  );

  await pool.query(
    `INSERT INTO cqc_statement_narratives (
       home_id, quality_statement, narrative, risks, actions, reviewed_by, reviewed_at, review_due
     ) VALUES ($1,'S1','Evidence shows learning from incidents','Handover consistency','Refresh handover prompts','admin','2026-04-10T09:00:00Z','2026-07-10')`,
    [homeId]
  );
});

afterAll(async () => {
  if (homeId) {
    await pool.query('DELETE FROM cqc_statement_narratives WHERE home_id = $1', [homeId]).catch(() => {});
    await pool.query('DELETE FROM cqc_evidence WHERE home_id = $1', [homeId]).catch(() => {});
    await pool.query('DELETE FROM homes WHERE id = $1', [homeId]).catch(() => {});
  }
});

describe('assessmentService readiness snapshots', () => {
  it('includes readiness payload in computed CQC snapshots', async () => {
    const snapshot = await computeSnapshot(homeId, 'cqc', '2026-03-01', '2026-03-31');

    expect(snapshot).not.toBeNull();
    expect(snapshot.result.readiness).toBeTruthy();
    expect(Array.isArray(snapshot.result.readiness.entries)).toBe(true);
    expect(snapshot.result.readiness.overall).toBeTruthy();

    const s1 = snapshot.result.readiness.entries.find((entry) => entry.statementId === 'S1');
    expect(s1).toBeTruthy();
    expect(s1.narrativePresent).toBe(true);
  });
});
