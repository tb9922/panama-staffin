-- Fix: DEFAULT 'low' violates CHECK constraint ('unlikely','possible','likely','high')
ALTER TABLE data_breaches ALTER COLUMN risk_to_rights SET DEFAULT 'unlikely';
