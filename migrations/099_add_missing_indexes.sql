-- Partial index on audit_log.action for common filtered queries
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log (action);

-- Index on beds.resident_id for resident-bed lookups and joins
CREATE INDEX IF NOT EXISTS idx_beds_resident_id ON beds (resident_id) WHERE resident_id IS NOT NULL;
