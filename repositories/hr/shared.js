import { pool } from '../../db.js';

export { pool };

export function d(v) { return v instanceof Date ? v.toISOString().slice(0, 10) : v; }
export function ts(v) { return v instanceof Date ? v.toISOString() : v; }

// ── Shape Factory ────────────────────────────────────────────────────────────
// Builds a row → API-object shaper from a declarative config.
// fields = explicit whitelist (security boundary — only listed fields reach the frontend)
// dates/timestamps/jsonArrays/jsonObjects/ints/floats = transformation sets
// aliases = { frontendName: 'dbField' | (row, out) => value }
export function createShaper({ fields, dates, timestamps, jsonArrays, jsonObjects, ints, floats, aliases }) {
  const dateSet  = new Set(dates || []);
  const tsSet    = new Set(timestamps || ['created_at', 'updated_at']);
  const arrSet   = new Set(jsonArrays || []);
  const objSet   = new Set(jsonObjects || []);
  const intSet   = new Set(ints || []);
  const floatSet = new Set(floats || []);

  return function shape(row) {
    if (!row) return null;
    const out = {};
    for (const key of fields) {
      const v = row[key];
      if (dateSet.has(key))       out[key] = d(v);
      else if (tsSet.has(key))    out[key] = ts(v);
      else if (arrSet.has(key))   out[key] = v || [];
      else if (objSet.has(key))   out[key] = v || {};
      else if (intSet.has(key))   out[key] = v != null ? parseInt(v, 10) : null;
      else if (floatSet.has(key)) out[key] = v != null ? parseFloat(v) : null;
      else                        out[key] = v;
    }
    if (aliases) {
      for (const [alias, src] of Object.entries(aliases)) {
        out[alias] = typeof src === 'function' ? src(row, out) : out[src];
      }
    }
    return out;
  };
}

// Allowed ORDER BY expressions — prevents SQL injection if a caller ever passes user input.
// Every paginate() call must use one of these exact strings.
const ALLOWED_ORDER_BY = new Set([
  'date_raised DESC', 'rtw_date DESC', 'referral_date DESC',
  'contract_start_date DESC', 'request_date DESC NULLS LAST',
  'request_date DESC', 'created_at DESC', 'transfer_date DESC',
]);

export async function paginate(conn, sql, params, orderBy, shaper, pag = {}) {
  if (!ALLOWED_ORDER_BY.has(orderBy)) {
    throw new Error(`paginate: disallowed ORDER BY clause: ${orderBy}`);
  }
  const limit = Math.min(Math.max(parseInt(pag.limit) || 200, 1), 500);
  const offset = Math.max(parseInt(pag.offset) || 0, 0);
  const countSql = `SELECT COUNT(*) FROM (${sql}) _c`;
  const dataSql = `${sql} ORDER BY ${orderBy} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  const [dataRes, countRes] = await Promise.all([
    conn.query(dataSql, [...params, limit, offset]),
    conn.query(countSql, params),
  ]);
  return { rows: dataRes.rows.map(shaper), total: parseInt(countRes.rows[0].count, 10) };
}

// ── Generic Soft Delete ──────────────────────────────────────────────────────

const SOFT_DELETE_TABLES = new Set([
  'hr_disciplinary_cases', 'hr_grievance_cases', 'hr_performance_cases',
  'hr_rtw_interviews', 'hr_oh_referrals', 'hr_contracts',
  'hr_family_leave', 'hr_flexible_working', 'hr_edi_records',
  'hr_tupe_transfers', 'hr_rtw_dbs_renewals',
]);

export async function softDeleteCase(table, id, homeId, client) {
  if (!SOFT_DELETE_TABLES.has(table)) throw new Error(`softDeleteCase: disallowed table: ${table}`);
  const conn = client || pool;
  const { rowCount } = await conn.query(
    `UPDATE ${table} SET deleted_at = NOW() WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`,
    [id, homeId]
  );
  return rowCount > 0;
}
