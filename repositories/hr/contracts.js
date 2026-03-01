import { pool, createShaper, paginate } from './shared.js';

const shapeContract = createShaper({
  fields: [
    'id', 'home_id', 'staff_id',
    'statement_issued', 'statement_issued_date', 'contract_type', 'contract_start_date', 'contract_end_date',
    'job_title', 'job_description_ref', 'reporting_to', 'place_of_work',
    'hours_per_week', 'working_pattern', 'hourly_rate', 'pay_frequency', 'annual_leave_days',
    'notice_period_employer', 'notice_period_employee',
    'probation_period_months', 'probation_start_date', 'probation_end_date',
    'probation_reviews', 'probation_outcome', 'probation_extension_date', 'probation_extension_reason',
    'probation_confirmed_date', 'probation_confirmation_letter_sent',
    'variations',
    'termination_type', 'termination_date', 'termination_reason', 'notice_given_date',
    'notice_given_by', 'last_working_day', 'garden_leave', 'pilon',
    'exit_interview_date', 'exit_interview_notes', 'references_agreed',
    'status', 'created_at', 'updated_at', 'version',
  ],
  dates: [
    'statement_issued_date', 'contract_start_date', 'contract_end_date',
    'probation_start_date', 'probation_end_date', 'probation_extension_date', 'probation_confirmed_date',
    'termination_date', 'notice_given_date', 'last_working_day', 'exit_interview_date',
  ],
  floats: ['hours_per_week', 'hourly_rate'],
  jsonArrays: ['probation_reviews', 'variations'],
  aliases: { start_date: 'contract_start_date', end_date: 'contract_end_date' },
});

export async function findContracts(homeId, { staffId, status } = {}, client, pag) {
  const conn = client || pool;
  let sql = 'SELECT * FROM hr_contracts WHERE home_id = $1 AND deleted_at IS NULL';
  const params = [homeId];
  if (staffId) { params.push(staffId); sql += ` AND staff_id = $${params.length}`; }
  if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
  return paginate(conn, sql, params, 'contract_start_date DESC', shapeContract, pag);
}

export async function findContractById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    'SELECT * FROM hr_contracts WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL', [id, homeId]);
  return shapeContract(rows[0]);
}

export async function createContract(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO hr_contracts
       (home_id, staff_id, statement_issued, statement_issued_date, contract_type,
        contract_start_date, contract_end_date, job_title, reporting_to, place_of_work,
        hours_per_week, working_pattern, hourly_rate, pay_frequency, annual_leave_days,
        notice_period_employer, notice_period_employee,
        probation_period_months, probation_start_date, probation_end_date, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,
    [homeId, data.staff_id, data.statement_issued ?? false,
     data.statement_issued_date || null, data.contract_type,
     data.contract_start_date, data.contract_end_date || null,
     data.job_title || null, data.reporting_to || null, data.place_of_work || null,
     data.hours_per_week ?? null, data.working_pattern || null,
     data.hourly_rate ?? null, data.pay_frequency || null, data.annual_leave_days ?? 28,
     data.notice_period_employer || null, data.notice_period_employee || null,
     data.probation_period_months ?? null, data.probation_start_date || null,
     data.probation_end_date || null, data.status ?? 'active', data.created_by || null]
  );
  return shapeContract(rows[0]);
}

export async function updateContract(id, homeId, data, client, version) {
  const conn = client || pool;
  const fields = [];
  const params = [id, homeId];
  const settable = [
    'contract_start_date', 'statement_issued', 'statement_issued_date', 'contract_type', 'contract_end_date',
    'job_title', 'job_description_ref', 'reporting_to', 'place_of_work',
    'hours_per_week', 'working_pattern', 'hourly_rate', 'pay_frequency', 'annual_leave_days',
    'notice_period_employer', 'notice_period_employee',
    'probation_period_months', 'probation_end_date', 'probation_reviews',
    'probation_outcome', 'probation_extension_date', 'probation_extension_reason',
    'probation_confirmed_date', 'probation_confirmation_letter_sent',
    'variations',
    'termination_type', 'termination_date', 'termination_reason', 'notice_given_date',
    'notice_given_by', 'last_working_day', 'garden_leave', 'pilon',
    'exit_interview_date', 'exit_interview_notes', 'references_agreed', 'status', 'notes',
  ];
  const jsonFields = ['probation_reviews', 'variations'];
  for (const key of settable) {
    if (key in data) {
      params.push(jsonFields.includes(key) ? JSON.stringify(data[key]) : data[key] ?? null);
      fields.push(`${key} = $${params.length}`);
    }
  }
  fields.push('version = version + 1');
  if (fields.length === 1) return findContractById(id, homeId, client);
  let where = 'WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL';
  if (version != null) { params.push(version); where += ` AND version = $${params.length}`; }
  const { rows, rowCount } = await conn.query(
    `UPDATE hr_contracts SET ${fields.join(', ')} ${where} RETURNING *`,
    params
  );
  if (rowCount === 0 && version != null) return null;
  return shapeContract(rows[0]);
}
