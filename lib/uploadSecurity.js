import { fileTypeFromFile } from 'file-type';
import { GENERIC_ATTACHMENT_UPLOAD_POLICY } from '../shared/uploadPolicies.js';
import { validateDeclaredUploadType, validateDetectedUploadType } from './uploadValidation.js';
import { assertFilePassedMalwareScan } from './malwareScan.js';

function uploadValidationError(message) {
  const err = new Error(message || 'File type not allowed');
  err.statusCode = 400;
  return err;
}

export function genericAttachmentFileFilter(req, file, cb) {
  const declared = validateDeclaredUploadType({
    originalName: file?.originalname,
    mimeType: file?.mimetype,
    policy: GENERIC_ATTACHMENT_UPLOAD_POLICY,
  });
  if (!declared.ok) return cb(uploadValidationError(declared.error));
  return cb(null, true);
}

export async function assertGenericAttachmentUploadSafe(file) {
  const declared = validateDeclaredUploadType({
    originalName: file?.originalname,
    mimeType: file?.mimetype,
    policy: GENERIC_ATTACHMENT_UPLOAD_POLICY,
  });
  if (!declared.ok) throw uploadValidationError(declared.error);

  const detected = await fileTypeFromFile(file.path);
  const verified = validateDetectedUploadType({
    fileType: declared.fileType,
    detected,
    declaredMimeType: file.mimetype,
  });
  if (!verified.ok) throw uploadValidationError(verified.error);

  await assertFilePassedMalwareScan(file.path);
}
