-- UP
DROP TABLE IF EXISTS rate_limit_hits;

DO $$
DECLARE
  rec RECORD;
  update_action TEXT;
  match_clause TEXT;
  deferrable_clause TEXT;
BEGIN
  FOR rec IN
    SELECT
      c.conname,
      c.conrelid::regclass AS table_name,
      c.confupdtype,
      c.confmatchtype,
      c.condeferrable,
      c.condeferred,
      ARRAY_AGG(quote_ident(child_att.attname) ORDER BY child_cols.ord) AS child_columns,
      ARRAY_AGG(quote_ident(parent_att.attname) ORDER BY parent_cols.ord) AS parent_columns
    FROM pg_constraint c
    JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS child_cols(attnum, ord) ON TRUE
    JOIN pg_attribute child_att
      ON child_att.attrelid = c.conrelid
     AND child_att.attnum = child_cols.attnum
    JOIN LATERAL unnest(c.confkey) WITH ORDINALITY AS parent_cols(attnum, ord)
      ON parent_cols.ord = child_cols.ord
    JOIN pg_attribute parent_att
      ON parent_att.attrelid = c.confrelid
     AND parent_att.attnum = parent_cols.attnum
    WHERE c.contype = 'f'
      AND c.confrelid = 'homes'::regclass
      AND c.confdeltype = 'a'
    GROUP BY
      c.conname, c.conrelid, c.confupdtype, c.confmatchtype, c.condeferrable, c.condeferred
  LOOP
    update_action := CASE rec.confupdtype
      WHEN 'c' THEN 'CASCADE'
      WHEN 'n' THEN 'SET NULL'
      WHEN 'd' THEN 'SET DEFAULT'
      WHEN 'r' THEN 'RESTRICT'
      ELSE 'NO ACTION'
    END;

    match_clause := CASE rec.confmatchtype
      WHEN 'f' THEN ' MATCH FULL'
      WHEN 'p' THEN ' MATCH PARTIAL'
      ELSE ''
    END;

    deferrable_clause := CASE
      WHEN rec.condeferrable AND rec.condeferred THEN ' DEFERRABLE INITIALLY DEFERRED'
      WHEN rec.condeferrable THEN ' DEFERRABLE'
      ELSE ''
    END;

    EXECUTE format(
      'ALTER TABLE %s DROP CONSTRAINT %I',
      rec.table_name,
      rec.conname
    );

    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES homes(%s)%s ON UPDATE %s ON DELETE CASCADE%s',
      rec.table_name,
      rec.conname,
      array_to_string(rec.child_columns, ', '),
      array_to_string(rec.parent_columns, ', '),
      match_clause,
      update_action,
      deferrable_clause
    );
  END LOOP;
END $$;

-- DOWN
CREATE TABLE IF NOT EXISTS rate_limit_hits (
  key         TEXT PRIMARY KEY,
  hits        INTEGER      NOT NULL DEFAULT 0 CHECK (hits >= 0),
  reset_at    TIMESTAMPTZ  NOT NULL,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_hits_reset_at
  ON rate_limit_hits(reset_at);
