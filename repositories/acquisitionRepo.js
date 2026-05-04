import { pool } from '../db.js';
import { toIsoOrNull } from '../lib/serverTimestamps.js';

export const ACQUISITION_ITEM_DEFINITIONS = [
  {
    item_key: 'staff_import',
    title: 'Staff import',
    description: 'Staff roster, roles, start dates, rates and contract baselines ready for import.',
  },
  {
    item_key: 'resident_import',
    title: 'Resident import',
    description: 'Resident list, room/bed links and finance identifiers ready for import.',
  },
  {
    item_key: 'training_import',
    title: 'Training import',
    description: 'Mandatory training matrix and evidence references ready for import.',
  },
  {
    item_key: 'rota_baseline',
    title: 'Rota baseline',
    description: 'Shift templates, minimum staffing and rota assumptions checked before go-live.',
  },
  {
    item_key: 'documents',
    title: 'Documents',
    description: 'Policies, contracts, evidence files and operational documents gathered.',
  },
  {
    item_key: 'users',
    title: 'Users',
    description: 'Home manager, admin and operational user access prepared.',
  },
  {
    item_key: 'audit_templates',
    title: 'Audit templates',
    description: 'Governance/audit templates confirmed for the incoming home.',
  },
  {
    item_key: 'go_live_signoff',
    title: 'Go-live signoff',
    description: 'Final manager signoff that the home is ready to go live.',
  },
];

export const ACQUISITION_ITEM_KEYS = ACQUISITION_ITEM_DEFINITIONS.map(item => item.item_key);
export const ACQUISITION_STATUSES = ['not_started', 'in_progress', 'blocked', 'ready', 'complete'];

const COLS = `
  id, home_id, item_key, title, description, status, owner_name, due_date,
  expected_count, imported_count, issue_count, evidence_ref, notes, blockers,
  created_by, updated_by, version, created_at, updated_at, deleted_at
`;

const ITEM_ORDER_SQL = `
  CASE item_key
    WHEN 'staff_import' THEN 1
    WHEN 'resident_import' THEN 2
    WHEN 'training_import' THEN 3
    WHEN 'rota_baseline' THEN 4
    WHEN 'documents' THEN 5
    WHEN 'users' THEN 6
    WHEN 'audit_templates' THEN 7
    WHEN 'go_live_signoff' THEN 8
    ELSE 99
  END
`;

const INT_FIELDS = new Set([
  'id',
  'home_id',
  'expected_count',
  'imported_count',
  'issue_count',
  'created_by',
  'updated_by',
  'version',
]);

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function shapeRow(row) {
  if (!row) return null;
  const shaped = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === 'due_date') shaped[key] = dateOnly(value);
    else if (INT_FIELDS.has(key)) shaped[key] = value == null ? null : parseInt(value, 10);
    else if (key.endsWith('_at')) shaped[key] = toIsoOrNull(value);
    else shaped[key] = value;
  }
  return shaped;
}

export async function ensureDefaultItems(homeId, createdBy = null, client = pool) {
  const { rows } = await client.query(
    `INSERT INTO acquisition_onboarding_items (
       home_id, item_key, title, description, created_by, updated_by
     )
     SELECT $1, item_key, title, description, $3, $3
       FROM jsonb_to_recordset($2::jsonb) AS d(item_key text, title text, description text)
     ON CONFLICT (home_id, item_key) WHERE deleted_at IS NULL DO NOTHING
     RETURNING ${COLS}`,
    [homeId, JSON.stringify(ACQUISITION_ITEM_DEFINITIONS), createdBy]
  );
  return rows.map(shapeRow);
}

export async function findByHome(homeId, filters = {}, client = pool) {
  const clauses = ['home_id = $1', 'deleted_at IS NULL'];
  const params = [homeId];

  if (filters.status) {
    params.push(filters.status);
    clauses.push(`status = $${params.length}`);
  }

  if (filters.item_key) {
    params.push(filters.item_key);
    clauses.push(`item_key = $${params.length}`);
  }

  const { rows } = await client.query(
    `SELECT ${COLS}
       FROM acquisition_onboarding_items
      WHERE ${clauses.join(' AND ')}
      ORDER BY ${ITEM_ORDER_SQL}, id ASC`,
    params
  );
  return rows.map(shapeRow);
}

export async function findById(id, homeId, client = pool) {
  const { rows } = await client.query(
    `SELECT ${COLS}
       FROM acquisition_onboarding_items
      WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`,
    [id, homeId]
  );
  return shapeRow(rows[0]);
}

export async function create(homeId, data, actorId = null, client = pool) {
  const { rows } = await client.query(
    `INSERT INTO acquisition_onboarding_items (
       home_id, item_key, title, description, status, owner_name, due_date,
       expected_count, imported_count, issue_count, evidence_ref, notes, blockers,
       created_by, updated_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14
     )
     RETURNING ${COLS}`,
    [
      homeId,
      data.item_key,
      data.title,
      data.description ?? null,
      data.status ?? 'not_started',
      data.owner_name ?? null,
      data.due_date ?? null,
      data.expected_count ?? 0,
      data.imported_count ?? 0,
      data.issue_count ?? 0,
      data.evidence_ref ?? null,
      data.notes ?? null,
      data.blockers ?? null,
      actorId,
    ]
  );
  return shapeRow(rows[0]);
}

const ALLOWED_UPDATE_COLUMNS = new Set([
  'title',
  'description',
  'status',
  'owner_name',
  'due_date',
  'expected_count',
  'imported_count',
  'issue_count',
  'evidence_ref',
  'notes',
  'blockers',
]);

export async function update(id, homeId, data, version = null, actorId = null, client = pool) {
  const fields = Object.entries(data).filter(([key, value]) => (
    value !== undefined && ALLOWED_UPDATE_COLUMNS.has(key)
  ));
  if (fields.length === 0) return findById(id, homeId, client);

  const params = [id, homeId, ...fields.map(([, value]) => value)];
  const setClause = fields.map(([key], index) => `${key} = $${index + 3}`).join(', ');
  params.push(actorId);
  const actorParam = params.length;

  let sql = `
    UPDATE acquisition_onboarding_items
       SET ${setClause},
           updated_by = $${actorParam},
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

export async function softDelete(id, homeId, actorId = null, version = null, client = pool) {
  const params = [id, homeId, actorId];
  let sql = `
    UPDATE acquisition_onboarding_items
       SET deleted_at = NOW(),
           updated_at = NOW(),
           updated_by = $3,
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
  return rowCount > 0 ? shapeRow(rows[0]) : null;
}
