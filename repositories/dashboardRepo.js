import { pool } from '../db.js';

const int = (v) => parseInt(v ?? '0', 10);

// ── Incidents ────────────────────────────────────────────────────────────────

export async function getIncidentCounts(homeId) {
  const [{ rows }, { rows: actionRows }] = await Promise.all([
    pool.query(
      `/* dashboardRepo – getIncidentCounts */
       SELECT
         COUNT(*) FILTER (WHERE investigation_status != 'closed')::int AS open,
         COUNT(*) FILTER (
           WHERE cqc_notifiable = true
             AND cqc_notified = false
             AND cqc_notification_deadline < NOW()
         )::int AS cqc_overdue,
         COUNT(*) FILTER (
           WHERE riddor_reportable = true
             AND riddor_reported = false
             AND CASE riddor_category
               WHEN 'death' THEN date + INTERVAL '1 day'
               WHEN 'specified_injury' THEN date + INTERVAL '1 day'
               WHEN 'dangerous_occurrence' THEN date + INTERVAL '1 day'
               WHEN 'over_7_day' THEN date + INTERVAL '15 days'
               ELSE date + INTERVAL '1 day'
             END < CURRENT_DATE
         )::int AS riddor_overdue,
         COUNT(*) FILTER (
           WHERE duty_of_candour_applies = true
             AND candour_notification_date IS NULL
             AND date < CURRENT_DATE - INTERVAL '14 days'
         )::int AS doc_overdue
       FROM incidents
       WHERE home_id = $1 AND deleted_at IS NULL`,
      [homeId]
    ),
    pool.query(
      `/* dashboardRepo – getIncidentCounts/actions */
       SELECT COUNT(*)::int AS count
       FROM (SELECT corrective_actions FROM incidents
             WHERE home_id = $1 AND deleted_at IS NULL
               AND jsonb_typeof(corrective_actions) = 'array') AS i,
            jsonb_array_elements(i.corrective_actions) AS elem
       WHERE elem->>'status' IS DISTINCT FROM 'completed'
         AND (elem->>'due_date') IS NOT NULL
         AND (elem->>'due_date') ~ '^\\d{4}-\\d{2}-\\d{2}$'
         AND (elem->>'due_date')::date < CURRENT_DATE`,
      [homeId]
    ),
  ]);
  const r = rows[0];

  return {
    open: r.open,
    cqcOverdue: r.cqc_overdue,
    riddorOverdue: r.riddor_overdue,
    docOverdue: r.doc_overdue,
    overdueActions: actionRows[0].count,
  };
}

// ── Complaints ───────────────────────────────────────────────────────────────

export async function getComplaintCounts(homeId) {
  const { rows } = await pool.query(
    `/* dashboardRepo – getComplaintCounts */
     SELECT
       COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed'))::int AS open,
       COUNT(*) FILTER (
         WHERE acknowledged_date IS NULL
           AND date < CURRENT_DATE - INTERVAL '2 days'
       )::int AS unacknowledged,
       COUNT(*) FILTER (
         WHERE response_deadline < CURRENT_DATE
           AND status NOT IN ('resolved', 'closed')
       )::int AS overdue_response
     FROM complaints
     WHERE home_id = $1 AND deleted_at IS NULL`,
    [homeId]
  );
  const r = rows[0];
  return {
    open: r.open,
    unacknowledged: r.unacknowledged,
    overdueResponse: r.overdue_response,
  };
}

// ── Maintenance ──────────────────────────────────────────────────────────────

export async function getMaintenanceCounts(homeId, today) {
  const { rows } = await pool.query(
    `/* dashboardRepo – getMaintenanceCounts */
     SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE next_due < $2)::int AS overdue,
       COUNT(*) FILTER (
         WHERE next_due >= $2 AND next_due <= ($2::date + INTERVAL '30 days')
       )::int AS due_soon,
       COUNT(*) FILTER (
         WHERE certificate_expiry IS NOT NULL AND certificate_expiry < $2
       )::int AS expired_certs
     FROM maintenance
     WHERE home_id = $1 AND deleted_at IS NULL`,
    [homeId, today]
  );
  const r = rows[0];
  const compliancePct = r.total > 0
    ? Math.round(100.0 * (r.total - r.overdue) / r.total)
    : 100;
  return {
    total: r.total,
    overdue: r.overdue,
    dueSoon: r.due_soon,
    expiredCerts: r.expired_certs,
    compliancePct,
  };
}

// ── Training ─────────────────────────────────────────────────────────────────

export async function getTrainingCounts(homeId, today) {
  const { rows } = await pool.query(
    `/* dashboardRepo – getTrainingCounts */
     SELECT
       COUNT(*) FILTER (WHERE expiry < $2)::int AS expired,
       COUNT(*) FILTER (
         WHERE expiry >= $2 AND expiry <= ($2::date + INTERVAL '30 days')
       )::int AS expiring_soon
     FROM training_records
     WHERE home_id = $1
       AND expiry IS NOT NULL`,
    [homeId, today]
  );
  const r = rows[0];
  return {
    expired: r.expired,
    expiringSoon: r.expiring_soon,
  };
}

// ── Supervisions ─────────────────────────────────────────────────────────────

export async function getSupervisionCounts(homeId, today) {
  const { rows } = await pool.query(
    `/* dashboardRepo – getSupervisionCounts */
     WITH active_care_staff AS (
       SELECT id AS staff_id
       FROM staff
       WHERE home_id = $1 AND deleted_at IS NULL AND active = true
     ),
     latest AS (
       SELECT DISTINCT ON (s.staff_id) s.staff_id, s.next_due
       FROM supervisions s
       INNER JOIN active_care_staff acs ON acs.staff_id = s.staff_id
       WHERE s.home_id = $1 AND s.deleted_at IS NULL
       ORDER BY s.staff_id, s.date DESC
     )
     SELECT
       (SELECT COUNT(*)::int FROM latest WHERE next_due < $2) AS overdue,
       (SELECT COUNT(*)::int FROM latest
        WHERE next_due >= $2 AND next_due <= ($2::date + INTERVAL '14 days')) AS due_soon,
       (SELECT COUNT(*)::int FROM active_care_staff acs
        WHERE NOT EXISTS (
          SELECT 1 FROM supervisions sv
          WHERE sv.home_id = $1 AND sv.staff_id = acs.staff_id AND sv.deleted_at IS NULL
        )) AS no_record`,
    [homeId, today]
  );
  const r = rows[0];
  return {
    overdue: int(r.overdue),
    dueSoon: int(r.due_soon),
    noRecord: int(r.no_record),
  };
}

// ── Appraisals ───────────────────────────────────────────────────────────────

export async function getAppraisalCounts(homeId, today) {
  const { rows } = await pool.query(
    `/* dashboardRepo – getAppraisalCounts */
     WITH active_care_staff AS (
       SELECT id AS staff_id
       FROM staff
       WHERE home_id = $1 AND deleted_at IS NULL AND active = true
     ),
     latest AS (
       SELECT DISTINCT ON (a.staff_id) a.staff_id, a.next_due
       FROM appraisals a
       INNER JOIN active_care_staff acs ON acs.staff_id = a.staff_id
       WHERE a.home_id = $1 AND a.deleted_at IS NULL
       ORDER BY a.staff_id, a.date DESC
     )
     SELECT
       (SELECT COUNT(*)::int FROM latest WHERE next_due < $2) AS overdue,
       (SELECT COUNT(*)::int FROM latest
        WHERE next_due >= $2 AND next_due <= ($2::date + INTERVAL '30 days')) AS due_soon,
       (SELECT COUNT(*)::int FROM active_care_staff acs
        WHERE NOT EXISTS (
          SELECT 1 FROM appraisals ap
          WHERE ap.home_id = $1 AND ap.staff_id = acs.staff_id AND ap.deleted_at IS NULL
        )) AS no_record`,
    [homeId, today]
  );
  const r = rows[0];
  return {
    overdue: int(r.overdue),
    dueSoon: int(r.due_soon),
    noRecord: int(r.no_record),
  };
}

// ── Fire Drills ──────────────────────────────────────────────────────────────

export async function getFireDrillCounts(homeId, today) {
  const { rows } = await pool.query(
    `/* dashboardRepo – getFireDrillCounts */
     SELECT
       MAX(date) AS last_date,
       MAX(date) < ($2::date - INTERVAL '91 days') AS overdue,
       COUNT(*) FILTER (
         WHERE date >= ($2::date - INTERVAL '1 year')
       )::int AS drills_this_year
     FROM fire_drills
     WHERE home_id = $1 AND deleted_at IS NULL`,
    [homeId, today]
  );
  const r = rows[0];
  return {
    lastDate: r.last_date ? r.last_date.toISOString().slice(0, 10) : null,
    drillsThisYear: r.drills_this_year,
    overdue: r.overdue ?? true,
  };
}

// ── IPC Audits ───────────────────────────────────────────────────────────────

export async function getIpcCounts(homeId) {
  const [{ rows }, { rows: actionRows }] = await Promise.all([
    pool.query(
      `/* dashboardRepo – getIpcCounts */
       SELECT
         COUNT(*) FILTER (
           WHERE outbreak->>'status' IN ('suspected', 'confirmed', 'contained')
         )::int AS active_outbreaks,
         (SELECT overall_score FROM ipc_audits
          WHERE home_id = $1 AND deleted_at IS NULL
          ORDER BY audit_date DESC NULLS LAST LIMIT 1
         ) AS latest_score
       FROM ipc_audits
       WHERE home_id = $1 AND deleted_at IS NULL`,
      [homeId]
    ),
    pool.query(
      `/* dashboardRepo – getIpcCounts/actions */
       SELECT COUNT(*)::int AS count
       FROM (SELECT corrective_actions FROM ipc_audits
             WHERE home_id = $1 AND deleted_at IS NULL
               AND jsonb_typeof(corrective_actions) = 'array') AS i,
            jsonb_array_elements(i.corrective_actions) AS elem
       WHERE elem->>'status' IS DISTINCT FROM 'completed'
         AND (elem->>'due_date') IS NOT NULL
         AND (elem->>'due_date') ~ '^\\d{4}-\\d{2}-\\d{2}$'
         AND (elem->>'due_date')::date < CURRENT_DATE`,
      [homeId]
    ),
  ]);
  const r = rows[0];

  return {
    activeOutbreaks: r.active_outbreaks,
    overdueActions: actionRows[0].count,
    latestScore: r.latest_score != null ? parseFloat(r.latest_score) : null,
  };
}

// ── Risk Register ────────────────────────────────────────────────────────────

export async function getRiskCounts(homeId, today) {
  const [{ rows }, { rows: actionRows }] = await Promise.all([
    pool.query(
      `/* dashboardRepo – getRiskCounts */
       SELECT
         COUNT(*) FILTER (WHERE status IS DISTINCT FROM 'closed')::int AS total,
         COUNT(*) FILTER (
           WHERE status IS DISTINCT FROM 'closed'
             AND residual_risk >= 16
         )::int AS critical,
         COUNT(*) FILTER (
           WHERE status IS DISTINCT FROM 'closed'
             AND next_review < $2
         )::int AS overdue_reviews
       FROM risk_register
       WHERE home_id = $1 AND deleted_at IS NULL`,
      [homeId, today]
    ),
    pool.query(
      `/* dashboardRepo – getRiskCounts/actions */
       SELECT COUNT(*)::int AS count
       FROM (SELECT actions FROM risk_register
             WHERE home_id = $1 AND deleted_at IS NULL
               AND status IS DISTINCT FROM 'closed'
               AND jsonb_typeof(actions) = 'array') AS r,
            jsonb_array_elements(r.actions) AS elem
       WHERE elem->>'status' IS DISTINCT FROM 'completed'
         AND (elem->>'due_date') IS NOT NULL
         AND (elem->>'due_date') ~ '^\\d{4}-\\d{2}-\\d{2}$'
         AND (elem->>'due_date')::date < $2`,
      [homeId, today]
    ),
  ]);
  const r = rows[0];

  return {
    total: r.total,
    critical: r.critical,
    overdueReviews: r.overdue_reviews,
    overdueActions: actionRows[0].count,
  };
}

// ── Policy Reviews ───────────────────────────────────────────────────────────

export async function getPolicyCounts(homeId, today) {
  const { rows } = await pool.query(
    `/* dashboardRepo – getPolicyCounts */
     SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE next_review_due < $2)::int AS overdue,
       COUNT(*) FILTER (
         WHERE next_review_due >= $2
           AND next_review_due <= ($2::date + INTERVAL '30 days')
       )::int AS due_soon
     FROM policy_reviews
     WHERE home_id = $1 AND deleted_at IS NULL`,
    [homeId, today]
  );
  const r = rows[0];
  const compliancePct = r.total > 0
    ? Math.round(100.0 * (r.total - r.overdue) / r.total)
    : 100;
  return {
    total: r.total,
    overdue: r.overdue,
    dueSoon: r.due_soon,
    compliancePct,
  };
}

// ── Whistleblowing ───────────────────────────────────────────────────────────

export async function getWhistleblowingCounts(homeId) {
  const { rows } = await pool.query(
    `/* dashboardRepo – getWhistleblowingCounts */
     SELECT
       COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed'))::int AS open,
       COUNT(*) FILTER (
         WHERE acknowledgement_date IS NULL
           AND date_raised < CURRENT_DATE - INTERVAL '3 days'
       )::int AS unacknowledged
     FROM whistleblowing_concerns
     WHERE home_id = $1 AND deleted_at IS NULL`,
    [homeId]
  );
  const r = rows[0];
  return {
    open: r.open,
    unacknowledged: r.unacknowledged,
  };
}

// ── DoLS / MCA ───────────────────────────────────────────────────────────────

export async function getDolsCounts(homeId, today) {
  const [{ rows }, { rows: mcaRows }] = await Promise.all([
    pool.query(
      `/* dashboardRepo – getDolsCounts */
       SELECT
         COUNT(*) FILTER (
           WHERE authorised = true
             AND (expiry_date IS NULL OR expiry_date >= $2)
         )::int AS active,
         COUNT(*) FILTER (
           WHERE authorised = true
             AND expiry_date >= $2
             AND expiry_date <= ($2::date + INTERVAL '90 days')
         )::int AS expiring_soon,
         COUNT(*) FILTER (
           WHERE next_review_date IS NOT NULL AND next_review_date < $2
         )::int AS overdue_reviews_dols
       FROM dols
       WHERE home_id = $1 AND deleted_at IS NULL`,
      [homeId, today]
    ),
    pool.query(
      `/* dashboardRepo – getDolsCounts/mca */
       SELECT COUNT(*) FILTER (
         WHERE next_review_date IS NOT NULL AND next_review_date < $2
       )::int AS overdue_reviews_mca
       FROM mca_assessments
       WHERE home_id = $1 AND deleted_at IS NULL`,
      [homeId, today]
    ),
  ]);

  const r = rows[0];
  return {
    active: r.active,
    expiringSoon: r.expiring_soon,
    overdueReviews: r.overdue_reviews_dols + mcaRows[0].overdue_reviews_mca,
  };
}

// ── Care Certificates ────────────────────────────────────────────────────────

export async function getCareCertCounts(homeId, today) {
  const { rows } = await pool.query(
    `/* dashboardRepo – getCareCertCounts */
     SELECT
       COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
       COUNT(*) FILTER (
         WHERE status IS DISTINCT FROM 'completed'
           AND expected_completion IS NOT NULL
           AND expected_completion < $2
       )::int AS overdue
     FROM care_certificates
     WHERE home_id = $1 AND deleted_at IS NULL`,
    [homeId, today]
  );
  const r = rows[0];
  return {
    inProgress: r.in_progress,
    overdue: r.overdue,
  };
}
