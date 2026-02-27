-- UP
CREATE TABLE IF NOT EXISTS hr_file_attachments (
  id              SERIAL PRIMARY KEY,
  home_id         INTEGER        NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  case_type       VARCHAR(30)    NOT NULL
    CHECK (case_type IN ('disciplinary','grievance','performance','rtw_interview',
                          'oh_referral','contract','family_leave','flexible_working',
                          'edi','tupe','renewal')),
  case_id         INTEGER        NOT NULL,
  original_name   VARCHAR(500)   NOT NULL,
  stored_name     VARCHAR(200)   NOT NULL,
  mime_type       VARCHAR(100)   NOT NULL,
  size_bytes      INTEGER        NOT NULL,
  description     TEXT,
  uploaded_by     VARCHAR(200)   NOT NULL,
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_attachments_case ON hr_file_attachments(case_type, case_id);
CREATE INDEX IF NOT EXISTS idx_hr_attachments_home ON hr_file_attachments(home_id);

-- DOWN
DROP TABLE IF EXISTS hr_file_attachments;
