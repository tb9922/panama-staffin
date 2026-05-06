import path from 'path';
import { unlink } from 'fs/promises';
import { pool } from './shared.js';
import { config } from '../../config.js';

const CASE_TABLES = [
  { table: 'hr_disciplinary_cases', caseType: 'disciplinary', staffBound: true, terminalDate: 'COALESCE({alias}.closed_date, {alias}.outcome_date)' },
  { table: 'hr_grievance_cases', caseType: 'grievance', staffBound: true, terminalDate: 'COALESCE({alias}.closed_date, {alias}.outcome_date)' },
  { table: 'hr_performance_cases', caseType: 'performance', staffBound: true, terminalDate: 'COALESCE({alias}.closed_date, {alias}.outcome_date)' },
  { table: 'hr_rtw_interviews', caseType: 'rtw_interview', staffBound: true },
  { table: 'hr_oh_referrals', caseType: 'oh_referral', staffBound: true },
  { table: 'hr_contracts', caseType: 'contract', staffBound: true },
  { table: 'hr_family_leave', caseType: 'family_leave', staffBound: true },
  { table: 'hr_flexible_working', caseType: 'flexible_working', staffBound: true, terminalDate: 'COALESCE({alias}.decision_date, {alias}.updated_at)' },
  { table: 'hr_edi_records', caseType: 'edi', staffBound: true },
  { table: 'hr_tupe_transfers', caseType: 'tupe', staffBound: false, terminalDate: 'COALESCE({alias}.signed_date, {alias}.transfer_date)' },
  { table: 'hr_rtw_dbs_renewals', caseType: 'renewal', staffBound: true },
];

function terminalExpr(configEntry, alias) {
  return configEntry.terminalDate?.replaceAll('{alias}', alias) || null;
}

function expiredCasePredicate(configEntry, alias = 'p') {
  const cutoffExpr = `NOW() - make_interval(years => $2)`;
  const predicates = [
    `(${alias}.deleted_at IS NOT NULL AND ${alias}.deleted_at < ${cutoffExpr})`,
  ];
  const terminal = terminalExpr(configEntry, alias);
  if (terminal) {
    predicates.push(`(${terminal} IS NOT NULL AND ${terminal} < ${cutoffExpr})`);
  }
  if (configEntry.staffBound) {
    predicates.push(`EXISTS (
      SELECT 1 FROM staff s
       WHERE s.home_id = ${alias}.home_id
         AND s.id = ${alias}.staff_id
         AND (
           (s.deleted_at IS NOT NULL AND s.deleted_at < ${cutoffExpr})
           OR (s.leaving_date IS NOT NULL AND s.leaving_date < ${cutoffExpr})
         )
    )`);
  }
  return `(${predicates.join(' OR ')})`;
}

function attachmentPath(homeId, caseType, caseId, storedName) {
  return path.join(config.upload.dir, String(homeId), caseType, String(caseId), storedName);
}

export async function purgeExpiredRecords(homeId, retentionYears = 6, dryRun = true) {
  const cutoffExpr = `NOW() - make_interval(years => $2)`;
  const client = await pool.connect();
  const filesToUnlink = [];
  try {
    await client.query('BEGIN');
    const counts = {};
    const years = parseInt(retentionYears, 10);

    // 1. Purge child rows that were individually soft-deleted past retention.
    const childTables = ['hr_case_notes', 'hr_file_attachments', 'hr_investigation_meetings'];
    for (const child of childTables) {
      if (dryRun) {
        const result = await client.query(
          `SELECT COUNT(*) FROM ${child} WHERE home_id = $1 AND deleted_at IS NOT NULL AND deleted_at < ${cutoffExpr}`,
          [homeId, years]
        );
        counts[`${child}_soft_deleted`] = parseInt(result.rows[0].count, 10);
      } else {
        if (child === 'hr_file_attachments') {
          const { rows: attachments } = await client.query(
            `SELECT case_type, case_id, stored_name
               FROM hr_file_attachments
              WHERE home_id = $1 AND deleted_at IS NOT NULL AND deleted_at < ${cutoffExpr}`,
            [homeId, years]
          );
          for (const attachment of attachments) {
            filesToUnlink.push(attachmentPath(homeId, attachment.case_type, attachment.case_id, attachment.stored_name));
          }
        }
        const result = await client.query(
          `DELETE FROM ${child} WHERE home_id = $1 AND deleted_at IS NOT NULL AND deleted_at < ${cutoffExpr}`,
          [homeId, years]
        );
        counts[`${child}_soft_deleted`] = result.rowCount;
      }
    }

    // 2. Purge child records whose parent cases are expired.
    for (const child of childTables) {
      let total = 0;
      for (const configEntry of CASE_TABLES) {
        const subquery = `SELECT p.id FROM ${configEntry.table} p WHERE p.home_id = $1 AND ${expiredCasePredicate(configEntry, 'p')}`;
        if (dryRun) {
          const result = await client.query(
            `SELECT COUNT(*) FROM ${child} WHERE home_id = $1 AND case_type = $3 AND case_id IN (${subquery})`,
            [homeId, years, configEntry.caseType]
          );
          total += parseInt(result.rows[0].count, 10);
          continue;
        }

        if (child === 'hr_file_attachments') {
          const { rows: attachments } = await client.query(
            `SELECT case_id, stored_name
             FROM hr_file_attachments
             WHERE home_id = $1 AND case_type = $3 AND case_id IN (${subquery})`,
            [homeId, years, configEntry.caseType]
          );
          for (const attachment of attachments) {
            filesToUnlink.push(attachmentPath(homeId, configEntry.caseType, attachment.case_id, attachment.stored_name));
          }
        }

        const result = await client.query(
          `DELETE FROM ${child} WHERE home_id = $1 AND case_type = $3 AND case_id IN (${subquery})`,
          [homeId, years, configEntry.caseType]
        );
        total += result.rowCount;
      }
      counts[child] = total;
    }

    // 3. Purge grievance actions (FK to hr_grievance_cases, not case_type pattern).
    const grievanceConfig = CASE_TABLES.find(entry => entry.caseType === 'grievance');
    const grvSub = `SELECT p.id FROM hr_grievance_cases p WHERE p.home_id = $1 AND ${expiredCasePredicate(grievanceConfig, 'p')}`;
    if (dryRun) {
      const { rows } = await client.query(
        `SELECT COUNT(*) FROM hr_grievance_actions WHERE home_id = $1 AND grievance_id IN (${grvSub})`, [homeId, years]);
      counts.hr_grievance_actions = parseInt(rows[0].count, 10);
    } else {
      const { rowCount } = await client.query(
        `DELETE FROM hr_grievance_actions WHERE home_id = $1 AND grievance_id IN (${grvSub})`, [homeId, years]);
      counts.hr_grievance_actions = rowCount;
    }

    // 4. Purge main case tables.
    for (const configEntry of CASE_TABLES) {
      if (dryRun) {
        const { rows } = await client.query(
          `SELECT COUNT(*) FROM ${configEntry.table} p WHERE p.home_id = $1 AND ${expiredCasePredicate(configEntry, 'p')}`,
          [homeId, years]
        );
        counts[configEntry.table] = parseInt(rows[0].count, 10);
      } else {
        const { rowCount } = await client.query(
          `DELETE FROM ${configEntry.table} p WHERE p.home_id = $1 AND ${expiredCasePredicate(configEntry, 'p')}`,
          [homeId, years]
        );
        counts[configEntry.table] = rowCount;
      }
    }

    await client.query('COMMIT');
    for (const filePath of filesToUnlink) {
      await unlink(filePath).catch((err) => {
        if (err?.code !== 'ENOENT') throw err;
      });
    }
    return counts;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
