-- UP
-- Panama V1 operating-system accountability layer.
-- action_items becomes the canonical query surface for accountable manager actions.
-- Legacy module fields stay readable during transition and are backfilled here.

CREATE TABLE IF NOT EXISTS action_items (
  id                 BIGSERIAL PRIMARY KEY,
  home_id            INTEGER      NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  source_type        TEXT         NOT NULL,
  source_id          TEXT,
  source_action_key  TEXT,
  title              TEXT         NOT NULL,
  description        TEXT,
  category           TEXT         NOT NULL DEFAULT 'operational'
    CHECK (category IN (
      'safeguarding', 'clinical', 'environmental', 'hr', 'governance',
      'compliance', 'staffing', 'finance', 'operational'
    )),
  priority           TEXT         NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  owner_user_id      INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  owner_name         TEXT,
  owner_role         TEXT,
  due_date           DATE         NOT NULL,
  status             TEXT         NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'blocked', 'completed', 'verified', 'cancelled')),
  evidence_required  BOOLEAN      NOT NULL DEFAULT false,
  evidence_notes     TEXT,
  escalation_level   INTEGER      NOT NULL DEFAULT 0 CHECK (escalation_level BETWEEN 0 AND 4),
  escalated_at       TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  completed_by       INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  verified_at        TIMESTAMPTZ,
  verified_by        INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  created_by         INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  updated_by         INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  version            INTEGER      NOT NULL DEFAULT 1,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ,
  CHECK (
    source_type IN (
      'standalone', 'incident', 'ipc_audit', 'risk', 'complaint',
      'complaint_survey', 'maintenance', 'fire_drill', 'supervision',
      'appraisal', 'hr_grievance', 'cqc_observation', 'cqc_narrative',
      'reflective_practice'
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_action_items_source_unique
  ON action_items(home_id, source_type, source_id, source_action_key)
  WHERE deleted_at IS NULL AND source_id IS NOT NULL AND source_action_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_action_items_home_status
  ON action_items(home_id, status, due_date)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_action_items_owner_status
  ON action_items(owner_user_id, status, due_date)
  WHERE deleted_at IS NULL AND owner_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_action_items_escalation
  ON action_items(home_id, escalation_level, due_date)
  WHERE deleted_at IS NULL AND status NOT IN ('completed', 'verified', 'cancelled');

CREATE TABLE IF NOT EXISTS reflective_practice (
  id                 BIGSERIAL PRIMARY KEY,
  home_id            INTEGER      NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  staff_id           VARCHAR(20),
  practice_date      DATE         NOT NULL,
  facilitator        TEXT,
  category           TEXT         NOT NULL DEFAULT 'reflective_practice',
  topic              TEXT         NOT NULL,
  reflection         TEXT,
  learning_outcome   TEXT,
  wellbeing_notes    TEXT,
  action_summary     TEXT,
  created_by         INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  updated_by         INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  version            INTEGER      NOT NULL DEFAULT 1,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reflective_practice_home_date
  ON reflective_practice(home_id, practice_date DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_reflective_practice_staff_date
  ON reflective_practice(home_id, staff_id, practice_date DESC)
  WHERE deleted_at IS NULL AND staff_id IS NOT NULL;

INSERT INTO retention_schedule (
  data_category,
  retention_period,
  retention_days,
  retention_basis,
  legal_basis,
  applies_to_table,
  special_category,
  notes
) VALUES
  (
    'Manager action items',
    '7 years',
    2555,
    'CQC Reg 17, GDPR Art 5(1)(e)',
    NULL,
    'action_items',
    FALSE,
    'Panama V1 accountable action trail; purged only after soft delete and retention expiry.'
  ),
  (
    'Reflective practice',
    '7 years',
    2555,
    'CQC Reg 17/18, GDPR Art 5(1)(e)',
    'May contain special category data',
    'reflective_practice',
    TRUE,
    'Panama V1 staff governance and learning evidence; purged only after soft delete and retention expiry.'
  )
ON CONFLICT (data_category) DO UPDATE SET
  retention_period = EXCLUDED.retention_period,
  retention_days = EXCLUDED.retention_days,
  retention_basis = EXCLUDED.retention_basis,
  legal_basis = EXCLUDED.legal_basis,
  applies_to_table = EXCLUDED.applies_to_table,
  special_category = EXCLUDED.special_category,
  notes = EXCLUDED.notes;

-- Incident JSON corrective actions
INSERT INTO action_items (
  home_id, source_type, source_id, source_action_key, title, description,
  category, priority, owner_name, due_date, status, completed_at, created_at, updated_at
)
SELECT
  i.home_id,
  'incident',
  i.id::text,
  'legacy:' || (ca.ordinality - 1)::text || ':' || md5(concat_ws('|',
    ca.action->>'description',
    ca.action->>'assigned_to',
    ca.action->>'due_date',
    ca.action->>'status'
  )),
  left(coalesce(nullif(ca.action->>'description', ''), 'Incident corrective action'), 300),
  nullif(ca.action->>'description', ''),
  CASE
    WHEN i.safeguarding_referral THEN 'safeguarding'
    WHEN i.cqc_notifiable OR i.riddor_reportable THEN 'compliance'
    ELSE 'clinical'
  END,
  CASE
    WHEN i.safeguarding_referral
      OR lower(coalesce(i.severity, '')) IN ('catastrophic', 'severe', 'serious')
      OR (i.riddor_reportable AND lower(coalesce(i.riddor_category, '')) IN ('death', 'specified_injury'))
      THEN 'critical'
    WHEN i.cqc_notifiable OR i.riddor_reportable OR i.duty_of_candour_applies OR i.hospital_attendance THEN 'high'
    ELSE 'medium'
  END,
  nullif(ca.action->>'assigned_to', ''),
  coalesce(
    CASE WHEN (ca.action->>'due_date') ~ '^\d{4}-\d{2}-\d{2}$' THEN (ca.action->>'due_date')::date END,
    i.investigation_review_date,
    i.date + INTERVAL '28 days',
    CURRENT_DATE + INTERVAL '28 days'
  )::date,
  CASE ca.action->>'status'
    WHEN 'completed' THEN 'completed'
    WHEN 'cancelled' THEN 'cancelled'
    WHEN 'in_progress' THEN 'in_progress'
    ELSE 'open'
  END,
  CASE WHEN (ca.action->>'completed_date') ~ '^\d{4}-\d{2}-\d{2}$' THEN (ca.action->>'completed_date')::date::timestamptz END,
  coalesce(i.created_at, NOW()),
  coalesce(i.updated_at, NOW())
FROM incidents i
CROSS JOIN LATERAL jsonb_array_elements(i.corrective_actions) WITH ORDINALITY AS ca(action, ordinality)
WHERE i.deleted_at IS NULL
  AND jsonb_typeof(i.corrective_actions) = 'array'
  AND nullif(ca.action->>'description', '') IS NOT NULL
ON CONFLICT DO NOTHING;

-- IPC JSON corrective actions
INSERT INTO action_items (
  home_id, source_type, source_id, source_action_key, title, description,
  category, priority, owner_name, due_date, status, completed_at, created_at, updated_at
)
SELECT
  a.home_id,
  'ipc_audit',
  a.id::text,
  'legacy:' || (ca.ordinality - 1)::text || ':' || md5(concat_ws('|',
    ca.action->>'description',
    ca.action->>'assigned_to',
    ca.action->>'due_date',
    ca.action->>'status'
  )),
  left(coalesce(nullif(ca.action->>'description', ''), 'IPC corrective action'), 300),
  nullif(ca.action->>'description', ''),
  'clinical',
  CASE
    WHEN a.outbreak->>'status' = 'confirmed' THEN 'critical'
    WHEN a.outbreak->>'status' = 'suspected' OR coalesce(a.compliance_pct, a.overall_score, 100) < 80 THEN 'high'
    ELSE 'medium'
  END,
  nullif(ca.action->>'assigned_to', ''),
  coalesce(
    CASE WHEN (ca.action->>'due_date') ~ '^\d{4}-\d{2}-\d{2}$' THEN (ca.action->>'due_date')::date END,
    a.audit_date + INTERVAL '28 days',
    CURRENT_DATE + INTERVAL '28 days'
  )::date,
  CASE ca.action->>'status'
    WHEN 'completed' THEN 'completed'
    WHEN 'cancelled' THEN 'cancelled'
    WHEN 'in_progress' THEN 'in_progress'
    ELSE 'open'
  END,
  CASE WHEN (ca.action->>'completed_date') ~ '^\d{4}-\d{2}-\d{2}$' THEN (ca.action->>'completed_date')::date::timestamptz END,
  coalesce(a.created_at, NOW()),
  coalesce(a.updated_at, NOW())
FROM ipc_audits a
CROSS JOIN LATERAL jsonb_array_elements(a.corrective_actions) WITH ORDINALITY AS ca(action, ordinality)
WHERE a.deleted_at IS NULL
  AND jsonb_typeof(a.corrective_actions) = 'array'
  AND nullif(ca.action->>'description', '') IS NOT NULL
ON CONFLICT DO NOTHING;

-- Risk JSON actions
INSERT INTO action_items (
  home_id, source_type, source_id, source_action_key, title, description,
  category, priority, owner_name, due_date, status, completed_at, created_at, updated_at
)
SELECT
  r.home_id,
  'risk',
  r.id::text,
  'legacy:' || (ra.ordinality - 1)::text || ':' || md5(concat_ws('|',
    ra.action->>'description',
    ra.action->>'owner',
    ra.action->>'due_date',
    ra.action->>'status'
  )),
  left(coalesce(nullif(ra.action->>'description', ''), 'Risk action'), 300),
  nullif(ra.action->>'description', ''),
  CASE lower(coalesce(r.category, ''))
    WHEN 'staffing' THEN 'staffing'
    WHEN 'financial' THEN 'finance'
    WHEN 'clinical' THEN 'clinical'
    WHEN 'compliance' THEN 'compliance'
    WHEN 'operational' THEN 'operational'
    ELSE 'governance'
  END,
  CASE
    WHEN coalesce(r.residual_risk, r.inherent_risk, 0) >= 16 THEN 'critical'
    WHEN coalesce(r.residual_risk, r.inherent_risk, 0) >= 9 THEN 'high'
    ELSE 'medium'
  END,
  coalesce(nullif(ra.action->>'owner', ''), nullif(r.owner, '')),
  coalesce(
    CASE WHEN (ra.action->>'due_date') ~ '^\d{4}-\d{2}-\d{2}$' THEN (ra.action->>'due_date')::date END,
    r.next_review,
    CURRENT_DATE + INTERVAL '28 days'
  )::date,
  CASE ra.action->>'status'
    WHEN 'completed' THEN 'completed'
    WHEN 'cancelled' THEN 'cancelled'
    WHEN 'in_progress' THEN 'in_progress'
    ELSE 'open'
  END,
  CASE WHEN (ra.action->>'completed_date') ~ '^\d{4}-\d{2}-\d{2}$' THEN (ra.action->>'completed_date')::date::timestamptz END,
  coalesce(r.created_at, NOW()),
  coalesce(r.updated_at, NOW())
FROM risk_register r
CROSS JOIN LATERAL jsonb_array_elements(r.actions) WITH ORDINALITY AS ra(action, ordinality)
WHERE r.deleted_at IS NULL
  AND jsonb_typeof(r.actions) = 'array'
  AND nullif(ra.action->>'description', '') IS NOT NULL
ON CONFLICT DO NOTHING;

-- Complaint improvement actions
INSERT INTO action_items (
  home_id, source_type, source_id, source_action_key, title, description,
  category, priority, owner_name, due_date, status, created_at, updated_at
)
SELECT
  c.home_id,
  'complaint',
  c.id::text,
  'legacy:improvements:' || md5(c.improvements),
  left(coalesce(c.title, c.improvements, 'Complaint improvement action'), 300),
  c.improvements,
  'governance',
  CASE
    WHEN c.response_deadline IS NOT NULL AND c.response_deadline < CURRENT_DATE THEN 'high'
    WHEN lower(coalesce(c.category, '')) LIKE '%safeguard%' OR lower(coalesce(c.category, '')) LIKE '%abuse%' THEN 'high'
    ELSE 'medium'
  END,
  nullif(c.investigator, ''),
  coalesce(c.response_deadline, c.date + INTERVAL '28 days', CURRENT_DATE + INTERVAL '28 days')::date,
  CASE WHEN c.status IN ('resolved', 'closed') THEN 'completed' ELSE 'open' END,
  coalesce(c.created_at, NOW()),
  coalesce(c.updated_at, NOW())
FROM complaints c
WHERE c.deleted_at IS NULL
  AND nullif(c.improvements, '') IS NOT NULL
ON CONFLICT DO NOTHING;

-- Complaint survey action text
INSERT INTO action_items (
  home_id, source_type, source_id, source_action_key, title, description,
  category, priority, owner_name, due_date, status, created_at, updated_at
)
SELECT
  s.home_id,
  'complaint_survey',
  s.id::text,
  'legacy:actions:' || md5(s.actions),
  left(coalesce(s.title, s.actions, 'Survey action'), 300),
  s.actions,
  'governance',
  'medium',
  nullif(s.conducted_by, ''),
  coalesce(s.date + INTERVAL '28 days', s.reported_at::date + INTERVAL '28 days', CURRENT_DATE + INTERVAL '28 days')::date,
  'open',
  coalesce(s.created_at, NOW()),
  coalesce(s.reported_at, s.created_at, NOW())
FROM complaint_surveys s
WHERE coalesce(s.deleted_at, NULL) IS NULL
  AND nullif(s.actions, '') IS NOT NULL
ON CONFLICT DO NOTHING;

-- Derived maintenance actions for failed checks, overdue checks and expired certificates
INSERT INTO action_items (
  home_id, source_type, source_id, source_action_key, title, description,
  category, priority, owner_name, due_date, status, created_at, updated_at
)
SELECT
  m.home_id,
  'maintenance',
  m.id::text,
  'derived:items_failed:' || md5(concat_ws('|', m.description, m.items_failed::text, m.next_due::text)),
  left('Failed maintenance checks: ' || coalesce(m.description, m.category, m.id), 300),
  concat_ws(E'\n', m.description, 'Failed items: ' || m.items_failed::text, m.notes),
  'environmental',
  'high',
  nullif(m.completed_by, ''),
  coalesce(m.next_due, CURRENT_DATE)::date,
  'open',
  coalesce(m.created_at, NOW()),
  coalesce(m.updated_at, NOW())
FROM maintenance m
WHERE m.deleted_at IS NULL
  AND coalesce(m.items_failed, 0) > 0
ON CONFLICT DO NOTHING;

INSERT INTO action_items (
  home_id, source_type, source_id, source_action_key, title, description,
  category, priority, owner_name, due_date, status, created_at, updated_at
)
SELECT
  m.home_id,
  'maintenance',
  m.id::text,
  'derived:next_due:' || md5(concat_ws('|', m.description, m.next_due::text)),
  left('Overdue maintenance: ' || coalesce(m.description, m.category, m.id), 300),
  concat_ws(E'\n', m.description, m.notes),
  'environmental',
  'medium',
  nullif(m.completed_by, ''),
  m.next_due,
  'open',
  coalesce(m.created_at, NOW()),
  coalesce(m.updated_at, NOW())
FROM maintenance m
WHERE m.deleted_at IS NULL
  AND m.next_due IS NOT NULL
  AND m.next_due < CURRENT_DATE
ON CONFLICT DO NOTHING;

INSERT INTO action_items (
  home_id, source_type, source_id, source_action_key, title, description,
  category, priority, owner_name, due_date, status, created_at, updated_at
)
SELECT
  m.home_id,
  'maintenance',
  m.id::text,
  'derived:certificate_expiry:' || md5(concat_ws('|', m.certificate_ref, m.certificate_expiry::text)),
  left('Expired certificate: ' || coalesce(m.certificate_ref, m.description, m.category, m.id), 300),
  concat_ws(E'\n', m.description, m.notes),
  'compliance',
  'high',
  nullif(m.completed_by, ''),
  m.certificate_expiry,
  'open',
  coalesce(m.created_at, NOW()),
  coalesce(m.updated_at, NOW())
FROM maintenance m
WHERE m.deleted_at IS NULL
  AND m.certificate_expiry IS NOT NULL
  AND m.certificate_expiry < CURRENT_DATE
ON CONFLICT DO NOTHING;

-- Fire drill corrective action text
INSERT INTO action_items (
  home_id, source_type, source_id, source_action_key, title, description,
  category, priority, owner_name, due_date, status, created_at, updated_at
)
SELECT
  f.home_id,
  'fire_drill',
  f.id::text,
  'legacy:corrective_actions:' || md5(f.corrective_actions),
  left(coalesce(f.corrective_actions, 'Fire drill corrective action'), 300),
  f.corrective_actions,
  'compliance',
  CASE WHEN nullif(f.issues, '') IS NOT NULL THEN 'high' ELSE 'medium' END,
  nullif(f.conducted_by, ''),
  (f.date + INTERVAL '28 days')::date,
  'open',
  coalesce(f.created_at, NOW()),
  coalesce(f.updated_at, f.created_at, NOW())
FROM fire_drills f
WHERE f.deleted_at IS NULL
  AND nullif(f.corrective_actions, '') IS NOT NULL
ON CONFLICT DO NOTHING;

-- Supervision action text
INSERT INTO action_items (
  home_id, source_type, source_id, source_action_key, title, description,
  category, priority, owner_name, due_date, status, created_at, updated_at
)
SELECT
  s.home_id,
  'supervision',
  s.id::text,
  'legacy:actions:' || md5(s.actions),
  left('Supervision action for ' || s.staff_id || ': ' || s.actions, 300),
  concat_ws(E'\n', 'Staff ID: ' || s.staff_id, s.actions),
  'hr',
  'medium',
  nullif(s.supervisor, ''),
  coalesce(s.next_due, s.date + INTERVAL '28 days')::date,
  'open',
  coalesce(s.created_at, NOW()),
  coalesce(s.updated_at, s.created_at, NOW())
FROM supervisions s
WHERE s.deleted_at IS NULL
  AND nullif(s.actions, '') IS NOT NULL
ON CONFLICT DO NOTHING;

-- Appraisal development and training actions
INSERT INTO action_items (
  home_id, source_type, source_id, source_action_key, title, description,
  category, priority, owner_name, due_date, status, created_at, updated_at
)
SELECT
  a.home_id,
  'appraisal',
  a.id::text,
  'legacy:development_plan:' || md5(a.development_plan),
  left('Appraisal development action for ' || a.staff_id || ': ' || a.development_plan, 300),
  concat_ws(E'\n', 'Staff ID: ' || a.staff_id, a.development_plan),
  'hr',
  'medium',
  nullif(a.appraiser, ''),
  coalesce(a.next_due, a.date + INTERVAL '90 days')::date,
  'open',
  coalesce(a.created_at, NOW()),
  coalesce(a.updated_at, a.created_at, NOW())
FROM appraisals a
WHERE a.deleted_at IS NULL
  AND nullif(a.development_plan, '') IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO action_items (
  home_id, source_type, source_id, source_action_key, title, description,
  category, priority, owner_name, due_date, status, created_at, updated_at
)
SELECT
  a.home_id,
  'appraisal',
  a.id::text,
  'legacy:training_needs:' || md5(a.training_needs),
  left('Appraisal training action for ' || a.staff_id || ': ' || a.training_needs, 300),
  concat_ws(E'\n', 'Staff ID: ' || a.staff_id, a.training_needs),
  'hr',
  'medium',
  nullif(a.appraiser, ''),
  coalesce(a.next_due, a.date + INTERVAL '90 days')::date,
  'open',
  coalesce(a.created_at, NOW()),
  coalesce(a.updated_at, a.created_at, NOW())
FROM appraisals a
WHERE a.deleted_at IS NULL
  AND nullif(a.training_needs, '') IS NOT NULL
ON CONFLICT DO NOTHING;

-- DOWN
DROP TABLE IF EXISTS reflective_practice;
DROP TABLE IF EXISTS action_items;
DELETE FROM retention_schedule
 WHERE data_category IN ('Manager action items', 'Reflective practice');
