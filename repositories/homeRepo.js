import { pool } from '../db.js';

/**
 * Find a home by its slug (path-safe name, e.g. "Oakwood_Care_Home").
 * Returns null if not found.
 * @param {string} slug
 */
export async function findBySlug(slug) {
  const { rows } = await pool.query(
    'SELECT * FROM homes WHERE slug = $1',
    [slug]
  );
  return rows[0] || null;
}

/**
 * List all homes with config metadata for the homes list endpoint.
 * Returns [{id, slug, name, beds, type}]
 */
export async function listAll() {
  const { rows } = await pool.query(
    'SELECT id, slug, name, config FROM homes ORDER BY name'
  );
  return rows.map(r => ({
    id: r.slug,
    name: r.config?.home_name || r.name,
    beds: r.config?.registered_beds,
    type: r.config?.care_type,
  }));
}

/**
 * Upsert a home by slug. Creates it if it doesn't exist.
 * Returns the home row.
 * @param {string} slug
 * @param {string} name
 * @param {object} configObj
 * @param {object} [annualLeave]
 * @param {object} [client] Optional transaction client
 */
export async function upsert(slug, name, configObj, annualLeave, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO homes (slug, name, config, annual_leave)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (slug) DO UPDATE SET
       name = EXCLUDED.name,
       config = EXCLUDED.config,
       annual_leave = EXCLUDED.annual_leave,
       updated_at = NOW()
     RETURNING *`,
    [slug, name, JSON.stringify(configObj), JSON.stringify(annualLeave || {})]
  );
  return rows[0];
}

/**
 * Update the config JSONB for a home.
 * @param {number} homeId
 * @param {object} configObj
 * @param {object} [client]
 */
export async function updateConfig(homeId, configObj, client) {
  const conn = client || pool;
  await conn.query(
    'UPDATE homes SET config = $1, updated_at = NOW() WHERE id = $2',
    [JSON.stringify(configObj), homeId]
  );
}

/**
 * Update the annual_leave JSONB for a home.
 * @param {number} homeId
 * @param {object} alObj
 * @param {object} [client]
 */
export async function updateAnnualLeave(homeId, alObj, client) {
  const conn = client || pool;
  await conn.query(
    'UPDATE homes SET annual_leave = $1, updated_at = NOW() WHERE id = $2',
    [JSON.stringify(alObj || {}), homeId]
  );
}
