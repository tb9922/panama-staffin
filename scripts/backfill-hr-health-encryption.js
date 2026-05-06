#!/usr/bin/env node
import { pool } from '../db.js';
import { encrypt } from '../services/encryptionService.js';

function normalizeJsonArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map((item) => String(item));
  if (value == null || value === '') return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map((item) => String(item));
    } catch {
      return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function hasContent(payload) {
  return Object.values(payload).some((value) => (Array.isArray(value) ? value.length > 0 : Boolean(value)));
}

function encryptedPayload(payload) {
  if (!hasContent(payload)) return { encrypted: null, iv: null, tag: null };
  return encrypt(JSON.stringify(payload));
}

async function backfillRtw(client) {
  const { rows } = await client.query(`
    SELECT id, absence_reason, adjustments_detail, underlying_condition, notes,
           fit_note_type, fit_note_adjustments
      FROM hr_rtw_interviews
     WHERE sensitive_encrypted IS NULL
       AND (
         absence_reason IS NOT NULL
         OR adjustments_detail IS NOT NULL
         OR underlying_condition = true
         OR notes IS NOT NULL
         OR fit_note_type IS NOT NULL
         OR fit_note_adjustments IS NOT NULL
       )
     ORDER BY id
     FOR UPDATE
  `);

  for (const row of rows) {
    const encrypted = encryptedPayload({
      absence_reason: row.absence_reason || null,
      adjustments_detail: row.adjustments_detail || null,
      underlying_condition: row.underlying_condition === true,
      notes: row.notes || null,
      fit_note_type: row.fit_note_type || null,
      fit_note_adjustments: row.fit_note_adjustments || null,
    });
    await client.query(
      `UPDATE hr_rtw_interviews
          SET sensitive_encrypted = $2,
              sensitive_iv = $3,
              sensitive_tag = $4,
              absence_reason = NULL,
              adjustments_detail = NULL,
              underlying_condition = false,
              notes = NULL,
              fit_note_type = NULL,
              fit_note_adjustments = NULL
        WHERE id = $1`,
      [row.id, encrypted.encrypted, encrypted.iv, encrypted.tag]
    );
  }
  return rows.length;
}

async function backfillOh(client) {
  const { rows } = await client.query(`
    SELECT id, reason, questions_for_oh, report_summary, fit_for_role,
           adjustments_recommended, estimated_return_date, disability_likely,
           adjustments_implemented, notes
      FROM hr_oh_referrals
     WHERE sensitive_encrypted IS NULL
       AND (
         reason IS NOT NULL
         OR jsonb_array_length(COALESCE(questions_for_oh, '[]'::jsonb)) > 0
         OR report_summary IS NOT NULL
         OR fit_for_role IS NOT NULL
         OR adjustments_recommended IS NOT NULL
         OR estimated_return_date IS NOT NULL
         OR disability_likely IS NOT NULL
         OR jsonb_array_length(COALESCE(adjustments_implemented, '[]'::jsonb)) > 0
         OR notes IS NOT NULL
       )
     ORDER BY id
     FOR UPDATE
  `);

  for (const row of rows) {
    const encrypted = encryptedPayload({
      reason: row.reason === '[encrypted]' ? null : row.reason || null,
      questions_for_oh: normalizeJsonArray(row.questions_for_oh),
      report_summary: row.report_summary || null,
      fit_for_role: row.fit_for_role || null,
      adjustments_recommended: row.adjustments_recommended || null,
      estimated_return_date: row.estimated_return_date || null,
      disability_likely: row.disability_likely || null,
      adjustments_implemented: normalizeJsonArray(row.adjustments_implemented),
      notes: row.notes || null,
    });
    await client.query(
      `UPDATE hr_oh_referrals
          SET sensitive_encrypted = $2,
              sensitive_iv = $3,
              sensitive_tag = $4,
              reason = '[encrypted]',
              questions_for_oh = '[]'::jsonb,
              report_summary = NULL,
              fit_for_role = NULL,
              adjustments_recommended = NULL,
              estimated_return_date = NULL,
              disability_likely = NULL,
              adjustments_implemented = '[]'::jsonb,
              notes = NULL
        WHERE id = $1`,
      [row.id, encrypted.encrypted, encrypted.iv, encrypted.tag]
    );
  }
  return rows.length;
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rtw = await backfillRtw(client);
    const oh = await backfillOh(client);
    await client.query('COMMIT');
    console.log(`Backfilled encrypted HR health payloads: RTW=${rtw}, OH=${oh}`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`HR health encryption backfill failed: ${err.message}`);
  process.exit(1);
});
