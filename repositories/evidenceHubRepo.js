import { pool } from '../db.js';
import { EVIDENCE_SOURCE_IDS } from '../shared/evidenceHub.js';

const SOURCE_QUERIES = {
  hr: `
    SELECT
      'hr'::TEXT AS source_module,
      case_type::TEXT AS source_sub_type,
      case_id::TEXT AS source_record_id,
      id AS attachment_id,
      NULL::TEXT AS quality_statement_id,
      NULL::TEXT AS evidence_category,
      NULL::TEXT AS evidence_owner,
      NULL::DATE AS review_due_at,
      original_name,
      stored_name,
      mime_type,
      size_bytes,
      description,
      uploaded_by,
      created_at
    FROM hr_file_attachments
    WHERE home_id = $1
      AND deleted_at IS NULL
      AND ($2::TEXT IS NULL OR original_name ILIKE $2 OR COALESCE(description, '') ILIKE $2)
      AND ($3::TEXT IS NULL OR uploaded_by = $3)
      AND ($4::DATE IS NULL OR (created_at AT TIME ZONE 'Europe/London')::DATE >= $4::DATE)
      AND ($5::DATE IS NULL OR (created_at AT TIME ZONE 'Europe/London')::DATE <= $5::DATE)
  `,
  cqc_evidence: `
    SELECT
      'cqc_evidence'::TEXT AS source_module,
      NULL::TEXT AS source_sub_type,
      f.evidence_id::TEXT AS source_record_id,
      f.id AS attachment_id,
      e.quality_statement::TEXT AS quality_statement_id,
      e.evidence_category::TEXT AS evidence_category,
      e.evidence_owner::TEXT AS evidence_owner,
      e.review_due::DATE AS review_due_at,
      f.original_name,
      f.stored_name,
      f.mime_type,
      f.size_bytes,
      f.description,
      f.uploaded_by,
      f.created_at
    FROM cqc_evidence_files f
    INNER JOIN cqc_evidence e
      ON e.home_id = f.home_id
     AND e.id = f.evidence_id
     AND e.deleted_at IS NULL
    WHERE f.home_id = $1
      AND f.deleted_at IS NULL
      AND ($2::TEXT IS NULL OR f.original_name ILIKE $2 OR COALESCE(f.description, '') ILIKE $2)
      AND ($3::TEXT IS NULL OR f.uploaded_by = $3)
      AND ($4::DATE IS NULL OR (f.created_at AT TIME ZONE 'Europe/London')::DATE >= $4::DATE)
      AND ($5::DATE IS NULL OR (f.created_at AT TIME ZONE 'Europe/London')::DATE <= $5::DATE)
  `,
  onboarding: `
    SELECT
      'onboarding'::TEXT AS source_module,
      section::TEXT AS source_sub_type,
      staff_id::TEXT AS source_record_id,
      id AS attachment_id,
      NULL::TEXT AS quality_statement_id,
      NULL::TEXT AS evidence_category,
      NULL::TEXT AS evidence_owner,
      NULL::DATE AS review_due_at,
      original_name,
      stored_name,
      mime_type,
      size_bytes,
      description,
      uploaded_by,
      created_at
    FROM onboarding_file_attachments
    WHERE home_id = $1
      AND deleted_at IS NULL
      AND ($2::TEXT IS NULL OR original_name ILIKE $2 OR COALESCE(description, '') ILIKE $2)
      AND ($3::TEXT IS NULL OR uploaded_by = $3)
      AND ($4::DATE IS NULL OR (created_at AT TIME ZONE 'Europe/London')::DATE >= $4::DATE)
      AND ($5::DATE IS NULL OR (created_at AT TIME ZONE 'Europe/London')::DATE <= $5::DATE)
  `,
  training: `
    SELECT
      'training'::TEXT AS source_module,
      training_type::TEXT AS source_sub_type,
      staff_id::TEXT AS source_record_id,
      id AS attachment_id,
      NULL::TEXT AS quality_statement_id,
      NULL::TEXT AS evidence_category,
      NULL::TEXT AS evidence_owner,
      NULL::DATE AS review_due_at,
      original_name,
      stored_name,
      mime_type,
      size_bytes,
      description,
      uploaded_by,
      created_at
    FROM training_file_attachments
    WHERE home_id = $1
      AND deleted_at IS NULL
      AND ($2::TEXT IS NULL OR original_name ILIKE $2 OR COALESCE(description, '') ILIKE $2)
      AND ($3::TEXT IS NULL OR uploaded_by = $3)
      AND ($4::DATE IS NULL OR (created_at AT TIME ZONE 'Europe/London')::DATE >= $4::DATE)
      AND ($5::DATE IS NULL OR (created_at AT TIME ZONE 'Europe/London')::DATE <= $5::DATE)
  `,
  record: `
    SELECT
      'record'::TEXT AS source_module,
      module::TEXT AS source_sub_type,
      record_id::TEXT AS source_record_id,
      id AS attachment_id,
      NULL::TEXT AS quality_statement_id,
      NULL::TEXT AS evidence_category,
      NULL::TEXT AS evidence_owner,
      NULL::DATE AS review_due_at,
      original_name,
      stored_name,
      mime_type,
      size_bytes,
      description,
      uploaded_by,
      created_at
    FROM record_file_attachments
    WHERE home_id = $1
      AND deleted_at IS NULL
      AND ($2::TEXT IS NULL OR original_name ILIKE $2 OR COALESCE(description, '') ILIKE $2)
      AND ($3::TEXT IS NULL OR uploaded_by = $3)
      AND ($4::DATE IS NULL OR (created_at AT TIME ZONE 'Europe/London')::DATE >= $4::DATE)
      AND ($5::DATE IS NULL OR (created_at AT TIME ZONE 'Europe/London')::DATE <= $5::DATE)
      AND ($6::TEXT[] IS NULL OR module = ANY($6))
  `,
};

function normalizeSourceModules(sourceModules) {
  const requested = Array.isArray(sourceModules) && sourceModules.length > 0
    ? sourceModules
    : EVIDENCE_SOURCE_IDS;
  return requested.filter((sourceId) => Object.prototype.hasOwnProperty.call(SOURCE_QUERIES, sourceId));
}

function buildUnionSql(sourceModules) {
  const modules = normalizeSourceModules(sourceModules);
  if (modules.length === 0) return null;
  return modules.map((sourceId) => SOURCE_QUERIES[sourceId].trim()).join('\nUNION ALL\n');
}

function shapeRow(row) {
  return {
    sourceModule: row.source_module,
    sourceSubType: row.source_sub_type,
    sourceRecordId: row.source_record_id,
    attachmentId: row.attachment_id,
    qualityStatementId: row.quality_statement_id || null,
    evidenceCategory: row.evidence_category || null,
    evidenceOwner: row.evidence_owner || null,
    reviewDueAt: row.review_due_at || null,
    originalName: row.original_name,
    storedName: row.stored_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    description: row.description,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
  };
}

function buildParams(homeId, filters = {}) {
  return [
    homeId,
    filters.q ? `%${filters.q}%` : null,
    filters.uploadedBy || null,
    filters.dateFrom || null,
    filters.dateTo || null,
    Array.isArray(filters.recordModules) && filters.recordModules.length > 0 ? filters.recordModules : null,
  ];
}

export async function search(homeId, filters = {}, client = pool) {
  const {
    sourceModules = null,
    limit = 50,
    offset = 0,
  } = filters;

  const unionSql = buildUnionSql(sourceModules);
  if (!unionSql) return { rows: [], total: 0 };

  const listSql = `
    WITH evidence AS (
      ${unionSql}
    )
    SELECT *
      FROM evidence
     ORDER BY created_at DESC
     LIMIT $7 OFFSET $8
  `;

  const countSql = `
    WITH evidence AS (
      ${unionSql}
    )
    SELECT COUNT(*)::INT AS total
      FROM evidence
  `;

  const baseParams = buildParams(homeId, filters);
  const clampedLimit = Math.min(Math.max(limit, 1), 200);
  const clampedOffset = Math.max(offset, 0);

  const [listResult, countResult] = await Promise.all([
    client.query(listSql, [...baseParams, clampedLimit, clampedOffset]),
    client.query(countSql, baseParams),
  ]);

  return {
    rows: listResult.rows.map(shapeRow),
    total: countResult.rows[0]?.total || 0,
  };
}

export async function listUploaders(homeId, filters = {}, client = pool) {
  const unionSql = buildUnionSql(filters.sourceModules);
  if (!unionSql) return [];

  const sql = `
    WITH evidence AS (
      ${unionSql}
    )
    SELECT DISTINCT uploaded_by
      FROM evidence
     WHERE uploaded_by IS NOT NULL
     ORDER BY uploaded_by
  `;

  const { rows } = await client.query(sql, buildParams(homeId, filters));
  return rows.map((row) => row.uploaded_by);
}
