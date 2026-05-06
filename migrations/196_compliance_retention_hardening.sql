-- UP
-- Ensure compliance/GDPR artefacts are represented in the retention schedule.

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
  ('Complaint surveys', '10 years', 3650, 'CQC Reg 16 and Reg 17', NULL, 'complaint_surveys', FALSE, 'Survey evidence and improvement actions linked to complaints governance.'),
  ('Resident MCA assessments', '8 years after discharge', 2920, 'MCA 2005 and CQC Reg 11', 'Special category', 'mca_assessments', TRUE, 'Mental-capacity assessment records.'),
  ('CQC evidence files', '10 years', 3650, 'CQC Reg 17 - Good Governance', NULL, 'cqc_evidence_files', FALSE, 'Files uploaded against CQC evidence records.'),
  ('CQC statement narratives', '10 years', 3650, 'CQC Reg 17 - Good Governance', NULL, 'cqc_statement_narratives', FALSE, 'Self-assessment narrative, risks and actions by quality statement.'),
  ('Training file attachments', '6 years after leaving', 2190, 'CQC Reg 18, H&S Act 1974', NULL, 'training_file_attachments', FALSE, 'Training evidence uploads and certificates.'),
  ('Record file attachments', '10 years', 3650, 'CQC Reg 17 - Good Governance', NULL, 'record_file_attachments', FALSE, 'Operational evidence attachments linked to regulated records.'),
  ('ROPA activities', '7 years', 2555, 'UK GDPR Art 30 accountability', 'UK GDPR', 'ropa_activities', FALSE, 'Records of processing activities.'),
  ('DPIA assessments', '7 years', 2555, 'UK GDPR Art 35 accountability', 'UK GDPR', 'dpia_assessments', FALSE, 'Data protection impact assessments.'),
  ('GDPR data requests', '7 years', 2555, 'UK GDPR Art 12-15 accountability', 'UK GDPR', 'data_requests', FALSE, 'SAR/rights request handling evidence.'),
  ('GDPR data breaches', '7 years', 2555, 'UK GDPR Art 33 accountability', 'UK GDPR', 'data_breaches', TRUE, 'Personal data breach records and notifications.'),
  ('Data protection complaints', '7 years', 2555, 'UK GDPR accountability', 'UK GDPR', 'dp_complaints', TRUE, 'Data protection complaint records.'),
  ('GDPR processors', '7 years after contract end', 2555, 'UK GDPR Art 28 accountability', 'UK GDPR', 'processors', FALSE, 'Processor due diligence and contract records.'),
  ('Consent records', '7 years after withdrawal or end of processing', 2555, 'UK GDPR consent accountability', 'UK GDPR', 'consent_records', TRUE, 'Consent evidence and withdrawal history.'),
  ('Sick periods', '6 years after leaving', 2190, 'Limitation Act 1980 s.11', 'Special category', 'sick_periods', TRUE, 'Sickness and SSP records using the current sick_periods table.')
ON CONFLICT (data_category) DO UPDATE SET
  retention_period = EXCLUDED.retention_period,
  retention_days = EXCLUDED.retention_days,
  retention_basis = EXCLUDED.retention_basis,
  legal_basis = EXCLUDED.legal_basis,
  applies_to_table = EXCLUDED.applies_to_table,
  special_category = EXCLUDED.special_category,
  notes = EXCLUDED.notes;
