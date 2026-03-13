-- access_log should never block home deletion — logs are append-only audit data.
-- Change FK from RESTRICT (default) to SET NULL so soft-deleted homes don't leave orphan blocks.
ALTER TABLE access_log
  DROP CONSTRAINT IF EXISTS access_log_home_id_fkey,
  ADD CONSTRAINT access_log_home_id_fkey
    FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE SET NULL;
