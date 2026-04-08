ALTER TABLE record_file_attachments
  DROP CONSTRAINT IF EXISTS record_file_attachments_module_check;

ALTER TABLE record_file_attachments
  ADD CONSTRAINT record_file_attachments_module_check
  CHECK (
    module IN (
      'incident',
      'complaint',
      'ipc_audit',
      'maintenance',
      'policy_review',
      'risk',
      'whistleblowing',
      'dols',
      'mca_assessment'
    )
  );

UPDATE retention_schedule
   SET notes = 'Incident, complaint, IPC, maintenance, policy, risk, whistleblowing, and DoLS/MCA supporting documents'
 WHERE data_category = 'Operational evidence attachments'
   AND applies_to_table = 'record_file_attachments';
