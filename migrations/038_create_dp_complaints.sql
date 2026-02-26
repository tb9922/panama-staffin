CREATE TABLE IF NOT EXISTS dp_complaints (
  id               SERIAL PRIMARY KEY,
  home_id          INTEGER NOT NULL REFERENCES homes(id),
  date_received    DATE NOT NULL,
  complainant_name VARCHAR(200),
  category         VARCHAR(50) NOT NULL CHECK (category IN ('access','erasure','rectification','breach','consent','other')),
  description      TEXT NOT NULL,
  severity         VARCHAR(20) NOT NULL DEFAULT 'low' CHECK (severity IN ('low','medium','high','critical')),
  ico_involved     BOOLEAN NOT NULL DEFAULT FALSE,
  ico_reference    VARCHAR(100),
  status           VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','resolved','closed','escalated')),
  resolution       TEXT,
  resolution_date  DATE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dp_complaints_home ON dp_complaints (home_id, status);
