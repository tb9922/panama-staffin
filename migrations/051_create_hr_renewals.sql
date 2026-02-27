-- UP
-- HR RTW & DBS renewals — ongoing compliance tracking beyond initial onboarding.
-- Uses check_type discriminator (dbs/rtw) to share one table.
-- CQC best practice: DBS renewal every 3 years, RTW re-check before document expiry.

CREATE TABLE IF NOT EXISTS hr_rtw_dbs_renewals (
  id                        SERIAL PRIMARY KEY,
  home_id                   INTEGER        NOT NULL REFERENCES homes(id),
  staff_id                  VARCHAR(20)    NOT NULL,

  check_type                VARCHAR(10)    NOT NULL
    CHECK (check_type IN ('dbs','rtw')),

  -- DBS fields
  dbs_certificate_number    VARCHAR(50),
  dbs_disclosure_level      VARCHAR(20)
    CHECK (dbs_disclosure_level IN ('enhanced','enhanced_barred','standard')),
  dbs_check_date            DATE,
  dbs_next_renewal_due      DATE,
  dbs_update_service_registered BOOLEAN    DEFAULT false,
  dbs_update_service_last_checked DATE,
  dbs_barred_list_check     BOOLEAN        DEFAULT true,

  -- RTW fields
  rtw_document_type         VARCHAR(30)
    CHECK (rtw_document_type IN ('passport','brp','share_code','settled_status','pre_settled')),
  rtw_check_date            DATE,
  rtw_document_expiry       DATE,
  rtw_next_check_due        DATE,

  -- Common
  status                    VARCHAR(20)    NOT NULL DEFAULT 'current'
    CHECK (status IN ('current','due_soon','overdue','pending','expired')),
  checked_by                VARCHAR(200),
  notes                     TEXT,
  created_at                TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  deleted_at                TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hr_renewals_home_staff
  ON hr_rtw_dbs_renewals(home_id, staff_id, check_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hr_renewals_due
  ON hr_rtw_dbs_renewals(home_id, status) WHERE status IN ('due_soon','overdue','expired') AND deleted_at IS NULL;

-- DOWN
DROP TABLE IF EXISTS hr_rtw_dbs_renewals;
