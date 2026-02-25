-- UP
-- homes: one row per care home. config stored as JSONB — always read as a complete
-- unit (training_types[], bank_holidays[], shifts{}, minimum_staffing{} etc).
-- annual_leave kept as JSONB legacy field to avoid data loss on migration.

CREATE TABLE IF NOT EXISTS homes (
  id            SERIAL PRIMARY KEY,
  slug          VARCHAR(100) NOT NULL UNIQUE,        -- path-safe name, e.g. "Oakwood_Care_Home"
  name          VARCHAR(200) NOT NULL,
  config        JSONB        NOT NULL DEFAULT '{}',
  annual_leave  JSONB        NOT NULL DEFAULT '{}',  -- legacy; overrides is source of truth
  created_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- DOWN
DROP TABLE IF EXISTS homes;
