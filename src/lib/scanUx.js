const TARGET_COPY = {
  maintenance: {
    label: 'Scan certificate',
    helperText: 'Scan a certificate, service sheet, or contractor report and review the OCR before filing it into maintenance.',
  },
  finance_ap: {
    label: 'Scan receipt or invoice',
    helperText: 'Scan a supplier receipt or invoice and review the OCR before filing it into Finance AP.',
  },
  onboarding: {
    label: 'Scan onboarding document',
    helperText: 'Scan right-to-work, DBS, ID, or onboarding evidence and review the OCR before filing it into onboarding.',
  },
  cqc: {
    label: 'Scan evidence',
    helperText: 'Scan supporting evidence and review the OCR before filing it into CQC.',
  },
  handover: {
    label: 'Scan handover evidence',
    helperText: 'Scan supporting evidence and review the OCR before filing it into a handover entry.',
  },
  record_attachment: {
    label: 'Scan into this record',
    helperText: 'Scan a photo or PDF, review the OCR, and file it back into this record.',
  },
  hr_attachment: {
    label: 'Scan HR document',
    helperText: 'Scan a signed letter, form, or meeting note and file it back into this HR case.',
  },
  training: {
    label: 'Scan training evidence',
    helperText: 'Scan training certificates or notes and file them back into this training record.',
  },
};

const CASE_TYPE_COPY = {
  maintenance: TARGET_COPY.maintenance,
  finance_expense: {
    label: 'Scan receipt or invoice',
    helperText: 'Scan a supplier receipt or invoice and review the OCR before filing it into this expense.',
  },
  finance_payment_schedule: {
    label: 'Scan supplier document',
    helperText: 'Scan a supplier mandate, contract, or supporting document and review the OCR before filing it into this schedule.',
  },
  onboarding: {
    label: 'Scan onboarding document',
    helperText: 'Scan right-to-work, DBS, ID, or onboarding evidence and file it into this section.',
  },
  cqc_evidence: {
    label: 'Scan evidence',
    helperText: 'Scan supporting evidence and review the OCR before filing it into this CQC evidence item.',
  },
  handover_entry: TARGET_COPY.handover,
  disciplinary: TARGET_COPY.hr_attachment,
  grievance: TARGET_COPY.hr_attachment,
  performance: TARGET_COPY.hr_attachment,
  rtw_interview: TARGET_COPY.hr_attachment,
  oh_referral: TARGET_COPY.hr_attachment,
  contract: TARGET_COPY.hr_attachment,
  family_leave: TARGET_COPY.hr_attachment,
  flexible_working: TARGET_COPY.hr_attachment,
  edi: TARGET_COPY.hr_attachment,
  tupe: TARGET_COPY.hr_attachment,
  renewal: TARGET_COPY.hr_attachment,
  training: TARGET_COPY.training,
};

const DEFAULT_COPY = {
  label: 'Scan into this record',
  helperText: 'Scan a photo or PDF, review the OCR, and file it back into the right place.',
};

export function getScanUiCopy({ target, caseType, saveMessage }) {
  const base = CASE_TYPE_COPY[caseType] || TARGET_COPY[target] || DEFAULT_COPY;
  return {
    label: base.label,
    helperText: base.helperText,
    disabledReason: saveMessage || 'Save this record first to scan directly into it.',
  };
}

