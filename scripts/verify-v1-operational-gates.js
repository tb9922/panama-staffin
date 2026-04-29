import { pool } from '../db.js';
import { execFileSync } from 'child_process';
import { config } from '../config.js';
import * as portfolioService from '../services/portfolioService.js';

const MIN_HOMES = Number(process.env.V1_OPERATIONAL_MIN_HOMES || 3);
const REQUIRED_RETENTION_TABLES = [
  'action_items',
  'reflective_practice',
  'agency_approval_attempts',
  'audit_tasks',
  'outcome_metrics',
];
const REQUIRED_TABLES = [
  'homes',
  'users',
  'user_home_roles',
  'retention_schedule',
  'audit_log',
  ...REQUIRED_RETENTION_TABLES,
  'agency_shifts',
];

async function requiredTableStatus() {
  const { rows } = await pool.query(
    `SELECT table_name,
            to_regclass('public.' || table_name) IS NOT NULL AS exists
       FROM unnest($1::text[]) AS t(table_name)
      ORDER BY table_name`,
    [[...new Set(REQUIRED_TABLES)]],
  );
  return rows;
}

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

async function platformAdminUsername() {
  const { rows: [row] } = await pool.query(
    `SELECT username
       FROM users
      WHERE active = true
        AND is_platform_admin = true
      ORDER BY username
      LIMIT 1`,
  );
  return row?.username || null;
}

async function portfolioKpiQuality() {
  const username = await platformAdminUsername();
  if (!username) return { username: null, homes: [], rag: {}, unknownRows: [], missingStaffingBaseline: [] };

  const payload = await portfolioService.getPortfolioKpisForUser({ username, isPlatformAdmin: true });
  const homes = Array.isArray(payload?.homes) ? payload.homes : [];
  const rag = { red: 0, amber: 0, green: 0, unknown: 0 };
  const unknownRows = [];
  const missingStaffingBaseline = [];

  for (const home of homes) {
    const overall = home.rag?.overall || 'unknown';
    rag[overall] = (rag[overall] || 0) + 1;
    const unknownSignals = Object.entries(home.rag || {})
      .filter(([key, value]) => key !== 'overall' && value === 'unknown')
      .map(([key]) => key);
    if (unknownSignals.length > 0) {
      unknownRows.push({
        home_slug: home.home_slug,
        unknown_signals: unknownSignals.join(', '),
      });
    }
    if (Number(home.staffing?.planned_shift_slots_7d || 0) === 0) {
      missingStaffingBaseline.push({
        home_slug: home.home_slug,
        home_name: home.home_name,
      });
    }
  }

  return { username, homes, rag, unknownRows, missingStaffingBaseline };
}

function commandAvailable(command) {
  if (!command) return false;
  try {
    if (process.platform === 'win32') {
      execFileSync('where.exe', [command], { stdio: 'ignore' });
    } else {
      execFileSync('sh', ['-lc', `command -v ${JSON.stringify(command)} >/dev/null 2>&1`], { stdio: 'ignore' });
    }
    return true;
  } catch {
    return false;
  }
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

  const tables = await requiredTableStatus();
  const missingTables = tables.filter(row => row.exists !== true).map(row => row.table_name);
  if (missingTables.length > 0) {
    fail('V1 migrations applied', `missing table(s): ${missingTables.join(', ')}`);
    console.log('\nRun migrations before using live V1 operational gates: node scripts/migrate.js\n');
    return;
  }
  pass('V1 migrations applied', 'required tables are present');

  const [homes, retention, boardPack, overrides, actions, portfolioQuality] = await Promise.all([
    activeHomeCount(),
    retentionRows(),
    recentBoardPackAudit(),
    emergencyOverrideRows(),
    actionItemSignals(),
    portfolioKpiQuality(),
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

  if (!portfolioQuality.username) {
    fail('portfolio KPI live-data sweep', 'no active platform admin user found for cross-home KPI generation');
  } else if (portfolioQuality.homes.length === 0) {
    fail('portfolio KPI live-data sweep', `platform admin ${portfolioQuality.username} sees 0 homes`);
  } else {
    pass(
      'portfolio KPI live-data sweep',
      `${portfolioQuality.homes.length} homes via ${portfolioQuality.username}; red=${portfolioQuality.rag.red || 0}, amber=${portfolioQuality.rag.amber || 0}, green=${portfolioQuality.rag.green || 0}, unknown=${portfolioQuality.rag.unknown || 0}`,
    );
    if (portfolioQuality.unknownRows.length > 0) {
      warn('portfolio unknown KPI coverage', `${portfolioQuality.unknownRows.length} home(s) have unknown signals`);
      console.table(portfolioQuality.unknownRows.slice(0, 10));
    }
    if (portfolioQuality.missingStaffingBaseline.length > 0) {
      warn('minimum staffing baselines', `${portfolioQuality.missingStaffingBaseline.length} home(s) have no planned staffing baseline`);
      console.table(portfolioQuality.missingStaffingBaseline.slice(0, 10));
    }
  }

  if (!config.upload.scanCommand) {
    if (config.nodeEnv === 'production') {
      fail('production upload malware scanner', 'UPLOAD_SCAN_COMMAND is not configured');
    } else {
      warn('upload malware scanner', 'UPLOAD_SCAN_COMMAND is not configured in this environment');
    }
  } else if (commandAvailable(config.upload.scanCommand)) {
    pass('upload malware scanner', config.upload.scanCommand);
  } else {
    fail('upload malware scanner', `${config.upload.scanCommand} is configured but not available on PATH`);
  }

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
