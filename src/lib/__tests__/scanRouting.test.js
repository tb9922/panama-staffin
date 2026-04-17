import { describe, it, expect } from 'vitest';
import {
  buildScanInboxHref,
  getScanLaunchContext,
  parseScanLaunchParams,
} from '../scanRouting.js';

describe('scanRouting', () => {
  it('maps record attachment modules to contextual scan targets', () => {
    expect(getScanLaunchContext({ caseType: 'incident', caseId: 'INC-42' })).toEqual({
      target: 'record_attachment',
      moduleId: 'incident',
      recordId: 'INC-42',
      label: 'Incident',
    });
  });

  it('maps HR attachments to HR case context', () => {
    expect(getScanLaunchContext({ caseType: 'disciplinary', caseId: 55 })).toEqual({
      target: 'hr_attachment',
      caseType: 'disciplinary',
      caseId: '55',
      label: 'disciplinary',
    });
  });

  it('builds and parses scan inbox links with return paths', () => {
    const href = buildScanInboxHref({
      target: 'training',
      staffId: 'S001',
      typeId: 'fire_safety',
    }, '/training');
    const parsed = parseScanLaunchParams(new URLSearchParams(href.split('?')[1]));
    expect(parsed).toEqual({
      target: 'training',
      moduleId: '',
      recordId: '',
      caseType: '',
      caseId: '',
      staffId: 'S001',
      typeId: 'fire_safety',
      section: '',
      evidenceId: '',
      qualityStatement: '',
      entryDate: '',
      shift: '',
      category: '',
      priority: '',
      returnTo: '/training',
    });
  });

  it('preserves CQC and handover launch context fields', () => {
    const cqcHref = buildScanInboxHref({
      target: 'cqc',
      qualityStatement: 'S4',
    }, '/cqc');
    const handoverHref = buildScanInboxHref({
      target: 'handover',
      entryDate: '2026-04-16',
      shift: 'L',
      category: 'operational',
      priority: 'action',
    }, '/handover');

    expect(parseScanLaunchParams(new URLSearchParams(cqcHref.split('?')[1]))).toMatchObject({
      target: 'cqc',
      qualityStatement: 'S4',
      returnTo: '/cqc',
    });
    expect(parseScanLaunchParams(new URLSearchParams(handoverHref.split('?')[1]))).toMatchObject({
      target: 'handover',
      entryDate: '2026-04-16',
      shift: 'L',
      category: 'operational',
      priority: 'action',
      returnTo: '/handover',
    });
  });
});
