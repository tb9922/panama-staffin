-- UP
-- care_certificate: Care Certificate progress (CQC QS6 — Reg 18) per staff member.
-- standards stored as JSONB — 16 standards, each with knowledge{} and observations[].
-- Deeply nested, always read as a complete record. PK on (home_id, staff_id).

CREATE TABLE IF NOT EXISTS care_certificates (
  home_id              INTEGER       NOT NULL REFERENCES homes(id),
  staff_id             VARCHAR(20)   NOT NULL,
  start_date           DATE,
  expected_completion  DATE,
  supervisor           VARCHAR(200),
  status               VARCHAR(50),
  completion_date      DATE,
  standards            JSONB         NOT NULL DEFAULT '{}',
  created_at           TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP,
  PRIMARY KEY (home_id, staff_id)
);

-- DOWN
DROP TABLE IF EXISTS care_certificates;
