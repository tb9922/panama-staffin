-- Add the new handover scan target to homes that already have scan intake configured.
UPDATE homes
SET config = jsonb_set(
  COALESCE(config, '{}'::jsonb),
  '{scan_intake_targets}',
  CASE
    WHEN jsonb_typeof(COALESCE(config, '{}'::jsonb)->'scan_intake_targets') = 'array' THEN
      CASE
        WHEN (COALESCE(config, '{}'::jsonb)->'scan_intake_targets') ? 'handover'
          THEN (COALESCE(config, '{}'::jsonb)->'scan_intake_targets')
        ELSE (COALESCE(config, '{}'::jsonb)->'scan_intake_targets') || '["handover"]'::jsonb
      END
    ELSE
      '["maintenance","finance_ap","onboarding","cqc","handover","record_attachment","hr_attachment","training"]'::jsonb
  END,
  true
)
WHERE deleted_at IS NULL;
