-- UP
-- HR occupational health referrals — tracks OH assessment process.
-- questions_for_oh and adjustments_implemented stored as JSONB.
-- Employee consent must be obtained before sharing medical info with OH provider.

CREATE TABLE IF NOT EXISTS hr_oh_referrals (
  id                          SERIAL PRIMARY KEY,
  home_id                     INTEGER        NOT NULL REFERENCES homes(id),
  staff_id                    VARCHAR(20)    NOT NULL,

  -- Referral
  referral_date               DATE           NOT NULL,
  referred_by                 VARCHAR(200)   NOT NULL,
  reason                      TEXT           NOT NULL,
  questions_for_oh            JSONB          NOT NULL DEFAULT '[]',

  -- Consent
  employee_consent_obtained   BOOLEAN        NOT NULL DEFAULT false,
  consent_date                DATE,

  -- OH report
  oh_provider                 VARCHAR(200),
  appointment_date            DATE,
  report_received_date        DATE,
  report_summary              TEXT,
  fit_for_role                VARCHAR(30)
    CHECK (fit_for_role IN ('yes','yes_with_adjustments','no_currently','no_permanently')),
  adjustments_recommended     TEXT,
  estimated_return_date       DATE,
  disability_likely           VARCHAR(10)
    CHECK (disability_likely IN ('yes','no','possible')),
  follow_up_date              DATE,

  -- Employer actions
  adjustments_implemented     JSONB          NOT NULL DEFAULT '[]',

  created_at                  TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  deleted_at                  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hr_oh_home_staff
  ON hr_oh_referrals(home_id, staff_id) WHERE deleted_at IS NULL;

-- DOWN
DROP TABLE IF EXISTS hr_oh_referrals;
