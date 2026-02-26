-- UP
-- Change discovered_date from DATE to TIMESTAMPTZ so the 72-hour ICO
-- notification deadline is calculated from the actual discovery time,
-- not midnight UTC. Existing DATE values auto-cast to midnight.

ALTER TABLE data_breaches ALTER COLUMN discovered_date TYPE TIMESTAMPTZ
  USING discovered_date::timestamptz;

-- DOWN
ALTER TABLE data_breaches ALTER COLUMN discovered_date TYPE DATE
  USING discovered_date::date;
