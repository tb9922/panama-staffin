-- UP
-- pay_rate_rules: per-home enhancement rules applied on top of staff.hourly_rate.
-- rate_type: 'percentage' (amount = %, e.g. 15 = +15%), 'fixed_hourly' (amount = £/hr),
--            'flat_per_shift' (amount = £ flat regardless of hours).
-- applies_to: 'night'|'weekend_sat'|'weekend_sun'|'bank_holiday'|'sleep_in'|'overtime'|'on_call'
-- effective_to NULL = current rule. Enhancements stack additively.

CREATE TABLE pay_rate_rules (
  id             SERIAL PRIMARY KEY,
  home_id        INTEGER NOT NULL REFERENCES homes(id),
  name           VARCHAR(100) NOT NULL,
  rate_type      VARCHAR(30)  NOT NULL,
  amount         NUMERIC(8,2) NOT NULL,
  applies_to     VARCHAR(30)  NOT NULL,
  priority       INTEGER NOT NULL DEFAULT 0,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to   DATE,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Partial index: fast lookup of active rules per home (effective_to IS NULL = current)
CREATE INDEX idx_pay_rules_home_active ON pay_rate_rules(home_id) WHERE effective_to IS NULL;

-- nmw_rates: National Minimum/Living Wage rates by effective date and age bracket.
-- Seeded with 2025-04-01 and 2026-04-01 rates. Add future years here.
-- Lookup: SELECT ... WHERE effective_from <= $date AND age_bracket = $bracket
--          ORDER BY effective_from DESC LIMIT 1

CREATE TABLE nmw_rates (
  id             SERIAL PRIMARY KEY,
  effective_from DATE NOT NULL,
  age_bracket    VARCHAR(20) NOT NULL,  -- '21+' | '18-20' | '16-17' | 'apprentice'
  hourly_rate    NUMERIC(6,2) NOT NULL
);

INSERT INTO nmw_rates (effective_from, age_bracket, hourly_rate) VALUES
  ('2025-04-01', '21+',        12.21),
  ('2025-04-01', '18-20',      10.00),
  ('2025-04-01', '16-17',       7.55),
  ('2025-04-01', 'apprentice',  7.55),
  ('2026-04-01', '21+',        12.71),
  ('2026-04-01', '18-20',      10.85),
  ('2026-04-01', '16-17',       8.00),
  ('2026-04-01', 'apprentice',  8.00);

-- date_of_birth: required for NMW age-bracket determination and pension auto-enrolment.
-- Nullable: if NULL, payroll engine defaults to '21+' bracket and logs a warning.
ALTER TABLE staff ADD COLUMN IF NOT EXISTS date_of_birth DATE;

-- Payroll configuration per home (typed columns, not JSONB, for query safety).
-- snap_window_minutes: clock-ins within this many minutes before shift start snap to scheduled time.
-- pay_frequency: 'weekly' | 'fortnightly' | 'monthly'
-- pay_reference_date: anchor date for weekly/fortnightly periods
ALTER TABLE homes ADD COLUMN IF NOT EXISTS snap_window_minutes INTEGER NOT NULL DEFAULT 15;
ALTER TABLE homes ADD COLUMN IF NOT EXISTS snap_enabled       BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE homes ADD COLUMN IF NOT EXISTS pay_frequency      VARCHAR(20) NOT NULL DEFAULT 'monthly';
ALTER TABLE homes ADD COLUMN IF NOT EXISTS pay_reference_date DATE;

-- DOWN
DROP TABLE IF EXISTS nmw_rates;
DROP TABLE IF EXISTS pay_rate_rules;
ALTER TABLE staff DROP COLUMN IF EXISTS date_of_birth;
ALTER TABLE homes DROP COLUMN IF EXISTS snap_window_minutes;
ALTER TABLE homes DROP COLUMN IF EXISTS snap_enabled;
ALTER TABLE homes DROP COLUMN IF EXISTS pay_frequency;
ALTER TABLE homes DROP COLUMN IF EXISTS pay_reference_date;
