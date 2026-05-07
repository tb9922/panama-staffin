#!/usr/bin/env node

/**
 * Automated retention purge — deletes records past their retention period.
 *
 * Reads the retention_schedule table, finds soft-deleted records past retention,
 * and hard-deletes them. Also purges audit_log and access_log per schedule.
 *
 * Usage:
 *   node scripts/purge-retention.js              # dry run (default)
 *   node scripts/purge-retention.js --execute    # actually delete
 *
 * Cron (weekly, Sunday 3am):
 *   0 3 * * 0 cd /var/www/panama-staffing && node scripts/purge-retention.js --execute >> /var/log/panama-purge.log 2>&1
 *
 * Safety:
 *   - Dry run by default — shows what would be deleted without deleting
 *   - Only purges soft-deleted records (deleted_at IS NOT NULL) for most tables
 *   - audit_log and access_log are hard-deleted by age (no soft-delete column)
 *   - All deletes are logged to audit_log before execution
 *   - Allowed table list prevents SQL injection
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../db.js';

import * as gdprRepo from '../repositories/gdprRepo.js';
import * as auditRepo from '../repositories/auditRepo.js';
import * as auditService from '../services/auditService.js';
import { config } from '../config.js';
import { isPathInsideRoot } from '../lib/pathSafety.js';

const DRY_RUN = !process.argv.includes('--execute');

// Tables that can be purged — must match retention_schedule.applies_to_table
const ALLOWED_TABLES = new Set([
  'staff', 'ssp_periods', 'training_records', 'onboarding', 'payroll_runs',
  'pension_enrolments', 'incidents', 'complaints', 'dols', 'audit_log',
  'access_log', 'risk_register', 'whistleblowing_concerns', 'maintenance',
  'action_items', 'reflective_practice', 'agency_approval_attempts',
  'audit_tasks', 'outcome_metrics',
  'sick_periods', 'complaint_surveys', 'mca_assessments', 'cqc_evidence',
  'cqc_evidence_links', 'cqc_evidence_files', 'cqc_partner_feedback',
  'cqc_observations', 'cqc_statement_narratives', 'training_file_attachments',
  'record_file_attachments', 'ropa_activities', 'dpia_assessments',
  'data_requests', 'data_breaches', 'dp_complaints', 'gdpr_processors',
  'consent_records',
  'hr_disciplinary_cases', 'hr_grievance_cases', 'hr_performance_cases',
  'hr_rtw_interviews', 'hr_oh_referrals', 'hr_contracts', 'hr_family_leave',
  'hr_flexible_working', 'hr_edi_records', 'hr_tupe_transfers', 'hr_rtw_dbs_renewals',
  'access_reviews', 'access_review_assignments', 'access_review_decisions',
]);

// Tables without home_id
const GLOBAL_TABLES = new Set(['audit_log', 'access_log', 'access_reviews', 'access_review_decisions']);

const HR_RETENTION_TABLES = new Set([
  'hr_disciplinary_cases', 'hr_grievance_cases', 'hr_performance_cases',
  'hr_rtw_interviews', 'hr_oh_referrals', 'hr_contracts', 'hr_family_leave',
  'hr_flexible_working', 'hr_edi_records', 'hr_tupe_transfers', 'hr_rtw_dbs_renewals',
]);

const STAFF_BOUND_RETENTION_TABLES = new Set(['staff']);

// Date column overrides for tables that don't use 'created_at'
const RETENTION_DATE_COLUMNS = Object.freeze({
  access_log: 'ts',
  audit_log: 'ts',
  onboarding: 'updated_at',
  pension_enrolments: 'updated_at',
  outcome_metrics: 'recorded_at',
  sick_periods: 'created_at',
  data_requests: 'date_received',
  data_breaches: 'discovered_date',
  dp_complaints: 'date_received',
  consent_records: 'COALESCE(withdrawn, created_at)',
  access_review_decisions: 'decided_at',
});

// Tables with soft-delete — only purge records where deleted_at IS NOT NULL
const SOFT_DELETE_TABLES = new Set([
  'staff', 'incidents', 'complaints', 'dols', 'risk_register',
  'whistleblowing_concerns', 'maintenance', 'action_items', 'reflective_practice',
  'agency_approval_attempts', 'audit_tasks', 'outcome_metrics',
  'complaint_surveys', 'mca_assessments', 'cqc_evidence',
  'cqc_evidence_links', 'cqc_evidence_files', 'cqc_partner_feedback',
  'cqc_observations', 'cqc_statement_narratives', 'training_file_attachments',
  'record_file_attachments', 'ropa_activities', 'dpia_assessments',
  'data_requests', 'data_breaches', 'dp_complaints', 'gdpr_processors',
  'consent_records',
]);

const FILE_PURGE_INSERTS = Object.freeze({
  cqc_evidence_files: (where, uploadRootParam) => `
    INSERT INTO retention_purge_files (home_id, source_module, source_table, source_id, file_path)
    SELECT home_id,
           'cqc_evidence',
           'cqc_evidence_files',
           id::text,
           CONCAT($${uploadRootParam}, '/', home_id, '/cqc_evidence/', evidence_id, '/', stored_name)
      FROM cqc_evidence_files
     WHERE ${where}
     RETURNING id
  `,
  training_file_attachments: (where, uploadRootParam) => `
    INSERT INTO retention_purge_files (home_id, source_module, source_table, source_id, file_path)
    SELECT home_id,
           'training',
           'training_file_attachments',
           id::text,
           CONCAT($${uploadRootParam}, '/', home_id, '/training/', staff_id, '/', training_type, '/', stored_name)
      FROM training_file_attachments
     WHERE ${where}
     RETURNING id
  `,
  record_file_attachments: (where, uploadRootParam) => `
    INSERT INTO retention_purge_files (home_id, source_module, source_table, source_id, file_path)
    SELECT home_id,
           module,
           'record_file_attachments',
           id::text,
           CONCAT($${uploadRootParam}, '/', home_id, '/', module, '/', record_id, '/', stored_name)
      FROM record_file_attachments
     WHERE ${where}
     RETURNING id
  `,
});

async function queueRetentionFilePurges(table, where, params) {
  const buildInsert = FILE_PURGE_INSERTS[table];
  if (!buildInsert) return [];
  const uploadRoot = String(config.upload.dir || 'uploads').replace(/\\/g, '/').replace(/\/$/, '');
  const uploadRootParam = params.length + 1;
  const { rows } = await pool.query(buildInsert(where, uploadRootParam), [...params, uploadRoot]);
  return rows.map((row) => row.id);
}

async function processQueuedRetentionFilePurges(ids) {
  if (!ids.length) return { deleted: 0, failed: 0 };
  const { rows } = await pool.query(
    `SELECT id, file_path
       FROM retention_purge_files
      WHERE id = ANY($1::bigint[])
        AND status IN ('pending', 'failed')
      ORDER BY id`,
    [ids],
  );
  const uploadRoot = path.resolve(config.upload.dir);
  let deleted = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const resolved = path.resolve(row.file_path);
      if (!isPathInsideRoot(uploadRoot, resolved)) {
        throw new Error('Queued file path is outside upload root');
      }
      try {
        await fs.unlink(resolved);
      } catch (err) {
        if (err?.code !== 'ENOENT') throw err;
      }
      await pool.query(
        `UPDATE retention_purge_files
            SET status = 'deleted', error = NULL, processed_at = NOW()
          WHERE id = $1`,
        [row.id],
      );
      deleted += 1;
    } catch (err) {
      await pool.query(
        `UPDATE retention_purge_files
            SET status = 'failed', error = $2, processed_at = NOW()
          WHERE id = $1`,
        [row.id, err?.message || 'Unable to delete file'],
      );
      failed += 1;
    }
  }
  if (failed > 0) {
    throw new Error(`${failed} queued file purge(s) failed`);
  }
  return { deleted, failed };
}

async function run() {
  const mode = DRY_RUN ? 'DRY RUN' : 'EXECUTE';
  console.log(`[${new Date().toISOString()}] Retention purge starting (${mode})`);
  console.log('');

  const schedule = await gdprRepo.getRetentionSchedule();
  let totalDeleted = 0;
  let errorCount = 0;

  for (const rule of schedule) {
    if (!rule.applies_to_table) continue;
    if (!ALLOWED_TABLES.has(rule.applies_to_table)) continue;

    const table = rule.applies_to_table;
    if (table === 'access_review_assignments' || table === 'access_review_decisions') {
      console.log(`  ${table}: skipped; retained and purged with access_reviews to preserve review decision history`);
      continue;
    }
    if (STAFF_BOUND_RETENTION_TABLES.has(table)) {
      console.log(`  ${table}: skipped by generic purge; use staff/GDPR erasure flow after retained HR evidence has been purged`);
      continue;
    }
    if (HR_RETENTION_TABLES.has(table)) {
      console.log(`  ${table}: skipped by generic purge; use /api/hr/admin/purge-expired or hrRepo.purgeExpiredRecords`);
      continue;
    }
    const isGlobal = GLOBAL_TABLES.has(table);
    const dateCol = RETENTION_DATE_COLUMNS[table] || 'created_at';
    const hasSoftDelete = SOFT_DELETE_TABLES.has(table);

    // Build the WHERE clause
    // For soft-delete tables: only purge already-deleted records past retention
    // For audit/access logs: purge by age
    let where;
    const params = [rule.retention_days];

    if (hasSoftDelete) {
      // Only hard-delete records that were already soft-deleted AND past retention
      where = isGlobal
        ? `deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '1 day' * $1`
        : `deleted_at IS NOT NULL AND home_id IS NOT NULL AND deleted_at < NOW() - INTERVAL '1 day' * $1`;
    } else if (table === 'access_reviews') {
      where = `created_at < NOW() - INTERVAL '1 day' * $1
        AND NOT EXISTS (
          SELECT 1 FROM access_review_decisions d
           WHERE d.review_id = access_reviews.id
             AND d.decided_at >= NOW() - INTERVAL '1 day' * $1
        )`;
    } else {
      // For audit/access logs — delete by age
      where = `${dateCol} < NOW() - INTERVAL '1 day' * $1`;
    }

    try {
      // Count what would be deleted
      const { rows } = await pool.query(
        `SELECT COUNT(*) AS cnt FROM ${table} WHERE ${where}`,
        params
      );
      const count = parseInt(rows[0].cnt, 10);

      if (count === 0) continue;

      console.log(`  ${table}: ${count} records past ${rule.retention_period} retention`);

      if (!DRY_RUN) {
        const queuedFileIds = await queueRetentionFilePurges(table, where, params);
        if (queuedFileIds.length > 0) {
          console.log(`    -> Queued ${queuedFileIds.length} file purge outbox rows`);
          const fileResult = await processQueuedRetentionFilePurges(queuedFileIds);
          console.log(`    -> Deleted ${fileResult.deleted} queued files`);
        }
        const rowCount = table === 'audit_log'
          ? await auditRepo.purgeOlderThan(rule.retention_days, null)
          : (await pool.query(
              `DELETE FROM ${table} WHERE ${where}`,
              params
            )).rowCount;
        totalDeleted += rowCount;
        console.log(`    -> Deleted ${rowCount} records`);
      } else {
        totalDeleted += count;
        console.log(`    -> Would delete ${count} records`);
      }
    } catch (err) {
      errorCount += 1;
      console.error(`  ${table}: ERROR — ${err.message}`);
    }
  }

  // Log the purge action to audit trail (unless it's a dry run)
  if (!DRY_RUN && totalDeleted > 0) {
    await auditService.log(
      'retention_purge',
      null,
      'system',
      `Automated retention purge: ${totalDeleted} records deleted`
    );
  }

  console.log('');
  console.log(`[${new Date().toISOString()}] ${mode} complete: ${totalDeleted} records ${DRY_RUN ? 'would be' : ''} deleted`);
  if (errorCount > 0) {
    console.error(`[${new Date().toISOString()}] ${mode} failed for ${errorCount} retention table(s)`);
    process.exitCode = 1;
  }

  await pool.end();
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
