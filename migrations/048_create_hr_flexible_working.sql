-- UP
-- HR flexible working requests — s.80F Employment Rights Act 1996.
-- ERA 2025: employer must decide within 2 months, explain refusal reasoning.
-- 8 statutory refusal reasons enumerated.

CREATE TABLE IF NOT EXISTS hr_flexible_working (
  id                        SERIAL PRIMARY KEY,
  home_id                   INTEGER        NOT NULL REFERENCES homes(id),
  staff_id                  VARCHAR(20)    NOT NULL,

  -- Request
  request_date              DATE           NOT NULL,
  effective_date_requested  DATE,
  current_pattern           TEXT,
  requested_change          TEXT           NOT NULL,
  reason                    TEXT,
  employee_assessment_of_impact TEXT,

  -- Employer response (2-month deadline)
  decision_deadline         DATE           NOT NULL,
  meeting_date              DATE,
  meeting_notes             TEXT,

  decision                  VARCHAR(20)
    CHECK (decision IN ('approved','approved_modified','refused','withdrawn')),
  decision_date             DATE,
  decision_by               VARCHAR(200),

  -- Refusal (must be statutory reason)
  refusal_reason            VARCHAR(50)
    CHECK (refusal_reason IN (
      'burden_of_additional_costs','detrimental_to_meet_customer_demand',
      'inability_to_reorganise_work','inability_to_recruit_additional_staff',
      'detrimental_to_quality','detrimental_to_performance',
      'insufficiency_of_work_during_periods','planned_structural_changes'
    )),
  refusal_explanation       TEXT,

  -- If approved
  approved_pattern          TEXT,
  approved_effective_date   DATE,
  trial_period              BOOLEAN        DEFAULT false,
  trial_period_end          DATE,
  contract_variation_id     INTEGER,

  -- Appeal
  appeal_date               DATE,
  appeal_grounds            TEXT,
  appeal_outcome            VARCHAR(20)
    CHECK (appeal_outcome IN ('upheld','overturned','modified')),
  appeal_outcome_date       DATE,

  -- Meta
  status                    VARCHAR(20)    NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','meeting_scheduled','decided','implemented','appealed','withdrawn')),
  notes                     TEXT,
  created_at                TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  deleted_at                TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hr_flex_home_staff
  ON hr_flexible_working(home_id, staff_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hr_flex_deadline
  ON hr_flexible_working(decision_deadline) WHERE decision IS NULL AND deleted_at IS NULL;

-- DOWN
DROP TABLE IF EXISTS hr_flexible_working;
