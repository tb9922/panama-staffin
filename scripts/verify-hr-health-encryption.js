#!/usr/bin/env node
import { pool } from '../db.js';

async function main() {
  const { rows: [rtw] } = await pool.query(`
    SELECT COUNT(*)::int AS legacy_plaintext_count
      FROM hr_rtw_interviews
     WHERE (
         absence_reason IS NOT NULL
         OR adjustments_detail IS NOT NULL
         OR underlying_condition = true
         OR notes IS NOT NULL
         OR fit_note_type IS NOT NULL
         OR fit_note_adjustments IS NOT NULL
       )
  `);
  const { rows: [oh] } = await pool.query(`
    SELECT COUNT(*)::int AS legacy_plaintext_count
      FROM hr_oh_referrals
     WHERE (
         (reason IS NOT NULL AND reason <> '[encrypted]')
         OR jsonb_array_length(COALESCE(questions_for_oh, '[]'::jsonb)) > 0
         OR report_summary IS NOT NULL
         OR fit_for_role IS NOT NULL
         OR adjustments_recommended IS NOT NULL
         OR estimated_return_date IS NOT NULL
         OR disability_likely IS NOT NULL
         OR jsonb_array_length(COALESCE(adjustments_implemented, '[]'::jsonb)) > 0
         OR notes IS NOT NULL
       )
  `);

  const total = rtw.legacy_plaintext_count + oh.legacy_plaintext_count;
  if (total > 0) {
    console.error(
      `HR health encryption verification failed: RTW=${rtw.legacy_plaintext_count}, OH=${oh.legacy_plaintext_count} records still contain plaintext health fields. ` +
      'Run npm run backfill:hr-health-encryption, then re-run this verifier.'
    );
    process.exit(1);
  }

  console.log('HR health encryption verification passed: no retained plaintext RTW/OH health fields remain.');
}

main()
  .catch((err) => {
    console.error(`HR health encryption verification failed: ${err.message}`);
    process.exit(1);
  })
  .finally(() => pool.end());
