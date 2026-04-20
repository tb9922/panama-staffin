-- UP
-- Processor register / DPA tracker.
-- Mirrors the way enterprise platforms keep a living log of processors,
-- contracts, transfer posture, and review dates under GDPR accountability.

CREATE TABLE IF NOT EXISTS gdpr_processors (
  id                      SERIAL PRIMARY KEY,
  home_id                 INTEGER      NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  provider_name           VARCHAR(300) NOT NULL,
  provider_role           VARCHAR(20)  NOT NULL
                          CHECK (provider_role IN ('processor', 'sub_processor')),
  services                TEXT,
  categories_of_data      VARCHAR(500) NOT NULL,
  categories_of_subjects  VARCHAR(500) NOT NULL,
  countries               VARCHAR(500),
  international_transfers BOOLEAN      NOT NULL DEFAULT false,
  dpa_status              VARCHAR(20)  NOT NULL DEFAULT 'requested'
                          CHECK (dpa_status IN ('draft', 'requested', 'signed', 'not_required', 'expired')),
  contract_owner          VARCHAR(100),
  signed_date             DATE,
  review_due              DATE,
  notes                   TEXT,
  version                 INTEGER      NOT NULL DEFAULT 1,
  created_by              VARCHAR(100) NOT NULL,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at              TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_gdpr_processors_home_status
  ON gdpr_processors(home_id, dpa_status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_gdpr_processors_review_due
  ON gdpr_processors(home_id, review_due)
  WHERE deleted_at IS NULL AND review_due IS NOT NULL;

-- DOWN
DROP TABLE IF EXISTS gdpr_processors;
