import { pool } from '../db.js';
import { toIsoOrNull } from '../lib/serverTimestamps.js';

const COLS = `
  id, home_id, template_key, title, category, frequency, period_start, period_end,
  due_date, owner_user_id, status, evidence_required, evidence_notes,
  completed_at, completed_by, manager_signed_off_at, manager_signed_off_by,
  qa_signed_off_at, qa_signed_off_by, version, created_by, updated_by,
  created_at, updated_at, deleted_at
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
    owner_user_id: row.owner_user_id == null ? null : parseInt(row.owner_user_id, 10),
    completed_by: row.completed_by == null ? null : parseInt(row.completed_by, 10),
    manager_signed_off_by: row.manager_signed_off_by == null ? null : parseInt(row.manager_signed_off_by, 10),
    qa_signed_off_by: row.qa_signed_off_by == null ? null : parseInt(row.qa_signed_off_by, 10),
    version: row.version == null ? 1 : parseInt(row.version, 10),
    period_start: dateOnly(row.period_start),
    period_end: dateOnly(row.period_end),
    due_date: dateOnly(row.due_date),
    completed_at: toIsoOrNull(row.completed_at),
    manager_signed_off_at: toIsoOrNull(row.manager_signed_off_at),
    qa_signed_off_at: toIsoOrNull(row.qa_signed_off_at),
    created_at: toIsoOrNull(row.created_at),
    updated_at: toIsoOrNull(row.updated_at),
    deleted_at: toIsoOrNull(row.deleted_at),
  };
}

export async function findByHome(homeId, filters = {}, client = pool) {
  const params = [homeId];
  const clauses = ['home_id = $1', 'deleted_at IS NULL'];
  if (filters.status) {
    params.push(filters.status);
    clauses.push(`status = $${params.length}`);
  }
  if (filters.category) {
    params.push(filters.category);
    clauses.push(`category = $${params.length}`);
  }
  if (filters.from) {
    params.push(filters.from);
    clauses.push(`due_date >= $${params.length}`);
  }
  if (filters.to) {
    params.push(filters.to);
    clauses.push(`due_date <= $${params.length}`);
  }
  const limit = Math.min(parseInt(filters.limit ?? 100, 10) || 100, 500);
  const offset = Math.max(parseInt(filters.offset ?? 0, 10) || 0, 0);
  params.push(limit, offset);
  const limitParam = params.length - 1;
  const offsetParam = params.length;

  const { rows } = await client.query(
    `SELECT ${COLS}, COUNT(*) OVER() AS _total
       FROM audit_tasks
      WHERE ${clauses.join(' AND ')}
      ORDER BY due_date ASC, id ASC
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
    `SELECT ${COLS} FROM audit_tasks WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`,
    [id, homeId],
  );
  return shapeRow(rows[0]);
}

export async function create(homeId, data, client = pool) {
  const { rows } = await client.query(
    `INSERT INTO audit_tasks (
       home_id, template_key, title, category, frequency, period_start, period_end,
       due_date, owner_user_id, status, evidence_required, evidence_notes,
       created_by, updated_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13
     )
     RETURNING ${COLS}`,
    [
      homeId,
      data.template_key || null,
      data.title,
      data.category || 'governance',
      data.frequency || 'ad_hoc',
      data.period_start || null,
      data.period_end || null,
      data.due_date,
      data.owner_user_id || null,
      data.status || 'open',
      data.evidence_required ?? true,
      data.evidence_notes || null,
      data.actor_id || null,
    ],
  );
  return shapeRow(rows[0]);
}

export async function createGenerated(homeId, tasks, actorId = null, client = pool) {
  if (!Array.isArray(tasks) || tasks.length === 0) return [];
  const values = [];
  const params = [];
  for (const task of tasks) {
    const offset = params.length;
    params.push(
      homeId,
      task.template_key,
      task.title,
      task.category || 'governance',
      task.frequency,
      task.period_start,
      task.period_end,
      task.due_date,
      task.evidence_required ?? true,
      actorId,
    );
    values.push(
      `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7},$${offset + 8},$${offset + 9},$${offset + 10},$${offset + 10})`,
    );
  }

  const { rows } = await client.query(
    `INSERT INTO audit_tasks (
       home_id, template_key, title, category, frequency, period_start, period_end,
       due_date, evidence_required, created_by, updated_by
     ) VALUES ${values.join(', ')}
     ON CONFLICT (home_id, template_key, period_start)
       WHERE deleted_at IS NULL AND template_key IS NOT NULL AND period_start IS NOT NULL
       DO NOTHING
     RETURNING ${COLS}`,
    params,
  );
  return rows.map(shapeRow);
}

export async function update(id, homeId, data, version = null, actorId = null, client = pool) {
  const allowed = new Set([
    'template_key', 'title', 'category', 'frequency', 'period_start', 'period_end',
    'due_date', 'owner_user_id', 'status', 'evidence_required', 'evidence_notes',
  ]);
  const fields = Object.entries(data).filter(([key, value]) => allowed.has(key) && value !== undefined);
  if (fields.length === 0) return findById(id, homeId, client);

  const params = [id, homeId, ...fields.map(([, value]) => value ?? null), actorId];
  const actorParam = params.length;
  const setClause = fields.map(([key], index) => `${key} = $${index + 3}`).join(', ');
  let sql = `
    UPDATE audit_tasks
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

export async function complete(id, homeId, actorId, evidenceNotes, version = null, client = pool) {
  const params = [id, homeId, actorId || null, evidenceNotes || null];
  let sql = `
    UPDATE audit_tasks
       SET status = 'completed',
           completed_at = NOW(),
           completed_by = $3,
           manager_signed_off_at = COALESCE(manager_signed_off_at, NOW()),
           manager_signed_off_by = COALESCE(manager_signed_off_by, $3),
           evidence_notes = COALESCE($4, evidence_notes),
           updated_by = $3,
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

export async function verify(id, homeId, actorId, version = null, client = pool) {
  const params = [id, homeId, actorId || null];
  let sql = `
    UPDATE audit_tasks
       SET status = 'verified',
           qa_signed_off_at = COALESCE(qa_signed_off_at, NOW()),
           qa_signed_off_by = COALESCE(qa_signed_off_by, $3),
           updated_by = $3,
           updated_at = NOW(),
           version = version + 1
     WHERE id = $1 AND home_id = $2 AND status = 'completed' AND deleted_at IS NULL
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
    `UPDATE audit_tasks
        SET deleted_at = NOW(), updated_at = NOW(), updated_by = $3
      WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`,
    [id, homeId, actorId],
  );
  return rowCount > 0;
}
