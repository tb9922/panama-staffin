-- UP
-- agency_providers: agencies that supply temporary care staff to the home.
-- agency_shifts: actual agency shifts logged against Panama rota records (shift_overrides AG-*).
-- Purpose: track true agency cost vs permanent staff cost, enable invoice reconciliation,
--          and drive the "Zero Agency" dashboard metric.
-- Agency staff are NOT on payroll — costs are tracked here for P&L, not wage calculation.

CREATE TABLE agency_providers (
  id          SERIAL PRIMARY KEY,
  home_id     INTEGER NOT NULL REFERENCES homes(id),
  name        VARCHAR(200) NOT NULL,
  contact     VARCHAR(200),
  rate_day    NUMERIC(8,2),    -- standard day rate per hour charged by agency
  rate_night  NUMERIC(8,2),   -- standard night rate per hour charged by agency
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agency_providers_home ON agency_providers(home_id);

CREATE TABLE agency_shifts (
  id           SERIAL PRIMARY KEY,
  home_id      INTEGER NOT NULL REFERENCES homes(id),
  agency_id    INTEGER NOT NULL REFERENCES agency_providers(id),
  date         DATE NOT NULL,
  shift_code   VARCHAR(10) NOT NULL,  -- AG-E | AG-L | AG-N
  hours        NUMERIC(5,2) NOT NULL,
  hourly_rate  NUMERIC(8,2) NOT NULL, -- actual rate on this invoice line
  total_cost   NUMERIC(10,2) NOT NULL,
  worker_name  VARCHAR(200),
  invoice_ref  VARCHAR(100),
  reconciled   BOOLEAN NOT NULL DEFAULT false,  -- matched against rota AG-* override
  role_covered VARCHAR(100),
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agency_shifts_home_date ON agency_shifts(home_id, date);
CREATE INDEX idx_agency_shifts_home_period ON agency_shifts(home_id, date, reconciled);

-- DOWN
DROP TABLE IF EXISTS agency_shifts;
DROP TABLE IF EXISTS agency_providers;
