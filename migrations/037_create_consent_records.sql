CREATE TABLE IF NOT EXISTS consent_records (
  id            SERIAL PRIMARY KEY,
  home_id       INTEGER NOT NULL REFERENCES homes(id),
  subject_type  VARCHAR(20) NOT NULL CHECK (subject_type IN ('staff','resident')),
  subject_id    VARCHAR(100) NOT NULL,
  subject_name  VARCHAR(200),
  purpose       VARCHAR(200) NOT NULL,
  legal_basis   VARCHAR(100) NOT NULL CHECK (legal_basis IN ('consent','contract','legal_obligation','vital_interests','public_task','legitimate_interests')),
  given         TIMESTAMPTZ,
  withdrawn     TIMESTAMPTZ,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_consent_records_home ON consent_records (home_id, subject_type);
