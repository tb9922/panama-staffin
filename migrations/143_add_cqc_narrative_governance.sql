ALTER TABLE cqc_statement_narratives
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_cqc_statement_narratives_home_active
  ON cqc_statement_narratives(home_id)
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
  'CQC self-assessment narratives',
  '10 years',
  3650,
  'CQC Reg 17 - Good Governance',
  'cqc_statement_narratives',
  'Narrative interpretation and reviewer accountability for CQC quality statements'
)
ON CONFLICT (data_category) DO NOTHING;
