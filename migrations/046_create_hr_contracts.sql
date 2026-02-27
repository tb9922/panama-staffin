-- UP
-- HR employment contracts — ERA 1996 s.1 Written Statement of Particulars.
-- Must be provided on or before day one of employment.
-- probation_reviews and variations stored as JSONB — complex nested structures.

CREATE TABLE IF NOT EXISTS hr_contracts (
  id                            SERIAL PRIMARY KEY,
  home_id                       INTEGER        NOT NULL REFERENCES homes(id),
  staff_id                      VARCHAR(20)    NOT NULL,

  -- Written Statement of Particulars
  statement_issued              BOOLEAN        NOT NULL DEFAULT false,
  statement_issued_date         DATE,

  -- Contract details
  contract_type                 VARCHAR(20)    NOT NULL
    CHECK (contract_type IN ('permanent','fixed_term','bank','zero_hours','casual')),
  contract_start_date           DATE           NOT NULL,
  contract_end_date             DATE,
  job_title                     VARCHAR(200),
  job_description_ref           VARCHAR(200),
  reporting_to                  VARCHAR(200),
  place_of_work                 VARCHAR(200),

  -- Hours & pay
  hours_per_week                NUMERIC(5,2),
  working_pattern               VARCHAR(200),
  hourly_rate                   NUMERIC(8,2),
  pay_frequency                 VARCHAR(20)
    CHECK (pay_frequency IN ('weekly','fortnightly','monthly')),

  -- Leave
  annual_leave_days             INTEGER        DEFAULT 28,

  -- Notice period
  notice_period_employer        VARCHAR(50),
  notice_period_employee        VARCHAR(50),

  -- Probation
  probation_period_months       INTEGER,
  probation_start_date          DATE,
  probation_end_date            DATE,
  probation_reviews             JSONB          NOT NULL DEFAULT '[]',
  probation_outcome             VARCHAR(20)
    CHECK (probation_outcome IN ('passed','extended','failed')),
  probation_extension_date      DATE,
  probation_extension_reason    TEXT,
  probation_confirmed_date      DATE,
  probation_confirmation_letter_sent BOOLEAN   DEFAULT false,

  -- Contract variations
  variations                    JSONB          NOT NULL DEFAULT '[]',

  -- Termination
  termination_type              VARCHAR(30)
    CHECK (termination_type IN ('resignation','dismissal','redundancy','mutual_agreement','end_of_fixed_term','retirement','tupe_transfer','death')),
  termination_date              DATE,
  termination_reason            TEXT,
  notice_given_date             DATE,
  notice_given_by               VARCHAR(20)
    CHECK (notice_given_by IN ('employer','employee')),
  last_working_day              DATE,
  garden_leave                  BOOLEAN        DEFAULT false,
  pilon                         BOOLEAN        DEFAULT false,
  exit_interview_date           DATE,
  exit_interview_notes          TEXT,
  references_agreed             TEXT,

  -- Status
  status                        VARCHAR(20)    NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','probation','notice_period','terminated','suspended')),
  created_at                    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  deleted_at                    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hr_contracts_home_staff
  ON hr_contracts(home_id, staff_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hr_contracts_status
  ON hr_contracts(home_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hr_contracts_probation
  ON hr_contracts(probation_end_date) WHERE probation_outcome IS NULL AND deleted_at IS NULL;

-- DOWN
DROP TABLE IF EXISTS hr_contracts;
