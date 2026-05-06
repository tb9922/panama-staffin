-- UP
-- Correct legacy retention rows that used the display name instead of the real table.

UPDATE retention_schedule
   SET applies_to_table = 'gdpr_processors'
 WHERE data_category = 'GDPR processors'
   AND applies_to_table = 'processors';

-- DOWN
UPDATE retention_schedule
   SET applies_to_table = 'processors'
 WHERE data_category = 'GDPR processors'
   AND applies_to_table = 'gdpr_processors';
