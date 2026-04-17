BEGIN;

-- Speeds up the AL conflict-detection query in services/overrideRequestService.js
-- (`existing.some(...item.status === 'pending' && item.requestType === 'AL' && item.date === date)`)
-- and the per-staff request history query for the staff portal. Without this index,
-- both queries fall back to the (home_id, staff_id, submitted_at) index which
-- doesn't help filter by status/date.
CREATE INDEX IF NOT EXISTS idx_override_requests_staff_status_date
  ON override_requests (home_id, staff_id, status, date);

COMMIT;
