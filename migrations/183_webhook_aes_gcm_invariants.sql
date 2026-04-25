-- P0-M4 — Enforce AES-256-GCM cryptographic invariants on webhook secret columns.
--
-- Background: migration 100 added secret_encrypted, secret_iv, secret_tag with
-- DEFAULT E'\\x00'::bytea (1 byte). This was a placeholder so the ALTER TABLE
-- could add the columns without violating NOT NULL on existing rows; the real
-- values are written by encrypt() at write time (12-byte IV, 16-byte GCM tag)
-- and the backfill script (scripts/encrypt-webhook-secrets.js) populates legacy
-- rows.
--
-- The risk: if anyone INSERTs a row directly via SQL or a buggy code path sets
-- secret_encrypted without also setting a proper IV, the default 1-byte IV
-- would be used. decrypt() would then crash at signing time with a misleading
-- "Invalid IV length" error and the webhook would silently never deliver.
--
-- This migration:
--   1. Repairs any latent bad rows (secret_encrypted set but IV/tag length
--      wrong) by NULLing secret_encrypted, forcing the resolveSecret path to
--      fall back to plaintext (or to fail loudly at the next encrypted-write).
--   2. Adds CHECK constraints that PHYSICALLY PREVENT future rows with bad
--      lengths from being inserted. Catches the bug at INSERT time, not at
--      decrypt time hours later when a real event fires.
--
-- AES-256-GCM standard:
--   - IV (nonce):  12 bytes  (96 bits, the GCM standard for performance)
--   - Auth tag:    16 bytes  (128 bits)

-- Step 1: Repair existing bad rows on the webhooks table.
UPDATE webhooks
   SET secret_encrypted = NULL,
       secret_iv = E'\\x00'::bytea,
       secret_tag = E'\\x00'::bytea
 WHERE secret_encrypted IS NOT NULL
   AND (LENGTH(secret_iv) <> 12 OR LENGTH(secret_tag) <> 16);

-- Step 2: Repair existing bad rows on webhook_deliveries (signing_secret_*
-- columns added by migration 176). These tables can have null encrypted-secret
-- columns legitimately (pre-176 deliveries), so only check when set.
UPDATE webhook_deliveries
   SET signing_secret_encrypted = NULL,
       signing_secret_iv = NULL,
       signing_secret_tag = NULL
 WHERE signing_secret_encrypted IS NOT NULL
   AND (LENGTH(signing_secret_iv) <> 12 OR LENGTH(signing_secret_tag) <> 16);

-- Step 3: Add CHECK constraints to prevent future drift.
-- Defensive form: only enforce length when secret_encrypted is non-null, so
-- the migration-100 default of 1 byte on rows where secret_encrypted=NULL is
-- still tolerated (it's a placeholder for the not-yet-encrypted case).
ALTER TABLE webhooks
  DROP CONSTRAINT IF EXISTS webhooks_secret_iv_length_check;
ALTER TABLE webhooks
  ADD CONSTRAINT webhooks_secret_iv_length_check
  CHECK (secret_encrypted IS NULL OR LENGTH(secret_iv) = 12);

ALTER TABLE webhooks
  DROP CONSTRAINT IF EXISTS webhooks_secret_tag_length_check;
ALTER TABLE webhooks
  ADD CONSTRAINT webhooks_secret_tag_length_check
  CHECK (secret_encrypted IS NULL OR LENGTH(secret_tag) = 16);

-- Same constraints on webhook_deliveries.signing_secret_*
ALTER TABLE webhook_deliveries
  DROP CONSTRAINT IF EXISTS webhook_deliveries_signing_iv_length_check;
ALTER TABLE webhook_deliveries
  ADD CONSTRAINT webhook_deliveries_signing_iv_length_check
  CHECK (signing_secret_encrypted IS NULL OR LENGTH(signing_secret_iv) = 12);

ALTER TABLE webhook_deliveries
  DROP CONSTRAINT IF EXISTS webhook_deliveries_signing_tag_length_check;
ALTER TABLE webhook_deliveries
  ADD CONSTRAINT webhook_deliveries_signing_tag_length_check
  CHECK (signing_secret_encrypted IS NULL OR LENGTH(signing_secret_tag) = 16);

-- Step 4: For new webhook rows added going forward, drop the bad 1-byte
-- default. NULL is the correct "no encrypted value yet" placeholder.
ALTER TABLE webhooks ALTER COLUMN secret_iv DROP DEFAULT;
ALTER TABLE webhooks ALTER COLUMN secret_iv DROP NOT NULL;
ALTER TABLE webhooks ALTER COLUMN secret_tag DROP DEFAULT;
ALTER TABLE webhooks ALTER COLUMN secret_tag DROP NOT NULL;
