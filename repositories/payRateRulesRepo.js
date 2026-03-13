import { pool, withTransaction } from '../db.js';

// ── pay_rate_rules ────────────────────────────────────────────────────────────

const RULE_COLS = `id, home_id, name, rate_type, amount, applies_to, priority,
  effective_from, effective_to, created_at, updated_at`;

const NMW_COLS = 'id, effective_from, age_bracket, hourly_rate';

function shapeRule(row) {
  return {
    id: row.id,
    home_id: row.home_id,
    name: row.name,
    rate_type: row.rate_type,
    amount: parseFloat(row.amount),
    applies_to: row.applies_to,
    priority: row.priority,
    effective_from: row.effective_from instanceof Date
      ? row.effective_from.toISOString().slice(0, 10)
      : String(row.effective_from).slice(0, 10),
    effective_to: row.effective_to
      ? (row.effective_to instanceof Date
          ? row.effective_to.toISOString().slice(0, 10)
          : String(row.effective_to).slice(0, 10))
      : null,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

/** Returns all currently active rules for a home (effective_to IS NULL). */
export async function findActiveByHome(homeId) {
  const { rows } = await pool.query(
    `SELECT ${RULE_COLS} FROM pay_rate_rules
     WHERE home_id = $1 AND effective_to IS NULL
     ORDER BY applies_to, priority`,
    [homeId],
  );
  return rows.map(shapeRule);
}

/**
 * Returns rules effective during a date range (for payroll calculation).
 * A rule is effective if: effective_from <= period_end AND (effective_to IS NULL OR effective_to >= period_start)
 */
export async function findForPeriod(homeId, periodStart, periodEnd, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${RULE_COLS} FROM pay_rate_rules
     WHERE home_id = $1
       AND effective_from <= $2
       AND (effective_to IS NULL OR effective_to >= $3)
     ORDER BY applies_to, priority`,
    [homeId, periodEnd, periodStart],
  );
  return rows.map(shapeRule);
}

/** Count of active rules for a home — used to decide whether to seed defaults. */
export async function countActiveByHome(homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT COUNT(*) AS cnt FROM pay_rate_rules WHERE home_id = $1 AND effective_to IS NULL`,
    [homeId],
  );
  return parseInt(rows[0].cnt, 10);
}

export async function create(homeId, rule, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO pay_rate_rules (home_id, name, rate_type, amount, applies_to, priority, effective_from)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [homeId, rule.name, rule.rate_type, rule.amount, rule.applies_to,
     rule.priority ?? 0, rule.effective_from ?? new Date().toISOString().slice(0, 10)],
  );
  return shapeRule(rows[0]);
}

/**
 * "Soft-close" the current version of a rule, then create a new one.
 * This preserves history — the old rule's effective_to is set to today.
 * Wrapped in a transaction to ensure atomicity (close + create succeed or both roll back).
 */
export async function update(ruleId, homeId, updates, client) {
  const exec = async (conn) => {
    const today = new Date().toISOString().slice(0, 10);

    // Close the existing rule
    const { rowCount } = await conn.query(
      `UPDATE pay_rate_rules SET effective_to = $1, updated_at = NOW()
       WHERE id = $2 AND home_id = $3 AND effective_to IS NULL`,
      [today, ruleId, homeId],
    );
    if (rowCount === 0) return null;

    // Create new version
    const { rows } = await conn.query(
      `INSERT INTO pay_rate_rules (home_id, name, rate_type, amount, applies_to, priority, effective_from)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [homeId, updates.name, updates.rate_type, updates.amount, updates.applies_to,
       updates.priority ?? 0, today],
    );
    return shapeRule(rows[0]);
  };

  // If caller already provided a transaction client, use it; otherwise create one
  if (client) return exec(client);
  return withTransaction(exec);
}

/** Deactivate a rule (set effective_to = today). No hard deletes. */
export async function deactivate(ruleId, homeId, client) {
  const conn = client || pool;
  const today = new Date().toISOString().slice(0, 10);
  const { rowCount } = await conn.query(
    `UPDATE pay_rate_rules SET effective_to = $1, updated_at = NOW()
     WHERE id = $2 AND home_id = $3 AND effective_to IS NULL`,
    [today, ruleId, homeId],
  );
  return rowCount > 0;
}

// ── nmw_rates ─────────────────────────────────────────────────────────────────

function shapeNmw(row) {
  return {
    id: row.id,
    effective_from: row.effective_from instanceof Date
      ? row.effective_from.toISOString().slice(0, 10)
      : String(row.effective_from).slice(0, 10),
    age_bracket: row.age_bracket,
    hourly_rate: parseFloat(row.hourly_rate),
  };
}

/** All NMW rates, ordered for lookup (most recent first within each bracket). */
export async function getAllNmwRates(client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${NMW_COLS} FROM nmw_rates ORDER BY age_bracket, effective_from DESC`,
  );
  return rows.map(shapeNmw);
}
