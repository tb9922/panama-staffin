/** @vitest-environment jsdom */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateEvidencePackPDF } from '../pdfReports.js';
import { MOCK_SCHEDULING_DATA } from '../../test/fixtures/schedulingData.js';

describe('pdfReports', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates the CQC evidence pack without relying on doc.autoTable()', () => {
    const data = {
      ...MOCK_SCHEDULING_DATA,
      onboarding: {},
      training: {},
      supervisions: {},
      appraisals: {},
      fire_drills: [],
      incidents: [],
      complaints: [],
      complaint_surveys: [],
      maintenance: [],
      ipc_audits: [],
      risk_register: [],
      policy_reviews: [],
      whistleblowing_concerns: [],
      dols: [],
      mca_assessments: [],
      care_certificate: {},
      cqc_evidence: [],
    };

    expect(() => generateEvidencePackPDF(data, 28)).not.toThrow();
  });
});
