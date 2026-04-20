-- Preserve retry signing secrets at dispatch time and cascade-delete webhooks
-- with their home. This prevents secret rotation from breaking pending retries
-- and avoids orphaned webhooks when a home is deleted.

ALTER TABLE webhook_deliveries
  ADD COLUMN IF NOT EXISTS signing_secret_encrypted BYTEA,
  ADD COLUMN IF NOT EXISTS signing_secret_iv BYTEA,
  ADD COLUMN IF NOT EXISTS signing_secret_tag BYTEA;

DO $$
DECLARE
  fk_name text;
BEGIN
  SELECT c.conname
    INTO fk_name
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = ANY(c.conkey)
   WHERE c.conrelid = 'webhooks'::regclass
     AND c.contype = 'f'
     AND a.attname = 'home_id'
   LIMIT 1;

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE webhooks DROP CONSTRAINT %I', fk_name);
  END IF;

  ALTER TABLE webhooks
    ADD CONSTRAINT webhooks_home_id_fkey
    FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE;
END $$;
