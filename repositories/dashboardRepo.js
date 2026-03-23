import { pool } from '../db.js';

const int = (v) => parseInt(v ?? '0', 10);

// ── Incidents ────────────────────────────────────────────────────────────────

export async function getIncidentCounts(homeId) {
  const [{ rows }, { rows: actionRows }] = await Promise.all([
    pool.query(
      `/* dashboardRepo – getIncidentCounts */
       WITH home_bh AS (
         SELECT (bh ->> 'date') AS bh_date
         FROM homes,
              jsonb_array_elements(COALESCE(config -> 'bank_holidays', '[]'::jsonb)) AS bh
         WHERE homes.id = $1
       )
       SELECT
         COUNT(*) FILTER (WHERE i.investigation_status != 'closed')::int AS open,
         COUNT(*) FILTER (
           WHERE i.cqc_notifiable = true
             AND i.cqc_notified = false
             AND i.cqc_notification_deadline < NOW()
         )::int AS cqc_overdue,
         COUNT(*) FILTER (
           WHERE i.riddor_reportable = true
             AND i.riddor_reported = false
             AND CASE i.riddor_category
               WHEN 'death' THEN i.date + INTERVAL '1 day'
               WHEN 'specified_injury' THEN i.date + INTERVAL '1 day'
               WHEN 'dangerous_occurrence' THEN i.date + INTERVAL '1 day'
               WHEN 'over_7_day' THEN i.date + INTERVAL '15 days'
               ELSE i.date + INTERVAL '1 day'
             END < CURRENT_DATE
         )::int AS riddor_overdue,
         COUNT(*) FILTER (
           WHERE i.duty_of_candour_applies = true
             AND i.candour_notification_date IS NULL
             -- CQC Reg 16: 10 working days (Mon–Fri, excluding bank holidays)
             AND (
               SELECT COUNT(d)
               FROM generate_series(i.date::date + 1, CURRENT_DATE - 1, '1 day') AS d
               WHERE EXTRACT(DOW FROM d) NOT IN (0, 6)
                 AND d::date::text NOT IN (SELECT bh_date FROM home_bh)
             ) >= 10
         )::int AS doc_overdue
       FROM incidents i
       WHERE i.home_id = $1 AND i.deleted_at IS NULL`,
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
           AND status NOT IN ('resolved', 'closed')
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
     WITH active_types AS (
       SELECT jsonb_array_elements(config -> 'training_types') AS t
       FROM homes WHERE id = $1
     ),
     latest_records AS (
       SELECT DISTINCT ON (tr.staff_id, tr.training_type_id)
              tr.staff_id, tr.training_type_id, tr.expiry
       FROM training_records tr
       JOIN staff s ON s.home_id = tr.home_id AND s.id = tr.staff_id
       WHERE tr.home_id = $1
         AND tr.deleted_at IS NULL
         AND s.deleted_at IS NULL AND s.active = true
         AND tr.expiry IS NOT NULL
       ORDER BY tr.staff_id, tr.training_type_id, tr.expiry DESC
     )
     SELECT
       COUNT(*) FILTER (
         WHERE lr.expiry < $2
           AND EXISTS (
             SELECT 1 FROM active_types
             WHERE t->>'id' = lr.training_type_id
               AND (t->>'active')::boolean IS NOT FALSE
           )
       )::int AS expired,
       COUNT(*) FILTER (
         WHERE lr.expiry >= $2 AND lr.expiry <= ($2::date + INTERVAL '30 days')
           AND EXISTS (
             SELECT 1 FROM active_types
             WHERE t->>'id' = lr.training_type_id
               AND (t->>'active')::boolean IS NOT FALSE
           )
       )::int AS expiring_soon
     FROM latest_records lr`,
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
    lastDate: r.last_date || null,
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
           WHERE outbreak->>'status' IN ('suspected', 'confirmed')
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
           AND status NOT IN ('resolved', 'closed')
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

// ── Beds & Occupancy ────────────────────────────────────────────────────────

export async function getBedCounts(homeId) {
  const { rows } = await pool.query(
    `/* dashboardRepo – getBedCounts */
     SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status = 'occupied')::int AS occupied,
       COUNT(*) FILTER (WHERE status = 'available')::int AS available,
       COUNT(*) FILTER (WHERE status = 'hospital_hold')::int AS hospital_hold,
       COUNT(*) FILTER (WHERE status = 'reserved')::int AS reserved,
       COUNT(*) FILTER (WHERE status = 'deep_clean')::int AS deep_clean,
       COUNT(*) FILTER (WHERE status = 'maintenance')::int AS maintenance,
       COUNT(*) FILTER (WHERE status = 'decommissioned')::int AS decommissioned
     FROM beds
     WHERE home_id = $1`,
    [homeId]
  );
  const r = rows[0];
  const operational = r.total - r.decommissioned;
  const occupancyRate = operational > 0
    ? Math.round(100.0 * r.occupied / operational)
    : 100;
  return {
    total: r.total,
    occupied: r.occupied,
    available: r.available,
    hospitalHold: r.hospital_hold,
    reserved: r.reserved,
    deepClean: r.deep_clean,
    maintenance: r.maintenance,
    decommissioned: r.decommissioned,
    occupancyRate,
  };
}

export async function getBedVacancyCost(homeId) {
  const { rows: bedRows } = await pool.query(
    `/* dashboardRepo – getBedVacancyCost/beds */
     SELECT COUNT(*)::int AS vacant_beds,
       SUM(CURRENT_DATE - status_since)::int AS total_vacancy_days
     FROM beds
     WHERE home_id = $1 AND status = 'available'`,
    [homeId]
  );
  const { rows: feeRows } = await pool.query(
    `/* dashboardRepo – getBedVacancyCost/fees */
     SELECT
       COALESCE(MIN(weekly_fee), 0) AS floor_rate,
       COALESCE(AVG(weekly_fee), 0) AS avg_rate
     FROM finance_residents
     WHERE home_id = $1 AND status = 'active' AND deleted_at IS NULL
       AND weekly_fee IS NOT NULL AND weekly_fee > 0`,
    [homeId]
  );
  const b = bedRows[0];
  const f = feeRows[0];
  return {
    vacantBeds: b.vacant_beds,
    totalVacancyDays: b.total_vacancy_days || 0,
    floorWeeklyLoss: Math.round(parseFloat(f.floor_rate) * (b.vacant_beds || 0) * 100) / 100,
    avgWeeklyLoss: Math.round(parseFloat(f.avg_rate) * (b.vacant_beds || 0) * 100) / 100,
  };
}

export async function getBedAlerts(homeId, today) {
  const [{ rows: holdRows }, { rows: reservedRows }, { rows: syncRows }] = await Promise.all([
    pool.query(
      `/* dashboardRepo – getBedAlerts/holds */
       SELECT COUNT(*)::int AS count
       FROM beds
       WHERE home_id = $1 AND status = 'hospital_hold'
         AND hold_expires IS NOT NULL AND hold_expires <= ($2::date + INTERVAL '7 days')`,
      [homeId, today]
    ),
    pool.query(
      `/* dashboardRepo – getBedAlerts/staleReservations */
       SELECT COUNT(*)::int AS count
       FROM beds
       WHERE home_id = $1 AND status = 'reserved'
         AND reserved_until IS NOT NULL AND reserved_until < $2`,
      [homeId, today]
    ),
    pool.query(
      `/* dashboardRepo – getBedAlerts/sync */
       SELECT COUNT(*)::int AS count
       FROM beds b
       INNER JOIN finance_residents fr ON fr.id = b.resident_id AND fr.home_id = $1
       WHERE b.home_id = $1 AND b.status = 'occupied'
         AND fr.status IN ('discharged', 'deceased')
         AND fr.deleted_at IS NULL`,
      [homeId]
    ),
  ]);
  return {
    hospitalHoldExpiring: holdRows[0].count,
    staleReservations: reservedRows[0].count,
    residentBedMismatch: syncRows[0].count,
  };
}

export async function getBedSummary(homeId, today) {
  const [counts, vacancy, alerts] = await Promise.all([
    getBedCounts(homeId),
    getBedVacancyCost(homeId),
    getBedAlerts(homeId, today),
  ]);
  return { ...counts, ...vacancy, ...alerts };
}
