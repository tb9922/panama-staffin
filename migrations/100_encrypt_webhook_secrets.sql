-- Encryption at rest for webhook secrets (AES-256-GCM).
-- After running this migration, run: node scripts/encrypt-webhook-secrets.js
-- to backfill existing plaintext secrets into the encrypted columns.

ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS secret_encrypted BYTEA;
ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS secret_iv BYTEA NOT NULL DEFAULT E'\\x00'::bytea;
ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS secret_tag BYTEA NOT NULL DEFAULT E'\\x00'::bytea;

-- Allow plaintext secret column to be NULL (will be NULLed after encryption backfill)
ALTER TABLE webhooks ALTER COLUMN secret DROP NOT NULL;
