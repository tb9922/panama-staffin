-- Clinical/GDPR hardening:
-- - Default new and existing homes to enforce onboarding/training roster blocks unless explicitly configured.
-- - Purge DBS certificate numbers after the DBS Code of Practice six-month window.

UPDATE homes
   SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{enforce_onboarding_blocking}', 'true'::jsonb, true),
       updated_at = NOW()
 WHERE deleted_at IS NULL
   AND NOT (COALESCE(config, '{}'::jsonb) ? 'enforce_onboarding_blocking');

UPDATE homes
   SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{enforce_training_blocking}', 'true'::jsonb, true),
       updated_at = NOW()
 WHERE deleted_at IS NULL
   AND NOT (COALESCE(config, '{}'::jsonb) ? 'enforce_training_blocking');

UPDATE hr_rtw_dbs_renewals
   SET dbs_certificate_number = NULL,
       updated_at = NOW()
 WHERE check_type = 'dbs'
   AND dbs_certificate_number IS NOT NULL
   AND COALESCE(dbs_check_date, updated_at::date, created_at::date) < CURRENT_DATE - INTERVAL '6 months';
