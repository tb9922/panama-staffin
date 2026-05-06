#!/usr/bin/env node
import { pool } from '../db.js';
import { encrypt } from '../services/encryptionService.js';

function normalizeJsonArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(item => String(item));
  if (value == null || value === '') return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map(item => String(item));
    } catch {
      // Fall through to newline handling.
    }
    return value.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
  }
  return [];
}

function payloadFrom(row) {
  return {
    harassment_category: row.harassment_category || null,
    respondent_name: row.respondent_name || null,
    reasonable_steps_evidence: normalizeJsonArray(row.reasonable_steps_evidence),
    condition_description: row.condition_description || null,
    adjustments: normalizeJsonArray(row.adjustments),
    access_to_work_reference: row.access_to_work_reference || null,
    description: row.description || null,
    outcome: row.outcome || null,
    notes: row.notes || null,
  };
}

function hasContent(payload) {
  return Object.values(payload).some(value => (Array.isArray(value) ? value.length > 0 : Boolean(value)));
}

async function main() {
  const client = await pool.connect();
  let updated = 0;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`
      SELECT id, harassment_category, respondent_name, reasonable_steps_evidence,
             condition_description, adjustments, access_to_work_reference,
             description, outcome, notes
       FROM hr_edi_records
       WHERE sensitive_encrypted IS NULL
         AND (
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
       ORDER BY id
       FOR UPDATE
    `);

    for (const row of rows) {
      const payload = payloadFrom(row);
      if (!hasContent(payload)) continue;
      const encrypted = encrypt(JSON.stringify(payload));
      await client.query(
        `UPDATE hr_edi_records
            SET sensitive_encrypted = $2,
                sensitive_iv = $3,
                sensitive_tag = $4,
                harassment_category = NULL,
                respondent_name = NULL,
                reasonable_steps_evidence = '[]'::jsonb,
                condition_description = NULL,
                adjustments = '[]'::jsonb,
                access_to_work_reference = NULL,
                description = NULL,
                outcome = NULL,
                notes = NULL
          WHERE id = $1`,
        [row.id, encrypted.encrypted, encrypted.iv, encrypted.tag]
      );
      updated += 1;
    }

    await client.query('COMMIT');
    console.log(`Backfilled encrypted EDI payloads: ${updated}`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`HR EDI encryption backfill failed: ${err.message}`);
  process.exit(1);
});
