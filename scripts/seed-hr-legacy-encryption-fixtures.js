#!/usr/bin/env node
import { pool } from '../db.js';

const HOME_SLUG = 'hr-legacy-encryption-fixture';
const STAFF_ID = 'HLEG001';

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      DELETE FROM hr_oh_referrals
       WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)
    `, [HOME_SLUG]);
    await client.query(`
      DELETE FROM hr_rtw_interviews
       WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)
    `, [HOME_SLUG]);
    await client.query(`
      DELETE FROM hr_edi_records
       WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)
    `, [HOME_SLUG]);
    await client.query(`
      DELETE FROM staff
       WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)
         AND id = $2
    `, [HOME_SLUG, STAFF_ID]);
    await client.query('DELETE FROM homes WHERE slug = $1', [HOME_SLUG]);

    const { rows: [home] } = await client.query(`
      INSERT INTO homes (slug, name, config)
      VALUES ($1, 'HR Legacy Encryption Fixture', '{}'::jsonb)
      RETURNING id
    `, [HOME_SLUG]);

    await client.query(`
      INSERT INTO staff (
        id, home_id, name, role, team, pref, skill, hourly_rate, active,
        wtr_opt_out, start_date
      )
      VALUES ($1, $2, 'Legacy HR Fixture', 'Carer', 'Day A', 'E', 1, 13.50, true, false, '2026-01-01')
    `, [STAFF_ID, home.id]);

    await client.query(`
      INSERT INTO hr_edi_records (
        home_id, record_type, staff_id,
        harassment_category, respondent_name, reasonable_steps_evidence,
        condition_description, adjustments, access_to_work_reference,
        description, outcome, notes, status, deleted_at
      )
      VALUES
        ($1, 'reasonable_adjustment', $2,
         NULL, NULL, '[]'::jsonb,
         'Legacy condition narrative', '["adapted workstation"]'::jsonb, 'ATW-LEGACY-1',
         'Legacy EDI description', 'Legacy EDI outcome', 'Legacy EDI notes', 'open', NULL),
        ($1, 'harassment_complaint', $2,
         'disability', 'Named respondent', '["manager briefing"]'::jsonb,
         NULL, '[]'::jsonb, NULL,
         'Soft-deleted EDI description', 'Soft-deleted EDI outcome', 'Soft-deleted EDI notes', 'closed', NOW())
    `, [home.id, STAFF_ID]);

    await client.query(`
      INSERT INTO hr_rtw_interviews (
        home_id, staff_id, absence_start_date, absence_end_date, absence_days,
        absence_reason, rtw_date, rtw_conducted_by, fit_to_return,
        adjustments_needed, adjustments_detail, underlying_condition,
        fit_note_received, fit_note_date, fit_note_type, fit_note_adjustments,
        notes, deleted_at
      )
      VALUES
        ($1, $2, '2026-03-01', '2026-03-03', 3,
         'Legacy surgery reason', '2026-03-04', 'Fixture Manager', true,
         true, 'Legacy phased return', true,
         true, '2026-03-01', 'may_be_fit', 'Legacy fit note detail',
         'Legacy RTW notes', NULL),
        ($1, $2, '2026-02-01', '2026-02-02', 2,
         'Soft-deleted illness reason', '2026-02-03', 'Fixture Manager', true,
         true, 'Soft-deleted RTW adjustment', true,
         true, '2026-02-01', 'not_fit', 'Soft-deleted fit note detail',
         'Soft-deleted RTW notes', NOW())
    `, [home.id, STAFF_ID]);

    await client.query(`
      INSERT INTO hr_oh_referrals (
        home_id, staff_id, referral_date, referred_by, reason, questions_for_oh,
        employee_consent_obtained, report_summary, fit_for_role,
        adjustments_recommended, estimated_return_date, disability_likely,
        adjustments_implemented, notes, status, deleted_at
      )
      VALUES
        ($1, $2, '2026-03-05', 'Fixture Manager', 'Legacy OH referral reason',
         '["Can they work safely?"]'::jsonb, true, 'Legacy OH report summary',
         'yes_with_adjustments', 'Legacy OH adjustment', '2026-04-01', 'possible',
         '["chair supplied"]'::jsonb, 'Legacy OH notes', 'completed', NULL),
        ($1, $2, '2026-02-05', 'Fixture Manager', 'Soft-deleted OH referral reason',
         '["Historic OH question"]'::jsonb, true, 'Soft-deleted OH report summary',
         'no_currently', 'Soft-deleted OH adjustment', '2026-03-01', 'yes',
         '["historic adjustment"]'::jsonb, 'Soft-deleted OH notes', 'completed', NOW())
    `, [home.id, STAFF_ID]);

    await client.query('COMMIT');
    console.log('Seeded HR legacy encryption fixtures: EDI=2, RTW=2, OH=2');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`Failed to seed HR legacy encryption fixtures: ${err.message}`);
  process.exit(1);
});
