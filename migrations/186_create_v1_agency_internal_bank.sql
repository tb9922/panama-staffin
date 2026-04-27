-- UP
-- V1 agency guard and internal-bank foundation.
-- Historical agency_shifts remain valid; new agency shifts can be linked to
-- agency_approval_attempts so managers prove overtime/internal-bank checks ran.

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS willing_extras BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS willing_other_homes BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_weekly_hours_topup NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS max_travel_radius_km INTEGER,
  ADD COLUMN IF NOT EXISTS home_postcode TEXT,
  ADD COLUMN IF NOT EXISTS internal_bank_status TEXT NOT NULL DEFAULT 'available'
    CHECK (internal_bank_status IN ('available','limited','paused','not_interested')),
  ADD COLUMN IF NOT EXISTS internal_bank_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_staff_internal_bank
  ON staff(home_id, role, internal_bank_status)
  WHERE deleted_at IS NULL AND active = true AND willing_extras = true;

CREATE TABLE IF NOT EXISTS agency_approval_attempts (
  id                              BIGSERIAL PRIMARY KEY,
  home_id                         INTEGER NOT NULL REFERENCES homes(id),
  gap_date                        DATE NOT NULL,
  shift_code                      VARCHAR(10) NOT NULL,
  role_needed                     VARCHAR(100),
  reason                          TEXT NOT NULL,
  overtime_offered                BOOLEAN NOT NULL DEFAULT false,
  overtime_accepted               BOOLEAN NOT NULL DEFAULT false,
  overtime_refused                BOOLEAN NOT NULL DEFAULT false,
  internal_bank_checked           BOOLEAN NOT NULL DEFAULT false,
  internal_bank_candidate_count   INTEGER NOT NULL DEFAULT 0,
  viable_internal_candidate_count INTEGER NOT NULL DEFAULT 0,
  emergency_override              BOOLEAN NOT NULL DEFAULT false,
  emergency_override_reason       TEXT,
  outcome                         TEXT NOT NULL DEFAULT 'pending'
    CHECK (outcome IN ('pending','internal_cover_found','no_viable_internal','emergency_agency','agency_used','agency_not_approved')),
  linked_agency_shift_id          INTEGER REFERENCES agency_shifts(id) ON DELETE SET NULL,
  checked_by                      INTEGER REFERENCES users(id),
  checked_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes                           TEXT,
  version                         INTEGER NOT NULL DEFAULT 1,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                      TIMESTAMPTZ,
  CONSTRAINT agency_attempt_emergency_reason_chk
    CHECK (emergency_override = false OR NULLIF(BTRIM(emergency_override_reason), '') IS NOT NULL),
  CONSTRAINT agency_attempt_counts_chk
    CHECK (internal_bank_candidate_count >= 0 AND viable_internal_candidate_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_agency_attempts_home_date
  ON agency_approval_attempts(home_id, gap_date DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_agency_attempts_override
  ON agency_approval_attempts(home_id, emergency_override, gap_date DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE agency_shifts
  ADD COLUMN IF NOT EXISTS agency_attempt_id BIGINT REFERENCES agency_approval_attempts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agency_shifts_attempt
  ON agency_shifts(home_id, agency_attempt_id)
  WHERE agency_attempt_id IS NOT NULL;

INSERT INTO retention_schedule (
  data_category, retention_period, retention_days, retention_basis,
  legal_basis, applies_to_table, special_category, notes
) VALUES (
  'Agency approval attempts',
  '7 years',
  2555,
  'CQC evidence, employment governance and regulated audit trail',
  NULL,
  'agency_approval_attempts',
  FALSE,
  'Evidence that overtime/internal-bank checks were completed before agency use.'
) ON CONFLICT (data_category) DO UPDATE SET
  retention_period = EXCLUDED.retention_period,
  retention_days = EXCLUDED.retention_days,
  retention_basis = EXCLUDED.retention_basis,
  legal_basis = EXCLUDED.legal_basis,
  applies_to_table = EXCLUDED.applies_to_table,
  special_category = EXCLUDED.special_category,
  notes = EXCLUDED.notes;

-- DOWN
ALTER TABLE agency_shifts DROP COLUMN IF EXISTS agency_attempt_id;
DROP TABLE IF EXISTS agency_approval_attempts;
DROP INDEX IF EXISTS idx_staff_internal_bank;
ALTER TABLE staff
  DROP COLUMN IF EXISTS internal_bank_notes,
  DROP COLUMN IF EXISTS internal_bank_status,
  DROP COLUMN IF EXISTS home_postcode,
  DROP COLUMN IF EXISTS max_travel_radius_km,
  DROP COLUMN IF EXISTS max_weekly_hours_topup,
  DROP COLUMN IF EXISTS willing_other_homes,
  DROP COLUMN IF EXISTS willing_extras;
