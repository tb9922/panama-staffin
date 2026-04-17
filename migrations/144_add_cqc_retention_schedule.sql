INSERT INTO retention_schedule (
  data_category,
  retention_period,
  retention_days,
  retention_basis,
  legal_basis,
  applies_to_table,
  special_category,
  notes
)
VALUES
  (
    'CQC evidence',
    '10 years',
    3650,
    'CQC Reg 17 — Good Governance',
    NULL,
    'cqc_evidence',
    FALSE,
    'Manual CQC evidence items, including evidence owner and review metadata.'
  ),
  (
    'CQC partner feedback',
    '10 years',
    3650,
    'CQC Reg 17 — Good Governance',
    NULL,
    'cqc_partner_feedback',
    FALSE,
    'Structured partner/family/professional feedback used in self-assessment.'
  ),
  (
    'CQC observations',
    '10 years',
    3650,
    'CQC Reg 17 — Good Governance',
    NULL,
    'cqc_observations',
    FALSE,
    'Structured observation records used in self-assessment.'
  )
ON CONFLICT (data_category) DO NOTHING;
