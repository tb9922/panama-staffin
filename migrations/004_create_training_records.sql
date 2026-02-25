-- UP
-- training_records: one row per staff × training type. Unique constraint enforces
-- one record per combination. Upserted on save.

CREATE TABLE IF NOT EXISTS training_records (
  id                SERIAL         PRIMARY KEY,
  home_id           INTEGER        NOT NULL REFERENCES homes(id),
  staff_id          VARCHAR(20)    NOT NULL,
  training_type_id  VARCHAR(50)    NOT NULL,
  completed         DATE,
  expiry            DATE,
  trainer           VARCHAR(200),
  method            VARCHAR(50),
  certificate_ref   VARCHAR(100),
  level             VARCHAR(20),
  notes             TEXT,
  created_at        TIMESTAMP      NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP      NOT NULL DEFAULT NOW(),
  UNIQUE (home_id, staff_id, training_type_id)
);

-- Training matrix lookup (all records for a home's active staff)
CREATE INDEX IF NOT EXISTS idx_training_home_staff
  ON training_records(home_id, staff_id);

-- Expiry scan for compliance alerts
CREATE INDEX IF NOT EXISTS idx_training_expiry
  ON training_records(home_id, expiry) WHERE expiry IS NOT NULL;

-- DOWN
DROP TABLE IF EXISTS training_records;
