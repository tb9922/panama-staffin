-- UP
-- onboarding: per-staff onboarding status across 9 regulatory sections
-- (dbs_check, right_to_work, references, identity_check, health_declaration,
-- qualifications, contract, day1_induction, policy_acknowledgement).
-- Stored as JSONB per staff member — structure varies per section, always read
-- as a complete record. PK on (home_id, staff_id).

CREATE TABLE IF NOT EXISTS onboarding (
  home_id     INTEGER       NOT NULL REFERENCES homes(id),
  staff_id    VARCHAR(20)   NOT NULL,
  data        JSONB         NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMP     NOT NULL DEFAULT NOW(),
  PRIMARY KEY (home_id, staff_id)
);

-- DOWN
DROP TABLE IF EXISTS onboarding;
