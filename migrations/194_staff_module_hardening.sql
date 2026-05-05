BEGIN;

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE TABLE IF NOT EXISTS onboarding_orphan_records (
  id BIGSERIAL PRIMARY KEY,
  home_id INTEGER NOT NULL,
  staff_id VARCHAR(20) NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',
  original_updated_at TIMESTAMPTZ,
  original_deleted_at TIMESTAMPTZ,
  quarantine_reason TEXT NOT NULL DEFAULT 'missing_staff_fk',
  quarantined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS onboarding_orphan_records_unique
  ON onboarding_orphan_records (home_id, staff_id, quarantine_reason);

INSERT INTO onboarding_orphan_records (
  home_id,
  staff_id,
  data,
  original_updated_at,
  original_deleted_at,
  quarantine_reason
)
SELECT o.home_id,
       o.staff_id,
       o.data,
       o.updated_at,
       o.deleted_at,
       'missing_staff_fk'
  FROM onboarding o
 WHERE NOT EXISTS (
   SELECT 1
     FROM staff s
    WHERE s.home_id = o.home_id
      AND s.id = o.staff_id
 )
ON CONFLICT (home_id, staff_id, quarantine_reason) DO NOTHING;

DELETE FROM onboarding o
 WHERE NOT EXISTS (
   SELECT 1
     FROM staff s
    WHERE s.home_id = o.home_id
      AND s.id = o.staff_id
 );

ALTER TABLE onboarding
  DROP CONSTRAINT IF EXISTS onboarding_staff_home_fk;

ALTER TABLE onboarding
  ADD CONSTRAINT onboarding_staff_home_fk
  FOREIGN KEY (home_id, staff_id)
  REFERENCES staff(home_id, id)
  ON DELETE RESTRICT
  NOT VALID;

ALTER TABLE onboarding
  VALIDATE CONSTRAINT onboarding_staff_home_fk;

WITH duplicate_pending_al AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY home_id, staff_id, date
           ORDER BY submitted_at ASC, id ASC
         ) AS rn
    FROM override_requests
   WHERE request_type = 'AL'
     AND status = 'pending'
)
UPDATE override_requests r
   SET status = 'cancelled',
       decided_at = COALESCE(r.decided_at, NOW()),
       decision_note = CASE
         WHEN r.decision_note IS NULL OR r.decision_note = ''
           THEN 'Auto-cancelled duplicate pending AL during migration'
         ELSE r.decision_note || E'\nAuto-cancelled duplicate pending AL during migration'
       END,
       version = r.version + 1
  FROM duplicate_pending_al d
 WHERE r.id = d.id
   AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS override_requests_pending_al_unique
  ON override_requests (home_id, staff_id, date)
  WHERE request_type = 'AL' AND status = 'pending';

COMMIT;
