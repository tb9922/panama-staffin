-- UP
ALTER TABLE onboarding_history
  DROP CONSTRAINT IF EXISTS onboarding_history_staff_fk;

ALTER TABLE onboarding_history
  ADD CONSTRAINT onboarding_history_staff_fk
  FOREIGN KEY (home_id, staff_id)
  REFERENCES staff(home_id, id)
  ON DELETE CASCADE
  NOT VALID;

ALTER TABLE onboarding_history
  VALIDATE CONSTRAINT onboarding_history_staff_fk;

-- DOWN
ALTER TABLE onboarding_history
  DROP CONSTRAINT IF EXISTS onboarding_history_staff_fk;
