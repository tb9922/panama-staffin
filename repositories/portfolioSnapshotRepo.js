import { pool, toDateStr } from '../db.js';
import { paginateResult } from '../lib/pagination.js';
import { toIsoOrNull } from '../lib/serverTimestamps.js';

const COLS = `
  id, home_id, period_date, period_granularity, rag, kpis, created_at
`;

function jsonValue(value) {
  if (value == null) return {};
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return {}; }
  }
  return value;
}

function shapeRow(row) {
  if (!row) return null;
  return {
    ...row,
    id: parseInt(row.id, 10),
    home_id: parseInt(row.home_id, 10),
    period_date: toDateStr(row.period_date),
    rag: jsonValue(row.rag),
    kpis: jsonValue(row.kpis),
    created_at: toIsoOrNull(row.created_at),
  };
}

export async function upsert(homeId, data, client = pool) {
  const { rows } = await client.query(
    `INSERT INTO portfolio_kpi_snapshots (
       home_id, period_date, period_granularity, rag, kpis
     ) VALUES (
       $1, $2, $3, $4::jsonb, $5::jsonb
     )
     ON CONFLICT (home_id, period_date, period_granularity)
     DO UPDATE SET
       rag = EXCLUDED.rag,
       kpis = EXCLUDED.kpis
     RETURNING ${COLS}`,
    [
      homeId,
      data.period_date,
      data.period_granularity,
      JSON.stringify(data.rag || {}),
      JSON.stringify(data.kpis || {}),
    ],
  );
  return shapeRow(rows[0]);
}

export async function findByHomeAndPeriod(homeId, periodDate, periodGranularity, client = pool) {
  const { rows } = await client.query(
    `SELECT ${COLS}
       FROM portfolio_kpi_snapshots
      WHERE home_id = $1
        AND period_date = $2
        AND period_granularity = $3`,
    [homeId, periodDate, periodGranularity],
  );
  return shapeRow(rows[0]);
}

export async function listByHomeIds(homeIds, filters = {}, client = pool) {
  if (!Array.isArray(homeIds) || homeIds.length === 0) {
    return { rows: [], total: 0 };
  }

  const params = [homeIds];
  const clauses = ['pks.home_id = ANY($1::int[])'];

  if (filters.home_id != null) {
    params.push(filters.home_id);
    clauses.push(`pks.home_id = $${params.length}`);
  }
  if (filters.period_granularity) {
    params.push(filters.period_granularity);
    clauses.push(`pks.period_granularity = $${params.length}`);
  }
  if (filters.from) {
    params.push(filters.from);
    clauses.push(`pks.period_date >= $${params.length}`);
  }
  if (filters.to) {
    params.push(filters.to);
    clauses.push(`pks.period_date <= $${params.length}`);
  }

  const limit = Math.min(parseInt(filters.limit ?? 100, 10) || 100, 500);
  const offset = Math.max(parseInt(filters.offset ?? 0, 10) || 0, 0);
  params.push(limit, offset);
  const limitParam = params.length - 1;
  const offsetParam = params.length;

  const { rows } = await client.query(
    `SELECT pks.${COLS.split(',').map(col => col.trim()).filter(Boolean).join(', pks.')},
            h.slug AS home_slug,
            COALESCE(h.config->>'home_name', h.name) AS home_name,
            COUNT(*) OVER() AS _total
       FROM portfolio_kpi_snapshots pks
       JOIN homes h ON h.id = pks.home_id AND h.deleted_at IS NULL
      WHERE ${clauses.join(' AND ')}
      ORDER BY pks.period_date DESC, pks.period_granularity, h.name, pks.home_id
      LIMIT $${limitParam} OFFSET $${offsetParam}`,
    params,
  );
  return paginateResult(rows, shapeRow);
}
