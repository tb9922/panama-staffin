import { randomUUID } from 'crypto';
import { pool } from '../db.js';
import { paginateResult } from '../lib/pagination.js';
import { normalizeEvidenceCategory } from '../src/lib/cqcEvidenceCategories.js';

const EVIDENCE_COLS = `
  id, home_id, version, quality_statement, type, title, description,
  date_from, date_to, evidence_category, evidence_owner, review_due,
  added_by, added_at, created_at, deleted_at
`;
const FILE_COUNT_SQL = `
  (
    SELECT COUNT(*)::int
      FROM cqc_evidence_files f
     WHERE f.home_id = e.home_id
       AND f.evidence_id = e.id
       AND f.deleted_at IS NULL
  ) AS file_count
`;

function shapeRow(row) {
  return {
    id: row.id,
    version: row.version != null ? parseInt(row.version, 10) : undefined,
    quality_statement: row.quality_statement,
    type: row.type,
    title: row.title,
    description: row.description,
    date_from: row.date_from,
    date_to: row.date_to,
    evidence_category: normalizeEvidenceCategory(row.evidence_category),
    evidence_owner: row.evidence_owner || null,
    review_due: row.review_due || null,
    added_by: row.added_by,
    added_at: row.added_at,
    file_count: row.file_count != null ? parseInt(row.file_count, 10) : 0,
  };
}

export async function findByHome(homeId, { limit = 100, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT ${EVIDENCE_COLS}, ${FILE_COUNT_SQL}, COUNT(*) OVER() AS _total
       FROM cqc_evidence e
      WHERE home_id = $1 AND deleted_at IS NULL
      ORDER BY added_at DESC NULLS LAST
      LIMIT $2 OFFSET $3`,
    [homeId, Math.min(limit, 500), Math.max(offset, 0)]
  );
  return paginateResult(rows, shapeRow);
}

export async function sync(homeId, arr, client) {
  const conn = client || pool;
  if (!arr) return;
  const incomingIds = arr.map((entry) => entry.id);

  const COLS_PER_ROW = 12;
  const CHUNK = Math.floor(65000 / COLS_PER_ROW);
  for (let i = 0; i < arr.length; i += CHUNK) {
    const chunk = arr.slice(i, i + CHUNK);
    const placeholders = [];
    const values = [];
    chunk.forEach((entry, index) => {
      const base = index * COLS_PER_ROW + 2;
      placeholders.push(
        `($${base},$1,$${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11})`
      );
      values.push(
        entry.id,
        entry.quality_statement || null,
        entry.type || null,
        entry.title || null,
        entry.description || null,
        entry.date_from || null,
        entry.date_to || null,
        normalizeEvidenceCategory(entry.evidence_category),
        entry.evidence_owner || null,
        entry.review_due || null,
        entry.added_by || null,
        entry.added_at || null
      );
    });

    await conn.query(
      `INSERT INTO cqc_evidence (
         id, home_id, quality_statement, type, title, description,
         date_from, date_to, evidence_category, evidence_owner, review_due, added_by, added_at
       ) VALUES ${placeholders.join(',')}
       ON CONFLICT (home_id, id) DO UPDATE SET
         quality_statement = EXCLUDED.quality_statement,
         type = EXCLUDED.type,
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         date_from = EXCLUDED.date_from,
         date_to = EXCLUDED.date_to,
         evidence_category = EXCLUDED.evidence_category,
         evidence_owner = EXCLUDED.evidence_owner,
         review_due = EXCLUDED.review_due,
         added_by = EXCLUDED.added_by,
         added_at = EXCLUDED.added_at,
         deleted_at = NULL`,
      [homeId, ...values]
    );
  }

  if (incomingIds.length > 0) {
    await conn.query(
      `UPDATE cqc_evidence
          SET deleted_at = NOW()
        WHERE home_id = $1
          AND id != ALL($2::text[])
          AND deleted_at IS NULL`,
      [homeId, incomingIds]
    );
  } else {
    await conn.query(
      `UPDATE cqc_evidence
          SET deleted_at = NOW()
        WHERE home_id = $1
          AND deleted_at IS NULL`,
      [homeId]
    );
  }
}

export async function findById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${EVIDENCE_COLS}, ${FILE_COUNT_SQL}
       FROM cqc_evidence e
      WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`,
    [id, homeId]
  );
  return rows[0] ? shapeRow(rows[0]) : null;
}

export async function upsert(homeId, data, client) {
  const conn = client || pool;
  const id = data.id || `cqc-${randomUUID()}`;
  const now = new Date().toISOString();
  const { rows } = await conn.query(
    `INSERT INTO cqc_evidence (
       id, home_id, quality_statement, type, title, description,
       date_from, date_to, evidence_category, evidence_owner, review_due, added_by, added_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (home_id, id) DO UPDATE SET
       quality_statement = $3,
       type = $4,
       title = $5,
       description = $6,
       date_from = $7,
       date_to = $8,
       evidence_category = $9,
       evidence_owner = $10,
       review_due = $11,
       added_by = $12,
       added_at = $13,
       deleted_at = NULL
     RETURNING id`,
    [
      id,
      homeId,
      data.quality_statement || null,
      data.type || null,
      data.title || null,
      data.description || null,
      data.date_from || null,
      data.date_to || null,
      normalizeEvidenceCategory(data.evidence_category),
      data.evidence_owner || null,
      data.review_due || null,
      data.added_by || null,
      data.added_at || now,
    ]
  );
  return rows[0] ? findById(rows[0].id, homeId, conn) : null;
}

const ALLOWED_COLUMNS = new Set([
  'quality_statement',
  'type',
  'title',
  'description',
  'date_from',
  'date_to',
  'evidence_category',
  'evidence_owner',
  'review_due',
  'added_by',
]);

export async function update(id, homeId, data, version) {
  const payload = {
    ...data,
    evidence_category:
      data.evidence_category === undefined
        ? undefined
        : normalizeEvidenceCategory(data.evidence_category),
  };
  const fields = Object.entries(payload).filter(([key, value]) => value !== undefined && ALLOWED_COLUMNS.has(key));
  if (fields.length === 0) return findById(id, homeId);

  const setClause = fields.map(([key], index) => `"${key}" = $${index + 3}`).join(', ');
  const values = fields.map(([, value]) => value);
  const params = [id, homeId, ...values];
  let sql = `
    UPDATE cqc_evidence
       SET ${setClause},
           version = version + 1
     WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL
  `;
  if (version != null) {
    params.push(version);
    sql += ` AND version = $${params.length}`;
  }
  sql += ` RETURNING id`;
  const { rows, rowCount } = await pool.query(sql, params);
  if (rowCount === 0 && version != null) return null;
  return rows[0] ? findById(rows[0].id, homeId) : null;
}

export async function softDelete(id, homeId) {
  const { rowCount } = await pool.query(
    `UPDATE cqc_evidence
        SET deleted_at = NOW()
      WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`,
    [id, homeId]
  );
  return rowCount > 0;
}
