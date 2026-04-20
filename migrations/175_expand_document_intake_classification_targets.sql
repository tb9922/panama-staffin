-- Expand OCR classification targets to match shared/scanIntake.js.
ALTER TABLE document_intake_items
  DROP CONSTRAINT IF EXISTS document_intake_items_classification_target_check;

ALTER TABLE document_intake_items
  ADD CONSTRAINT document_intake_items_classification_target_check
  CHECK (
    classification_target IN (
      'maintenance',
      'finance_ap',
      'onboarding',
      'cqc',
      'handover',
      'record_attachment',
      'hr_attachment',
      'training'
    )
  );
