const DOCUMENT_FILE_TYPES = [
  {
    key: 'pdf',
    label: 'PDF',
    extensions: ['.pdf'],
    mimeTypes: ['application/pdf'],
    signatureRequired: true,
  },
  {
    key: 'doc',
    label: 'Word',
    extensions: ['.doc'],
    mimeTypes: ['application/msword'],
    signatureRequired: false,
  },
  {
    key: 'docx',
    label: 'Word',
    extensions: ['.docx'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    signatureRequired: false,
  },
  {
    key: 'rtf',
    label: 'RTF',
    extensions: ['.rtf'],
    mimeTypes: ['application/rtf', 'text/rtf'],
    signatureRequired: false,
  },
  {
    key: 'xls',
    label: 'Excel',
    extensions: ['.xls'],
    mimeTypes: ['application/vnd.ms-excel'],
    signatureRequired: false,
  },
  {
    key: 'xlsx',
    label: 'Excel',
    extensions: ['.xlsx'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    signatureRequired: false,
  },
  {
    key: 'csv',
    label: 'CSV',
    extensions: ['.csv'],
    mimeTypes: ['text/csv'],
    signatureRequired: false,
  },
  {
    key: 'jpeg',
    label: 'JPG',
    extensions: ['.jpg', '.jpeg'],
    mimeTypes: ['image/jpeg'],
    signatureRequired: true,
  },
  {
    key: 'png',
    label: 'PNG',
    extensions: ['.png'],
    mimeTypes: ['image/png'],
    signatureRequired: true,
  },
  {
    key: 'gif',
    label: 'GIF',
    extensions: ['.gif'],
    mimeTypes: ['image/gif'],
    signatureRequired: true,
  },
  {
    key: 'webp',
    label: 'WebP',
    extensions: ['.webp'],
    mimeTypes: ['image/webp'],
    signatureRequired: true,
  },
  {
    key: 'heic',
    label: 'HEIC/HEIF',
    extensions: ['.heic', '.heif'],
    mimeTypes: ['image/heic', 'image/heif'],
    signatureRequired: false,
  },
  {
    key: 'txt',
    label: 'TXT',
    extensions: ['.txt'],
    mimeTypes: ['text/plain'],
    signatureRequired: false,
  },
];

export const GENERIC_ATTACHMENT_UPLOAD_POLICY = {
  id: 'generic_attachment',
  maxBytes: 20 * 1024 * 1024,
  fileTypes: DOCUMENT_FILE_TYPES,
};

export const SCAN_INTAKE_UPLOAD_POLICY = {
  id: 'scan_intake',
  maxBytes: 10 * 1024 * 1024,
  fileTypes: DOCUMENT_FILE_TYPES.filter((fileType) =>
    ['pdf', 'jpeg', 'png'].includes(fileType.key)
  ),
};

export function getAllowedExtensions(policy) {
  return policy.fileTypes.flatMap((fileType) => fileType.extensions);
}

export function getAllowedMimeTypes(policy) {
  return policy.fileTypes.flatMap((fileType) => fileType.mimeTypes);
}

export function getAcceptString(policy) {
  return getAllowedExtensions(policy).join(',');
}

export function formatUploadPolicyHelp(policy) {
  const labels = [];
  for (const fileType of policy.fileTypes) {
    if (!labels.includes(fileType.label)) labels.push(fileType.label);
  }
  return `Accepted: ${labels.join(', ')} (max ${Math.round(policy.maxBytes / (1024 * 1024))}MB).`;
}

export function findFileTypeByExtension(filename, policy) {
  const lower = String(filename || '').toLowerCase();
  return policy.fileTypes.find((fileType) =>
    fileType.extensions.some((extension) => lower.endsWith(extension))
  ) || null;
}

export function findFileTypeByMime(mimeType, policy) {
  return policy.fileTypes.find((fileType) => fileType.mimeTypes.includes(mimeType)) || null;
}

export function isUploadAllowed(filename, mimeType, policy) {
  const byExtension = findFileTypeByExtension(filename, policy);
  if (!byExtension) return false;
  return byExtension.mimeTypes.includes(mimeType);
}
