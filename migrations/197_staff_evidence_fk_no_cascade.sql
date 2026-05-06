-- UP
-- Staff rows are soft-deleted for leavers/erasures, while onboarding and training
-- attachments are regulated evidence. Prevent accidental hard-delete cascades.
CREATE TABLE IF NOT EXISTS onboarding_orphan_attachment_records (
  quarantined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  record JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS training_orphan_attachment_records (
  quarantined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  record JSONB NOT NULL
);

INSERT INTO onboarding_orphan_attachment_records (record)
SELECT to_jsonb(ofa)
FROM onboarding_file_attachments ofa
WHERE NOT EXISTS (
  SELECT 1
  FROM staff s
  WHERE s.home_id = ofa.home_id
    AND s.id = ofa.staff_id
);

INSERT INTO training_orphan_attachment_records (record)
SELECT to_jsonb(tfa)
FROM training_file_attachments tfa
WHERE NOT EXISTS (
  SELECT 1
  FROM staff s
  WHERE s.home_id = tfa.home_id
    AND s.id = tfa.staff_id
);

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
  REFERENCES staff(home_id, id);

ALTER TABLE training_file_attachments
  DROP CONSTRAINT IF EXISTS training_file_attachments_staff_fk,
  ADD CONSTRAINT training_file_attachments_staff_fk
  FOREIGN KEY (home_id, staff_id)
  REFERENCES staff(home_id, id);

-- DOWN
ALTER TABLE training_file_attachments
  DROP CONSTRAINT IF EXISTS training_file_attachments_staff_fk,
  ADD CONSTRAINT training_file_attachments_staff_fk
  FOREIGN KEY (home_id, staff_id)
  REFERENCES staff(home_id, id)
  ON DELETE CASCADE;

ALTER TABLE onboarding_file_attachments
  DROP CONSTRAINT IF EXISTS onboarding_file_attachments_staff_fk,
  ADD CONSTRAINT onboarding_file_attachments_staff_fk
  FOREIGN KEY (home_id, staff_id)
  REFERENCES staff(home_id, id)
  ON DELETE CASCADE;
