-- UP
ALTER TABLE shift_overrides
  ADD CONSTRAINT chk_shift_valid CHECK (
    shift IN ('E', 'L', 'EL', 'N', 'OFF', 'AL', 'SICK', 'ADM', 'TRN', 'AVL',
              'OC-E', 'OC-L', 'OC-EL', 'OC-N', 'AG-E', 'AG-L', 'AG-EL', 'AG-N', 'BH-D', 'BH-N')
  );

ALTER TABLE shift_overrides
  ADD CONSTRAINT chk_no_self_cover CHECK (
    replaces_staff_id IS NULL OR replaces_staff_id != staff_id
  );

-- DOWN
ALTER TABLE shift_overrides DROP CONSTRAINT IF EXISTS chk_shift_valid;
ALTER TABLE shift_overrides DROP CONSTRAINT IF EXISTS chk_no_self_cover;
