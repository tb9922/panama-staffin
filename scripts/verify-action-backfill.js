import { pool } from '../db.js';

async function tableExists(tableName) {
  const { rows: [row] } = await pool.query(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [`public.${tableName}`],
  );
  return row?.exists === true;
}

const EXPECTED_CTE = `
WITH expected AS (
  SELECT i.home_id, h.slug AS home_slug, 'incident' AS source_type, i.id::text AS source_id,
         'legacy:' || (ca.ordinality - 1)::text || ':' || md5(concat_ws('|',
           ca.action->>'description',
           ca.action->>'assigned_to',
           ca.action->>'due_date',
           ca.action->>'status'
         )) AS source_action_key,
         left(ca.action->>'description', 120) AS title
    FROM incidents i
    JOIN homes h ON h.id = i.home_id
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(i.corrective_actions) = 'array' THEN i.corrective_actions ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS ca(action, ordinality)
   WHERE i.deleted_at IS NULL
     AND jsonb_typeof(i.corrective_actions) = 'array'
     AND nullif(ca.action->>'description', '') IS NOT NULL

  UNION ALL
  SELECT a.home_id, h.slug, 'ipc_audit', a.id::text,
         'legacy:' || (ca.ordinality - 1)::text || ':' || md5(concat_ws('|',
           ca.action->>'description',
           ca.action->>'assigned_to',
           ca.action->>'due_date',
           ca.action->>'status'
         )),
         left(ca.action->>'description', 120)
    FROM ipc_audits a
    JOIN homes h ON h.id = a.home_id
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(a.corrective_actions) = 'array' THEN a.corrective_actions ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS ca(action, ordinality)
   WHERE a.deleted_at IS NULL
     AND jsonb_typeof(a.corrective_actions) = 'array'
     AND nullif(ca.action->>'description', '') IS NOT NULL

  UNION ALL
  SELECT r.home_id, h.slug, 'risk', r.id::text,
         'legacy:' || (ra.ordinality - 1)::text || ':' || md5(concat_ws('|',
           ra.action->>'description',
           ra.action->>'owner',
           ra.action->>'due_date',
           ra.action->>'status'
         )),
         left(ra.action->>'description', 120)
    FROM risk_register r
    JOIN homes h ON h.id = r.home_id
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(r.actions) = 'array' THEN r.actions ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS ra(action, ordinality)
   WHERE r.deleted_at IS NULL
     AND jsonb_typeof(r.actions) = 'array'
     AND nullif(ra.action->>'description', '') IS NOT NULL

  UNION ALL
  SELECT c.home_id, h.slug, 'complaint', c.id::text,
         'legacy:improvements:' || md5(c.improvements),
         left(c.improvements, 120)
    FROM complaints c
    JOIN homes h ON h.id = c.home_id
   WHERE c.deleted_at IS NULL
     AND nullif(c.improvements, '') IS NOT NULL

  UNION ALL
  SELECT s.home_id, h.slug, 'complaint_survey', s.id::text,
         'legacy:actions:' || md5(s.actions),
         left(s.actions, 120)
    FROM complaint_surveys s
    JOIN homes h ON h.id = s.home_id
   WHERE s.deleted_at IS NULL
     AND nullif(s.actions, '') IS NOT NULL

  UNION ALL
  SELECT m.home_id, h.slug, 'maintenance', m.id::text,
         'derived:items_failed:' || md5(concat_ws('|', m.description, m.items_failed::text, m.next_due::text)),
         left('Failed maintenance items: ' || m.description, 120)
    FROM maintenance m
    JOIN homes h ON h.id = m.home_id
   WHERE m.deleted_at IS NULL
     AND coalesce(m.items_failed, 0) > 0

  UNION ALL
  SELECT m.home_id, h.slug, 'maintenance', m.id::text,
         'derived:next_due:' || md5(concat_ws('|', m.description, m.next_due::text)),
         left('Overdue maintenance check: ' || m.description, 120)
    FROM maintenance m
    JOIN homes h ON h.id = m.home_id
   WHERE m.deleted_at IS NULL
     AND m.next_due IS NOT NULL
     AND m.next_due < CURRENT_DATE

  UNION ALL
  SELECT m.home_id, h.slug, 'maintenance', m.id::text,
         'derived:certificate_expiry:' || md5(concat_ws('|', m.certificate_ref, m.certificate_expiry::text)),
         left('Expired maintenance certificate: ' || coalesce(m.certificate_ref, m.description), 120)
    FROM maintenance m
    JOIN homes h ON h.id = m.home_id
   WHERE m.deleted_at IS NULL
     AND m.certificate_expiry IS NOT NULL
     AND m.certificate_expiry < CURRENT_DATE

  UNION ALL
  SELECT f.home_id, h.slug, 'fire_drill', f.id::text,
         'legacy:corrective_actions:' || md5(f.corrective_actions),
         left(f.corrective_actions, 120)
    FROM fire_drills f
    JOIN homes h ON h.id = f.home_id
   WHERE f.deleted_at IS NULL
     AND nullif(f.corrective_actions, '') IS NOT NULL

  UNION ALL
  SELECT s.home_id, h.slug, 'supervision', s.id::text,
         'legacy:actions:' || md5(s.actions),
         left(s.actions, 120)
    FROM supervisions s
    JOIN homes h ON h.id = s.home_id
   WHERE s.deleted_at IS NULL
     AND nullif(s.actions, '') IS NOT NULL

  UNION ALL
  SELECT a.home_id, h.slug, 'appraisal', a.id::text,
         'legacy:development_plan:' || md5(a.development_plan),
         left(a.development_plan, 120)
    FROM appraisals a
    JOIN homes h ON h.id = a.home_id
   WHERE a.deleted_at IS NULL
     AND nullif(a.development_plan, '') IS NOT NULL

  UNION ALL
  SELECT a.home_id, h.slug, 'appraisal', a.id::text,
         'legacy:training_needs:' || md5(a.training_needs),
         left(a.training_needs, 120)
    FROM appraisals a
    JOIN homes h ON h.id = a.home_id
   WHERE a.deleted_at IS NULL
     AND nullif(a.training_needs, '') IS NOT NULL
)
`;

const SUMMARY_SQL = `
${EXPECTED_CTE}
SELECT e.source_type,
       COUNT(*)::int AS expected,
       COUNT(ai.id)::int AS matched,
       (COUNT(*) - COUNT(ai.id))::int AS missing
  FROM expected e
  LEFT JOIN action_items ai
    ON ai.home_id = e.home_id
   AND ai.source_type = e.source_type
   AND ai.source_id = e.source_id
   AND ai.source_action_key = e.source_action_key
   AND ai.deleted_at IS NULL
 GROUP BY e.source_type
 ORDER BY e.source_type;
`;

const MISSING_SQL = `
${EXPECTED_CTE}
SELECT e.home_slug, e.source_type, e.source_id, e.source_action_key, e.title
  FROM expected e
  LEFT JOIN action_items ai
    ON ai.home_id = e.home_id
   AND ai.source_type = e.source_type
   AND ai.source_id = e.source_id
   AND ai.source_action_key = e.source_action_key
   AND ai.deleted_at IS NULL
 WHERE ai.id IS NULL
 ORDER BY e.home_slug, e.source_type, e.source_id
 LIMIT 50;
`;

const SPOT_CHECK_SQL = `
${EXPECTED_CTE}
SELECT e.home_slug, e.source_type, e.source_id, e.title AS expected_title,
       ai.id AS action_item_id, ai.title AS action_item_title, ai.status, ai.due_date
  FROM expected e
  JOIN action_items ai
    ON ai.home_id = e.home_id
   AND ai.source_type = e.source_type
   AND ai.source_id = e.source_id
   AND ai.source_action_key = e.source_action_key
   AND ai.deleted_at IS NULL
 ORDER BY random()
 LIMIT 10;
`;

const JSON_ANOMALY_SQL = `
SELECT source_type, COUNT(*)::int AS non_array_count
  FROM (
    SELECT 'incident' AS source_type
      FROM incidents
     WHERE deleted_at IS NULL
       AND corrective_actions IS NOT NULL
       AND jsonb_typeof(corrective_actions) <> 'array'
    UNION ALL
    SELECT 'ipc_audit'
      FROM ipc_audits
     WHERE deleted_at IS NULL
       AND corrective_actions IS NOT NULL
       AND jsonb_typeof(corrective_actions) <> 'array'
    UNION ALL
    SELECT 'risk'
      FROM risk_register
     WHERE deleted_at IS NULL
       AND actions IS NOT NULL
       AND jsonb_typeof(actions) <> 'array'
  ) anomalies
 GROUP BY source_type
 ORDER BY source_type;
`;

async function main() {
  if (!(await tableExists('action_items'))) {
    console.log('\nAction item backfill verification\n');
    console.log('FAIL V1 migrations applied - missing table: action_items');
    console.log('\nRun migrations before verifying action backfill: node scripts/migrate.js\n');
    process.exitCode = 1;
    return;
  }

  const [{ rows }, { rows: anomalies }] = await Promise.all([
    pool.query(SUMMARY_SQL),
    pool.query(JSON_ANOMALY_SQL),
  ]);
  const totals = rows.reduce((acc, row) => ({
    expected: acc.expected + Number(row.expected || 0),
    matched: acc.matched + Number(row.matched || 0),
    missing: acc.missing + Number(row.missing || 0),
  }), { expected: 0, matched: 0, missing: 0 });

  console.log('\nAction item backfill verification\n');
  console.table(rows);
  console.log(`Totals: expected=${totals.expected} matched=${totals.matched} missing=${totals.missing}`);

  if (anomalies.length > 0) {
    console.log('\nLegacy JSON fields skipped because they are not arrays:');
    console.table(anomalies);
  }

  if (totals.missing > 0) {
    const missing = await pool.query(MISSING_SQL);
    console.log('\nSample missing legacy actions:');
    console.table(missing.rows);
    process.exitCode = 1;
    return;
  }

  const spotCheck = await pool.query(SPOT_CHECK_SQL);
  if (spotCheck.rows.length > 0) {
    console.log('\nRandom matched action spot-check sample:');
    console.table(spotCheck.rows);
  } else {
    console.log('\nNo legacy action candidates were found to spot-check.');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
