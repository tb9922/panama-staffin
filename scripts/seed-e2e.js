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

const PORTFOLIO_HOMES = [
  {
    slug: 'e2e-portfolio-amber',
    name: 'E2E Portfolio Amber',
    config: { ...CONFIG, home_name: 'E2E Portfolio Amber', registered_beds: 30 },
  },
  {
    slug: 'e2e-portfolio-red',
    name: 'E2E Portfolio Red',
    config: { ...CONFIG, home_name: 'E2E Portfolio Red', registered_beds: 60 },
  },
];

async function upsertHome(client, slug, name, config) {
  const { rows: [home] } = await client.query(
    `INSERT INTO homes (slug, name, config)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (slug) WHERE deleted_at IS NULL DO UPDATE
       SET name = EXCLUDED.name,
           config = EXCLUDED.config
     RETURNING id`,
    [slug, name, JSON.stringify(config)],
  );
  return home.id;
}

async function resetPortfolioSeedData(client, primaryHomeId, portfolioHomeIds) {
  const allHomeIds = [primaryHomeId, ...portfolioHomeIds];
  await client.query(`DELETE FROM action_items WHERE home_id = $1 AND source_id = 'e2e-v1'`, [primaryHomeId]);
  await client.query(`DELETE FROM outcome_metrics WHERE home_id = $1 AND metric_key LIKE 'e2e_%'`, [primaryHomeId]);
  await client.query(`DELETE FROM audit_tasks WHERE home_id = $1 AND template_key LIKE 'e2e_%'`, [primaryHomeId]);
  await client.query(`DELETE FROM reflective_practice WHERE home_id = $1 AND topic LIKE 'E2E V1 %'`, [primaryHomeId]);

  await client.query(`DELETE FROM action_items WHERE home_id = ANY($1::int[])`, [portfolioHomeIds]);
  await client.query(`DELETE FROM outcome_metrics WHERE home_id = ANY($1::int[])`, [portfolioHomeIds]);
  await client.query(`DELETE FROM audit_tasks WHERE home_id = ANY($1::int[])`, [portfolioHomeIds]);
  await client.query(`DELETE FROM reflective_practice WHERE home_id = ANY($1::int[])`, [portfolioHomeIds]);
  await client.query(`DELETE FROM agency_approval_attempts WHERE home_id = ANY($1::int[])`, [allHomeIds]);
  await client.query(`DELETE FROM agency_shifts WHERE home_id = ANY($1::int[])`, [allHomeIds]);
  await client.query(`DELETE FROM agency_providers WHERE home_id = ANY($1::int[])`, [allHomeIds]);
  await client.query(`DELETE FROM incidents WHERE home_id = ANY($1::int[]) AND id LIKE 'e2e-v1-%'`, [allHomeIds]);
  await client.query(`DELETE FROM complaints WHERE home_id = ANY($1::int[]) AND id LIKE 'e2e-v1-%'`, [allHomeIds]);
}

async function seedPortfolioSignals(client, homeIdsBySlug) {
  const primaryId = homeIdsBySlug.get('e2e-test-home');
  const amberId = homeIdsBySlug.get('e2e-portfolio-amber');
  const redId = homeIdsBySlug.get('e2e-portfolio-red');

  await client.query(
    `INSERT INTO agency_providers (home_id, name, rate_day, rate_night)
     VALUES ($1, 'E2E V1 Primary Agency', 25, 30)`,
    [primaryId],
  );

  await client.query(
    `INSERT INTO staff (
       id, home_id, name, role, team, pref, skill, hourly_rate,
       active, start_date, contract_hours, willing_extras,
       willing_other_homes, max_weekly_hours_topup, max_travel_radius_km,
       home_postcode, internal_bank_status
     )
     VALUES
       ('P001', $1, 'Portfolio Amber Carer', 'Carer', 'Day A', 'E', 2, 12.50, true, '2025-01-01', 37.5, true, true, 8, 25, 'AB1 1AA', 'available'),
       ('P001', $2, 'Portfolio Red Carer', 'Carer', 'Day A', 'E', 2, 12.50, true, '2025-01-01', 37.5, true, true, 8, 25, 'AB1 1AA', 'available')
     ON CONFLICT (home_id, id) DO UPDATE
       SET name = EXCLUDED.name,
           role = EXCLUDED.role,
           active = EXCLUDED.active,
           willing_extras = EXCLUDED.willing_extras,
           willing_other_homes = EXCLUDED.willing_other_homes,
           max_weekly_hours_topup = EXCLUDED.max_weekly_hours_topup,
           max_travel_radius_km = EXCLUDED.max_travel_radius_km,
           home_postcode = EXCLUDED.home_postcode,
           internal_bank_status = EXCLUDED.internal_bank_status`,
    [amberId, redId],
  );

  await client.query(
    `INSERT INTO action_items (
       home_id, source_type, source_id, source_action_key, title,
       category, priority, due_date, status, escalation_level
     )
     VALUES
       ($1, 'standalone', 'e2e-v1', 'amber-action', 'E2E V1 amber action', 'governance', 'medium', CURRENT_DATE - INTERVAL '1 day', 'open', 1),
       ($2, 'standalone', 'e2e-v1', 'red-critical-action', 'E2E V1 critical overdue action', 'safeguarding', 'critical', CURRENT_DATE - INTERVAL '8 days', 'open', 4)
     ON CONFLICT (home_id, source_type, source_id, source_action_key)
       WHERE deleted_at IS NULL AND source_id IS NOT NULL AND source_action_key IS NOT NULL
     DO UPDATE SET
       title = EXCLUDED.title,
       category = EXCLUDED.category,
       priority = EXCLUDED.priority,
       due_date = EXCLUDED.due_date,
       status = EXCLUDED.status,
       escalation_level = EXCLUDED.escalation_level,
       updated_at = NOW()`,
    [amberId, redId],
  );

  const { rows: [provider] } = await client.query(
    `INSERT INTO agency_providers (home_id, name, rate_day, rate_night)
     VALUES ($1, 'E2E V1 Agency', 25, 30)
     RETURNING id`,
    [redId],
  );
  const { rows: [shift] } = await client.query(
    `INSERT INTO agency_shifts (home_id, agency_id, date, shift_code, hours, hourly_rate, total_cost, role_covered)
     VALUES ($1, $2, CURRENT_DATE, 'AG-E', 8, 25, 200, 'Carer')
     RETURNING id`,
    [redId, provider.id],
  );
  const { rows: [attempt] } = await client.query(
    `INSERT INTO agency_approval_attempts (
       home_id, gap_date, shift_code, role_needed, reason, internal_bank_checked,
       internal_bank_candidate_count, viable_internal_candidate_count,
       emergency_override, emergency_override_reason, outcome, linked_agency_shift_id
     )
     VALUES (
       $1, CURRENT_DATE, 'AG-E', 'Carer', 'E2E V1 emergency cover',
       true, 1, 1, true, 'No safe internal cover for handover', 'emergency_agency', $2
     )
     RETURNING id`,
    [redId, shift.id],
  );
  await client.query(`UPDATE agency_shifts SET agency_attempt_id = $1 WHERE id = $2`, [attempt.id, shift.id]);

  await client.query(
    `INSERT INTO incidents (
       id, home_id, date, time, location, type, severity, person_affected_name,
       investigation_status, investigation_review_date, root_cause
     )
     VALUES
       ('e2e-v1-fall-1', $1, CURRENT_DATE - INTERVAL '2 days', '08:00', 'Lounge', 'Fall', 'moderate', 'Resident A', 'open', CURRENT_DATE - INTERVAL '1 day', 'Environment'),
       ('e2e-v1-fall-2', $2, CURRENT_DATE - INTERVAL '3 days', '09:00', 'Bedroom', 'Fall', 'moderate', 'Resident B', 'open', CURRENT_DATE - INTERVAL '1 day', 'Observation')
     ON CONFLICT (home_id, id) DO NOTHING`,
    [amberId, redId],
  );

  await client.query(
    `INSERT INTO complaints (
       id, home_id, date, raised_by, raised_by_name, category, title,
       acknowledged_date, response_deadline, status, root_cause
     )
     VALUES
       ('e2e-v1-complaint-1', $1, CURRENT_DATE - INTERVAL '5 days', 'relative', 'Family', 'communication', 'E2E V1 delayed response', NULL, CURRENT_DATE - INTERVAL '1 day', 'open', 'Communication')
     ON CONFLICT (home_id, id) DO NOTHING`,
    [redId],
  );
}

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const testUsers = [
      {
        username: 'admin',
        password: 'admin12345',
        role: 'admin',
        displayName: 'Admin',
        isPlatformAdmin: true,
        homeRole: 'home_manager',
      },
      {
        username: 'manager',
        password: 'manager12345',
        role: 'viewer',
        displayName: 'Home Manager',
        isPlatformAdmin: false,
        homeRole: 'home_manager',
      },
      {
        username: 'coordinator',
        password: 'coordinator12345',
        role: 'viewer',
        displayName: 'Shift Coordinator',
        isPlatformAdmin: false,
        homeRole: 'shift_coordinator',
      },
      {
        username: 'viewer',
        password: 'viewer12345',
        role: 'viewer',
        displayName: 'Viewer',
        isPlatformAdmin: false,
        homeRole: 'viewer',
      },
    ];

    const userRows = await Promise.all(testUsers.map(async (user) => ({
      ...user,
      passwordHash: await bcrypt.hash(user.password, 12),
    })));

    await client.query(
      `INSERT INTO users (username, password_hash, role, display_name, is_platform_admin)
       SELECT username, password_hash, role, display_name, is_platform_admin
       FROM jsonb_to_recordset($1::jsonb) AS users(
         username text,
         password_hash text,
         role text,
         display_name text,
         is_platform_admin boolean
       )
       ON CONFLICT (username) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             role = EXCLUDED.role,
             display_name = EXCLUDED.display_name,
             is_platform_admin = EXCLUDED.is_platform_admin,
             active = true,
             failed_login_count = 0,
             locked_until = NULL`,
      [JSON.stringify(userRows.map(user => ({
        username: user.username,
        password_hash: user.passwordHash,
        role: user.role,
        display_name: user.displayName,
        is_platform_admin: user.isPlatformAdmin,
      })))]
    );

    const homeId = await upsertHome(client, 'e2e-test-home', 'E2E Test Home', CONFIG);
    const portfolioHomeIds = [];
    const homeIdsBySlug = new Map([['e2e-test-home', homeId]]);
    for (const home of PORTFOLIO_HOMES) {
      const id = await upsertHome(client, home.slug, home.name, home.config);
      portfolioHomeIds.push(id);
      homeIdsBySlug.set(home.slug, id);
    }
    await resetPortfolioSeedData(client, homeId, portfolioHomeIds);

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

    await client.query(
      `UPDATE staff
          SET willing_extras = true,
              willing_other_homes = true,
              max_weekly_hours_topup = 8,
              max_travel_radius_km = 25,
              home_postcode = 'AB1 1AA',
              internal_bank_status = 'available'
        WHERE home_id = $1 AND id = 'S001'`,
      [homeId],
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
       SELECT username, $1, role_id, 'seed-e2e'
       FROM jsonb_to_recordset($2::jsonb) AS roles(username text, role_id text)
       ON CONFLICT (username, home_id) DO UPDATE
         SET role_id = EXCLUDED.role_id,
             staff_id = NULL,
             granted_by = EXCLUDED.granted_by`,
      [
        homeId,
        JSON.stringify(userRows.map(user => ({ username: user.username, role_id: user.homeRole }))),
      ]
    );

    await seedPortfolioSignals(client, homeIdsBySlug);

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
