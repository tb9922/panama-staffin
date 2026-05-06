import { pool } from '../db.js';
import { toIsoOrNull } from '../lib/serverTimestamps.js';

const COLS = `
  id, home_id, source_type, source_id, source_action_key, title, description,
  category, priority, owner_user_id, owner_name, owner_role, due_date, status,
  evidence_required, evidence_notes, escalation_level, escalated_at,
  completed_at, completed_by, verified_at, verified_by, created_by, updated_by,
  version, created_at, updated_at, deleted_at
`;

const JOIN_COLS = COLS
  .split(',')
  .map(col => col.trim())
  .filter(Boolean)
  .map(col => `ai.${col}`)
  .join(', ');

const JOIN_COLS_WITH_OWNER = `
  ${JOIN_COLS},
  NULLIF(u.display_name, '') AS owner_display_name,
  u.username AS owner_username
`;

const DATE_FIELDS = new Set(['due_date']);
const JSON_INT_FIELDS = new Set([
  'id',
  'home_id',
  'owner_user_id',
  'escalation_level',
  'completed_by',
  'verified_by',
  'created_by',
  'updated_by',
  'version',
]);

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function intOrNull(value) {
  return value == null ? null : parseInt(value, 10);
}

function shapeRow(row) {
  if (!row) return null;
  const shaped = {};
  for (const [key, value] of Object.entries(row)) {
    if (DATE_FIELDS.has(key)) shaped[key] = dateOnly(value);
    else if (JSON_INT_FIELDS.has(key)) shaped[key] = intOrNull(value);
    else if (key.endsWith('_at')) shaped[key] = toIsoOrNull(value);
    else shaped[key] = value;
  }
  if (shaped.owner_user_id != null && !shaped.owner_name) {
    shaped.owner_name = shaped.owner_display_name || shaped.owner_username || null;
  }
  shaped.owner_label = shaped.owner_name || shaped.owner_role || shaped.owner_display_name || shaped.owner_username || null;
  return shaped;
}

export async function findByHome(homeId, filters = {}, client = pool) {
  const clauses = ['ai.home_id = $1', 'ai.deleted_at IS NULL'];
  const params = [homeId];

  const addFilter = (column, value) => {
    if (value == null || value === '') return;
    params.push(value);
    clauses.push(`ai.${column} = $${params.length}`);
  };

  addFilter('status', filters.status);
  addFilter('source_type', filters.source_type);
  addFilter('priority', filters.priority);
  addFilter('category', filters.category);
  if (filters.owner_user_id != null && filters.owner_user_id !== '') {
    params.push(filters.owner_user_id);
    clauses.push(`ai.owner_user_id = $${params.length}`);
  }
  if (filters.overdue === true || filters.overdue === 'true') {
    clauses.push(`ai.due_date < CURRENT_DATE`);
    clauses.push(`ai.status NOT IN ('completed', 'verified', 'cancelled')`);
  }

  const limit = Math.min(parseInt(filters.limit ?? 100, 10) || 100, 500);
  const offset = Math.max(parseInt(filters.offset ?? 0, 10) || 0, 0);
  params.push(limit, offset);
  const limitParam = params.length - 1;
  const offsetParam = params.length;

  const { rows } = await client.query(
    `SELECT ${JOIN_COLS_WITH_OWNER}, COUNT(*) OVER() AS _total
       FROM action_items ai
       LEFT JOIN users u ON u.id = ai.owner_user_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY
        CASE ai.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        ai.due_date ASC,
        ai.id DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}`,
    params
  );
  const total = rows.length > 0 ? parseInt(rows[0]._total, 10) : 0;
  return {
    rows: rows.map(({ _total, ...row }) => shapeRow(row)),
    total,
  };
}

export async function findById(id, homeId, client = pool) {
  const { rows } = await client.query(
    `SELECT ${JOIN_COLS_WITH_OWNER}
       FROM action_items ai
       LEFT JOIN users u ON u.id = ai.owner_user_id
      WHERE ai.id = $1 AND ai.home_id = $2 AND ai.deleted_at IS NULL`,
    [id, homeId]
  );
  return shapeRow(rows[0]);
}

export async function findBySource(homeId, sourceType, sourceId, sourceActionKey, client = pool) {
  const { rows } = await client.query(
    `SELECT ${JOIN_COLS_WITH_OWNER}
       FROM action_items ai
       LEFT JOIN users u ON u.id = ai.owner_user_id
      WHERE ai.home_id = $1
        AND ai.source_type = $2
        AND ai.source_id = $3
        AND ai.source_action_key = $4
        AND ai.deleted_at IS NULL`,
    [homeId, sourceType, sourceId, sourceActionKey]
  );
  return shapeRow(rows[0]);
}

export async function create(homeId, data, client = pool) {
  const { rows } = await client.query(
    `INSERT INTO action_items (
       home_id, source_type, source_id, source_action_key, title, description,
       category, priority, owner_user_id, owner_name, owner_role, due_date,
       status, evidence_required, evidence_notes, escalation_level,
       created_by, updated_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
     )
     RETURNING ${COLS}`,
    [
      homeId,
      data.source_type || 'standalone',
      data.source_id || null,
      data.source_action_key || null,
      data.title,
      data.description || null,
      data.category || 'operational',
      data.priority || 'medium',
      data.owner_user_id || null,
      data.owner_name || null,
      data.owner_role || null,
      data.due_date,
      data.status || 'open',
      data.evidence_required ?? false,
      data.evidence_notes || null,
      data.escalation_level ?? 0,
      data.created_by || null,
      data.updated_by || data.created_by || null,
    ]
  );
  return shapeRow(rows[0]);
}

export async function findOrCreateBySource(homeId, data, client = pool) {
  if (!data.source_type || data.source_id == null || !data.source_action_key) {
    throw new Error('source_type, source_id and source_action_key are required for source action creation');
  }

  const sourceId = String(data.source_id);
  const { rows } = await client.query(
    `INSERT INTO action_items (
       home_id, source_type, source_id, source_action_key, title, description,
       category, priority, owner_user_id, owner_name, owner_role, due_date,
       status, evidence_required, evidence_notes, escalation_level,
       created_by, updated_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
     )
     ON CONFLICT (home_id, source_type, source_id, source_action_key)
       WHERE deleted_at IS NULL AND source_id IS NOT NULL AND source_action_key IS NOT NULL
       DO NOTHING
     RETURNING ${COLS}`,
    [
      homeId,
      data.source_type,
      sourceId,
      data.source_action_key,
      data.title,
      data.description || null,
      data.category || 'operational',
      data.priority || 'medium',
      data.owner_user_id || null,
      data.owner_name || null,
      data.owner_role || null,
      data.due_date,
      data.status || 'open',
      data.evidence_required ?? false,
      data.evidence_notes || null,
      data.escalation_level ?? 0,
      data.created_by || null,
      data.updated_by || data.created_by || null,
    ]
  );

  if (rows[0]) return { item: shapeRow(rows[0]), created: true };

  const existing = await findBySource(
    homeId,
    data.source_type,
    sourceId,
    data.source_action_key,
    client
  );
  return { item: existing, created: false };
}

const SOURCE_SYNC_COLUMNS = [
  'title',
  'description',
  'category',
  'priority',
  'owner_user_id',
  'owner_name',
  'owner_role',
  'due_date',
  'evidence_required',
  'evidence_notes',
  'escalation_level',
];

const TERMINAL_STATUSES = new Set(['completed', 'verified']);
const CLOSED_STATUSES = new Set([...TERMINAL_STATUSES, 'cancelled']);

function valuesDiffer(left, right) {
  if (left == null && right == null) return false;
  return String(left ?? '') !== String(right ?? '');
}

export async function syncBySource(homeId, data, updatedBy = null, client = pool) {
  const result = await findOrCreateBySource(homeId, data, client);
  if (result.created || !result.item || TERMINAL_STATUSES.has(result.item.status)) {
    return { ...result, updated: false };
  }

  const updates = {};
  if (result.item.status === 'cancelled') {
    updates.status = data.status || 'open';
  }
  for (const key of SOURCE_SYNC_COLUMNS) {
    if (data[key] !== undefined && valuesDiffer(result.item[key], data[key])) {
      updates[key] = data[key];
    }
  }

  if (Object.keys(updates).length === 0) {
    return { ...result, updated: false };
  }

  const item = await update(result.item.id, homeId, updates, null, updatedBy, client);
  return { item, created: false, updated: true };
}

export async function cancelBySource(homeId, sourceType, sourceId, sourceActionKey, updatedBy = null, client = pool) {
  const existing = await findBySource(homeId, sourceType, String(sourceId), sourceActionKey, client);
  if (!existing || CLOSED_STATUSES.has(existing.status)) {
    return { item: existing, cancelled: false };
  }
  const item = await update(
    existing.id,
    homeId,
    { status: 'cancelled', escalation_level: 0 },
    null,
    updatedBy,
    client,
  );
  return { item, cancelled: Boolean(item) };
}

export async function cancelAllBySource(homeId, sourceType, sourceId, updatedBy = null, client = pool) {
  const { rows } = await client.query(
    `SELECT id
       FROM action_items
      WHERE home_id = $1
        AND source_type = $2
        AND source_id = $3
        AND deleted_at IS NULL
        AND status NOT IN ('completed', 'verified', 'cancelled')`,
    [homeId, sourceType, String(sourceId)]
  );

  const cancelled = [];
  for (const row of rows) {
    const item = await update(
      row.id,
      homeId,
      { status: 'cancelled', escalation_level: 0 },
      null,
      updatedBy,
      client,
    );
    if (item) cancelled.push(item);
  }
  return cancelled;
}

const ALLOWED_UPDATE_COLUMNS = new Set([
  'source_type',
  'source_id',
  'source_action_key',
  'title',
  'description',
  'category',
  'priority',
  'owner_user_id',
  'owner_name',
  'owner_role',
  'due_date',
  'status',
  'evidence_required',
  'evidence_notes',
  'escalation_level',
]);

export async function update(id, homeId, data, version = null, updatedBy = null, client = pool) {
  const fields = Object.entries(data).filter(([key, value]) => (
    value !== undefined && ALLOWED_UPDATE_COLUMNS.has(key)
  ));
  if (fields.length === 0) return findById(id, homeId, client);

  const params = [id, homeId, ...fields.map(([, value]) => value)];
  const setClause = fields.map(([key], index) => `"${key}" = $${index + 3}`).join(', ');
  params.push(updatedBy);
  const updatedByParam = params.length;

  let sql = `
    UPDATE action_items
       SET ${setClause},
           updated_by = $${updatedByParam},
           updated_at = NOW(),
           version = version + 1
     WHERE id = $1
       AND home_id = $2
       AND deleted_at IS NULL
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

export async function complete(id, homeId, userId, version = null, evidenceNotes = undefined, client = pool) {
  const params = [id, homeId, userId, evidenceNotes ?? null];
  let sql = `
    UPDATE action_items
       SET status = 'completed',
           completed_at = NOW(),
           completed_by = $3,
           evidence_notes = COALESCE($4, evidence_notes),
           escalation_level = 0,
           updated_by = $3,
           updated_at = NOW(),
           version = version + 1
     WHERE id = $1
       AND home_id = $2
       AND deleted_at IS NULL
       AND status IN ('open', 'in_progress', 'blocked')
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

export async function verify(id, homeId, userId, version = null, client = pool) {
  const params = [id, homeId, userId];
  let sql = `
    UPDATE action_items
       SET status = 'verified',
           verified_at = NOW(),
           verified_by = $3,
           escalation_level = 0,
           updated_by = $3,
           updated_at = NOW(),
           version = version + 1
     WHERE id = $1
       AND home_id = $2
       AND deleted_at IS NULL
       AND status = 'completed'
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

export async function softDelete(id, homeId, updatedBy = null, client = pool) {
  const { rows, rowCount } = await client.query(
    `UPDATE action_items
        SET deleted_at = NOW(),
            updated_at = NOW(),
            updated_by = $3,
            version = version + 1
      WHERE id = $1
        AND home_id = $2
        AND deleted_at IS NULL
      RETURNING ${COLS}`,
    [id, homeId, updatedBy]
  );
  return rowCount > 0 ? shapeRow(rows[0]) : null;
}

export async function findEscalationCandidates(today = new Date(), client = pool) {
  const { rows } = await client.query(
    `SELECT ai.id, ai.home_id, ai.priority, ai.status, ai.due_date,
            ai.escalation_level, h.slug AS home_slug
       FROM action_items ai
       JOIN homes h ON h.id = ai.home_id
      WHERE ai.deleted_at IS NULL
        AND ai.status NOT IN ('completed', 'verified', 'cancelled')
        AND ai.due_date <= $1::date`,
    [dateOnly(today)]
  );
  return rows.map(row => ({
    ...shapeRow(row),
    home_slug: row.home_slug,
  }));
}

export async function setEscalationLevel(id, homeId, level, client = pool) {
  const { rows } = await client.query(
    `UPDATE action_items
        SET escalation_level = $3,
            escalated_at = CASE WHEN $3 > escalation_level THEN NOW() ELSE escalated_at END,
            updated_at = NOW(),
            version = version + 1
      WHERE id = $1
        AND home_id = $2
        AND deleted_at IS NULL
      RETURNING ${COLS}`,
    [id, homeId, level]
  );
  return shapeRow(rows[0]);
}

export async function countByHome(homeIds, client = pool) {
  if (!Array.isArray(homeIds) || homeIds.length === 0) return [];
  const { rows } = await client.query(
    `SELECT home_id,
            COUNT(*) FILTER (WHERE status NOT IN ('completed', 'verified', 'cancelled'))::int AS open,
            COUNT(*) FILTER (
              WHERE status NOT IN ('completed', 'verified', 'cancelled')
                AND due_date < CURRENT_DATE
            )::int AS overdue,
            COUNT(*) FILTER (
              WHERE status NOT IN ('completed', 'verified', 'cancelled')
                AND escalation_level >= 3
            )::int AS escalated_l3_plus,
            COUNT(*) FILTER (
              WHERE status IN ('completed', 'verified')
                AND completed_at >= NOW() - INTERVAL '28 days'
            )::int AS completed_28d
       FROM action_items
      WHERE home_id = ANY($1::int[])
        AND deleted_at IS NULL
      GROUP BY home_id`,
    [homeIds]
  );
  return rows;
}

export async function findEscalatedByHomeIds(homeIds, limit = 25, client = pool) {
  if (!Array.isArray(homeIds) || homeIds.length === 0) return [];
  const cappedLimit = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  const { rows } = await client.query(
    `SELECT ${JOIN_COLS_WITH_OWNER}, h.slug AS home_slug, COALESCE(h.config->>'home_name', h.name) AS home_name
       FROM action_items ai
       JOIN homes h ON h.id = ai.home_id
       LEFT JOIN users u ON u.id = ai.owner_user_id
      WHERE ai.home_id = ANY($1::int[])
        AND ai.deleted_at IS NULL
        AND ai.status NOT IN ('completed', 'verified', 'cancelled')
        AND ai.escalation_level >= 3
      ORDER BY ai.escalation_level DESC,
               CASE ai.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
               ai.due_date ASC,
               ai.id DESC
      LIMIT $2`,
    [homeIds, cappedLimit]
  );
  return rows.map(row => ({
    ...shapeRow(row),
    home_slug: row.home_slug,
    home_name: row.home_name,
  }));
}

export async function findBoardPackExceptionsByHomeIds(homeIds, limit = 50, client = pool) {
  if (!Array.isArray(homeIds) || homeIds.length === 0) {
    return { rows: [], total: 0, omitted: 0, limit: 0 };
  }
  const cappedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 250);
  const { rows } = await client.query(
    `SELECT ${JOIN_COLS_WITH_OWNER}, h.slug AS home_slug,
            COALESCE(h.config->>'home_name', h.name) AS home_name,
            COUNT(*) OVER() AS _total
       FROM action_items ai
       JOIN homes h ON h.id = ai.home_id
       LEFT JOIN users u ON u.id = ai.owner_user_id
      WHERE ai.home_id = ANY($1::int[])
        AND ai.deleted_at IS NULL
        AND ai.status NOT IN ('completed', 'verified', 'cancelled')
        AND (
          ai.due_date < CURRENT_DATE
          OR ai.priority IN ('high', 'critical')
          OR ai.escalation_level >= 3
        )
      ORDER BY
        CASE ai.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        CASE WHEN ai.due_date < CURRENT_DATE THEN 0 ELSE 1 END,
        ai.due_date ASC,
        ai.escalation_level DESC,
        ai.id DESC
      LIMIT $2`,
    [homeIds, cappedLimit]
  );
  const total = rows.length > 0 ? parseInt(rows[0]._total, 10) : 0;
  return {
    rows: rows.map(({ _total, ...row }) => ({
      ...shapeRow(row),
      home_slug: row.home_slug,
      home_name: row.home_name,
    })),
    total,
    omitted: Math.max(0, total - rows.length),
    limit: cappedLimit,
  };
}
