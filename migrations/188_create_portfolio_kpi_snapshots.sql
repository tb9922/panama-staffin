-- UP
-- Daily/weekly portfolio KPI snapshots for historical portfolio reporting.

CREATE TABLE IF NOT EXISTS portfolio_kpi_snapshots (
  id                  BIGSERIAL PRIMARY KEY,
  home_id             INTEGER NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  period_date         DATE NOT NULL,
  period_granularity  TEXT NOT NULL
    CHECK (period_granularity IN ('daily', 'weekly')),
  rag                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  kpis                JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(home_id, period_date, period_granularity)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_kpi_snapshots_home_period
  ON portfolio_kpi_snapshots(home_id, period_granularity, period_date DESC);

CREATE INDEX IF NOT EXISTS idx_portfolio_kpi_snapshots_period
  ON portfolio_kpi_snapshots(period_granularity, period_date DESC);

INSERT INTO retention_schedule (
  data_category, retention_period, retention_days, retention_basis,
  legal_basis, applies_to_table, special_category, notes
) VALUES (
  'Portfolio KPI snapshots',
  '7 years',
  2555,
  'CQC Reg 17, GDPR Art 5(1)(e)',
  NULL,
  'portfolio_kpi_snapshots',
  FALSE,
  'Daily and weekly aggregate portfolio KPI/RAG snapshots for governance history.'
)
ON CONFLICT (data_category) DO UPDATE SET
  retention_period = EXCLUDED.retention_period,
  retention_days = EXCLUDED.retention_days,
  retention_basis = EXCLUDED.retention_basis,
  legal_basis = EXCLUDED.legal_basis,
  applies_to_table = EXCLUDED.applies_to_table,
  special_category = EXCLUDED.special_category,
  notes = EXCLUDED.notes;

-- DOWN
DROP TABLE IF EXISTS portfolio_kpi_snapshots;
