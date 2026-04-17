CREATE TABLE IF NOT EXISTS cqc_evidence_links (
  id                 SERIAL PRIMARY KEY,
  home_id            INTEGER      NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  source_module      VARCHAR(40)  NOT NULL,
  source_id          VARCHAR(50)  NOT NULL,
  quality_statement  VARCHAR(10)  NOT NULL
                   CHECK (quality_statement ~ '^(S[1-8]|E[1-6]|C[1-5]|R[1-7]|WL[1-8])$'),
  evidence_category  VARCHAR(40)  NOT NULL
                   CHECK (evidence_category IN (
                     'peoples_experience',
                     'staff_leader_feedback',
                     'partner_feedback',
                     'observation',
                     'processes',
                     'outcomes'
                   )),
  rationale          TEXT,
  auto_linked        BOOLEAN      NOT NULL DEFAULT FALSE,
  requires_review    BOOLEAN      NOT NULL DEFAULT FALSE,
  linked_by          VARCHAR(200) NOT NULL,
  source_recorded_at TIMESTAMPTZ,
  version            INTEGER      NOT NULL DEFAULT 1,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cqc_links_unique_active
  ON cqc_evidence_links(home_id, source_module, source_id, quality_statement, evidence_category)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cqc_links_statement
  ON cqc_evidence_links(home_id, quality_statement, source_recorded_at DESC, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cqc_links_category
  ON cqc_evidence_links(home_id, evidence_category, source_recorded_at DESC, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cqc_links_source
  ON cqc_evidence_links(home_id, source_module, source_id)
  WHERE deleted_at IS NULL;

INSERT INTO retention_schedule (
  data_category,
  retention_period,
  retention_days,
  retention_basis,
  applies_to_table,
  notes
)
VALUES (
  'CQC evidence links',
  '10 years',
  3650,
  'CQC Reg 17 - Good Governance',
  'cqc_evidence_links',
  'Cross-module evidence tagging linking operational records to CQC quality statements'
)
ON CONFLICT (data_category) DO NOTHING;
