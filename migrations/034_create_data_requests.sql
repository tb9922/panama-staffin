CREATE TABLE IF NOT EXISTS data_requests (
  id                SERIAL PRIMARY KEY,
  home_id           INTEGER NOT NULL REFERENCES homes(id),
  request_type      VARCHAR(30) NOT NULL CHECK (request_type IN ('sar','erasure','rectification','restriction','portability')),
  subject_type      VARCHAR(20) NOT NULL CHECK (subject_type IN ('staff','resident')),
  subject_id        VARCHAR(100) NOT NULL,
  subject_name      VARCHAR(200),
  date_received     DATE NOT NULL,
  deadline          DATE NOT NULL,
  identity_verified BOOLEAN NOT NULL DEFAULT FALSE,
  status            VARCHAR(20) NOT NULL DEFAULT 'received' CHECK (status IN ('received','in_progress','completed','rejected')),
  notes             TEXT,
  completed_date    DATE,
  completed_by      VARCHAR(100),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_data_requests_home ON data_requests (home_id, status);
