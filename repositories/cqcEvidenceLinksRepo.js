import { pool } from '../db.js';
import { paginateResult } from '../lib/pagination.js';

const COLS = `
  id, home_id, source_module, source_id, quality_statement, evidence_category,
  rationale, auto_linked, requires_review, linked_by, source_recorded_at,
  version, created_at, updated_at, deleted_at
`;
const QUALIFIED_COLS = `
  l.id, l.home_id, l.source_module, l.source_id, l.quality_statement, l.evidence_category,
  l.rationale, l.auto_linked, l.requires_review, l.linked_by, l.source_recorded_at,
  l.version, l.created_at, l.updated_at, l.deleted_at
`;

function ts(value) {
  return value instanceof Date ? value.toISOString() : value || null;
}

function normaliseRecordedAt(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00Z`;
  return value;
}

function shapeRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    homeId: row.home_id,
    sourceModule: row.source_module,
    sourceId: row.source_id,
    qualityStatement: row.quality_statement,
    evidenceCategory: row.evidence_category,
    rationale: row.rationale || null,
    autoLinked: Boolean(row.auto_linked),
    requiresReview: Boolean(row.requires_review),
    linkedBy: row.linked_by,
    sourceRecordedAt: ts(row.source_recorded_at),
    version: row.version != null ? parseInt(row.version, 10) : 1,
    createdAt: ts(row.created_at),
    updatedAt: ts(row.updated_at),
  };
}

function addDateRange(where, params, dateFrom, dateTo) {
  const field = 'COALESCE(source_recorded_at, created_at)';
  if (dateFrom) {
    params.push(dateFrom);
    where.push(`${field} >= $${params.length}::date`);
  }
  if (dateTo) {
    params.push(dateTo);
    where.push(`${field} < ($${params.length}::date + INTERVAL '1 day')`);
  }
}

export async function findById(id, homeId, client = pool) {
  const { rows } = await client.query(
    `SELECT ${COLS}
       FROM cqc_evidence_links
      WHERE id = $1
        AND home_id = $2
        AND deleted_at IS NULL`,
    [id, homeId]
  );
  return shapeRow(rows[0]);
}

export async function findByStatement(homeId, statementId, { dateFrom, dateTo, limit = 100, offset = 0 } = {}, client = pool) {
  const where = ['home_id = $1', 'quality_statement = $2', 'deleted_at IS NULL'];
  const params = [homeId, statementId];
  addDateRange(where, params, dateFrom, dateTo);
  params.push(Math.min(limit, 500), Math.max(offset, 0));

  const { rows } = await client.query(
    `SELECT ${COLS}, COUNT(*) OVER() AS _total
       FROM cqc_evidence_links
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(source_recorded_at, created_at) DESC, created_at DESC, id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return paginateResult(rows, shapeRow);
}

export async function findBySource(homeId, sourceModule, sourceId, client = pool) {
  const { rows } = await client.query(
    `SELECT ${COLS}
       FROM cqc_evidence_links
      WHERE home_id = $1
        AND source_module = $2
        AND source_id = $3
        AND deleted_at IS NULL
      ORDER BY COALESCE(source_recorded_at, created_at) DESC, created_at DESC, id DESC`,
    [homeId, sourceModule, String(sourceId)]
  );
  return rows.map(shapeRow);
}

export async function findByHome(
  homeId,
  { sourceModules, statements, categories, autoLinked, requiresReview, dateFrom, dateTo, limit = 100, offset = 0 } = {},
  client = pool
) {
  const where = ['home_id = $1', 'deleted_at IS NULL'];
  const params = [homeId];

  if (sourceModules?.length) {
    params.push(sourceModules);
    where.push(`source_module = ANY($${params.length}::text[])`);
  }
  if (statements?.length) {
    params.push(statements);
    where.push(`quality_statement = ANY($${params.length}::text[])`);
  }
  if (categories?.length) {
    params.push(categories);
    where.push(`evidence_category = ANY($${params.length}::text[])`);
  }
  if (autoLinked !== undefined) {
    params.push(autoLinked);
    where.push(`auto_linked = $${params.length}`);
  }
  if (requiresReview !== undefined) {
    params.push(requiresReview);
    where.push(`requires_review = $${params.length}`);
  }
  addDateRange(where, params, dateFrom, dateTo);

  params.push(Math.min(limit, 500), Math.max(offset, 0));
  const { rows } = await client.query(
    `SELECT ${COLS}, COUNT(*) OVER() AS _total
       FROM cqc_evidence_links
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(source_recorded_at, created_at) DESC, created_at DESC, id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return paginateResult(rows, shapeRow);
}

export async function countByStatement(homeId, { dateFrom, dateTo } = {}, client = pool) {
  const where = ['home_id = $1', 'deleted_at IS NULL'];
  const params = [homeId];
  addDateRange(where, params, dateFrom, dateTo);

  const { rows } = await client.query(
    `SELECT quality_statement,
            evidence_category,
            COUNT(*)::int AS count,
            MIN(COALESCE(source_recorded_at, created_at)) AS oldest,
            MAX(COALESCE(source_recorded_at, created_at)) AS newest
       FROM cqc_evidence_links
      WHERE ${where.join(' AND ')}
      GROUP BY quality_statement, evidence_category
      ORDER BY quality_statement, evidence_category`,
    params
  );

  return rows.map((row) => ({
    qualityStatement: row.quality_statement,
    evidenceCategory: row.evidence_category,
    count: parseInt(row.count, 10),
    oldest: ts(row.oldest),
    newest: ts(row.newest),
  }));
}

export async function createLink(homeId, data, client = pool) {
  const params = [
    homeId,
    data.source_module,
    String(data.source_id),
    data.quality_statement,
    data.evidence_category,
    data.rationale || null,
    data.auto_linked ?? false,
    data.requires_review ?? false,
    data.linked_by,
    normaliseRecordedAt(data.source_recorded_at),
  ];

  const { rows } = await client.query(
    `WITH inserted AS (
       INSERT INTO cqc_evidence_links (
         home_id, source_module, source_id, quality_statement, evidence_category,
         rationale, auto_linked, requires_review, linked_by, source_recorded_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (home_id, source_module, source_id, quality_statement, evidence_category)
         WHERE deleted_at IS NULL
       DO NOTHING
       RETURNING ${COLS}
     )
     SELECT ${COLS} FROM inserted
     UNION ALL
     SELECT ${COLS}
       FROM cqc_evidence_links
      WHERE home_id = $1
        AND source_module = $2
        AND source_id = $3
        AND quality_statement = $4
        AND evidence_category = $5
        AND deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM inserted)
      LIMIT 1`,
    params
  );
  return shapeRow(rows[0]);
}

export async function createBulkLinks(homeId, links, client = pool) {
  if (!Array.isArray(links) || links.length === 0) return [];

  const chunkSize = 1000;
  const foundById = new Map();

  for (let i = 0; i < links.length; i += chunkSize) {
    const chunk = links.slice(i, i + chunkSize);
    const rows = chunk.map((link) => [
      homeId,
      link.source_module,
      String(link.source_id),
      link.quality_statement,
      link.evidence_category,
      link.rationale || null,
      link.auto_linked ?? false,
      link.requires_review ?? false,
      link.linked_by,
      normaliseRecordedAt(link.source_recorded_at),
    ]);

    const values = [];
    const placeholders = rows.map((row, rowIndex) => {
      const base = rowIndex * 10;
      row.forEach((value) => values.push(value));
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10})`;
    });

    await client.query(
      `INSERT INTO cqc_evidence_links (
         home_id, source_module, source_id, quality_statement, evidence_category,
         rationale, auto_linked, requires_review, linked_by, source_recorded_at
       )
       VALUES ${placeholders.join(',')}
       ON CONFLICT (home_id, source_module, source_id, quality_statement, evidence_category)
         WHERE deleted_at IS NULL
       DO NOTHING`,
      values
    );

    const keyValues = [];
    const keyPlaceholders = rows.map((row, rowIndex) => {
      const base = rowIndex * 5;
      keyValues.push(row[0], row[1], row[2], row[3], row[4]);
      return `($${base + 1}::int,$${base + 2}::text,$${base + 3}::text,$${base + 4}::text,$${base + 5}::text)`;
    });

    const { rows: found } = await client.query(
      `WITH requested(home_id, source_module, source_id, quality_statement, evidence_category) AS (
         VALUES ${keyPlaceholders.join(',')}
       )
       SELECT DISTINCT ON (l.id) ${QUALIFIED_COLS}
         FROM cqc_evidence_links l
         JOIN requested r
           ON r.home_id = l.home_id
          AND r.source_module = l.source_module
          AND r.source_id = l.source_id
          AND r.quality_statement = l.quality_statement
          AND r.evidence_category = l.evidence_category
        WHERE l.deleted_at IS NULL
        ORDER BY l.id, COALESCE(l.source_recorded_at, l.created_at) DESC, l.created_at DESC`,
      keyValues
    );

    for (const row of found.map(shapeRow)) {
      foundById.set(row.id, row);
    }
  }

  return [...foundById.values()];
}

const ALLOWED_UPDATE_COLUMNS = new Set(['rationale', 'requires_review', 'source_recorded_at']);

export async function updateLink(id, homeId, data, version = null, client = pool) {
  const fields = Object.entries(data).filter(([key, value]) => value !== undefined && ALLOWED_UPDATE_COLUMNS.has(key));
  if (fields.length === 0) return findById(id, homeId, client);

  const assignments = [];
  const params = [id, homeId];
  for (const [key, rawValue] of fields) {
    params.push(key === 'source_recorded_at' ? normaliseRecordedAt(rawValue) : rawValue);
    assignments.push(`${key} = $${params.length}`);
  }

  let sql = `
    UPDATE cqc_evidence_links
       SET ${assignments.join(', ')},
           version = version + 1,
           updated_at = NOW()
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

export async function softDelete(id, homeId, client = pool) {
  const { rowCount } = await client.query(
    `UPDATE cqc_evidence_links
        SET deleted_at = NOW(),
            updated_at = NOW()
      WHERE id = $1
        AND home_id = $2
        AND deleted_at IS NULL`,
    [id, homeId]
  );
  return rowCount > 0;
}

export async function confirmAutoLink(id, homeId, username, client = pool) {
  const { rows } = await client.query(
    `UPDATE cqc_evidence_links
        SET requires_review = FALSE,
            linked_by = $3,
            version = version + 1,
            updated_at = NOW()
      WHERE id = $1
        AND home_id = $2
        AND deleted_at IS NULL
      RETURNING ${COLS}`,
    [id, homeId, username]
  );
  return shapeRow(rows[0]);
}

export async function confirmBulkAutoLinks(homeId, ids, username, client = pool) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const { rows } = await client.query(
    `UPDATE cqc_evidence_links
        SET requires_review = FALSE,
            linked_by = $3,
            version = version + 1,
            updated_at = NOW()
      WHERE home_id = $1
        AND id = ANY($2::int[])
        AND deleted_at IS NULL
      RETURNING ${COLS}`,
    [homeId, ids, username]
  );
  return rows.map(shapeRow);
}
