import { pool } from '../db.js';

const EXPECTED_SQL = `
WITH expected AS (
  SELECT i.home_id, 'incident' AS source_type, i.id::text AS source_id,
         'legacy:' || (ca.ordinality - 1)::text || ':' || md5(concat_ws('|',
           ca.action->>'description',
           ca.action->>'assigned_to',
           ca.action->>'due_date',
           ca.action->>'status'
         )) AS source_action_key
    FROM incidents i
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(i.corrective_actions) = 'array' THEN i.corrective_actions ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS ca(action, ordinality)
   WHERE i.deleted_at IS NULL
     AND jsonb_typeof(i.corrective_actions) = 'array'
     AND nullif(ca.action->>'description', '') IS NOT NULL

  UNION ALL
  SELECT a.home_id, 'ipc_audit', a.id::text,
         'legacy:' || (ca.ordinality - 1)::text || ':' || md5(concat_ws('|',
           ca.action->>'description',
           ca.action->>'assigned_to',
           ca.action->>'due_date',
           ca.action->>'status'
         ))
    FROM ipc_audits a
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(a.corrective_actions) = 'array' THEN a.corrective_actions ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS ca(action, ordinality)
   WHERE a.deleted_at IS NULL
     AND jsonb_typeof(a.corrective_actions) = 'array'
     AND nullif(ca.action->>'description', '') IS NOT NULL

  UNION ALL
  SELECT r.home_id, 'risk', r.id::text,
         'legacy:' || (ra.ordinality - 1)::text || ':' || md5(concat_ws('|',
           ra.action->>'description',
           ra.action->>'owner',
           ra.action->>'due_date',
           ra.action->>'status'
         ))
    FROM risk_register r
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(r.actions) = 'array' THEN r.actions ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS ra(action, ordinality)
   WHERE r.deleted_at IS NULL
     AND jsonb_typeof(r.actions) = 'array'
     AND nullif(ra.action->>'description', '') IS NOT NULL

  UNION ALL
  SELECT c.home_id, 'complaint', c.id::text, 'legacy:improvements:' || md5(c.improvements)
    FROM complaints c
   WHERE c.deleted_at IS NULL
     AND nullif(c.improvements, '') IS NOT NULL

  UNION ALL
  SELECT s.home_id, 'complaint_survey', s.id::text, 'legacy:actions:' || md5(s.actions)
    FROM complaint_surveys s
   WHERE s.deleted_at IS NULL
     AND nullif(s.actions, '') IS NOT NULL

  UNION ALL
  SELECT m.home_id, 'maintenance', m.id::text,
         'derived:items_failed:' || md5(concat_ws('|', m.description, m.items_failed::text, m.next_due::text))
    FROM maintenance m
   WHERE m.deleted_at IS NULL
     AND coalesce(m.items_failed, 0) > 0

  UNION ALL
  SELECT m.home_id, 'maintenance', m.id::text,
         'derived:next_due:' || md5(concat_ws('|', m.description, m.next_due::text))
    FROM maintenance m
   WHERE m.deleted_at IS NULL
     AND m.next_due IS NOT NULL
     AND m.next_due < CURRENT_DATE

  UNION ALL
  SELECT m.home_id, 'maintenance', m.id::text,
         'derived:certificate_expiry:' || md5(concat_ws('|', m.certificate_ref, m.certificate_expiry::text))
    FROM maintenance m
   WHERE m.deleted_at IS NULL
     AND m.certificate_expiry IS NOT NULL
     AND m.certificate_expiry < CURRENT_DATE

  UNION ALL
  SELECT f.home_id, 'fire_drill', f.id::text, 'legacy:corrective_actions:' || md5(f.corrective_actions)
    FROM fire_drills f
   WHERE f.deleted_at IS NULL
     AND nullif(f.corrective_actions, '') IS NOT NULL

  UNION ALL
  SELECT s.home_id, 'supervision', s.id::text, 'legacy:actions:' || md5(s.actions)
    FROM supervisions s
   WHERE s.deleted_at IS NULL
     AND nullif(s.actions, '') IS NOT NULL

  UNION ALL
  SELECT a.home_id, 'appraisal', a.id::text, 'legacy:development_plan:' || md5(a.development_plan)
    FROM appraisals a
   WHERE a.deleted_at IS NULL
     AND nullif(a.development_plan, '') IS NOT NULL

  UNION ALL
  SELECT a.home_id, 'appraisal', a.id::text, 'legacy:training_needs:' || md5(a.training_needs)
    FROM appraisals a
   WHERE a.deleted_at IS NULL
     AND nullif(a.training_needs, '') IS NOT NULL
)
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
WITH expected AS (
  SELECT i.home_id, h.slug AS home_slug, 'incident' AS source_type, i.id::text AS source_id,
         'legacy:' || (ca.ordinality - 1)::text || ':' || md5(concat_ws('|',
           ca.action->>'description', ca.action->>'assigned_to', ca.action->>'due_date', ca.action->>'status'
         )) AS source_action_key,
         left(ca.action->>'description', 120) AS title
    FROM incidents i
    JOIN homes h ON h.id = i.home_id
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(i.corrective_actions) = 'array' THEN i.corrective_actions ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS ca(action, ordinality)
   WHERE i.deleted_at IS NULL AND jsonb_typeof(i.corrective_actions) = 'array' AND nullif(ca.action->>'description', '') IS NOT NULL
)
SELECT e.*
  FROM expected e
  LEFT JOIN action_items ai
    ON ai.home_id = e.home_id
   AND ai.source_type = e.source_type
   AND ai.source_id = e.source_id
   AND ai.source_action_key = e.source_action_key
   AND ai.deleted_at IS NULL
 WHERE ai.id IS NULL
 ORDER BY e.home_slug, e.source_type, e.source_id
 LIMIT 25;
`;

async function main() {
  const { rows } = await pool.query(EXPECTED_SQL);
  const totals = rows.reduce((acc, row) => ({
    expected: acc.expected + Number(row.expected || 0),
    matched: acc.matched + Number(row.matched || 0),
    missing: acc.missing + Number(row.missing || 0),
  }), { expected: 0, matched: 0, missing: 0 });

  console.log('\nAction item backfill verification\n');
  console.table(rows);
  console.log(`Totals: expected=${totals.expected} matched=${totals.matched} missing=${totals.missing}`);

  if (totals.missing > 0) {
    const missing = await pool.query(MISSING_SQL);
    if (missing.rows.length > 0) {
      console.log('\nSample missing incident actions:');
      console.table(missing.rows);
    }
    process.exitCode = 1;
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
