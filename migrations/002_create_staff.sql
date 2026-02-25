-- UP
-- staff: one row per care home staff member. id preserves the application-generated
-- string IDs ("S001" etc) rather than using a DB sequence. Composite PK (home_id, id).
-- deleted_at for soft delete — regulated HR data must be auditable, not hard-deleted.

CREATE TABLE IF NOT EXISTS staff (
  id              VARCHAR(20)    NOT NULL,
  home_id         INTEGER        NOT NULL REFERENCES homes(id),
  name            VARCHAR(200)   NOT NULL,
  role            VARCHAR(100)   NOT NULL,
  team            VARCHAR(50)    NOT NULL,
  pref            VARCHAR(10),
  skill           NUMERIC(4,2)   NOT NULL DEFAULT 1,
  hourly_rate     NUMERIC(8,2)   NOT NULL,
  active          BOOLEAN        NOT NULL DEFAULT true,
  wtr_opt_out     BOOLEAN        NOT NULL DEFAULT false,
  start_date      DATE,
  contract_hours  NUMERIC(5,2),
  al_entitlement  INTEGER,
  al_carryover    INTEGER        NOT NULL DEFAULT 0,
  leaving_date    DATE,
  created_at      TIMESTAMP      NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP      NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMP,
  PRIMARY KEY (home_id, id)
);

-- Hot path: coverage and cost calculations filter active staff per home
CREATE INDEX IF NOT EXISTS idx_staff_home_active
  ON staff(home_id) WHERE deleted_at IS NULL AND active = true;

-- DOWN
DROP TABLE IF EXISTS staff;
