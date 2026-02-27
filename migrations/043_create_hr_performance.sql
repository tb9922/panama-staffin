-- UP
-- HR performance & capability cases — ACAS Code of Practice compliant.
-- Tracks: concern → informal discussion → PIP → formal hearing → outcome → appeal.
-- pip_objectives and informal_targets stored as JSONB — complex nested structures.

CREATE TABLE IF NOT EXISTS hr_performance_cases (
  id                            SERIAL PRIMARY KEY,
  home_id                       INTEGER        NOT NULL REFERENCES homes(id),
  staff_id                      VARCHAR(20)    NOT NULL,
  type                          VARCHAR(30)    NOT NULL
    CHECK (type IN ('capability','pip','probation_concern')),

  -- Concern
  date_raised                   DATE           NOT NULL,
  raised_by                     VARCHAR(200)   NOT NULL,
  concern_summary               TEXT           NOT NULL,
  concern_detail                TEXT,
  performance_area              VARCHAR(30)    NOT NULL
    CHECK (performance_area IN ('clinical_competence','communication','attendance','teamwork','documentation','compliance','other')),

  -- Informal stage
  informal_discussion_date      DATE,
  informal_discussion_notes     TEXT,
  informal_targets              JSONB          NOT NULL DEFAULT '[]',
  informal_review_date          DATE,
  informal_outcome              VARCHAR(20)
    CHECK (informal_outcome IN ('resolved','proceed_to_formal')),

  -- PIP
  pip_start_date                DATE,
  pip_end_date                  DATE,
  pip_objectives                JSONB          NOT NULL DEFAULT '[]',
  pip_overall_outcome           VARCHAR(20)
    CHECK (pip_overall_outcome IN ('passed','failed','extended')),
  pip_extended_to               DATE,

  -- Formal capability hearing
  hearing_status                VARCHAR(20)    NOT NULL DEFAULT 'not_scheduled'
    CHECK (hearing_status IN ('not_scheduled','scheduled','held','adjourned','cancelled')),
  hearing_date                  DATE,
  hearing_time                  VARCHAR(10),
  hearing_location              VARCHAR(200),
  hearing_chair                 VARCHAR(200),
  hearing_letter_sent_date      DATE,
  hearing_companion_name        VARCHAR(200),
  hearing_companion_role        VARCHAR(30)
    CHECK (hearing_companion_role IN ('colleague','trade_union_rep')),
  hearing_notes                 TEXT,

  -- Outcome
  outcome                       VARCHAR(30)
    CHECK (outcome IN ('no_action','further_pip','redeployment','first_written','final_written','dismissal')),
  outcome_date                  DATE,
  outcome_reason                TEXT,
  outcome_letter_sent_date      DATE,
  warning_expiry_date           DATE,
  redeployment_offered          BOOLEAN        DEFAULT false,
  redeployment_role             VARCHAR(100),
  redeployment_accepted         BOOLEAN,

  -- Appeal
  appeal_status                 VARCHAR(20)    NOT NULL DEFAULT 'none'
    CHECK (appeal_status IN ('none','requested','scheduled','held','decided')),
  appeal_received_date          DATE,
  appeal_deadline               DATE,
  appeal_grounds                TEXT,
  appeal_hearing_date           DATE,
  appeal_outcome                VARCHAR(30)
    CHECK (appeal_outcome IN ('upheld','partially_upheld','overturned')),
  appeal_outcome_date           DATE,
  appeal_outcome_reason         TEXT,

  -- Meta
  status                        VARCHAR(30)    NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','informal','pip_active','pip_review','hearing_scheduled','outcome_issued','appeal_pending','closed')),
  closed_date                   DATE,
  created_by                    VARCHAR(100)   NOT NULL,
  created_at                    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  deleted_at                    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hr_perf_home_staff
  ON hr_performance_cases(home_id, staff_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hr_perf_status
  ON hr_performance_cases(home_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hr_perf_warning_expiry
  ON hr_performance_cases(warning_expiry_date) WHERE warning_expiry_date IS NOT NULL AND deleted_at IS NULL;

-- DOWN
DROP TABLE IF EXISTS hr_performance_cases;
