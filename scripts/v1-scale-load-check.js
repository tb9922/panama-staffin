#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import { fileURLToPath } from 'url';

const DEFAULTS = {
  homes: 12,
  staffPerHome: 48,
  iterations: 3,
  concurrency: 4,
  prefix: 'scale-v1-os',
  password: 'ScaleLocal1!',
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);
const SAFE_DB_NAME = /(^|[_-])(dev|test|local)([_-]|$)|panama_(dev|test|local)$/i;
const UNSAFE_DB_NAME = /(prod|production|live|rds|render|railway|neon|supabase)/i;

function readEnvFile(envPath = path.join(process.cwd(), '.env')) {
  try {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const raw = trimmed.slice(eq + 1).trim();
      const value = raw.replace(/^(['"])(.*)\1$/, '$2');
      if (key && !(key in process.env)) process.env[key] = value;
    }
  } catch {
    // The main config loader also treats .env as optional.
  }
}

export function parseIntegerOption(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    homes: parseIntegerOption(env.PANAMA_SCALE_HOMES, DEFAULTS.homes, { min: 10, max: 20 }),
    staffPerHome: parseIntegerOption(env.PANAMA_SCALE_STAFF_PER_HOME, DEFAULTS.staffPerHome, { min: 20, max: 120 }),
    iterations: parseIntegerOption(env.PANAMA_SCALE_ITERATIONS, DEFAULTS.iterations, { min: 1, max: 25 }),
    concurrency: parseIntegerOption(env.PANAMA_SCALE_CONCURRENCY, DEFAULTS.concurrency, { min: 1, max: 12 }),
    prefix: env.PANAMA_SCALE_PREFIX || DEFAULTS.prefix,
    keepData: env.PANAMA_SCALE_KEEP_DATA === '1',
    jsonOut: env.PANAMA_SCALE_JSON_OUT || null,
  };

  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'homes') options.homes = parseIntegerOption(value, options.homes, { min: 10, max: 20 });
    if (key === 'staff-per-home') options.staffPerHome = parseIntegerOption(value, options.staffPerHome, { min: 20, max: 120 });
    if (key === 'iterations') options.iterations = parseIntegerOption(value, options.iterations, { min: 1, max: 25 });
    if (key === 'concurrency') options.concurrency = parseIntegerOption(value, options.concurrency, { min: 1, max: 12 });
    if (key === 'prefix') options.prefix = value || options.prefix;
    if (key === 'keep-data') options.keepData = true;
    if (key === 'json-out') options.jsonOut = value || '.review/v1-scale-load-latest.json';
  }

  if (!/^[a-z0-9][a-z0-9-]{2,40}$/i.test(options.prefix)) {
    throw new Error('Scale prefix must be 3-41 URL-safe characters.');
  }
  return options;
}

export function assertLocalOnlyTarget({ nodeEnv, dbHost, dbName, dbSsl, databaseUrl, allowedOrigin } = {}) {
  if (nodeEnv === 'production') {
    throw new Error('Refusing to run V1 scale load check with NODE_ENV=production.');
  }

  const host = String(dbHost || '').toLowerCase();
  const name = String(dbName || '').toLowerCase();
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`Refusing to run against non-local DB host "${dbHost}".`);
  }
  if (!SAFE_DB_NAME.test(name) || UNSAFE_DB_NAME.test(name)) {
    throw new Error(`Refusing to run against DB name "${dbName}". Use a local dev/test database.`);
  }
  if (dbSsl && dbSsl !== false && dbSsl !== 'false') {
    throw new Error('Refusing to run with DB SSL enabled; expected a local Postgres target.');
  }
  if (databaseUrl) {
    const parsed = new URL(databaseUrl);
    if (!LOCAL_HOSTS.has(parsed.hostname.toLowerCase())) {
      throw new Error(`Refusing to run with non-local DATABASE_URL host "${parsed.hostname}".`);
    }
  }
  if (allowedOrigin && !String(allowedOrigin).includes('localhost') && !String(allowedOrigin).includes('127.0.0.1')) {
    throw new Error(`Refusing to run with non-local ALLOWED_ORIGIN "${allowedOrigin}".`);
  }
}

export function buildHomeConfig(index, staffPerHome) {
  const registeredBeds = 32 + (index % 7) * 4;
  const pressure = index % 4;
  return {
    home_name: `Scale V1 Home ${String(index + 1).padStart(2, '0')}`,
    registered_beds: registeredBeds,
    care_type: index % 3 === 0 ? 'nursing' : 'residential',
    cycle_start_date: '2026-04-06',
    shifts: { E: { hours: 8 }, L: { hours: 8 }, N: { hours: 10 } },
    minimum_staffing: {
      early: { heads: 4 + pressure, skill_points: 5 + pressure },
      late: { heads: 4 + pressure, skill_points: 5 + pressure },
      night: { heads: 2 + (index % 2), skill_points: 3 },
    },
    training_types: [
      { id: 'safeguarding', name: 'Safeguarding Adults', active: true, roles: null },
      { id: 'medicines', name: 'Medicines Management', active: true, roles: ['Senior Carer', 'Nurse'] },
      { id: 'moving_handling', name: 'Moving and Handling', active: true, roles: null },
      { id: 'fire_safety', name: 'Fire Safety', active: true, roles: null },
      { id: 'infection_control', name: 'Infection Prevention and Control', active: true, roles: null },
    ],
    agency_rate_day: 26 + (index % 4),
    agency_rate_night: 31 + (index % 4),
    staff_count_target: staffPerHome,
    bank_holidays: [],
  };
}

export function summarizeTimings(samples) {
  const values = [...samples].sort((a, b) => a - b);
  if (values.length === 0) return { count: 0, minMs: null, p50Ms: null, p95Ms: null, maxMs: null, avgMs: null };
  const pick = percentile => values[Math.min(values.length - 1, Math.ceil((percentile / 100) * values.length) - 1)];
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    count: values.length,
    minMs: Math.round(values[0]),
    p50Ms: Math.round(pick(50)),
    p95Ms: Math.round(pick(95)),
    maxMs: Math.round(values[values.length - 1]),
    avgMs: Math.round(sum / values.length),
  };
}

function daysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function daysFromNow(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function staffId(homeIndex, staffIndex) {
  return `S${String(homeIndex + 1).padStart(2, '0')}${String(staffIndex + 1).padStart(3, '0')}`;
}

async function runLimited(items, concurrency, worker) {
  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function timed(label, fn) {
  const start = performance.now();
  const result = await fn();
  return { label, ms: performance.now() - start, result };
}

async function cleanup(client, prefix) {
  const like = `${prefix}-%`;
  const { rows } = await client.query('SELECT id FROM homes WHERE slug LIKE $1', [like]);
  const homeIds = rows.map(row => row.id);
  if (homeIds.length === 0) return;

  await client.query('UPDATE agency_shifts SET agency_attempt_id = NULL WHERE home_id = ANY($1::int[])', [homeIds]).catch(() => {});
  await client.query('UPDATE agency_approval_attempts SET linked_agency_shift_id = NULL WHERE home_id = ANY($1::int[])', [homeIds]).catch(() => {});

  const tables = [
    'action_items',
    'agency_shifts',
    'agency_approval_attempts',
    'agency_providers',
    'training_records',
    'supervisions',
    'appraisals',
    'audit_tasks',
    'outcome_metrics',
    'incidents',
    'complaints',
    'beds',
    'finance_residents',
    'staff',
  ];
  for (const table of tables) {
    await client.query(`DELETE FROM ${table} WHERE home_id = ANY($1::int[])`, [homeIds]).catch(() => {});
  }

  await client.query('DELETE FROM audit_log WHERE home_slug LIKE $1', [like]).catch(() => {});
  await client.query('DELETE FROM user_home_roles WHERE username LIKE $1 OR home_id = ANY($2::int[])', [like, homeIds]).catch(() => {});
  await client.query('DELETE FROM token_denylist WHERE username LIKE $1', [like]).catch(() => {});
  await client.query('DELETE FROM users WHERE username LIKE $1', [like]).catch(() => {});
  await client.query('DELETE FROM homes WHERE id = ANY($1::int[])', [homeIds]);
}

async function seedHomes(client, options, bcrypt) {
  const username = `${options.prefix}-admin`;
  const passwordHash = await bcrypt.hash(DEFAULTS.password, 4);
  const { rows: [user] } = await client.query(
    `INSERT INTO users (username, password_hash, role, display_name, active, is_platform_admin, created_by)
     VALUES ($1, $2, 'viewer', 'Scale Load Manager', true, false, 'scale-load-check')
     ON CONFLICT (username) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       role = 'viewer',
       display_name = EXCLUDED.display_name,
       active = true,
       is_platform_admin = false
     RETURNING id, username`,
    [username, passwordHash],
  );

  const homes = [];
  for (let i = 0; i < options.homes; i += 1) {
    const slug = `${options.prefix}-home-${String(i + 1).padStart(2, '0')}`;
    const config = buildHomeConfig(i, options.staffPerHome);
    const { rows: [home] } = await client.query(
      `INSERT INTO homes (slug, name, config)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (slug) WHERE deleted_at IS NULL DO UPDATE SET name = EXCLUDED.name, config = EXCLUDED.config
       RETURNING id, slug, name`,
      [slug, config.home_name, JSON.stringify(config)],
    );
    homes.push({ ...home, config, index: i });
    await client.query(
      `INSERT INTO user_home_roles (username, home_id, role_id, granted_by)
       VALUES ($1, $2, 'home_manager', 'scale-load-check')
       ON CONFLICT (username, home_id) DO UPDATE SET role_id = 'home_manager', granted_by = 'scale-load-check'`,
      [username, home.id],
    );
  }

  return { user, username, password: DEFAULTS.password, homes };
}

async function seedHomeOperationalData(client, home, options) {
  const staffRows = [];
  for (let i = 0; i < options.staffPerHome; i += 1) {
    const role = i % 11 === 0 ? 'Nurse' : (i % 5 === 0 ? 'Senior Carer' : 'Carer');
    const shift = i % 3 === 0 ? 'E' : (i % 3 === 1 ? 'L' : 'N');
    staffRows.push({
      id: staffId(home.index, i),
      name: `Scale Staff ${home.index + 1}-${i + 1}`,
      role,
      team: `Team ${String.fromCharCode(65 + (i % 4))}`,
      pref: shift,
      skill: role === 'Nurse' ? 4 : (role === 'Senior Carer' ? 3 : 2),
      hourly_rate: role === 'Nurse' ? 19.5 : (role === 'Senior Carer' ? 14.5 : 12.5),
      contract_hours: i % 6 === 0 ? 30 : 37.5,
      willing_extras: i % 4 !== 0,
      willing_other_homes: i % 5 === 0,
      internal_bank_status: i % 13 === 0 ? 'limited' : 'available',
    });
  }

  await client.query(
    `INSERT INTO staff (
       id, home_id, name, role, team, pref, skill, hourly_rate, active, start_date,
       contract_hours, willing_extras, willing_other_homes, max_weekly_hours_topup,
       max_travel_radius_km, home_postcode, internal_bank_status
     )
     SELECT id, $1, name, role, team, pref, skill, hourly_rate, true, '2024-01-01'::date,
            contract_hours, willing_extras, willing_other_homes, 8, 25, 'AB1 1AA', internal_bank_status
     FROM jsonb_to_recordset($2::jsonb) AS s(
       id text, name text, role text, team text, pref text, skill numeric, hourly_rate numeric,
       contract_hours numeric, willing_extras boolean, willing_other_homes boolean, internal_bank_status text
     )
     ON CONFLICT (home_id, id) DO UPDATE SET
       name = EXCLUDED.name,
       role = EXCLUDED.role,
       team = EXCLUDED.team,
       pref = EXCLUDED.pref,
       skill = EXCLUDED.skill,
       hourly_rate = EXCLUDED.hourly_rate,
       active = true,
       contract_hours = EXCLUDED.contract_hours,
       willing_extras = EXCLUDED.willing_extras,
       willing_other_homes = EXCLUDED.willing_other_homes,
       internal_bank_status = EXCLUDED.internal_bank_status`,
    [home.id, JSON.stringify(staffRows)],
  );

  const trainingRows = [];
  for (const staff of staffRows) {
    for (const type of home.config.training_types) {
      if (Array.isArray(type.roles) && !type.roles.includes(staff.role)) continue;
      const signal = (Number(staff.id.slice(-3)) + home.index + type.id.length) % 10;
      trainingRows.push({
        staff_id: staff.id,
        training_type_id: type.id,
        completed: signal === 0 ? null : daysAgo(90 + signal),
        expiry: signal === 1 ? daysAgo(5) : (signal === 2 ? daysFromNow(18) : daysFromNow(220 - signal)),
        trainer: 'Scale Training Lead',
        method: signal % 2 === 0 ? 'classroom' : 'e_learning',
      });
    }
  }

  await client.query(
    `INSERT INTO training_records (home_id, staff_id, training_type_id, completed, expiry, trainer, method, certificate_ref)
     SELECT $1, staff_id, training_type_id, completed::date, expiry::date, trainer, method,
            'scale-' || staff_id || '-' || training_type_id
     FROM jsonb_to_recordset($2::jsonb) AS tr(
       staff_id text, training_type_id text, completed text, expiry text, trainer text, method text
     )
     ON CONFLICT (home_id, staff_id, training_type_id) DO UPDATE SET
       completed = EXCLUDED.completed,
       expiry = EXCLUDED.expiry,
       trainer = EXCLUDED.trainer,
       method = EXCLUDED.method,
       certificate_ref = EXCLUDED.certificate_ref,
       deleted_at = NULL`,
    [home.id, JSON.stringify(trainingRows)],
  );

  const supervisionRows = staffRows.filter((_, i) => i % 2 === 0).map((staff, i) => ({
    id: `scale-sup-${home.index}-${i}`,
    staff_id: staff.id,
    date: daysAgo(60 + (i % 20)),
    next_due: i % 3 === 0 ? daysAgo(7) : daysFromNow(10 + i),
  }));
  await client.query(
    `INSERT INTO supervisions (id, home_id, staff_id, date, supervisor, topics, actions, next_due, notes)
     SELECT id, $1, staff_id, date::date, 'Scale Deputy', 'Practice, wellbeing, policy update',
            'Follow up training and reflective practice', next_due::date, 'Scale harness supervision'
     FROM jsonb_to_recordset($2::jsonb) AS s(id text, staff_id text, date text, next_due text)
     ON CONFLICT (home_id, id) DO NOTHING`,
    [home.id, JSON.stringify(supervisionRows)],
  );

  const appraisalRows = staffRows.filter((_, i) => i % 4 === 0).map((staff, i) => ({
    id: `scale-app-${home.index}-${i}`,
    staff_id: staff.id,
    date: daysAgo(330 + (i % 30)),
    next_due: i % 2 === 0 ? daysAgo(3) : daysFromNow(35),
  }));
  await client.query(
    `INSERT INTO appraisals (id, home_id, staff_id, date, appraiser, objectives, training_needs, development_plan, next_due, notes)
     SELECT id, $1, staff_id, date::date, 'Scale Manager', 'Maintain safe staffing evidence',
            'Medicines and safeguarding refresh', 'Shadow senior on governance reviews', next_due::date,
            'Scale harness appraisal'
     FROM jsonb_to_recordset($2::jsonb) AS a(id text, staff_id text, date text, next_due text)
     ON CONFLICT (home_id, id) DO NOTHING`,
    [home.id, JSON.stringify(appraisalRows)],
  );

  const occupied = Math.max(1, home.config.registered_beds - (home.index % 5) - 2);
  const residents = [];
  for (let i = 0; i < occupied; i += 1) {
    residents.push({
      resident_name: `Scale Resident ${home.index + 1}-${i + 1}`,
      room_number: String(100 + i),
      weekly_fee: 950 + (home.index % 5) * 30,
    });
  }
  const { rows: residentRows } = await client.query(
    `INSERT INTO finance_residents (home_id, resident_name, room_number, care_type, weekly_fee, funding_type, status, created_by)
     SELECT $1, resident_name, room_number, 'residential', weekly_fee, 'self_funded', 'active', 'scale-load-check'
     FROM jsonb_to_recordset($2::jsonb) AS r(resident_name text, room_number text, weekly_fee numeric)
     RETURNING id, room_number`,
    [home.id, JSON.stringify(residents)],
  );
  const residentByRoom = new Map(residentRows.map(row => [row.room_number, row.id]));
  const bedRows = [];
  for (let i = 0; i < home.config.registered_beds; i += 1) {
    const room = String(100 + i);
    const isOccupied = i < occupied;
    bedRows.push({
      room_number: room,
      status: isOccupied ? 'occupied' : (i % 3 === 0 ? 'hospital_hold' : 'available'),
      resident_id: isOccupied ? residentByRoom.get(room) : null,
      status_since: daysAgo(10 + (i % 60)),
      hold_expires: !isOccupied && i % 3 === 0 ? daysFromNow(3) : null,
    });
  }
  await client.query(
    `INSERT INTO beds (home_id, room_number, room_type, status, resident_id, status_since, hold_expires, created_by)
     SELECT $1, room_number, 'single', status, resident_id, status_since::date, hold_expires::date, 'scale-load-check'
     FROM jsonb_to_recordset($2::jsonb) AS b(
       room_number text, status text, resident_id int, status_since text, hold_expires text
     )
     ON CONFLICT (home_id, room_number) DO UPDATE SET
       status = EXCLUDED.status,
       resident_id = EXCLUDED.resident_id,
       status_since = EXCLUDED.status_since,
       hold_expires = EXCLUDED.hold_expires`,
    [home.id, JSON.stringify(bedRows)],
  );

  const provider = await client.query(
    `INSERT INTO agency_providers (home_id, name, rate_day, rate_night)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [home.id, `Scale Agency ${home.index + 1}`, home.config.agency_rate_day, home.config.agency_rate_night],
  );
  const agencyId = provider.rows[0].id;
  const agencyShiftCount = 2 + (home.index % 5);
  for (let i = 0; i < agencyShiftCount; i += 1) {
    const shiftCode = i % 3 === 0 ? 'AG-E' : (i % 3 === 1 ? 'AG-L' : 'AG-N');
    const hours = shiftCode === 'AG-N' ? 10 : 8;
    const rate = shiftCode === 'AG-N' ? home.config.agency_rate_night : home.config.agency_rate_day;
    const { rows: [shift] } = await client.query(
      `INSERT INTO agency_shifts (home_id, agency_id, date, shift_code, hours, hourly_rate, total_cost, worker_name, role_covered)
       VALUES ($1, $2, CURRENT_DATE - ($3::int * INTERVAL '1 day'), $4, $5, $6, $7, $8, 'Carer')
       RETURNING id`,
      [home.id, agencyId, i, shiftCode, hours, rate, hours * rate, `Scale Agency Worker ${i + 1}`],
    );
    const emergency = i % 2 === 0;
    const { rows: [attempt] } = await client.query(
      `INSERT INTO agency_approval_attempts (
         home_id, gap_date, shift_code, role_needed, reason, overtime_offered,
         internal_bank_checked, internal_bank_candidate_count, viable_internal_candidate_count,
         emergency_override, emergency_override_reason, outcome, linked_agency_shift_id
       )
       VALUES ($1, CURRENT_DATE - ($2::int * INTERVAL '1 day'), $3, 'Carer',
               'Scale load cover pressure', true, true, 3, $4, $5, $6, 'emergency_agency', $7)
       RETURNING id`,
      [home.id, i, shiftCode, emergency ? 0 : 1, emergency, emergency ? 'No safe internal cover available before handover' : null, shift.id],
    );
    await client.query('UPDATE agency_shifts SET agency_attempt_id = $1 WHERE id = $2', [attempt.id, shift.id]);
  }

  const actionRows = Array.from({ length: 10 + (home.index % 4) }, (_, i) => ({
    key: `scale-action-${home.index}-${i}`,
    title: `Scale manager action ${i + 1}`,
    category: ['governance', 'staffing', 'clinical', 'operational'][i % 4],
    priority: i % 7 === 0 ? 'critical' : (i % 3 === 0 ? 'high' : 'medium'),
    due_date: i % 3 === 0 ? daysAgo(2 + i) : daysFromNow(3 + i),
    escalation_level: i % 7 === 0 ? 4 : (i % 3 === 0 ? 2 : 0),
  }));
  await client.query(
    `INSERT INTO action_items (
       home_id, source_type, source_id, source_action_key, title, category, priority,
       due_date, status, escalation_level, evidence_required, owner_name
     )
     SELECT $1, 'standalone', 'scale-load-check', key, title, category, priority,
            due_date::date, 'open', escalation_level, true, 'Scale Manager'
     FROM jsonb_to_recordset($2::jsonb) AS a(
       key text, title text, category text, priority text, due_date text, escalation_level int
     )
     ON CONFLICT (home_id, source_type, source_id, source_action_key)
       WHERE deleted_at IS NULL AND source_id IS NOT NULL AND source_action_key IS NOT NULL
     DO UPDATE SET
       title = EXCLUDED.title,
       category = EXCLUDED.category,
       priority = EXCLUDED.priority,
       due_date = EXCLUDED.due_date,
       status = EXCLUDED.status,
       escalation_level = EXCLUDED.escalation_level`,
    [home.id, JSON.stringify(actionRows)],
  );

  const incidentRows = Array.from({ length: 6 + (home.index % 5) }, (_, i) => ({
    id: `scale-inc-${home.index}-${i}`,
    date: daysAgo(1 + i * 2),
    time: `${String(8 + (i % 10)).padStart(2, '0')}:00`,
    type: i % 3 === 0 ? 'Fall' : (i % 3 === 1 ? 'Medication' : 'Skin integrity'),
    severity: i % 5 === 0 ? 'serious' : 'medium',
    person_affected_name: `Scale Resident ${home.index + 1}-${(i % occupied) + 1}`,
    cqc_notifiable: i % 5 === 0,
    cqc_notified: false,
    riddor_reportable: i % 7 === 0,
    duty_of_candour_applies: i % 4 === 0,
  }));
  await client.query(
    `INSERT INTO incidents (
       id, home_id, date, time, location, type, severity, description,
       person_affected_name, investigation_status, investigation_review_date,
       root_cause, cqc_notifiable, cqc_notified, cqc_notification_deadline,
       riddor_reportable, riddor_category, riddor_reported, duty_of_candour_applies
     )
     SELECT id, $1, date::date, time::time, 'Lounge', type, severity,
            'Scale load incident with governance follow-up', person_affected_name, 'open',
            (date::date + INTERVAL '3 days')::date, 'Environment',
            cqc_notifiable, cqc_notified, NOW() - INTERVAL '1 day',
            riddor_reportable, CASE WHEN riddor_reportable THEN 'specified_injury' ELSE NULL END,
            false, duty_of_candour_applies
     FROM jsonb_to_recordset($2::jsonb) AS i(
       id text, date text, time text, type text, severity text, person_affected_name text,
       cqc_notifiable boolean, cqc_notified boolean, riddor_reportable boolean, duty_of_candour_applies boolean
     )
     ON CONFLICT (home_id, id) DO UPDATE SET
       date = EXCLUDED.date,
       type = EXCLUDED.type,
       severity = EXCLUDED.severity,
       investigation_status = 'open',
       deleted_at = NULL`,
    [home.id, JSON.stringify(incidentRows)],
  );

  const complaintRows = Array.from({ length: 3 + (home.index % 4) }, (_, i) => ({
    id: `scale-cmp-${home.index}-${i}`,
    date: daysAgo(4 + i * 3),
    category: i % 2 === 0 ? 'communication' : 'care_quality',
    title: `Scale complaint ${i + 1}`,
    acknowledged_date: i % 3 === 0 ? null : daysAgo(2 + i),
    response_deadline: i % 2 === 0 ? daysAgo(1) : daysFromNow(8),
  }));
  await client.query(
    `INSERT INTO complaints (
       id, home_id, date, raised_by, raised_by_name, category, title, description,
       acknowledged_date, response_deadline, status, root_cause, improvements
     )
     SELECT id, $1, date::date, 'relative', 'Scale Family', category, title,
            'Scale load complaint for board reporting', acknowledged_date::date,
            response_deadline::date, 'open', 'Communication', 'Manager to evidence family update cadence'
     FROM jsonb_to_recordset($2::jsonb) AS c(
       id text, date text, category text, title text, acknowledged_date text, response_deadline text
     )
     ON CONFLICT (home_id, id) DO UPDATE SET
       date = EXCLUDED.date,
       category = EXCLUDED.category,
       title = EXCLUDED.title,
       acknowledged_date = EXCLUDED.acknowledged_date,
       response_deadline = EXCLUDED.response_deadline,
       status = 'open',
       deleted_at = NULL`,
    [home.id, JSON.stringify(complaintRows)],
  );

  const auditRows = Array.from({ length: 8 }, (_, i) => ({
    key: `scale-audit-${home.index}-${i}`,
    title: `Scale governance audit ${i + 1}`,
    category: ['governance', 'medication', 'infection_control', 'care_plan'][i % 4],
    due_date: i % 3 === 0 ? daysAgo(2 + i) : daysFromNow(i + 1),
    status: i % 5 === 0 ? 'completed' : 'open',
  }));
  await client.query(
    `INSERT INTO audit_tasks (home_id, template_key, title, category, frequency, period_start, period_end, due_date, status, evidence_required)
     SELECT $1, key, title, category, 'weekly', due_date::date, due_date::date, due_date::date, status, true
     FROM jsonb_to_recordset($2::jsonb) AS a(key text, title text, category text, due_date text, status text)
     ON CONFLICT (home_id, template_key, period_start)
       WHERE deleted_at IS NULL AND template_key IS NOT NULL AND period_start IS NOT NULL
     DO UPDATE SET
       title = EXCLUDED.title,
       status = EXCLUDED.status,
       due_date = EXCLUDED.due_date`,
    [home.id, JSON.stringify(auditRows)],
  );

  await client.query(
    `INSERT INTO outcome_metrics (home_id, metric_key, period_start, period_end, numerator, denominator, notes)
     VALUES
       ($1, 'prn_antipsychotic_pct', DATE_TRUNC('month', CURRENT_DATE)::date, CURRENT_DATE, $2, $3, 'Scale load monthly governance metric'),
       ($1, 'falls_with_injury_pct', DATE_TRUNC('month', CURRENT_DATE)::date, CURRENT_DATE, $4, $5, 'Scale load monthly governance metric')
     ON CONFLICT (home_id, metric_key, period_start) DO UPDATE SET
       numerator = EXCLUDED.numerator,
       denominator = EXCLUDED.denominator,
       notes = EXCLUDED.notes,
       deleted_at = NULL`,
    [home.id, 2 + (home.index % 3), occupied, 1 + (home.index % 4), occupied],
  );
}

async function runHarness(options) {
  readEnvFile();
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  process.env.VITEST = process.env.VITEST || 'true';
  process.env.DISABLE_RATE_LIMITS = process.env.DISABLE_RATE_LIMITS || '1';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';

  const { config } = await import('../config.js');
  assertLocalOnlyTarget({
    nodeEnv: config.nodeEnv,
    dbHost: config.db.host,
    dbName: config.db.name,
    dbSsl: config.db.ssl,
    databaseUrl: process.env.DATABASE_URL,
    allowedOrigin: config.allowedOrigin,
  });

  const [{ app }, { pool }, bcryptModule, requestModule, portfolioModule] = await Promise.all([
    import('../server.js'),
    import('../db.js'),
    import('bcryptjs'),
    import('supertest'),
    import('../services/portfolioService.js'),
  ]);
  const bcrypt = bcryptModule.default;
  const request = requestModule.default;
  const { clearPortfolioCache } = portfolioModule;

  const client = await pool.connect();
  let seeded = null;
  try {
    await client.query('BEGIN');
    await cleanup(client, options.prefix);
    seeded = await seedHomes(client, options, bcrypt);
    for (const home of seeded.homes) {
      await seedHomeOperationalData(client, home, options);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  clearPortfolioCache();
  const agent = request(app);
  const login = await agent.post('/api/login').send({ username: seeded.username, password: seeded.password }).expect(200);
  const token = login.body.token;
  const auth = req => req.set('Authorization', `Bearer ${token}`);

  const kpiTimings = [];
  const boardPackTimings = [];
  const dashboardTimings = [];

  for (let i = 0; i < options.iterations; i += 1) {
    clearPortfolioCache();
    const kpi = await timed('portfolio/kpis', async () => auth(agent.get('/api/portfolio/kpis')).expect(200));
    kpiTimings.push(kpi.ms);
    const homeCount = kpi.result.body.homes?.length || 0;
    if (homeCount !== options.homes) {
      throw new Error(`Expected ${options.homes} portfolio homes, got ${homeCount}.`);
    }
  }

  await runLimited(seeded.homes.flatMap(home => Array.from({ length: options.iterations }, () => home)), options.concurrency, async (home) => {
    const summary = await timed(`dashboard/${home.slug}`, async () => auth(agent.get(`/api/dashboard/summary?home=${home.slug}`)).expect(200));
    if (summary.result.body._degraded) {
      throw new Error(`Dashboard summary degraded for ${home.slug}: ${summary.result.body._failedModules?.join(', ')}`);
    }
    dashboardTimings.push(summary.ms);
  });

  for (let i = 0; i < options.iterations; i += 1) {
    clearPortfolioCache();
    const boardPack = await timed('portfolio/board-pack', async () => auth(agent.get('/api/portfolio/board-pack')).expect(200));
    boardPackTimings.push(boardPack.ms);
    if ((boardPack.result.body.homes || []).length !== options.homes) {
      throw new Error(`Expected ${options.homes} board-pack homes.`);
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    target: {
      dbHost: config.db.host,
      dbName: config.db.name,
      nodeEnv: config.nodeEnv,
    },
    seeded: {
      homes: options.homes,
      staffPerHome: options.staffPerHome,
      estimatedStaff: options.homes * options.staffPerHome,
      prefix: options.prefix,
    },
    timings: {
      portfolioKpis: summarizeTimings(kpiTimings),
      dashboardSummary: summarizeTimings(dashboardTimings),
      boardPack: summarizeTimings(boardPackTimings),
    },
  };

  if (!options.keepData) {
    const cleanupClient = await pool.connect();
    try {
      await cleanupClient.query('BEGIN');
      await cleanup(cleanupClient, options.prefix);
      await cleanupClient.query('COMMIT');
    } catch (err) {
      await cleanupClient.query('ROLLBACK').catch(() => {});
      report.cleanupWarning = err.message;
    } finally {
      cleanupClient.release();
    }
  }

  if (options.jsonOut) {
    const outPath = path.resolve(options.jsonOut);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
    report.jsonOut = outPath;
  }

  await pool.end();
  return report;
}

function printReport(report) {
  console.log('V1 OS local scale/load check complete');
  console.log(`Target: ${report.target.dbHost}/${report.target.dbName} (${report.target.nodeEnv})`);
  console.log(`Seeded: ${report.seeded.homes} homes, ${report.seeded.estimatedStaff} staff, prefix ${report.seeded.prefix}`);
  for (const [name, timing] of Object.entries(report.timings)) {
    console.log(`${name}: count=${timing.count} avg=${timing.avgMs}ms p50=${timing.p50Ms}ms p95=${timing.p95Ms}ms max=${timing.maxMs}ms`);
  }
  if (report.cleanupWarning) console.log(`Cleanup warning: ${report.cleanupWarning}`);
  if (report.jsonOut) console.log(`JSON report: ${report.jsonOut}`);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  runHarness(parseArgs())
    .then(printReport)
    .catch((err) => {
      console.error(`V1 OS scale/load check failed: ${err.message}`);
      process.exitCode = 1;
    });
}
