BEGIN;

CREATE TABLE clock_ins (
  id               SERIAL PRIMARY KEY,
  home_id          INTEGER NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  staff_id         VARCHAR(20) NOT NULL,
  clock_type       VARCHAR(10) NOT NULL CHECK (clock_type IN ('in', 'out')),
  server_time      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  client_time      TIMESTAMPTZ,
  lat              NUMERIC(9,6),
  lng              NUMERIC(9,6),
  accuracy_m       NUMERIC(7,2),
  distance_m       NUMERIC(7,2),
  within_geofence  BOOLEAN,
  source           VARCHAR(20) NOT NULL DEFAULT 'gps'
                     CHECK (source IN ('gps', 'manual', 'correction')),
  shift_date       DATE NOT NULL,
  expected_shift   VARCHAR(10),
  approved         BOOLEAN NOT NULL DEFAULT FALSE,
  approved_by      VARCHAR(100),
  approved_at      TIMESTAMPTZ,
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (home_id, staff_id) REFERENCES staff(home_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_clock_ins_home_date
  ON clock_ins (home_id, shift_date DESC);

CREATE INDEX idx_clock_ins_staff_date
  ON clock_ins (home_id, staff_id, shift_date DESC);

CREATE INDEX idx_clock_ins_unapproved
  ON clock_ins (home_id, approved)
  WHERE approved = FALSE;

COMMIT;
