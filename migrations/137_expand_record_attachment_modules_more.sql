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
      'bed',
      'budget_month',
      'handover_entry',
      'payroll_run',
      'schedule_override',
      'investigation_meeting',
      'supervision',
      'appraisal',
      'fire_drill',
      'policy_review',
      'risk',
      'whistleblowing',
      'dols',
      'mca_assessment',
      'dpia',
      'ropa',
      'finance_expense',
      'finance_resident',
      'finance_invoice',
      'finance_payment_schedule',
      'payroll_rate_rule',
      'payroll_timesheet',
      'payroll_tax_code',
      'payroll_pension',
      'payroll_sick_period',
      'agency_provider',
      'agency_shift',
      'care_certificate',
      'staff_register'
    )
  );

UPDATE retention_schedule
   SET notes = 'Incident, complaint, IPC, maintenance, bed, budget, payroll run, schedule override, investigation meeting, handover, supervision, appraisal, fire drill, policy, risk, whistleblowing, DoLS/MCA, GDPR, finance, payroll, agency, care certificate, and staff register supporting documents'
 WHERE data_category = 'Operational evidence attachments'
   AND applies_to_table = 'record_file_attachments';
