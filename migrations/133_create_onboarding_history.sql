-- UP
CREATE TABLE IF NOT EXISTS onboarding_history (
  id          SERIAL PRIMARY KEY,
  home_id     INTEGER        NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  staff_id    VARCHAR(20)    NOT NULL,
  section     VARCHAR(30)    NOT NULL,
  data        JSONB          NOT NULL,
  changed_by  VARCHAR(200)   NOT NULL,
  change_type VARCHAR(10)    NOT NULL CHECK (change_type IN ('update','clear')),
  changed_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onb_history_lookup
  ON onboarding_history(home_id, staff_id, section, changed_at DESC);

-- DOWN
DROP TABLE IF EXISTS onboarding_history;
