import { pool } from '../db.js';
import { toIsoOrNull } from '../lib/serverTimestamps.js';

const COLS = `
  id, home_id, staff_id, practice_date, facilitator, category, topic,
  reflection, learning_outcome, wellbeing_notes, action_summary,
  created_by, updated_by, version, created_at, updated_at, deleted_at
`;

function dateOnly(value) {
  if (!value) return null;
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function shapeRow(row) {
  if (!row) return null;
  return {
    ...row,
    id: parseInt(row.id, 10),
    home_id: parseInt(row.home_id, 10),
    created_by: row.created_by == null ? null : parseInt(row.created_by, 10),
    updated_by: row.updated_by == null ? null : parseInt(row.updated_by, 10),
    version: row.version == null ? 1 : parseInt(row.version, 10),
    practice_date: dateOnly(row.practice_date),
    created_at: toIsoOrNull(row.created_at),
    updated_at: toIsoOrNull(row.updated_at),
    deleted_at: toIsoOrNull(row.deleted_at),
  };
}

export async function findByHome(homeId, filters = {}, client = pool) {
  const params = [homeId];
  const clauses = ['home_id = $1', 'deleted_at IS NULL'];
  if (filters.staff_id) {
    params.push(filters.staff_id);
    clauses.push(`staff_id = $${params.length}`);
  }
  if (filters.from) {
    params.push(filters.from);
    clauses.push(`practice_date >= $${params.length}`);
  }
  if (filters.to) {
    params.push(filters.to);
    clauses.push(`practice_date <= $${params.length}`);
  }
  const limit = Math.min(parseInt(filters.limit ?? 100, 10) || 100, 500);
  const offset = Math.max(parseInt(filters.offset ?? 0, 10) || 0, 0);
  params.push(limit, offset);
  const limitParam = params.length - 1;
  const offsetParam = params.length;
  const { rows } = await client.query(
    `SELECT ${COLS}, COUNT(*) OVER() AS _total
       FROM reflective_practice
      WHERE ${clauses.join(' AND ')}
      ORDER BY practice_date DESC, id DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}`,
    params,
  );
  const total = rows.length > 0 ? parseInt(rows[0]._total, 10) : 0;
  return {
    rows: rows.map(({ _total, ...row }) => shapeRow(row)),
    total,
  };
}

export async function findById(id, homeId, client = pool) {
  const { rows } = await client.query(
    `SELECT ${COLS} FROM reflective_practice WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`,
    [id, homeId],
  );
  return shapeRow(rows[0]);
}

export async function create(homeId, data, actorId = null, client = pool) {
  const { rows } = await client.query(
    `INSERT INTO reflective_practice (
       home_id, staff_id, practice_date, facilitator, category, topic,
       reflection, learning_outcome, wellbeing_notes, action_summary,
       created_by, updated_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11
     )
     RETURNING ${COLS}`,
    [
      homeId,
      data.staff_id || null,
      data.practice_date,
      data.facilitator || null,
      data.category || 'reflective_practice',
      data.topic,
      data.reflection || null,
      data.learning_outcome || null,
      data.wellbeing_notes || null,
      data.action_summary || null,
      actorId,
    ],
  );
  return shapeRow(rows[0]);
}

export async function update(id, homeId, data, version = null, actorId = null, client = pool) {
  const allowed = new Set([
    'staff_id', 'practice_date', 'facilitator', 'category', 'topic',
    'reflection', 'learning_outcome', 'wellbeing_notes', 'action_summary',
  ]);
  const fields = Object.entries(data).filter(([key, value]) => allowed.has(key) && value !== undefined);
  if (fields.length === 0) return findById(id, homeId, client);
  const params = [id, homeId, ...fields.map(([, value]) => value ?? null), actorId];
  const actorParam = params.length;
  const setClause = fields.map(([key], index) => `${key} = $${index + 3}`).join(', ');
  let sql = `
    UPDATE reflective_practice
       SET ${setClause},
           updated_by = $${actorParam},
           updated_at = NOW(),
           version = version + 1
     WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL
  `;
  if (version != null) {
    params.push(version);
    sql += ` AND version = $${params.length}`;
  }
  sql += ` RETURNING ${COLS}`;
  const { rows, rowCount } = await client.query(sql, params);
  if (rowCount === 0 && version != null) return null;
  return shapeRow(rows[0]);
}

export async function softDelete(id, homeId, actorId = null, client = pool) {
  const { rowCount } = await client.query(
    `UPDATE reflective_practice
        SET deleted_at = NOW(), updated_at = NOW(), updated_by = $3
      WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`,
    [id, homeId, actorId],
  );
  return rowCount > 0;
}
