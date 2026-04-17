export function sendStoredDownload(res, next, filePath, {
  originalName,
  mimeType,
  missingMessage = 'Attachment file is missing',
}) {
  const safeName = String(originalName || 'download').replace(/["\r\n;]/g, '_');
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    'X-Frame-Options': 'DENY',
  };
  if (mimeType) headers['Content-Type'] = mimeType;

  res.download(filePath, safeName, { headers }, (err) => {
    if (!err) return;
    const isMissingFile = err.code === 'ENOENT'
      || err.code === 'ENOTDIR'
      || err.status === 404
      || err.statusCode === 404;
    if (isMissingFile && !res.headersSent) {
      res.status(404).json({ error: missingMessage });
      return;
    }
    if (res.headersSent) {
      next(err);
      return;
    }
    next(err);
  });
}
