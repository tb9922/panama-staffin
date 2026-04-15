import { findFileTypeByExtension } from '../shared/uploadPolicies.js';

export function validateClientFileSelection(file, policy) {
  if (!file) return 'Choose a file first.';
  if (file.size > policy.maxBytes) {
    return `File too large (max ${Math.round(policy.maxBytes / (1024 * 1024))}MB).`;
  }
  const allowedType = findFileTypeByExtension(file.name, policy);
  if (!allowedType) {
    return 'That file type is not supported.';
  }
  if (!allowedType.mimeTypes.includes(file.type)) {
    return 'That file type is not supported.';
  }
  return null;
}

export function validateDeclaredUploadType({ originalName, mimeType, policy }) {
  const allowedType = findFileTypeByExtension(originalName, policy);
  if (!allowedType) {
    return { ok: false, error: 'File extension not allowed', fileType: null };
  }
  if (!allowedType.mimeTypes.includes(mimeType)) {
    return { ok: false, error: `File type ${mimeType} not allowed`, fileType: allowedType };
  }
  return { ok: true, fileType: allowedType };
}

export function validateDetectedUploadType({ fileType, detected, declaredMimeType }) {
  if (!fileType) {
    return { ok: false, error: 'Unsupported file type' };
  }
  if (fileType.signatureRequired) {
    if (!detected) {
      return { ok: false, error: 'File content could not be verified' };
    }
    if (!fileType.mimeTypes.includes(detected.mime) || detected.mime !== declaredMimeType) {
      return { ok: false, error: 'File content does not match declared type' };
    }
    return { ok: true };
  }
  if (detected && !fileType.mimeTypes.includes(detected.mime)) {
    return { ok: false, error: 'File content does not match declared type' };
  }
  return { ok: true };
}
