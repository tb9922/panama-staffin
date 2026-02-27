-- UP
-- Add missing FK constraints and ON DELETE CASCADE to all HR tables (041-052).
-- Three categories:
--   1. home_id FK -> homes(id) ON DELETE CASCADE (all 15 HR tables)
--   2. (home_id, staff_id) composite FK -> staff(home_id, id) ON DELETE CASCADE
--   3. Cross-reference FKs (linked_grievance_id, linked_disciplinary_id, etc.) ON DELETE SET NULL
--   4. hr_grievance_actions.grievance_id FK -> hr_grievance_cases(id) ON DELETE CASCADE

-- ============================================================
-- 1. home_id REFERENCES homes(id) ON DELETE CASCADE
-- Pattern: drop existing FK (default name: {table}_home_id_fkey), re-add with CASCADE.
-- ============================================================

-- hr_disciplinary_cases (041)
ALTER TABLE hr_disciplinary_cases
  DROP CONSTRAINT IF EXISTS hr_disciplinary_cases_home_id_fkey,
  ADD CONSTRAINT hr_disciplinary_cases_home_id_fkey
    FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE;

-- hr_grievance_cases (042)
ALTER TABLE hr_grievance_cases
  DROP CONSTRAINT IF EXISTS hr_grievance_cases_home_id_fkey,
  ADD CONSTRAINT hr_grievance_cases_home_id_fkey
    FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE;

-- hr_grievance_actions (042, home_id added in 054)
ALTER TABLE hr_grievance_actions
  DROP CONSTRAINT IF EXISTS hr_grievance_actions_home_id_fkey,
  ADD CONSTRAINT hr_grievance_actions_home_id_fkey
    FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE;

-- hr_performance_cases (043)
ALTER TABLE hr_performance_cases
  DROP CONSTRAINT IF EXISTS hr_performance_cases_home_id_fkey,
  ADD CONSTRAINT hr_performance_cases_home_id_fkey
    FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE;

-- hr_rtw_interviews (044)
ALTER TABLE hr_rtw_interviews
  DROP CONSTRAINT IF EXISTS hr_rtw_interviews_home_id_fkey,
  ADD CONSTRAINT hr_rtw_interviews_home_id_fkey
    FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE;

-- hr_oh_referrals (045)
ALTER TABLE hr_oh_referrals
  DROP CONSTRAINT IF EXISTS hr_oh_referrals_home_id_fkey,
  ADD CONSTRAINT hr_oh_referrals_home_id_fkey
    FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE;

-- hr_contracts (046)
ALTER TABLE hr_contracts
  DROP CONSTRAINT IF EXISTS hr_contracts_home_id_fkey,
  ADD CONSTRAINT hr_contracts_home_id_fkey
    FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE;

-- hr_family_leave (047)
ALTER TABLE hr_family_leave
  DROP CONSTRAINT IF EXISTS hr_family_leave_home_id_fkey,
  ADD CONSTRAINT hr_family_leave_home_id_fkey
    FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE;

-- hr_flexible_working (048)
ALTER TABLE hr_flexible_working
  DROP CONSTRAINT IF EXISTS hr_flexible_working_home_id_fkey,
  ADD CONSTRAINT hr_flexible_working_home_id_fkey
    FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE;

-- hr_edi_records (049)
ALTER TABLE hr_edi_records
  DROP CONSTRAINT IF EXISTS hr_edi_records_home_id_fkey,
  ADD CONSTRAINT hr_edi_records_home_id_fkey
    FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE;

-- hr_tupe_transfers (050)
ALTER TABLE hr_tupe_transfers
  DROP CONSTRAINT IF EXISTS hr_tupe_transfers_home_id_fkey,
  ADD CONSTRAINT hr_tupe_transfers_home_id_fkey
    FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE;

-- hr_rtw_dbs_renewals (051)
ALTER TABLE hr_rtw_dbs_renewals
  DROP CONSTRAINT IF EXISTS hr_rtw_dbs_renewals_home_id_fkey,
  ADD CONSTRAINT hr_rtw_dbs_renewals_home_id_fkey
    FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE;

-- hr_case_notes (052)
ALTER TABLE hr_case_notes
  DROP CONSTRAINT IF EXISTS hr_case_notes_home_id_fkey,
  ADD CONSTRAINT hr_case_notes_home_id_fkey
    FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE;

-- ============================================================
-- 2. Composite FK (home_id, staff_id) -> staff(home_id, id) ON DELETE CASCADE
-- staff PK is (home_id, id). HR tables store staff_id but had no FK.
-- ============================================================

-- hr_disciplinary_cases
ALTER TABLE hr_disciplinary_cases
  DROP CONSTRAINT IF EXISTS hr_disciplinary_cases_staff_fkey,
  ADD CONSTRAINT hr_disciplinary_cases_staff_fkey
    FOREIGN KEY (home_id, staff_id) REFERENCES staff(home_id, id) ON DELETE CASCADE;

-- hr_grievance_cases
ALTER TABLE hr_grievance_cases
  DROP CONSTRAINT IF EXISTS hr_grievance_cases_staff_fkey,
  ADD CONSTRAINT hr_grievance_cases_staff_fkey
    FOREIGN KEY (home_id, staff_id) REFERENCES staff(home_id, id) ON DELETE CASCADE;

-- hr_performance_cases
ALTER TABLE hr_performance_cases
  DROP CONSTRAINT IF EXISTS hr_performance_cases_staff_fkey,
  ADD CONSTRAINT hr_performance_cases_staff_fkey
    FOREIGN KEY (home_id, staff_id) REFERENCES staff(home_id, id) ON DELETE CASCADE;

-- hr_rtw_interviews
ALTER TABLE hr_rtw_interviews
  DROP CONSTRAINT IF EXISTS hr_rtw_interviews_staff_fkey,
  ADD CONSTRAINT hr_rtw_interviews_staff_fkey
    FOREIGN KEY (home_id, staff_id) REFERENCES staff(home_id, id) ON DELETE CASCADE;

-- hr_oh_referrals
ALTER TABLE hr_oh_referrals
  DROP CONSTRAINT IF EXISTS hr_oh_referrals_staff_fkey,
  ADD CONSTRAINT hr_oh_referrals_staff_fkey
    FOREIGN KEY (home_id, staff_id) REFERENCES staff(home_id, id) ON DELETE CASCADE;

-- hr_contracts
ALTER TABLE hr_contracts
  DROP CONSTRAINT IF EXISTS hr_contracts_staff_fkey,
  ADD CONSTRAINT hr_contracts_staff_fkey
    FOREIGN KEY (home_id, staff_id) REFERENCES staff(home_id, id) ON DELETE CASCADE;

-- hr_family_leave
ALTER TABLE hr_family_leave
  DROP CONSTRAINT IF EXISTS hr_family_leave_staff_fkey,
  ADD CONSTRAINT hr_family_leave_staff_fkey
    FOREIGN KEY (home_id, staff_id) REFERENCES staff(home_id, id) ON DELETE CASCADE;

-- hr_flexible_working
ALTER TABLE hr_flexible_working
  DROP CONSTRAINT IF EXISTS hr_flexible_working_staff_fkey,
  ADD CONSTRAINT hr_flexible_working_staff_fkey
    FOREIGN KEY (home_id, staff_id) REFERENCES staff(home_id, id) ON DELETE CASCADE;

-- hr_edi_records (staff_id is NULLABLE — FK still valid, only enforced when non-null)
ALTER TABLE hr_edi_records
  DROP CONSTRAINT IF EXISTS hr_edi_records_staff_fkey,
  ADD CONSTRAINT hr_edi_records_staff_fkey
    FOREIGN KEY (home_id, staff_id) REFERENCES staff(home_id, id) ON DELETE CASCADE;

-- hr_rtw_dbs_renewals
ALTER TABLE hr_rtw_dbs_renewals
  DROP CONSTRAINT IF EXISTS hr_rtw_dbs_renewals_staff_fkey,
  ADD CONSTRAINT hr_rtw_dbs_renewals_staff_fkey
    FOREIGN KEY (home_id, staff_id) REFERENCES staff(home_id, id) ON DELETE CASCADE;

-- ============================================================
-- 3. Cross-reference FKs on linked_*_id columns — ON DELETE SET NULL
-- These are optional cross-references between HR case types.
-- ============================================================

-- hr_disciplinary_cases.linked_grievance_id -> hr_grievance_cases(id)
ALTER TABLE hr_disciplinary_cases
  DROP CONSTRAINT IF EXISTS hr_disciplinary_cases_linked_grievance_fkey,
  ADD CONSTRAINT hr_disciplinary_cases_linked_grievance_fkey
    FOREIGN KEY (linked_grievance_id) REFERENCES hr_grievance_cases(id) ON DELETE SET NULL;

-- hr_grievance_cases.linked_disciplinary_id -> hr_disciplinary_cases(id)
ALTER TABLE hr_grievance_cases
  DROP CONSTRAINT IF EXISTS hr_grievance_cases_linked_disciplinary_fkey,
  ADD CONSTRAINT hr_grievance_cases_linked_disciplinary_fkey
    FOREIGN KEY (linked_disciplinary_id) REFERENCES hr_disciplinary_cases(id) ON DELETE SET NULL;

-- hr_family_leave.flexible_working_request_linked -> hr_flexible_working(id)
ALTER TABLE hr_family_leave
  DROP CONSTRAINT IF EXISTS hr_family_leave_flex_working_fkey,
  ADD CONSTRAINT hr_family_leave_flex_working_fkey
    FOREIGN KEY (flexible_working_request_linked) REFERENCES hr_flexible_working(id) ON DELETE SET NULL;

-- hr_flexible_working.contract_variation_id -> hr_contracts(id)
ALTER TABLE hr_flexible_working
  DROP CONSTRAINT IF EXISTS hr_flexible_working_contract_fkey,
  ADD CONSTRAINT hr_flexible_working_contract_fkey
    FOREIGN KEY (contract_variation_id) REFERENCES hr_contracts(id) ON DELETE SET NULL;

-- hr_edi_records.oh_referral_id -> hr_oh_referrals(id)
ALTER TABLE hr_edi_records
  DROP CONSTRAINT IF EXISTS hr_edi_records_oh_referral_fkey,
  ADD CONSTRAINT hr_edi_records_oh_referral_fkey
    FOREIGN KEY (oh_referral_id) REFERENCES hr_oh_referrals(id) ON DELETE SET NULL;

-- ============================================================
-- 4. hr_grievance_actions.grievance_id -> hr_grievance_cases(id) ON DELETE CASCADE
-- Original 042 FK had no CASCADE — orphan actions on grievance delete.
-- ============================================================

ALTER TABLE hr_grievance_actions
  DROP CONSTRAINT IF EXISTS hr_grievance_actions_grievance_id_fkey,
  ADD CONSTRAINT hr_grievance_actions_grievance_id_fkey
    FOREIGN KEY (grievance_id) REFERENCES hr_grievance_cases(id) ON DELETE CASCADE;

-- DOWN
-- Reverse all CASCADE/SET NULL back to default (NO ACTION).
-- Section 1: home_id FKs — revert to plain REFERENCES (no CASCADE)

ALTER TABLE hr_disciplinary_cases
  DROP CONSTRAINT IF EXISTS hr_disciplinary_cases_home_id_fkey,
  ADD CONSTRAINT hr_disciplinary_cases_home_id_fkey
    FOREIGN KEY (home_id) REFERENCES homes(id);

ALTER TABLE hr_grievance_cases
  DROP CONSTRAINT IF EXISTS hr_grievance_cases_home_id_fkey,
  ADD CONSTRAINT hr_grievance_cases_home_id_fkey
    FOREIGN KEY (home_id) REFERENCES homes(id);

ALTER TABLE hr_grievance_actions
  DROP CONSTRAINT IF EXISTS hr_grievance_actions_home_id_fkey,
  ADD CONSTRAINT hr_grievance_actions_home_id_fkey
    FOREIGN KEY (home_id) REFERENCES homes(id);

ALTER TABLE hr_performance_cases
  DROP CONSTRAINT IF EXISTS hr_performance_cases_home_id_fkey,
  ADD CONSTRAINT hr_performance_cases_home_id_fkey
    FOREIGN KEY (home_id) REFERENCES homes(id);

ALTER TABLE hr_rtw_interviews
  DROP CONSTRAINT IF EXISTS hr_rtw_interviews_home_id_fkey,
  ADD CONSTRAINT hr_rtw_interviews_home_id_fkey
    FOREIGN KEY (home_id) REFERENCES homes(id);

ALTER TABLE hr_oh_referrals
  DROP CONSTRAINT IF EXISTS hr_oh_referrals_home_id_fkey,
  ADD CONSTRAINT hr_oh_referrals_home_id_fkey
    FOREIGN KEY (home_id) REFERENCES homes(id);

ALTER TABLE hr_contracts
  DROP CONSTRAINT IF EXISTS hr_contracts_home_id_fkey,
  ADD CONSTRAINT hr_contracts_home_id_fkey
    FOREIGN KEY (home_id) REFERENCES homes(id);

ALTER TABLE hr_family_leave
  DROP CONSTRAINT IF EXISTS hr_family_leave_home_id_fkey,
  ADD CONSTRAINT hr_family_leave_home_id_fkey
    FOREIGN KEY (home_id) REFERENCES homes(id);

ALTER TABLE hr_flexible_working
  DROP CONSTRAINT IF EXISTS hr_flexible_working_home_id_fkey,
  ADD CONSTRAINT hr_flexible_working_home_id_fkey
    FOREIGN KEY (home_id) REFERENCES homes(id);

ALTER TABLE hr_edi_records
  DROP CONSTRAINT IF EXISTS hr_edi_records_home_id_fkey,
  ADD CONSTRAINT hr_edi_records_home_id_fkey
    FOREIGN KEY (home_id) REFERENCES homes(id);

ALTER TABLE hr_tupe_transfers
  DROP CONSTRAINT IF EXISTS hr_tupe_transfers_home_id_fkey,
  ADD CONSTRAINT hr_tupe_transfers_home_id_fkey
    FOREIGN KEY (home_id) REFERENCES homes(id);

ALTER TABLE hr_rtw_dbs_renewals
  DROP CONSTRAINT IF EXISTS hr_rtw_dbs_renewals_home_id_fkey,
  ADD CONSTRAINT hr_rtw_dbs_renewals_home_id_fkey
    FOREIGN KEY (home_id) REFERENCES homes(id);

ALTER TABLE hr_case_notes
  DROP CONSTRAINT IF EXISTS hr_case_notes_home_id_fkey,
  ADD CONSTRAINT hr_case_notes_home_id_fkey
    FOREIGN KEY (home_id) REFERENCES homes(id);

-- Section 2: Drop composite staff FKs (none existed before this migration)

ALTER TABLE hr_disciplinary_cases DROP CONSTRAINT IF EXISTS hr_disciplinary_cases_staff_fkey;
ALTER TABLE hr_grievance_cases DROP CONSTRAINT IF EXISTS hr_grievance_cases_staff_fkey;
ALTER TABLE hr_performance_cases DROP CONSTRAINT IF EXISTS hr_performance_cases_staff_fkey;
ALTER TABLE hr_rtw_interviews DROP CONSTRAINT IF EXISTS hr_rtw_interviews_staff_fkey;
ALTER TABLE hr_oh_referrals DROP CONSTRAINT IF EXISTS hr_oh_referrals_staff_fkey;
ALTER TABLE hr_contracts DROP CONSTRAINT IF EXISTS hr_contracts_staff_fkey;
ALTER TABLE hr_family_leave DROP CONSTRAINT IF EXISTS hr_family_leave_staff_fkey;
ALTER TABLE hr_flexible_working DROP CONSTRAINT IF EXISTS hr_flexible_working_staff_fkey;
ALTER TABLE hr_edi_records DROP CONSTRAINT IF EXISTS hr_edi_records_staff_fkey;
ALTER TABLE hr_rtw_dbs_renewals DROP CONSTRAINT IF EXISTS hr_rtw_dbs_renewals_staff_fkey;

-- Section 3: Drop cross-reference FKs (none existed before this migration)

ALTER TABLE hr_disciplinary_cases DROP CONSTRAINT IF EXISTS hr_disciplinary_cases_linked_grievance_fkey;
ALTER TABLE hr_grievance_cases DROP CONSTRAINT IF EXISTS hr_grievance_cases_linked_disciplinary_fkey;
ALTER TABLE hr_family_leave DROP CONSTRAINT IF EXISTS hr_family_leave_flex_working_fkey;
ALTER TABLE hr_flexible_working DROP CONSTRAINT IF EXISTS hr_flexible_working_contract_fkey;
ALTER TABLE hr_edi_records DROP CONSTRAINT IF EXISTS hr_edi_records_oh_referral_fkey;

-- Section 4: Revert grievance_actions FK to plain REFERENCES (no CASCADE)

ALTER TABLE hr_grievance_actions
  DROP CONSTRAINT IF EXISTS hr_grievance_actions_grievance_id_fkey,
  ADD CONSTRAINT hr_grievance_actions_grievance_id_fkey
    FOREIGN KEY (grievance_id) REFERENCES hr_grievance_cases(id);
