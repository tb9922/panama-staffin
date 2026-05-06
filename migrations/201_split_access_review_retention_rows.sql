-- UP
-- Retention scanner/purge code matches one physical table per schedule row.

DELETE FROM retention_schedule
 WHERE data_category = 'Platform access reviews'
   AND applies_to_table = 'access_reviews, access_review_assignments';

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
    'Platform access reviews',
    '7 years',
    2555,
    'CQC Reg 17, GDPR Art 5(1)(f), UK GDPR accountability',
    'Legitimate interests and legal obligation',
    'access_reviews',
    FALSE,
    'Quarterly/monthly access review headers. Stores only account metadata; no passwords, tokens, or secrets.'
  ),
  (
    'Platform access review assignments',
    '7 years',
    2555,
    'CQC Reg 17, GDPR Art 5(1)(f), UK GDPR accountability',
    'Legitimate interests and legal obligation',
    'access_review_assignments',
    FALSE,
    'Access certification assignment snapshots and current decisions.'
  ),
  (
    'Platform access review decisions',
    '7 years',
    2555,
    'CQC Reg 17, GDPR Art 5(1)(f), UK GDPR accountability',
    'Legitimate interests and legal obligation',
    'access_review_decisions',
    FALSE,
    'Append-only certification decisions for platform and home-role access reviews.'
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
DELETE FROM retention_schedule
 WHERE data_category IN ('Platform access review assignments', 'Platform access review decisions');

UPDATE retention_schedule
   SET applies_to_table = 'access_reviews, access_review_assignments',
       notes = 'Quarterly/monthly role and access certification trail. Stores only account metadata and decisions; no passwords, tokens, or secrets.'
 WHERE data_category = 'Platform access reviews';
