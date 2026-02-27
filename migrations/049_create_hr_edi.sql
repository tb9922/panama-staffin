-- UP
-- HR EDI (Equality, Diversity & Inclusion) records.
-- Covers harassment complaints (including ERA 2025 third-party harassment),
-- reasonable adjustments (Equality Act 2010), and Access to Work.
-- Uses record_type discriminator to share one table.

CREATE TABLE IF NOT EXISTS hr_edi_records (
  id                        SERIAL PRIMARY KEY,
  home_id                   INTEGER        NOT NULL REFERENCES homes(id),
  record_type               VARCHAR(30)    NOT NULL
    CHECK (record_type IN ('harassment_complaint','reasonable_adjustment')),
  staff_id                  VARCHAR(20),

  -- Harassment complaint fields
  complaint_date            DATE,
  harassment_category       VARCHAR(30)
    CHECK (harassment_category IN ('sexual_harassment','racial','disability','age','religion','gender','other')),
  third_party               BOOLEAN        DEFAULT false,
  third_party_type          VARCHAR(20)
    CHECK (third_party_type IN ('customer','resident','family','visitor','contractor')),
  respondent_type           VARCHAR(20)
    CHECK (respondent_type IN ('staff','manager','third_party')),
  respondent_staff_id       VARCHAR(20),
  respondent_name           VARCHAR(200),
  handling_route            VARCHAR(20)
    CHECK (handling_route IN ('disciplinary','grievance','informal','mediation')),
  linked_case_id            INTEGER,
  reasonable_steps_evidence JSONB          NOT NULL DEFAULT '[]',

  -- Reasonable adjustment fields
  condition_description     TEXT,
  adjustments               JSONB          NOT NULL DEFAULT '[]',
  oh_referral_id            INTEGER,
  access_to_work_applied    BOOLEAN        DEFAULT false,
  access_to_work_reference  VARCHAR(100),
  access_to_work_amount     NUMERIC(10,2),

  -- Common fields
  description               TEXT,
  status                    VARCHAR(20)    NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','investigating','resolved','closed','escalated')),
  outcome                   TEXT,
  notes                     TEXT,
  created_at                TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  deleted_at                TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hr_edi_home_type
  ON hr_edi_records(home_id, record_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hr_edi_staff
  ON hr_edi_records(home_id, staff_id) WHERE staff_id IS NOT NULL AND deleted_at IS NULL;

-- DOWN
DROP TABLE IF EXISTS hr_edi_records;
