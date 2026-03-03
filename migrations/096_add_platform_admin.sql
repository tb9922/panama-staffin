-- Platform admin flag (orthogonal to admin/viewer role)
ALTER TABLE users ADD COLUMN is_platform_admin BOOLEAN NOT NULL DEFAULT false;

-- Seed: existing 'admin' user becomes platform admin
UPDATE users SET is_platform_admin = true WHERE username = 'admin';

-- Soft-delete on homes (preserves child data for audit/GDPR)
ALTER TABLE homes ADD COLUMN deleted_at TIMESTAMPTZ;

-- Slug uniqueness must exclude soft-deleted homes so slugs can be reused.
-- Replace the full UNIQUE constraint with a partial index on active homes only.
ALTER TABLE homes DROP CONSTRAINT homes_slug_key;
CREATE UNIQUE INDEX homes_slug_active ON homes(slug) WHERE deleted_at IS NULL;
