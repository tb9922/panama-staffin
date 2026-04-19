/**
 * Seed the database with minimal test data for E2E tests.
 * Creates users, one home with config + two staff, and one approved payroll
 * run so dashboard, staff, finance, and export/PDF pages all have something real to render.
 */
import pg from 'pg';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;

// Load .env so DB credentials are available.
try {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const envContent = fs.readFileSync(path.join(__dirname, '../.env'), 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const raw = trimmed.slice(eq + 1).trim();
    const val = raw.replace(/^(['"])(.*)\1$/, '$2');
    if (key && !(key in process.env)) process.env[key] = val;
  }
} catch {
  // .env is optional.
}

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  database: process.env.DB_NAME || 'panama_test',
  user: process.env.DB_USER || 'panama',
  password: process.env.DB_PASSWORD || 'test_password',
  ssl: process.env.DB_SSL === 'false' ? false : undefined,
});

const CONFIG = {
  home_name: 'E2E Test Home',
  registered_beds: 30,
  care_type: 'residential',
  cycle_start_date: '2025-01-06',
  shifts: { E: { hours: 8 }, L: { hours: 8 }, EL: { hours: 12 }, N: { hours: 10 } },
  minimum_staffing: {
    early: { heads: 3, skill_points: 3 },
    late: { heads: 3, skill_points: 3 },
    night: { heads: 2, skill_points: 2 },
  },
  agency_rate_day: 25,
  agency_rate_night: 30,
  ot_premium: 15,
  bh_premium_multiplier: 1.5,
  max_consecutive_days: 6,
  max_al_same_day: 2,
  al_entitlement_days: 28,
  leave_year_start: '04-01',
  al_carryover_max: 8,
  nlw_rate: 12.21,
  bank_holidays: [],
};

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const adminHash = await bcrypt.hash('admin12345', 12);
    const viewerHash = await bcrypt.hash('viewer12345', 12);

    await client.query(
      `INSERT INTO users (username, password_hash, role, display_name, is_platform_admin)
       VALUES ('admin', $1, 'admin', 'Admin', true), ('viewer', $2, 'viewer', 'Viewer', false)
       ON CONFLICT (username) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             role = EXCLUDED.role,
             display_name = EXCLUDED.display_name,
             is_platform_admin = EXCLUDED.is_platform_admin,
             active = true`,
      [adminHash, viewerHash]
    );

    const { rows } = await client.query(
      `INSERT INTO homes (slug, name, config)
       VALUES ('e2e-test-home', 'E2E Test Home', $1::jsonb)
       ON CONFLICT (slug) WHERE deleted_at IS NULL DO UPDATE
         SET config = $1::jsonb
       RETURNING id`,
      [JSON.stringify(CONFIG)]
    );
    const homeId = rows[0].id;

    await client.query(
      `INSERT INTO staff (
         id, home_id, name, role, team, pref, skill, hourly_rate,
         active, start_date, contract_hours, al_carryover
       )
       VALUES
         ('S001', $1, 'Alice Smith', 'Senior Carer', 'Day A', 'E', 3, 14.50, true, '2024-01-15', 37.5, 0),
         ('S002', $1, 'Bob Jones', 'Carer', 'Day B', 'L', 2, 12.50, true, '2024-06-01', 37.5, 8)
       ON CONFLICT (home_id, id) DO UPDATE
         SET name = EXCLUDED.name,
             role = EXCLUDED.role,
             team = EXCLUDED.team,
             pref = EXCLUDED.pref,
             skill = EXCLUDED.skill,
             hourly_rate = EXCLUDED.hourly_rate,
             active = EXCLUDED.active,
             start_date = EXCLUDED.start_date,
             contract_hours = EXCLUDED.contract_hours,
             al_carryover = EXCLUDED.al_carryover`,
      [homeId]
    );

    const { rows: [insertedRun] } = await client.query(
      `INSERT INTO payroll_runs (
         home_id, period_start, period_end, pay_frequency, status,
         total_gross, total_enhancements, total_sleep_ins, staff_count,
         approved_by, approved_at
       )
       SELECT $1, '2026-03-01', '2026-03-31', 'monthly', 'approved',
              2450.00, 120.00, 0, 1,
              'admin', NOW()
       WHERE NOT EXISTS (
         SELECT 1
         FROM payroll_runs
         WHERE home_id = $1
           AND period_start = '2026-03-01'
           AND period_end = '2026-03-31'
       )
       RETURNING id`,
      [homeId]
    );

    let payrollRunId = insertedRun?.id;
    if (!payrollRunId) {
      const { rows: [existingRun] } = await client.query(
        `SELECT id
         FROM payroll_runs
         WHERE home_id = $1
           AND period_start = '2026-03-01'
           AND period_end = '2026-03-31'
         ORDER BY id DESC
         LIMIT 1`,
        [homeId]
      );
      payrollRunId = existingRun.id;
    }

    await client.query(
      `INSERT INTO payroll_lines (
         payroll_run_id, staff_id,
         base_hours, base_pay, total_hours, gross_pay,
         tax_deducted, employee_ni, employer_ni, net_pay,
         nmw_compliant
       )
       SELECT $1, 'S001', 160, 2320.00, 160, 2450.00, 180.00, 90.00, 110.00, 2180.00, true
       WHERE NOT EXISTS (
         SELECT 1 FROM payroll_lines WHERE payroll_run_id = $1 AND staff_id = 'S001'
       )`,
      [payrollRunId]
    );

    await client.query(
      `INSERT INTO user_home_roles (username, home_id, role_id, granted_by)
       VALUES ('admin', $1, 'home_manager', 'seed-e2e'), ('viewer', $1, 'viewer', 'seed-e2e')
       ON CONFLICT (username, home_id) DO NOTHING`,
      [homeId]
    );

    await client.query(
      `INSERT INTO finance_residents (home_id, resident_name, room_number, care_type, weekly_fee, funding_type, status, created_by)
       SELECT $1, 'Test Resident', '101', 'residential', 800, 'self_funded', 'active', 'seed-e2e'
       WHERE NOT EXISTS (
         SELECT 1
         FROM finance_residents
         WHERE home_id = $1
           AND resident_name = 'Test Resident'
           AND deleted_at IS NULL
       )`,
      [homeId]
    );

    await client.query('COMMIT');
    console.log('E2E seed data created successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

export default async function globalSetup() {
  await seed();
}

if (process.argv[1].endsWith('seed-e2e.js')) {
  seed().catch((err) => {
    console.error('Seed failed:', err.message);
    process.exit(1);
  });
}
