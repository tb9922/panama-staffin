import { pool } from '../db.js';

const COLS = `
  id, home_id, quality_statement, narrative, risks, actions,
  reviewed_by, reviewed_at, review_due, version, created_at, updated_at, deleted_at
`;

function shapeRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    home_id: row.home_id,
    quality_statement: row.quality_statement,
    narrative: row.narrative,
    risks: row.risks,
    actions: row.actions,
    reviewed_by: row.reviewed_by,
    reviewed_at: row.reviewed_at,
    review_due: row.review_due,
    version: row.version != null ? parseInt(row.version, 10) : 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at || null,
  };
}

async function findAnyByStatement(homeId, qualityStatement, client = pool) {
  const { rows } = await client.query(
    `SELECT ${COLS}
       FROM cqc_statement_narratives
      WHERE home_id = $1 AND quality_statement = $2`,
    [homeId, qualityStatement]
  );
  return shapeRow(rows[0]);
}

export async function findByHome(homeId, client = pool) {
  const { rows } = await client.query(
    `SELECT ${COLS}
       FROM cqc_statement_narratives
      WHERE home_id = $1 AND deleted_at IS NULL
      ORDER BY quality_statement`,
    [homeId]
  );
  return rows.map(shapeRow);
}

export async function findByStatement(homeId, qualityStatement, client = pool) {
  const { rows } = await client.query(
    `SELECT ${COLS}
       FROM cqc_statement_narratives
      WHERE home_id = $1 AND quality_statement = $2 AND deleted_at IS NULL`,
    [homeId, qualityStatement]
  );
  return shapeRow(rows[0]);
}

export async function upsert(homeId, qualityStatement, data, version = null, client = pool) {
  const existing = await findAnyByStatement(homeId, qualityStatement, client);
  if (existing && existing.deleted_at == null && version != null && existing.version !== version) return null;

  if (!existing) {
    const { rows } = await client.query(
      `INSERT INTO cqc_statement_narratives (
         home_id, quality_statement, narrative, risks, actions,
         reviewed_by, reviewed_at, review_due
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING ${COLS}`,
      [
        homeId,
        qualityStatement,
        data.narrative || null,
        data.risks || null,
        data.actions || null,
        data.reviewed_by || null,
        data.reviewed_at || null,
        data.review_due || null,
      ]
    );
    return shapeRow(rows[0]);
  }

  const { rows } = await client.query(
    `UPDATE cqc_statement_narratives
        SET narrative = $3,
            risks = $4,
            actions = $5,
            reviewed_by = $6,
            reviewed_at = $7,
            review_due = $8,
            deleted_at = NULL,
            version = version + 1,
            updated_at = NOW()
      WHERE home_id = $1 AND quality_statement = $2
      RETURNING ${COLS}`,
    [
      homeId,
      qualityStatement,
      data.narrative || null,
      data.risks || null,
      data.actions || null,
      data.reviewed_by || null,
      data.reviewed_at || null,
      data.review_due || null,
    ]
  );
  return shapeRow(rows[0]);
}

export async function softDelete(homeId, qualityStatement, client = pool) {
  const { rowCount } = await client.query(
    `UPDATE cqc_statement_narratives
        SET deleted_at = NOW(),
            updated_at = NOW()
      WHERE home_id = $1 AND quality_statement = $2 AND deleted_at IS NULL`,
    [homeId, qualityStatement]
  );
  return rowCount > 0;
}
