-- UP
CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  vat_number VARCHAR(32),
  default_category VARCHAR(50),
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1,
  created_by VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_suppliers_home_name_active
  ON suppliers (home_id, LOWER(TRIM(name)))
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_suppliers_home_vat_active
  ON suppliers (home_id, vat_number)
  WHERE vat_number IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_suppliers_home_active
  ON suppliers (home_id, active, name)
  WHERE deleted_at IS NULL;

-- DOWN
DROP TABLE IF EXISTS suppliers;
