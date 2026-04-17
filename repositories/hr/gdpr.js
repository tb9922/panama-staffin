import path from 'path';
import { unlink } from 'fs/promises';
import { pool } from './shared.js';
import { config } from '../../config.js';

export async function purgeExpiredRecords(homeId, retentionYears = 6, dryRun = true) {
  const caseTables = [
    'hr_disciplinary_cases', 'hr_grievance_cases', 'hr_performance_cases',
    'hr_rtw_interviews', 'hr_oh_referrals', 'hr_contracts',
    'hr_family_leave', 'hr_flexible_working', 'hr_edi_records',
    'hr_tupe_transfers', 'hr_rtw_dbs_renewals',
  ];
  // Map case_type values to their parent tables for child record purging
  const caseTypeMap = {
    disciplinary: 'hr_disciplinary_cases', grievance: 'hr_grievance_cases',
    performance: 'hr_performance_cases', rtw_interview: 'hr_rtw_interviews',
    oh_referral: 'hr_oh_referrals', contract: 'hr_contracts',
    family_leave: 'hr_family_leave', flexible_working: 'hr_flexible_working',
    edi: 'hr_edi_records', tupe: 'hr_tupe_transfers', renewal: 'hr_rtw_dbs_renewals',
  };
  const cutoffExpr = `NOW() - make_interval(years => $2)`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const counts = {};
    const years = parseInt(retentionYears, 10);

    // 1. Purge child records whose parent cases are expired (no deleted_at on child tables)
    const childTables = ['hr_case_notes', 'hr_file_attachments', 'hr_investigation_meetings'];
    for (const child of childTables) {
      let total = 0;
      for (const [caseType, parentTable] of Object.entries(caseTypeMap)) {
        const subquery = `SELECT id FROM ${parentTable} WHERE home_id = $1 AND deleted_at IS NOT NULL AND deleted_at < ${cutoffExpr}`;
        if (dryRun) {
          const result = await client.query(
            `SELECT COUNT(*) FROM ${child} WHERE home_id = $1 AND case_type = $3 AND case_id IN (${subquery})`,
            [homeId, years, caseType]
          );
          total += parseInt(result.rows[0].count, 10);
          continue;
        }

        if (child === 'hr_file_attachments') {
          const { rows: attachments } = await client.query(
            `SELECT case_id, stored_name
             FROM hr_file_attachments
             WHERE home_id = $1 AND case_type = $3 AND case_id IN (${subquery})`,
            [homeId, years, caseType]
          );
          for (const attachment of attachments) {
            const filePath = path.join(
              config.upload.dir,
              String(homeId),
              caseType,
              String(attachment.case_id),
              attachment.stored_name,
            );
            await unlink(filePath).catch((err) => {
              if (err?.code !== 'ENOENT') throw err;
            });
          }
        }

        const result = await client.query(
          `DELETE FROM ${child} WHERE home_id = $1 AND case_type = $3 AND case_id IN (${subquery})`,
          [homeId, years, caseType]
        );
        total += result.rowCount;
      }
      counts[child] = total;
    }

    // 2. Purge grievance actions (FK to hr_grievance_cases, not case_type pattern)
    const grvSub = `SELECT id FROM hr_grievance_cases WHERE home_id = $1 AND deleted_at IS NOT NULL AND deleted_at < ${cutoffExpr}`;
    if (dryRun) {
      const { rows } = await client.query(
        `SELECT COUNT(*) FROM hr_grievance_actions WHERE home_id = $1 AND grievance_id IN (${grvSub})`, [homeId, years]);
      counts.hr_grievance_actions = parseInt(rows[0].count, 10);
    } else {
      const { rowCount } = await client.query(
        `DELETE FROM hr_grievance_actions WHERE home_id = $1 AND grievance_id IN (${grvSub})`, [homeId, years]);
      counts.hr_grievance_actions = rowCount;
    }

    // 3. Purge main case tables (have deleted_at column)
    for (const table of caseTables) {
      if (dryRun) {
        const { rows } = await client.query(
          `SELECT COUNT(*) FROM ${table} WHERE home_id = $1 AND deleted_at IS NOT NULL AND deleted_at < ${cutoffExpr}`,
          [homeId, years]
        );
        counts[table] = parseInt(rows[0].count, 10);
      } else {
        const { rowCount } = await client.query(
          `DELETE FROM ${table} WHERE home_id = $1 AND deleted_at IS NOT NULL AND deleted_at < ${cutoffExpr}`,
          [homeId, years]
        );
        counts[table] = rowCount;
      }
    }

    await client.query('COMMIT');
    return counts;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
