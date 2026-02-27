-- UP
-- HR return-to-work interviews — tracks post-absence RTW process.
-- Links to existing SICK shift overrides via date matching.
-- Bradford score snapshot stored at time of RTW for trigger tracking.

CREATE TABLE IF NOT EXISTS hr_rtw_interviews (
  id                      SERIAL PRIMARY KEY,
  home_id                 INTEGER        NOT NULL REFERENCES homes(id),
  staff_id                VARCHAR(20)    NOT NULL,

  -- Absence details
  absence_start_date      DATE           NOT NULL,
  absence_end_date        DATE,
  absence_days            INTEGER,
  absence_reason          VARCHAR(200),

  -- RTW interview
  rtw_date                DATE           NOT NULL,
  rtw_conducted_by        VARCHAR(200)   NOT NULL,
  fit_to_return           BOOLEAN        NOT NULL DEFAULT true,
  adjustments_needed      BOOLEAN        NOT NULL DEFAULT false,
  adjustments_detail      TEXT,
  underlying_condition    BOOLEAN        NOT NULL DEFAULT false,
  oh_referral_recommended BOOLEAN        NOT NULL DEFAULT false,
  follow_up_date          DATE,
  notes                   TEXT,

  -- Fit note
  fit_note_received       BOOLEAN        NOT NULL DEFAULT false,
  fit_note_date           DATE,
  fit_note_type           VARCHAR(20)
    CHECK (fit_note_type IN ('not_fit','may_be_fit')),
  fit_note_adjustments    TEXT,
  fit_note_review_date    DATE,

  -- Trigger assessment
  bradford_score_after    INTEGER,
  trigger_reached         VARCHAR(20)
    CHECK (trigger_reached IN ('informal','formal_1','formal_2','final','none')),
  action_taken            VARCHAR(30)
    CHECK (action_taken IN ('none','informal_chat','formal_meeting','referral')),
  linked_case_id          INTEGER,

  created_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  deleted_at              TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hr_rtw_home_staff
  ON hr_rtw_interviews(home_id, staff_id) WHERE deleted_at IS NULL;

-- DOWN
DROP TABLE IF EXISTS hr_rtw_interviews;
