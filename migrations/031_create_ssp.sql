-- 031_create_ssp.sql
-- Statutory Sick Pay: SSP rate config (including April 2026 changes),
-- sick periods per staff, and enhanced sick pay config per home.

-- UP

-- SSP rate configuration. Two rows seeded:
--   2025-04-06: current rules (3 waiting days, LEL test, £118.75/wk)
--   2026-04-06: reformed rules (0 waiting days, no LEL, £123.25/wk)
CREATE TABLE IF NOT EXISTS ssp_config (
  id              SERIAL PRIMARY KEY,
  effective_from  DATE NOT NULL UNIQUE,
  weekly_rate     NUMERIC(8,2) NOT NULL,
  waiting_days    INTEGER NOT NULL DEFAULT 3,   -- 0 from April 2026
  lel_weekly      NUMERIC(8,2),                 -- NULL from April 2026 (abolished)
  max_weeks       INTEGER NOT NULL DEFAULT 28   -- maximum SSP entitlement
);

INSERT INTO ssp_config (effective_from, weekly_rate, waiting_days, lel_weekly, max_weeks) VALUES
  ('2025-04-06', 118.75, 3, 125.00, 28),
  ('2026-04-06', 123.25, 0, NULL,   28)
ON CONFLICT (effective_from) DO NOTHING;

-- Sick period per staff member.
-- Tracks start/end of each spell; links to previous for "linked period" rules.
-- qualifying_days_per_week: working days per week (default 5).
-- waiting_days_served: incremental — if this period is linked, may be 0.
-- ssp_weeks_paid: running total of SSP weeks used, for 28-week cap enforcement.
-- fit_note_received: GP certificate required if absence > 7 days.
CREATE TABLE IF NOT EXISTS sick_periods (
  id                      SERIAL PRIMARY KEY,
  home_id                 INTEGER NOT NULL REFERENCES homes(id),
  staff_id                VARCHAR(20) NOT NULL,
  start_date              DATE NOT NULL,
  end_date                DATE,              -- NULL = still open
  qualifying_days_per_week INTEGER NOT NULL DEFAULT 5,
  waiting_days_served     INTEGER NOT NULL DEFAULT 0,
  ssp_weeks_paid          NUMERIC(6,2) NOT NULL DEFAULT 0,
  fit_note_received       BOOLEAN NOT NULL DEFAULT false,
  fit_note_date           DATE,
  linked_to_period_id     INTEGER REFERENCES sick_periods(id),
  notes                   TEXT,
  created_at              TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sick_periods_home_staff ON sick_periods(home_id, staff_id);
CREATE INDEX IF NOT EXISTS idx_sick_periods_dates ON sick_periods(home_id, start_date, end_date);

-- Enhanced sick pay configuration per home.
-- full_pay_weeks: weeks at full pay above SSP (e.g. 4 = first 4 weeks full pay).
-- half_pay_weeks: weeks at half pay above SSP after full_pay_weeks exhausted.
-- Both default 0 (SSP only).
CREATE TABLE IF NOT EXISTS enhanced_sick_config (
  id              SERIAL PRIMARY KEY,
  home_id         INTEGER NOT NULL REFERENCES homes(id) UNIQUE,
  full_pay_weeks  INTEGER NOT NULL DEFAULT 0,
  half_pay_weeks  INTEGER NOT NULL DEFAULT 0,
  notes           TEXT,
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- DOWN
DROP TABLE IF EXISTS enhanced_sick_config;
DROP TABLE IF EXISTS sick_periods;
DROP TABLE IF EXISTS ssp_config;
