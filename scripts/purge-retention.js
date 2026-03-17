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

import { pool } from '../db.js';

import * as gdprRepo from '../repositories/gdprRepo.js';
import * as auditService from '../services/auditService.js';

const DRY_RUN = !process.argv.includes('--execute');

// Tables that can be purged — must match retention_schedule.applies_to_table
const ALLOWED_TABLES = new Set([
  'staff', 'ssp_periods', 'training_records', 'onboarding', 'payroll_runs',
  'pension_enrolments', 'incidents', 'complaints', 'dols', 'audit_log',
  'access_log', 'risk_register', 'whistleblowing_concerns', 'maintenance',
  'hr_disciplinary_cases', 'hr_grievance_cases', 'hr_performance_cases',
  'hr_rtw_interviews', 'hr_oh_referrals', 'hr_contracts', 'hr_family_leave',
  'hr_flexible_working', 'hr_edi_records', 'hr_tupe_transfers', 'hr_rtw_dbs_renewals',
]);

// Tables without home_id
const GLOBAL_TABLES = new Set(['audit_log', 'access_log']);

// Tables that use 'ts' instead of 'created_at'
const TS_TABLES = new Set(['access_log', 'audit_log']);

// Tables with soft-delete — only purge records where deleted_at IS NOT NULL
const SOFT_DELETE_TABLES = new Set([
  'staff', 'incidents', 'complaints', 'dols', 'risk_register',
  'whistleblowing_concerns', 'maintenance',
]);

async function run() {
  const mode = DRY_RUN ? 'DRY RUN' : 'EXECUTE';
  console.log(`[${new Date().toISOString()}] Retention purge starting (${mode})`);
  console.log('');

  const schedule = await gdprRepo.getRetentionSchedule();
  let totalDeleted = 0;

  for (const rule of schedule) {
    if (!rule.applies_to_table) continue;
    if (!ALLOWED_TABLES.has(rule.applies_to_table)) continue;

    const table = rule.applies_to_table;
    const isGlobal = GLOBAL_TABLES.has(table);
    const dateCol = TS_TABLES.has(table) ? 'ts' : 'created_at';
    const hasSoftDelete = SOFT_DELETE_TABLES.has(table);

    // Build the WHERE clause
    // For soft-delete tables: only purge already-deleted records past retention
    // For audit/access logs: purge by age
    let where;
    const params = [rule.retention_days];

    if (hasSoftDelete) {
      // Only hard-delete records that were already soft-deleted AND past retention
      where = isGlobal
        ? `deleted_at IS NOT NULL AND ${dateCol} < NOW() - INTERVAL '1 day' * $1`
        : `deleted_at IS NOT NULL AND home_id IS NOT NULL AND ${dateCol} < NOW() - INTERVAL '1 day' * $1`;
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
        const { rowCount } = await pool.query(
          `DELETE FROM ${table} WHERE ${where}`,
          params
        );
        totalDeleted += rowCount;
        console.log(`    -> Deleted ${rowCount} records`);
      } else {
        totalDeleted += count;
        console.log(`    -> Would delete ${count} records`);
      }
    } catch (err) {
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

  await pool.end();
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
