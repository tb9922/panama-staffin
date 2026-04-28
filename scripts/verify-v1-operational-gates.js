import { pool } from '../db.js';

const MIN_HOMES = Number(process.env.V1_OPERATIONAL_MIN_HOMES || 3);
const REQUIRED_RETENTION_TABLES = [
  'action_items',
  'reflective_practice',
  'agency_approval_attempts',
  'audit_tasks',
  'outcome_metrics',
];

async function activeHomeCount() {
  const { rows: [row] } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM homes WHERE deleted_at IS NULL`,
  );
  return row.count;
}

async function retentionRows() {
  const { rows } = await pool.query(
    `SELECT applies_to_table, retention_days, retention_period
       FROM retention_schedule
      WHERE applies_to_table = ANY($1::varchar[])
      ORDER BY applies_to_table`,
    [REQUIRED_RETENTION_TABLES],
  );
  return rows;
}

async function recentBoardPackAudit() {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS downloads,
            COUNT(DISTINCT home_slug)::int AS homes_covered,
            MAX(ts) AS latest_download
       FROM audit_log
      WHERE action = 'portfolio_board_pack_download'
        AND ts >= NOW() - INTERVAL '30 days'`,
  );
  return rows[0];
}

async function emergencyOverrideRows() {
  const { rows } = await pool.query(
    `SELECT h.slug AS home_slug,
            COUNT(s.id)::int AS agency_shifts_7d,
            COUNT(s.id) FILTER (WHERE a.emergency_override = true)::int AS linked_emergency_overrides_7d,
            CASE WHEN COUNT(s.id) = 0 THEN 0
                 ELSE ROUND((COUNT(s.id) FILTER (WHERE a.emergency_override = true)::numeric / COUNT(s.id)) * 100, 1)
            END AS emergency_override_pct
       FROM homes h
       LEFT JOIN agency_shifts s
         ON s.home_id = h.id
        AND s.date >= CURRENT_DATE - INTERVAL '7 days'
       LEFT JOIN agency_approval_attempts a
         ON a.id = s.agency_attempt_id
        AND a.home_id = h.id
        AND a.deleted_at IS NULL
      WHERE h.deleted_at IS NULL
      GROUP BY h.slug
      ORDER BY emergency_override_pct DESC, h.slug`,
  );
  return rows;
}

async function actionItemSignals() {
  const { rows: [row] } = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (
              WHERE deleted_at IS NULL
                AND status NOT IN ('completed', 'verified', 'cancelled')
                AND due_date < CURRENT_DATE
            )::int AS overdue,
            COUNT(*) FILTER (
              WHERE deleted_at IS NULL
                AND escalation_level >= 3
                AND status NOT IN ('completed', 'verified', 'cancelled')
            )::int AS escalated_l3_plus
       FROM action_items`,
  );
  return row;
}

function pass(label, details) {
  console.log(`PASS ${label}${details ? ` - ${details}` : ''}`);
}

function fail(label, details) {
  console.log(`FAIL ${label}${details ? ` - ${details}` : ''}`);
  process.exitCode = 1;
}

function warn(label, details) {
  console.log(`WARN ${label}${details ? ` - ${details}` : ''}`);
}

async function main() {
  console.log('\nPanama V1 operational gate verification\n');

  const [homes, retention, boardPack, overrides, actions] = await Promise.all([
    activeHomeCount(),
    retentionRows(),
    recentBoardPackAudit(),
    emergencyOverrideRows(),
    actionItemSignals(),
  ]);

  if (homes >= MIN_HOMES) pass('3-home operational dataset', `${homes} active homes`);
  else fail('3-home operational dataset', `${homes} active homes, expected at least ${MIN_HOMES}`);

  const retentionByTable = new Map(retention.map(row => [row.applies_to_table, row]));
  const missingRetention = REQUIRED_RETENTION_TABLES.filter(table => !retentionByTable.has(table));
  const shortRetention = retention.filter(row => Number(row.retention_days) < 2555).map(row => row.applies_to_table);
  if (missingRetention.length === 0 && shortRetention.length === 0) {
    pass('7-year V1 retention schedule', REQUIRED_RETENTION_TABLES.join(', '));
  } else {
    if (missingRetention.length > 0) fail('7-year V1 retention schedule', `missing ${missingRetention.join(', ')}`);
    if (shortRetention.length > 0) fail('7-year V1 retention schedule', `short retention ${shortRetention.join(', ')}`);
  }

  if (Number(boardPack.downloads || 0) > 0 && Number(boardPack.homes_covered || 0) >= Math.min(homes, MIN_HOMES)) {
    pass('portfolio board-pack audit trail', `${boardPack.downloads} downloads covering ${boardPack.homes_covered} homes`);
  } else {
    warn('portfolio board-pack review still needs human completion', 'generate a full-week board pack and record Teddy/external review');
  }

  const redOverrideHomes = overrides.filter(row => Number(row.emergency_override_pct) > 20);
  if (redOverrideHomes.length === 0) {
    pass('emergency override report', 'no home is above the 20% red threshold');
  } else {
    warn('emergency override report', `${redOverrideHomes.length} home(s) above 20% emergency agency override`);
    console.table(redOverrideHomes);
  }

  pass('manager action signals readable', `${actions.total} total, ${actions.overdue} overdue, ${actions.escalated_l3_plus} L3+`);

  if (process.env.V1_LEGACY_ACTION_FREEZE === '1') {
    pass('legacy action freeze flag', 'V1_LEGACY_ACTION_FREEZE=1');
  } else {
    warn('legacy action freeze flag', 'set V1_LEGACY_ACTION_FREEZE=1 only after backfill spot-check sign-off');
  }

  console.log('\nManual gates that this script cannot complete: Teddy walkthrough sign-off and external CQC/quality review.\n');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
