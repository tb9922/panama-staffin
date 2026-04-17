BEGIN;

CREATE TABLE override_requests (
  id              SERIAL PRIMARY KEY,
  home_id         INTEGER NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  staff_id        VARCHAR(20) NOT NULL,
  request_type    VARCHAR(20) NOT NULL CHECK (request_type IN ('AL', 'SICK', 'OTHER')),
  date            DATE NOT NULL,
  requested_shift VARCHAR(10),
  al_hours        NUMERIC(5,2),
  swap_with_staff VARCHAR(20),
  reason          TEXT,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_by      VARCHAR(100),
  decided_at      TIMESTAMPTZ,
  decision_note   TEXT,
  version         INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (home_id, staff_id) REFERENCES staff(home_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_override_requests_home_status
  ON override_requests (home_id, status, submitted_at DESC);

CREATE INDEX idx_override_requests_staff
  ON override_requests (home_id, staff_id, submitted_at DESC);

COMMIT;
