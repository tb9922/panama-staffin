UPDATE cqc_evidence
   SET quality_statement = CASE quality_statement
     WHEN 'WL9' THEN 'R6'
     WHEN 'WL10' THEN 'WL5'
     ELSE quality_statement
   END
 WHERE quality_statement IN ('WL9', 'WL10');

UPDATE cqc_statement_narratives
   SET quality_statement = 'R6'
 WHERE quality_statement = 'WL9';

UPDATE cqc_statement_narratives n
   SET quality_statement = 'WL5'
 WHERE quality_statement = 'WL10'
   AND NOT EXISTS (
     SELECT 1
       FROM cqc_statement_narratives existing
      WHERE existing.home_id = n.home_id
        AND existing.quality_statement = 'WL5'
        AND existing.deleted_at IS NULL
   );

UPDATE cqc_statement_narratives
   SET deleted_at = COALESCE(deleted_at, NOW()),
       updated_at = NOW()
 WHERE quality_statement = 'WL10';

UPDATE cqc_partner_feedback
   SET quality_statement = CASE quality_statement
     WHEN 'WL9' THEN 'R6'
     WHEN 'WL10' THEN 'WL5'
     ELSE quality_statement
   END
 WHERE quality_statement IN ('WL9', 'WL10');

UPDATE cqc_observations
   SET quality_statement = CASE quality_statement
     WHEN 'WL9' THEN 'R6'
     WHEN 'WL10' THEN 'WL5'
     ELSE quality_statement
   END
 WHERE quality_statement IN ('WL9', 'WL10');

ALTER TABLE cqc_statement_narratives
  DROP CONSTRAINT IF EXISTS cqc_statement_narratives_quality_statement_check;

ALTER TABLE cqc_statement_narratives
  ADD CONSTRAINT cqc_statement_narratives_quality_statement_check
  CHECK (quality_statement ~ '^(S[1-8]|E[1-6]|C[1-5]|R[1-7]|WL[1-8])$');

ALTER TABLE cqc_partner_feedback
  DROP CONSTRAINT IF EXISTS cqc_partner_feedback_quality_statement_check;

ALTER TABLE cqc_partner_feedback
  ADD CONSTRAINT cqc_partner_feedback_quality_statement_check
  CHECK (quality_statement ~ '^(S[1-8]|E[1-6]|C[1-5]|R[1-7]|WL[1-8])$');

ALTER TABLE cqc_observations
  DROP CONSTRAINT IF EXISTS cqc_observations_quality_statement_check;

ALTER TABLE cqc_observations
  ADD CONSTRAINT cqc_observations_quality_statement_check
  CHECK (quality_statement ~ '^(S[1-8]|E[1-6]|C[1-5]|R[1-7]|WL[1-8])$');
