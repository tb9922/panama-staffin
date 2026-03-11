CREATE TABLE IF NOT EXISTS import_log (
  id SERIAL PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes(id),
  import_type VARCHAR(50) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  imported_by VARCHAR(100) NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_import_log_home ON import_log(home_id);
