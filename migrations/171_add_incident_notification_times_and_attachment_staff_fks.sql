-- UP
ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS cqc_notified_time TIME,
  ADD COLUMN IF NOT EXISTS riddor_reported_time TIME;

DELETE FROM onboarding_file_attachments ofa
WHERE NOT EXISTS (
  SELECT 1
  FROM staff s
  WHERE s.home_id = ofa.home_id
    AND s.id = ofa.staff_id
);

DELETE FROM training_file_attachments tfa
WHERE NOT EXISTS (
  SELECT 1
  FROM staff s
  WHERE s.home_id = tfa.home_id
    AND s.id = tfa.staff_id
);

ALTER TABLE onboarding_file_attachments
  DROP CONSTRAINT IF EXISTS onboarding_file_attachments_staff_fk,
  ADD CONSTRAINT onboarding_file_attachments_staff_fk
  FOREIGN KEY (home_id, staff_id)
  REFERENCES staff(home_id, id)
  ON DELETE CASCADE;

ALTER TABLE training_file_attachments
  DROP CONSTRAINT IF EXISTS training_file_attachments_staff_fk,
  ADD CONSTRAINT training_file_attachments_staff_fk
  FOREIGN KEY (home_id, staff_id)
  REFERENCES staff(home_id, id)
  ON DELETE CASCADE;

-- DOWN
ALTER TABLE training_file_attachments
  DROP CONSTRAINT IF EXISTS training_file_attachments_staff_fk;

ALTER TABLE onboarding_file_attachments
  DROP CONSTRAINT IF EXISTS onboarding_file_attachments_staff_fk;

ALTER TABLE incidents
  DROP COLUMN IF EXISTS riddor_reported_time,
  DROP COLUMN IF EXISTS cqc_notified_time;
