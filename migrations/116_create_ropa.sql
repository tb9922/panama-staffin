-- UP
-- Record of Processing Activities (ROPA) — Article 30 UK GDPR.
-- Each row is one processing activity documented by the care home.

CREATE TABLE IF NOT EXISTS ropa_activities (
  id                     SERIAL       PRIMARY KEY,
  home_id                INTEGER      NOT NULL REFERENCES homes(id) ON DELETE CASCADE,

  -- Article 30(1) required fields
  purpose                VARCHAR(500) NOT NULL,
  legal_basis            VARCHAR(50)  NOT NULL
                         CHECK (legal_basis IN ('consent','contract','legal_obligation','vital_interests','public_task','legitimate_interests')),
  categories_of_individuals VARCHAR(500) NOT NULL,
  categories_of_data     VARCHAR(500) NOT NULL,
  categories_of_recipients VARCHAR(500),
  international_transfers BOOLEAN NOT NULL DEFAULT false,
  transfer_safeguards    TEXT,

  -- Article 30(1) best-effort fields
  retention_period       VARCHAR(200),
  security_measures      TEXT,

  -- Care home operational fields
  data_source            VARCHAR(200),
  system_or_asset        VARCHAR(200),
  special_category       BOOLEAN NOT NULL DEFAULT false,
  dpia_required          BOOLEAN NOT NULL DEFAULT false,
  status                 VARCHAR(20) NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','under_review','archived')),
  last_reviewed          DATE,
  next_review_due        DATE,
  notes                  TEXT,

  -- Standard metadata
  version                INTEGER      NOT NULL DEFAULT 1,
  created_by             VARCHAR(100) NOT NULL,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ropa_home_status
  ON ropa_activities(home_id, status) WHERE deleted_at IS NULL;

-- DOWN
DROP TABLE IF EXISTS ropa_activities;
