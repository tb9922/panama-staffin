-- UP
CREATE TABLE IF NOT EXISTS onboarding_file_attachments (
  id              SERIAL PRIMARY KEY,
  home_id         INTEGER        NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  staff_id        VARCHAR(20)    NOT NULL,
  section         VARCHAR(30)    NOT NULL
    CHECK (section IN (
      'dbs_check','right_to_work','references','identity_check',
      'health_declaration','qualifications','contract',
      'employment_history','day1_induction','policy_acknowledgement'
    )),
  original_name   VARCHAR(500)   NOT NULL,
  stored_name     VARCHAR(200)   NOT NULL,
  mime_type       VARCHAR(100)   NOT NULL,
  size_bytes      INTEGER        NOT NULL CHECK (size_bytes >= 0),
  description     TEXT,
  uploaded_by     VARCHAR(200)   NOT NULL,
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_onb_attach_staff
  ON onboarding_file_attachments(home_id, staff_id, section) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_onb_attach_home
  ON onboarding_file_attachments(home_id);

INSERT INTO retention_schedule (data_category, retention_period, retention_days, retention_basis, applies_to_table)
VALUES ('Onboarding documents', '75 years', 27375, 'Limitation Act 1980 — regulated care employment', 'onboarding_file_attachments')
ON CONFLICT DO NOTHING;

-- DOWN
DROP TABLE IF EXISTS onboarding_file_attachments;
