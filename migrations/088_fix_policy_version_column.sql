-- UP
-- policy_reviews has a domain `version VARCHAR(20)` (policy document version)
-- that collides with the optimistic-locking `version INTEGER` pattern.
-- Migration 081 tried ADD COLUMN IF NOT EXISTS version INTEGER but was a no-op.
-- Fix: rename the domain column to doc_version, then add the integer version.

ALTER TABLE policy_reviews RENAME COLUMN version TO doc_version;
ALTER TABLE policy_reviews ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

-- DOWN
-- ALTER TABLE policy_reviews DROP COLUMN IF EXISTS version;
-- ALTER TABLE policy_reviews RENAME COLUMN doc_version TO version;
