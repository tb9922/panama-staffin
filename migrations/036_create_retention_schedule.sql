CREATE TABLE IF NOT EXISTS retention_schedule (
  id               SERIAL PRIMARY KEY,
  data_category    VARCHAR(100) NOT NULL UNIQUE,
  retention_period VARCHAR(100) NOT NULL,
  retention_days   INTEGER NOT NULL,
  retention_basis  VARCHAR(200) NOT NULL,
  legal_basis      VARCHAR(200),
  applies_to_table VARCHAR(100),
  special_category BOOLEAN NOT NULL DEFAULT FALSE,
  notes            TEXT
);

-- Seed with UK care home retention rules
INSERT INTO retention_schedule (data_category, retention_period, retention_days, retention_basis, legal_basis, applies_to_table, special_category, notes) VALUES
  ('Staff employment',   '6 years after leaving',    2190, 'Limitation Act 1980 s.5',             NULL,                    'staff',              FALSE, NULL),
  ('Staff health/sick',  '6 years after leaving',    2190, 'Limitation Act 1980 s.11',            'Special category',      'ssp_periods',        TRUE,  NULL),
  ('Training records',   '6 years after leaving',    2190, 'CQC Reg 18, H&S Act 1974',           NULL,                    'training',           FALSE, NULL),
  ('DBS certificates',   '6 months after check',      183, 'DBS Code of Practice 2020',           'Must destroy',          'onboarding',         TRUE,  NULL),
  ('Payroll/tax',        '6 years after tax year',   2190, 'PAYE Regulations 2003',               'HMRC requirement',      'payroll_runs',       FALSE, NULL),
  ('Pension',            '6 years after benefit',    2190, 'Pension Schemes Act 1993',            NULL,                    'pension_enrolments', FALSE, NULL),
  ('Incidents',          '10 years (clinical)',       3650, 'CQC Reg 17, Limitation Act',         'Special category',      'incidents',          TRUE,  NULL),
  ('Complaints',         '10 years',                 3650, 'CQC Reg 16, Limitation Act',         NULL,                    'complaints',         FALSE, NULL),
  ('Resident DoLS/MCA',  '8 years after discharge',  2920, 'MCA 2005, CQC Reg 11',               'Special category',      'dols',               TRUE,  NULL),
  ('Audit log',          '7 years',                  2555, 'CQC Reg 17, GDPR Art 5(1)(e)',       NULL,                    'audit_log',          FALSE, NULL),
  ('Access log',         '2 years',                   730, 'GDPR Art 5(1)(f)',                    NULL,                    'access_log',         FALSE, NULL),
  ('Risk register',      '6 years',                  2190, 'CQC Reg 17',                         NULL,                    'risk_register',      FALSE, NULL),
  ('Whistleblowing',     '6 years',                  2190, 'PIDA 1998',                           'May be special category','whistleblowing_concerns', FALSE, NULL),
  ('Maintenance',        '6 years',                  2190, 'H&S Act 1974',                        NULL,                    'maintenance',        FALSE, NULL)
ON CONFLICT (data_category) DO NOTHING;
