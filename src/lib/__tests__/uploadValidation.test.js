import { describe, expect, it } from 'vitest';
import { GENERIC_ATTACHMENT_UPLOAD_POLICY, SCAN_INTAKE_UPLOAD_POLICY } from '../../../shared/uploadPolicies.js';
import {
  validateClientFileSelection,
  validateDeclaredUploadType,
  validateDetectedUploadType,
} from '../../../lib/uploadValidation.js';

describe('uploadValidation', () => {
  it('rejects client-side files that exceed the configured policy size', () => {
    const result = validateClientFileSelection({
      name: 'large.pdf',
      type: 'application/pdf',
      size: GENERIC_ATTACHMENT_UPLOAD_POLICY.maxBytes + 1,
    }, GENERIC_ATTACHMENT_UPLOAD_POLICY);

    expect(result).toBe('File too large (max 20MB).');
  });

  it('accepts a scan-intake PDF with the expected declared mime type', () => {
    const result = validateDeclaredUploadType({
      originalName: 'invoice.pdf',
      mimeType: 'application/pdf',
      policy: SCAN_INTAKE_UPLOAD_POLICY,
    });

    expect(result.ok).toBe(true);
    expect(result.fileType.key).toBe('pdf');
  });

  it('allows text-like files when no binary signature can be detected', () => {
    const declared = validateDeclaredUploadType({
      originalName: 'notes.txt',
      mimeType: 'text/plain',
      policy: GENERIC_ATTACHMENT_UPLOAD_POLICY,
    });

    const detected = validateDetectedUploadType({
      fileType: declared.fileType,
      detected: null,
      declaredMimeType: 'text/plain',
    });

    expect(declared.ok).toBe(true);
    expect(detected).toEqual({ ok: true });
  });

  it('rejects binary files when content verification is missing', () => {
    const declared = validateDeclaredUploadType({
      originalName: 'receipt.png',
      mimeType: 'image/png',
      policy: SCAN_INTAKE_UPLOAD_POLICY,
    });

    const detected = validateDetectedUploadType({
      fileType: declared.fileType,
      detected: null,
      declaredMimeType: 'image/png',
    });

    expect(declared.ok).toBe(true);
    expect(detected).toEqual({ ok: false, error: 'File content could not be verified' });
  });
});
