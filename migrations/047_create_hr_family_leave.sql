-- UP
-- HR family leave — maternity, paternity, shared parental, adoption, bereavement, neonatal.
-- ERA 2025: day-one rights for paternity and unpaid parental leave from April 2026.
-- kit_days and split_days stored as JSONB.

CREATE TABLE IF NOT EXISTS hr_family_leave (
  id                        SERIAL PRIMARY KEY,
  home_id                   INTEGER        NOT NULL REFERENCES homes(id),
  staff_id                  VARCHAR(20)    NOT NULL,

  -- Leave type
  type                      VARCHAR(30)    NOT NULL
    CHECK (type IN ('maternity','paternity','shared_parental','adoption','parental_unpaid','parental_bereavement','neonatal')),

  -- Request
  request_date              DATE,

  -- Maternity-specific
  expected_due_date         DATE,
  actual_birth_date         DATE,
  mat_b1_received           BOOLEAN        DEFAULT false,
  mat_b1_date               DATE,

  -- Paternity-specific
  paternity_week_choice     INTEGER
    CHECK (paternity_week_choice IN (1, 2)),
  paternity_start_date      DATE,

  -- Shared Parental Leave
  spl_total_weeks           INTEGER,
  spl_notice_received_date  DATE,
  spl_partner_employer      VARCHAR(200),
  spl_booking_notices       JSONB          NOT NULL DEFAULT '[]',

  -- Adoption-specific
  matching_date             DATE,
  placement_date            DATE,

  -- Unpaid Parental Leave
  upl_child_name            VARCHAR(200),
  upl_child_dob             DATE,
  upl_weeks_requested       INTEGER,
  upl_weeks_used_total      INTEGER,

  -- Parental Bereavement
  bereavement_date          DATE,
  bereavement_relationship  VARCHAR(30)
    CHECK (bereavement_relationship IN ('child_under_18','stillbirth','bereaved_partner')),

  -- Leave dates
  leave_start_date          DATE,
  leave_end_date            DATE,
  expected_return_date      DATE,
  actual_return_date        DATE,

  -- Pay
  statutory_pay_type        VARCHAR(10)
    CHECK (statutory_pay_type IN ('SMP','SPP','ShPP','SAP','none')),
  statutory_pay_start_date  DATE,
  enhanced_pay              BOOLEAN        DEFAULT false,
  enhanced_pay_weeks        INTEGER,
  enhanced_pay_rate         NUMERIC(5,2),

  -- Pregnancy risk assessment (maternity)
  risk_assessment_date      DATE,
  risk_assessment_by        VARCHAR(200),
  risks_identified          TEXT,
  adjustments_made          TEXT,
  risk_assessment_review_date DATE,

  -- KIT / SPLIT days
  kit_days                  JSONB          NOT NULL DEFAULT '[]',
  split_days                JSONB          NOT NULL DEFAULT '[]',

  -- Return to work
  return_confirmed          BOOLEAN        DEFAULT false,
  return_pattern            VARCHAR(50),
  flexible_working_request_linked INTEGER,

  -- Protected period (ERA 2025)
  protected_period_start    DATE,
  protected_period_end      DATE,

  -- Meta
  status                    VARCHAR(20)    NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','approved','active','kit_day','returned','cancelled')),
  notes                     TEXT,
  created_by                VARCHAR(100),
  created_at                TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  deleted_at                TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hr_family_home_staff
  ON hr_family_leave(home_id, staff_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hr_family_status
  ON hr_family_leave(home_id, status) WHERE deleted_at IS NULL AND status NOT IN ('returned','cancelled');

-- DOWN
DROP TABLE IF EXISTS hr_family_leave;
