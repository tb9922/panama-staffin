-- UP
-- Add acknowledgement tracking to handover entries.
-- Allows incoming shift staff to confirm they have received and read the handover.
-- CQC Reg 17: evidence that contemporaneous records were communicated and received.

ALTER TABLE handover_entries
  ADD COLUMN IF NOT EXISTS acknowledged_by  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS acknowledged_at  TIMESTAMPTZ;
