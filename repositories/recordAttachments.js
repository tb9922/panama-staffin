import { pool } from '../db.js';

const PARENT_TABLES = {
  incident: { table: 'incidents', idExpr: 'id', softDelete: true },
  complaint: { table: 'complaints', idExpr: 'id', softDelete: true },
  ipc_audit: { table: 'ipc_audits', idExpr: 'id', softDelete: true },
  maintenance: { table: 'maintenance', idExpr: 'id', softDelete: true },
  bed: { table: 'beds', idExpr: 'id::text' },
  handover_entry: { table: 'handover_entries', idExpr: 'id::text' },
  payroll_run: { table: 'payroll_runs', idExpr: 'id::text' },
  investigation_meeting: { table: 'hr_investigation_meetings', idExpr: 'id::text', softDelete: true },
  supervision: { table: 'supervisions', idExpr: 'id' },
  appraisal: { table: 'appraisals', idExpr: 'id' },
  fire_drill: { table: 'fire_drills', idExpr: 'id' },
  policy_review: { table: 'policy_reviews', idExpr: 'id', softDelete: true },
  risk: { table: 'risk_register', idExpr: 'id', softDelete: true },
  whistleblowing: { table: 'whistleblowing_concerns', idExpr: 'id', softDelete: true },
  dols: { table: 'dols', idExpr: 'id', softDelete: true },
  mca_assessment: { table: 'mca_assessments', idExpr: 'id', softDelete: true },
  dpia: { table: 'dpia_assessments', idExpr: 'id::text', softDelete: true },
  ropa: { table: 'ropa_activities', idExpr: 'id::text', softDelete: true },
  finance_expense: { table: 'finance_expenses', idExpr: 'id::text', softDelete: true },
  finance_resident: { table: 'finance_residents', idExpr: 'id::text', softDelete: true },
  finance_invoice: { table: 'finance_invoices', idExpr: 'id::text', softDelete: true },
  finance_payment_schedule: { table: 'finance_payment_schedule', idExpr: 'id::text', softDelete: true },
  payroll_rate_rule: { table: 'pay_rate_rules', idExpr: 'id::text' },
  payroll_timesheet: { table: 'timesheet_entries', idExpr: 'id::text' },
  payroll_tax_code: { table: 'tax_codes', idExpr: 'id::text', softDelete: true },
  payroll_pension: { table: 'pension_enrolments', idExpr: 'id::text' },
  payroll_sick_period: { table: 'sick_periods', idExpr: 'id::text' },
  agency_provider: { table: 'agency_providers', idExpr: 'id::text' },
  agency_shift: { table: 'agency_shifts', idExpr: 'id::text' },
  care_certificate: { table: 'care_certificates', idExpr: 'staff_id' },
  staff_register: { table: 'staff', idExpr: 'id', softDelete: true },
};

function parseScheduleOverrideId(recordId) {
  const raw = String(recordId || '').trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})(?:::\s*|[:|])(.+)$/);
  if (!match) return null;
  const staffId = match[2].trim();
  return staffId ? { date: match[1], staffId } : null;
}

const COLS = `
  id,
  home_id,
  module,
  record_id,
  original_name,
  stored_name,
  mime_type,
  size_bytes,
  description,
  uploaded_by,
  created_at
`;

function shape(row) {
  return row ? {
    id: row.id,
    home_id: row.home_id,
    module: row.module,
    record_id: row.record_id,
    original_name: row.original_name,
    stored_name: row.stored_name,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    description: row.description,
    uploaded_by: row.uploaded_by,
    created_at: row.created_at,
} : null;
}

export async function parentExists(homeId, moduleId, recordId, client) {
  const conn = client || pool;
  const recordKey = String(recordId || '').trim();
  if (!recordKey) return false;

  if (moduleId === 'budget_month') {
    return /^\d{4}-\d{2}$/.test(recordKey);
  }

  if (moduleId === 'schedule_override') {
    const parsed = parseScheduleOverrideId(recordKey);
    if (!parsed) return false;
    const { rows } = await conn.query(
      `SELECT 1
         FROM shift_overrides
        WHERE home_id = $1
          AND date = $2::date
          AND staff_id = $3
        LIMIT 1`,
      [homeId, parsed.date, parsed.staffId]
    );
    return rows.length > 0;
  }

  const parent = PARENT_TABLES[moduleId];
  if (!parent) return false;
  const { rows } = await conn.query(
    `SELECT 1
       FROM ${parent.table}
      WHERE home_id = $1
        AND ${parent.idExpr} = $2
        ${parent.softDelete ? 'AND deleted_at IS NULL' : ''}
      LIMIT 1`,
    [homeId, recordKey]
  );
  return rows.length > 0;
}

export async function findAttachments(homeId, moduleId, recordId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${COLS}
       FROM record_file_attachments
      WHERE home_id = $1
        AND module = $2
        AND record_id = $3
        AND deleted_at IS NULL
      ORDER BY created_at DESC`,
    [homeId, moduleId, recordId]
  );
  return rows.map(shape);
}

export async function findByHome(homeId, { moduleId, moduleIds, limit = 5000, offset = 0 } = {}, client) {
  const conn = client || pool;
  const params = [homeId];
  let sql = `
    SELECT ${COLS}
      FROM record_file_attachments
     WHERE home_id = $1
       AND deleted_at IS NULL
  `;
  if (moduleId) {
    params.push(moduleId);
    sql += ` AND module = $${params.length}`;
  } else if (moduleIds?.length) {
    params.push(moduleIds);
    sql += ` AND module = ANY($${params.length}::text[])`;
  }
  sql += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
  params.push(Math.min(limit, 10000));
  sql += ' OFFSET $' + (params.length + 1);
  params.push(Math.max(offset, 0));
  const { rows } = await conn.query(sql, params);
  return rows.map(shape);
}

export async function findById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${COLS}
       FROM record_file_attachments
      WHERE id = $1
        AND home_id = $2
        AND deleted_at IS NULL`,
    [id, homeId]
  );
  return shape(rows[0]);
}

export async function create(homeId, moduleId, recordId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO record_file_attachments
       (home_id, module, record_id, original_name, stored_name, mime_type, size_bytes, description, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING ${COLS}`,
    [
      homeId,
      moduleId,
      recordId,
      data.original_name,
      data.stored_name,
      data.mime_type,
      data.size_bytes,
      data.description || null,
      data.uploaded_by,
    ]
  );
  return shape(rows[0]);
}

export async function softDelete(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `UPDATE record_file_attachments
        SET deleted_at = NOW()
      WHERE id = $1
        AND home_id = $2
        AND deleted_at IS NULL
    RETURNING ${COLS}`,
    [id, homeId]
  );
  return shape(rows[0]);
}
