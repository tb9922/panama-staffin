-- UP
-- Beds & occupancy: physical bed inventory and status lifecycle.
-- Beds are physical assets — decommissioned via status, not soft-deleted.
-- No version column — optimistic locking uses updated_at.

CREATE TABLE IF NOT EXISTS beds (
  id                  SERIAL PRIMARY KEY,
  home_id             INTEGER        NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  room_number         VARCHAR(20)    NOT NULL,
  room_name           VARCHAR(50),
  room_type           VARCHAR(30)
    CHECK (room_type IN ('single', 'shared', 'en_suite', 'nursing', 'bariatric')),
  floor               VARCHAR(20),
  status              VARCHAR(20)    NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'reserved', 'occupied', 'hospital_hold', 'vacating', 'deep_clean', 'maintenance', 'decommissioned')),
  resident_id         INTEGER REFERENCES finance_residents(id) ON DELETE SET NULL,
  status_since        DATE           NOT NULL DEFAULT CURRENT_DATE,
  hold_expires        DATE,
  reserved_until      DATE,
  booked_from         DATE,
  booked_until        DATE,
  notes               TEXT,
  created_by          VARCHAR(100)   NOT NULL,
  updated_by          VARCHAR(100),
  created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  UNIQUE(home_id, room_number)
);

CREATE TABLE IF NOT EXISTS bed_transitions (
  id                  SERIAL PRIMARY KEY,
  home_id             INTEGER        NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  bed_id              INTEGER        NOT NULL REFERENCES beds(id) ON DELETE CASCADE,
  from_status         VARCHAR(20)    NOT NULL,
  to_status           VARCHAR(20)    NOT NULL,
  resident_id         INTEGER REFERENCES finance_residents(id) ON DELETE SET NULL,
  changed_by          VARCHAR(100)   NOT NULL,
  changed_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  reason              TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_beds_home ON beds(home_id);
CREATE INDEX IF NOT EXISTS idx_beds_home_available ON beds(home_id) WHERE status = 'available';
CREATE INDEX IF NOT EXISTS idx_beds_home_hold ON beds(home_id, hold_expires) WHERE status = 'hospital_hold';
CREATE INDEX IF NOT EXISTS idx_beds_home_reserved ON beds(home_id, reserved_until) WHERE status = 'reserved';
CREATE INDEX IF NOT EXISTS idx_bed_transitions_bed ON bed_transitions(bed_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_bed_transitions_home ON bed_transitions(home_id, changed_at DESC);

-- Auto-update updated_at trigger (reuses shared set_updated_at from migration 056)
DROP TRIGGER IF EXISTS trg_updated_at_beds ON beds;
CREATE TRIGGER trg_updated_at_beds
  BEFORE UPDATE ON beds
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN
-- DROP TRIGGER IF EXISTS trg_updated_at_beds ON beds;
-- DROP TABLE IF EXISTS bed_transitions;
-- DROP TABLE IF EXISTS beds;
