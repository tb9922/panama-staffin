/**
 * Seed the database with minimal test data for E2E tests.
 * Creates one home with config + two staff members — enough for
 * Dashboard, Roster, Staff, and Finance pages to render.
 */
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'panama_test',
  user: process.env.DB_USER || 'panama',
  password: process.env.DB_PASSWORD || 'test_password',
  ssl: process.env.DB_SSL === 'false' ? false : undefined,
});

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create a test home
    await client.query(`
      INSERT INTO homes (slug, name) VALUES ('e2e-test-home', 'E2E Test Home')
      ON CONFLICT (slug) DO NOTHING
    `);

    // Create home config
    await client.query(`
      INSERT INTO home_config (home_id, config)
      SELECT id, $1::jsonb FROM homes WHERE slug = 'e2e-test-home'
      ON CONFLICT (home_id) DO UPDATE SET config = EXCLUDED.config
    `, [JSON.stringify({
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
    })]);

    // Create two test staff members
    const homeId = (await client.query(`SELECT id FROM homes WHERE slug = 'e2e-test-home'`)).rows[0].id;

    await client.query(`
      INSERT INTO staff (id, home_id, name, role, team, pref, skill, hourly_rate, active, start_date, contract_hours)
      VALUES
        ('S001', $1, 'Alice Smith', 'Senior Carer', 'Day A', 'E', 3, 14.50, true, '2024-01-15', 37.5),
        ('S002', $1, 'Bob Jones', 'Carer', 'Day B', 'L', 2, 12.50, true, '2024-06-01', 37.5)
      ON CONFLICT (id, home_id) DO NOTHING
    `, [homeId]);

    // Grant admin access to the test home
    await client.query(`
      INSERT INTO user_home_access (username, home_slug)
      VALUES ('admin', 'e2e-test-home'), ('viewer', 'e2e-test-home')
      ON CONFLICT DO NOTHING
    `);

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
