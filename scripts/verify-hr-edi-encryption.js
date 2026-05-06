#!/usr/bin/env node
import { pool } from '../db.js';

async function main() {
  const { rows: [row] } = await pool.query(`
    SELECT COUNT(*)::int AS legacy_plaintext_count
      FROM hr_edi_records
     WHERE (
         harassment_category IS NOT NULL
         OR respondent_name IS NOT NULL
         OR condition_description IS NOT NULL
         OR access_to_work_reference IS NOT NULL
         OR description IS NOT NULL
         OR outcome IS NOT NULL
         OR notes IS NOT NULL
         OR jsonb_array_length(COALESCE(reasonable_steps_evidence, '[]'::jsonb)) > 0
         OR jsonb_array_length(COALESCE(adjustments, '[]'::jsonb)) > 0
       )
  `);

  if (row.legacy_plaintext_count > 0) {
    console.error(
      `HR EDI encryption verification failed: ${row.legacy_plaintext_count} retained records still contain plaintext sensitive fields. ` +
      'Run npm run backfill:hr-edi-encryption, then re-run this verifier.'
    );
    process.exit(1);
  }

  console.log('HR EDI encryption verification passed: no retained plaintext sensitive fields remain.');
}

main()
  .catch((err) => {
    console.error(`HR EDI encryption verification failed: ${err.message}`);
    process.exit(1);
  })
  .finally(() => pool.end());
