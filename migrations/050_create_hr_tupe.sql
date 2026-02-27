-- UP
-- HR TUPE transfers — Transfer of Undertakings (Protection of Employment) Regulations 2006.
-- Tracks incoming/outgoing transfers for care home acquisitions.
-- employees and eli_items stored as JSONB — complex nested structures.

CREATE TABLE IF NOT EXISTS hr_tupe_transfers (
  id                        SERIAL PRIMARY KEY,
  home_id                   INTEGER        NOT NULL REFERENCES homes(id),

  transfer_type             VARCHAR(20)    NOT NULL
    CHECK (transfer_type IN ('incoming','outgoing')),
  transfer_date             DATE           NOT NULL,

  -- Parties
  transferor_name           VARCHAR(200)   NOT NULL,
  transferee_name           VARCHAR(200)   NOT NULL,

  -- Employee list
  employees                 JSONB          NOT NULL DEFAULT '[]',

  -- Consultation
  consultation_start_date   DATE,
  consultation_end_date     DATE,
  measures_letter_date      DATE,
  measures_description      TEXT,
  employee_reps_consulted   BOOLEAN        DEFAULT false,
  rep_names                 VARCHAR(500),

  -- ELI (Employee Liability Information — must receive 28+ days before transfer)
  eli_received_date         DATE,
  eli_complete              BOOLEAN        NOT NULL DEFAULT false,
  eli_items                 JSONB          NOT NULL DEFAULT '{}',

  -- Due diligence
  dd_notes                  TEXT,
  outstanding_claims        TEXT,
  outstanding_tribunal_claims TEXT,

  -- Meta
  status                    VARCHAR(20)    NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','consultation','transferred','complete')),
  notes                     TEXT,
  created_at                TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  deleted_at                TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hr_tupe_home
  ON hr_tupe_transfers(home_id) WHERE deleted_at IS NULL;

-- DOWN
DROP TABLE IF EXISTS hr_tupe_transfers;
