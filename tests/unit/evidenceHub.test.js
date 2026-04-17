import { describe, expect, it } from 'vitest';
import {
  canAccessEvidenceHub,
  canDeleteEvidenceSource,
  getReadableEvidenceSources,
} from '../../shared/evidenceHub.js';
import {
  canReadRecordAttachmentModule,
  getReadableRecordAttachmentModules,
} from '../../shared/recordAttachmentModules.js';

describe('shared/evidenceHub helpers', () => {
  it('home_manager can read every evidence source', () => {
    expect(getReadableEvidenceSources('home_manager').map((source) => source.id)).toEqual([
      'hr',
      'cqc_evidence',
      'onboarding',
      'training',
      'record',
    ]);
  });

  it('finance_officer can read only operational record evidence', () => {
    expect(getReadableEvidenceSources('finance_officer').map((source) => source.id)).toEqual(['record']);
    expect(getReadableRecordAttachmentModules('finance_officer').map((entry) => entry.id)).toContain('finance_invoice');
    expect(getReadableRecordAttachmentModules('finance_officer').map((entry) => entry.id)).not.toContain('incident');
  });

  it('viewer can still access the hub through readable staff record evidence', () => {
    expect(canAccessEvidenceHub('viewer')).toBe(true);
    expect(canReadRecordAttachmentModule('viewer', 'staff_register')).toBe(true);
  });

  it('delete permissions stay source-specific', () => {
    expect(canDeleteEvidenceSource('finance_officer', 'record', 'finance_invoice')).toBe(true);
    expect(canDeleteEvidenceSource('finance_officer', 'record', 'incident')).toBe(false);
    expect(canDeleteEvidenceSource('finance_officer', 'hr', 'disciplinary')).toBe(false);
    expect(canDeleteEvidenceSource('home_manager', 'hr', 'disciplinary')).toBe(true);
  });

  it('unknown roles cannot access the hub', () => {
    expect(canAccessEvidenceHub('not_a_real_role')).toBe(false);
    expect(getReadableEvidenceSources('not_a_real_role')).toEqual([]);
  });
});
