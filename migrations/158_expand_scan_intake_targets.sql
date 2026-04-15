-- Ensure existing homes can use the broader scan-entry UX without manual config edits.
UPDATE homes
SET config = jsonb_set(
  COALESCE(config, '{}'::jsonb),
  '{scan_intake_targets}',
  '["maintenance","finance_ap","onboarding","cqc","record_attachment","hr_attachment","training"]'::jsonb,
  true
)
WHERE deleted_at IS NULL;
