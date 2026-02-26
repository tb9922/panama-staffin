CREATE TABLE IF NOT EXISTS access_log (
  id            SERIAL PRIMARY KEY,
  ts            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_name     VARCHAR(100),
  user_role     VARCHAR(20),
  method        VARCHAR(10) NOT NULL,
  endpoint      VARCHAR(500) NOT NULL,
  home_id       INTEGER REFERENCES homes(id),
  data_categories TEXT[] DEFAULT '{}',
  ip_address    INET,
  status_code   SMALLINT
);

CREATE INDEX idx_access_log_ts ON access_log (ts DESC);
CREATE INDEX idx_access_log_home ON access_log (home_id, ts DESC);
