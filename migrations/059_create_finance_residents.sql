-- UP
-- Finance residents: billing profiles for care home residents (no health data)

CREATE TABLE IF NOT EXISTS finance_residents (
  id                  SERIAL PRIMARY KEY,
  home_id             INTEGER        NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  resident_name       VARCHAR(200)   NOT NULL,
  room_number         VARCHAR(20),
  admission_date      DATE,
  discharge_date      DATE,
  care_type           VARCHAR(30)    NOT NULL DEFAULT 'residential'
    CHECK (care_type IN ('residential','nursing','dementia_residential','dementia_nursing','respite')),

  -- Funding profile
  funding_type        VARCHAR(20)    NOT NULL DEFAULT 'self_funded'
    CHECK (funding_type IN ('self_funded','la_funded','chc_funded','split_funded','respite')),
  funding_authority   VARCHAR(200),
  funding_reference   VARCHAR(100),

  -- Fee structure (all NUMERIC for exact decimal arithmetic)
  weekly_fee          NUMERIC(10,2)  NOT NULL DEFAULT 0,
  la_contribution     NUMERIC(10,2)  NOT NULL DEFAULT 0,
  chc_contribution    NUMERIC(10,2)  NOT NULL DEFAULT 0,
  fnc_amount          NUMERIC(10,2)  NOT NULL DEFAULT 0,
  top_up_amount       NUMERIC(10,2)  NOT NULL DEFAULT 0,
  top_up_payer        VARCHAR(200),
  top_up_contact      VARCHAR(300),

  -- Fee review tracking
  last_fee_review     DATE,
  next_fee_review     DATE,

  status              VARCHAR(20)    NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','discharged','deceased','suspended')),
  notes               TEXT,

  created_by          VARCHAR(100)   NOT NULL,
  created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_fin_residents_home_status
  ON finance_residents(home_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_fin_residents_home_review
  ON finance_residents(home_id, next_fee_review) WHERE deleted_at IS NULL AND status = 'active';

-- DOWN
DROP TABLE IF EXISTS finance_residents;
