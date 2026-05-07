import { pool } from '../db.js';
import { paginateResult } from '../lib/pagination.js';
import { toIsoOrNull } from '../lib/serverTimestamps.js';

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}

function dateOnly(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

export function shapeReview(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    review_key: row.review_key,
    cadence: row.cadence,
    period_start: dateOnly(row.period_start),
    period_end: dateOnly(row.period_end),
    status: row.status,
    snapshot: parseJson(row.snapshot, {}),
    started_by_username: row.started_by_username,
    completed_by_username: row.completed_by_username || null,
    completed_at: toIsoOrNull(row.completed_at),
    created_at: toIsoOrNull(row.created_at),
    updated_at: toIsoOrNull(row.updated_at),
    assignment_counts: parseJson(row.assignment_counts, {}),
  };
}

export function shapeAssignment(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    review_id: Number(row.review_id),
    assignment_key: row.assignment_key,
    assignment_type: row.assignment_type,
    user_id: row.user_id == null ? null : Number(row.user_id),
    username: row.username,
    display_name: row.display_name || '',
    user_role: row.user_role || null,
    active: row.active === true,
    is_platform_admin: row.is_platform_admin === true,
    last_login_at: toIsoOrNull(row.last_login_at),
    home_id: row.home_id == null ? null : Number(row.home_id),
    home_slug: row.home_slug || null,
    home_name: row.home_name || null,
    role_id: row.role_id || null,
    exception_flags: parseJson(row.exception_flags, []),
    status: row.status,
    notes: row.notes || '',
    reviewed_by_username: row.reviewed_by_username || null,
    reviewed_at: toIsoOrNull(row.reviewed_at),
    created_at: toIsoOrNull(row.created_at),
    updated_at: toIsoOrNull(row.updated_at),
  };
}

export async function listAccessReviewSourceUsers(client = pool) {
  const { rows } = await client.query(
    `SELECT id, username, role, display_name, active, is_platform_admin, created_at, updated_at, last_login_at
       FROM users
      ORDER BY LOWER(username)`,
  );
  return rows;
}

export async function listAccessReviewSourceAssignments(client = pool) {
  const { rows } = await client.query(
    `SELECT u.id AS user_id,
            u.username,
            u.role AS user_role,
            u.display_name,
            u.active,
            u.is_platform_admin,
            u.last_login_at,
            uhr.home_id,
            h.slug AS home_slug,
            COALESCE(h.config->>'home_name', h.name) AS home_name,
            uhr.role_id,
            uhr.granted_by,
            uhr.granted_at
       FROM user_home_roles uhr
       JOIN users u ON u.username = uhr.username
       LEFT JOIN homes h ON h.id = uhr.home_id AND h.deleted_at IS NULL
      ORDER BY LOWER(u.username), h.name NULLS LAST, uhr.home_id`,
  );
  return rows;
}

export async function insertReview(data, client = pool) {
  const { rows } = await client.query(
    `INSERT INTO access_reviews (
       review_key, cadence, period_start, period_end, snapshot, started_by_username
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     RETURNING *`,
    [
      data.review_key,
      data.cadence,
      data.period_start,
      data.period_end,
      JSON.stringify(data.snapshot || {}),
      data.started_by_username,
    ],
  );
  return shapeReview(rows[0]);
}

export async function insertAssignments(reviewId, assignments, client = pool) {
  if (!Array.isArray(assignments) || assignments.length === 0) return [];
  const inserted = [];
  for (const assignment of assignments) {
    const { rows } = await client.query(
      `INSERT INTO access_review_assignments (
         review_id, assignment_key, assignment_type, user_id, username, display_name, user_role,
         active, is_platform_admin, last_login_at, home_id, home_slug, home_name, role_id,
         exception_flags
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, $11, $12, $13, $14,
         $15::jsonb
       )
       ON CONFLICT (review_id, assignment_key) DO UPDATE SET
         exception_flags = EXCLUDED.exception_flags,
         updated_at = NOW()
       RETURNING *`,
      [
        reviewId,
        assignment.assignment_key,
        assignment.assignment_type,
        assignment.user_id,
        assignment.username,
        assignment.display_name || '',
        assignment.user_role || null,
        assignment.active !== false,
        assignment.is_platform_admin === true,
        assignment.last_login_at || null,
        assignment.home_id || null,
        assignment.home_slug || null,
        assignment.home_name || null,
        assignment.role_id || null,
        JSON.stringify(assignment.exception_flags || []),
      ],
    );
    inserted.push(shapeAssignment(rows[0]));
  }
  return inserted;
}

export async function findReviewByKey(reviewKey, client = pool) {
  const { rows } = await client.query(
    'SELECT * FROM access_reviews WHERE review_key = $1',
    [reviewKey],
  );
  return shapeReview(rows[0]);
}

export async function findReviewById(reviewId, client = pool) {
  const { rows } = await client.query(
    `SELECT ar.*,
            COALESCE(
              jsonb_object_agg(ara.status, ara.count) FILTER (WHERE ara.status IS NOT NULL),
              '{}'::jsonb
            ) AS assignment_counts
       FROM access_reviews ar
       LEFT JOIN (
         SELECT review_id, status, COUNT(*)::int AS count
           FROM access_review_assignments
          WHERE review_id = $1
          GROUP BY review_id, status
       ) ara ON ara.review_id = ar.id
      WHERE ar.id = $1
      GROUP BY ar.id`,
    [reviewId],
  );
  return shapeReview(rows[0]);
}

export async function findReviewByIdForUpdate(reviewId, client = pool) {
  const { rows } = await client.query(
    `SELECT * FROM access_reviews WHERE id = $1 FOR UPDATE`,
    [reviewId],
  );
  return shapeReview(rows[0]);
}

export async function listReviews(filters = {}, client = pool) {
  const params = [];
  const clauses = [];
  if (filters.status) {
    params.push(filters.status);
    clauses.push(`ar.status = $${params.length}`);
  }
  if (filters.cadence) {
    params.push(filters.cadence);
    clauses.push(`ar.cadence = $${params.length}`);
  }
  const limit = Math.min(Number.parseInt(filters.limit ?? 25, 10) || 25, 100);
  const offset = Math.max(Number.parseInt(filters.offset ?? 0, 10) || 0, 0);
  params.push(limit, offset);
  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await client.query(
    `SELECT ar.*,
            COALESCE(
              jsonb_object_agg(ara.status, ara.count) FILTER (WHERE ara.status IS NOT NULL),
              '{}'::jsonb
            ) AS assignment_counts,
            COUNT(*) OVER() AS _total
       FROM access_reviews ar
       LEFT JOIN (
         SELECT review_id, status, COUNT(*)::int AS count
           FROM access_review_assignments
          GROUP BY review_id, status
       ) ara ON ara.review_id = ar.id
       ${whereSql}
      GROUP BY ar.id
      ORDER BY ar.period_start DESC, ar.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return paginateResult(rows, shapeReview);
}

export async function listAssignments(reviewId, filters = {}, client = pool) {
  const params = [reviewId];
  const clauses = ['review_id = $1'];
  if (filters.status) {
    params.push(filters.status);
    clauses.push(`status = $${params.length}`);
  }
  if (filters.exceptionOnly) {
    clauses.push('jsonb_array_length(exception_flags) > 0');
  }
  const limit = Math.min(Number.parseInt(filters.limit ?? 250, 10) || 250, 500);
  const offset = Math.max(Number.parseInt(filters.offset ?? 0, 10) || 0, 0);
  params.push(limit, offset);
  const { rows } = await client.query(
    `SELECT *, COUNT(*) OVER() AS _total
       FROM access_review_assignments
      WHERE ${clauses.join(' AND ')}
      ORDER BY
        CASE WHEN jsonb_array_length(exception_flags) > 0 THEN 0 ELSE 1 END,
        LOWER(username),
        home_name NULLS LAST,
        id
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return paginateResult(rows, shapeAssignment);
}

export async function findAssignmentById(reviewId, assignmentId, client = pool) {
  const { rows } = await client.query(
    `SELECT *
       FROM access_review_assignments
      WHERE review_id = $1
        AND id = $2`,
    [reviewId, assignmentId],
  );
  return shapeAssignment(rows[0]);
}

export async function findAssignmentByIdForUpdate(reviewId, assignmentId, client = pool) {
  const { rows } = await client.query(
    `SELECT *
       FROM access_review_assignments
      WHERE review_id = $1
        AND id = $2
      FOR UPDATE`,
    [reviewId, assignmentId],
  );
  return shapeAssignment(rows[0]);
}

export async function updateAssignmentStatus(reviewId, assignmentId, data, client = pool) {
  const { rows } = await client.query(
    `UPDATE access_review_assignments
        SET status = $3,
            notes = $4,
            reviewed_by_username = $5,
            reviewed_at = NOW(),
            updated_at = NOW()
      WHERE review_id = $1
        AND id = $2
      RETURNING *`,
    [reviewId, assignmentId, data.status, data.notes || null, data.reviewed_by_username],
  );
  return shapeAssignment(rows[0]);
}

export async function insertAssignmentDecision(data, client = pool) {
  const { rows } = await client.query(
    `INSERT INTO access_review_decisions (
       review_id, assignment_id, assignment_key, from_status, to_status, notes, decided_by_username
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      data.review_id,
      data.assignment_id,
      data.assignment_key,
      data.from_status || null,
      data.to_status,
      data.notes || null,
      data.decided_by_username,
    ],
  );
  return rows[0] || null;
}

export async function markReviewCompleted(reviewId, username, client = pool) {
  const { rows } = await client.query(
    `UPDATE access_reviews
        SET status = 'completed',
            completed_by_username = $2,
            completed_at = NOW(),
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [reviewId, username],
  );
  return shapeReview(rows[0]);
}
