/**
 * Seed the database with minimal test data for E2E tests.
 * Creates users, one home with config + two staff — enough for
 * Dashboard, Roster, Staff, and Finance pages to render.
 */
import pg from 'pg';
import bcrypt from 'bcryptjs';
const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
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
  agency_rate_day: 25, agency_rate_night: 30,
  ot_premium: 15, bh_premium_multiplier: 1.5,
  max_consecutive_days: 6, max_al_same_day: 2,
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

    // Create test users in the users table (DB-backed auth)
    const adminHash = await bcrypt.hash('admin123', 12);
    const viewerHash = await bcrypt.hash('view123', 12);

    await client.query(`
      INSERT INTO users (username, password_hash, role, display_name, is_platform_admin)
      VALUES ('admin', $1, 'admin', 'Admin', true), ('viewer', $2, 'viewer', 'Viewer', false)
      ON CONFLICT (username) DO UPDATE
        SET is_platform_admin = EXCLUDED.is_platform_admin
    `, [adminHash, viewerHash]);

    // Upsert home with config (partial unique index: homes_slug_active WHERE deleted_at IS NULL)
    const { rows } = await client.query(`
      INSERT INTO homes (slug, name, config)
      VALUES ('e2e-test-home', 'E2E Test Home', $1::jsonb)
      ON CONFLICT (slug) WHERE deleted_at IS NULL DO UPDATE SET config = $1::jsonb
      RETURNING id
    `, [JSON.stringify(CONFIG)]);
    const homeId = rows[0].id;

    // Upsert two staff members (PK is (home_id, id))
    await client.query(`
      INSERT INTO staff (id, home_id, name, role, team, pref, skill, hourly_rate, active, start_date, contract_hours)
      VALUES
        ('S001', $1, 'Alice Smith', 'Senior Carer', 'Day A', 'E', 3, 14.50, true, '2024-01-15', 37.5),
        ('S002', $1, 'Bob Jones', 'Carer', 'Day B', 'L', 2, 12.50, true, '2024-06-01', 37.5)
      ON CONFLICT (home_id, id) DO NOTHING
    `, [homeId]);

    // Grant roles via user_home_roles (replaces dropped user_home_access)
    await client.query(`
      INSERT INTO user_home_roles (username, home_id, role_id, granted_by)
      VALUES ('admin', $1, 'home_manager', 'seed-e2e'), ('viewer', $1, 'viewer', 'seed-e2e')
      ON CONFLICT (username, home_id) DO NOTHING
    `, [homeId]);

    // Seed one resident for ResidentPicker E2E tests (idempotent — checks existence first)
    await client.query(`
      INSERT INTO finance_residents (home_id, resident_name, room_number, care_type, weekly_fee, funding_type, status, created_by)
      SELECT $1, 'Test Resident', '101', 'residential', 800, 'self_funded', 'active', 'seed-e2e'
      WHERE NOT EXISTS (
        SELECT 1 FROM finance_residents WHERE home_id = $1 AND resident_name = 'Test Resident' AND deleted_at IS NULL
      )
    `, [homeId]);

    await client.query('COMMIT');
    console.log('E2E seed data created successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
