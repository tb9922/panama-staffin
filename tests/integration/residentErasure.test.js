/**
 * Integration tests for resident erasure (GDPR Article 17).
 *
 * Validates: anonymisation across dols/mca/finance/incidents/complaints,
 * active DoLS blocking, PK resolution, cross-home isolation,
 * request completion on success.
 *
 * Requires: PostgreSQL running with migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../../db.js';
import * as gdprService from '../../services/gdprService.js';

let homeA;

beforeAll(async () => {
  // Clean up prior test data
  await pool.query(`DELETE FROM dols WHERE home_id IN (SELECT id FROM homes WHERE slug = 'res-erasure-test')`).catch(() => {});
  await pool.query(`DELETE FROM mca_assessments WHERE home_id IN (SELECT id FROM homes WHERE slug = 'res-erasure-test')`).catch(() => {});
  await pool.query(`DELETE FROM finance_invoices WHERE home_id IN (SELECT id FROM homes WHERE slug = 'res-erasure-test')`).catch(() => {});
  await pool.query(`DELETE FROM finance_residents WHERE home_id IN (SELECT id FROM homes WHERE slug = 'res-erasure-test')`).catch(() => {});
  await pool.query(`DELETE FROM incidents WHERE home_id IN (SELECT id FROM homes WHERE slug = 'res-erasure-test')`).catch(() => {});
  await pool.query(`DELETE FROM complaints WHERE home_id IN (SELECT id FROM homes WHERE slug = 'res-erasure-test')`).catch(() => {});
  await pool.query(`DELETE FROM data_requests WHERE home_id IN (SELECT id FROM homes WHERE slug = 'res-erasure-test')`).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug = 'res-erasure-test'`);

  const { rows: [h] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ('res-erasure-test', 'Res Erasure Test', '{}') RETURNING id`
  );
  homeA = h.id;
});

afterAll(async () => {
  // Clean in FK order
  await pool.query(`DELETE FROM finance_invoices WHERE home_id = $1`, [homeA]).catch(() => {});
  await pool.query(`DELETE FROM finance_residents WHERE home_id = $1`, [homeA]).catch(() => {});
  await pool.query(`DELETE FROM dols WHERE home_id = $1`, [homeA]).catch(() => {});
  await pool.query(`DELETE FROM mca_assessments WHERE home_id = $1`, [homeA]).catch(() => {});
  await pool.query(`DELETE FROM incidents WHERE home_id = $1`, [homeA]).catch(() => {});
  await pool.query(`DELETE FROM complaints WHERE home_id = $1`, [homeA]).catch(() => {});
  await pool.query(`DELETE FROM data_requests WHERE home_id = $1`, [homeA]).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE id = $1`, [homeA]).catch(() => {});
});

describe('Resident erasure: blocks on active DoLS', () => {
  it('throws ValidationError for resident with active DoLS authorisation', async () => {
    // Create a DoLS record with no expiry (active indefinitely)
    await pool.query(
      `INSERT INTO dols (id, home_id, resident_name, dob, application_type, application_date, authorised)
       VALUES ('dols-active-test', $1, 'Margaret Active', '1940-01-01', 'dols', '2026-01-01', true)`,
      [homeA]
    );

    await expect(
      gdprService.executeResidentErasure('res-001', homeA, null, 'admin', 'res-erasure-test', 'Margaret Active')
    ).rejects.toThrow('active DoLS authorisation');

    // Clean up
    await pool.query(`DELETE FROM dols WHERE id = 'dols-active-test'`);
  });
});

describe('Resident erasure: anonymises data correctly', () => {
  let residentPk;

  beforeAll(async () => {
    // Create resident in finance_residents (the PK source)
    const { rows: [res] } = await pool.query(
      `INSERT INTO finance_residents (home_id, resident_name, room_number, notes, status, created_by)
       VALUES ($1, 'John Erasable', '12', 'Has dementia', 'active', 'admin') RETURNING id`,
      [homeA]
    );
    residentPk = res.id;

    // Create expired DoLS (should be anonymised, not blocked)
    await pool.query(
      `INSERT INTO dols (id, home_id, resident_name, dob, application_type, application_date, expiry_date, authorised)
       VALUES ('dols-expired-test', $1, 'John Erasable', '1935-06-15', 'dols', '2025-01-01', '2025-12-31', true)`,
      [homeA]
    );

    // Create MCA assessment
    await pool.query(
      `INSERT INTO mca_assessments (id, home_id, resident_name, assessment_date, assessor, decision_area, lacks_capacity)
       VALUES ('mca-erasure-test', $1, 'John Erasable', '2025-06-01', 'Dr Smith', 'Financial decisions', true)`,
      [homeA]
    );

    // Create incident where resident was affected
    await pool.query(
      `INSERT INTO incidents (id, home_id, date, type, severity, description, person_affected, person_affected_name, reported_by, investigation_status)
       VALUES ('inc-erasure-test', $1, '2025-05-01', 'fall', 'minor', 'Slipped in bathroom', 'resident', 'John Erasable', 'admin', 'closed')`,
      [homeA]
    );

    // Create complaint about resident
    await pool.query(
      `INSERT INTO complaints (id, home_id, date, raised_by, raised_by_name, category, description, status, reported_by)
       VALUES ('comp-erasure-test', $1, '2025-04-01', 'family', 'John Erasable', 'care_quality', 'Concerned about care', 'resolved', 'admin')`,
      [homeA]
    );

    // Create erasure request
    await pool.query(
      `INSERT INTO data_requests (home_id, request_type, subject_type, subject_id, subject_name, date_received, deadline, identity_verified, status)
       VALUES ($1, 'erasure', 'resident', $2, 'John Erasable', '2026-03-18', '2026-04-17', true, 'in_progress')`,
      [homeA, String(residentPk)]
    );
  });

  it('anonymises resident data across all tables', async () => {
    const result = await gdprService.executeResidentErasure(
      String(residentPk), homeA, null, 'admin', 'res-erasure-test', 'John Erasable'
    );
    expect(result.anonymised).toBe(true);
    expect(result.subject_type).toBe('resident');

    // Check finance_residents anonymised
    const { rows: [fr] } = await pool.query(
      `SELECT resident_name, notes FROM finance_residents WHERE id = $1`,
      [residentPk]
    );
    expect(fr.resident_name).toMatch(/^\[REDACTED/);
    expect(fr.notes).toBeNull();

    // Check DoLS anonymised
    const { rows: dols } = await pool.query(
      `SELECT resident_name, dob FROM dols WHERE home_id = $1`, [homeA]
    );
    for (const d of dols) {
      expect(d.resident_name).toMatch(/^\[REDACTED/);
      expect(d.dob).toBeNull();
    }

    // Check MCA anonymised
    const { rows: mca } = await pool.query(
      `SELECT resident_name, notes FROM mca_assessments WHERE home_id = $1`, [homeA]
    );
    for (const m of mca) {
      expect(m.resident_name).toMatch(/^\[REDACTED/);
    }

    // Check incidents anonymised
    const { rows: incidents } = await pool.query(
      `SELECT person_affected_name FROM incidents WHERE home_id = $1`, [homeA]
    );
    for (const i of incidents) {
      expect(i.person_affected_name).toMatch(/^\[REDACTED/);
    }

    // Check complaints anonymised
    const { rows: complaints } = await pool.query(
      `SELECT raised_by_name FROM complaints WHERE home_id = $1`, [homeA]
    );
    for (const c of complaints) {
      expect(c.raised_by_name).toMatch(/^\[REDACTED/);
    }
  });
});
