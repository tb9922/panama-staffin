import { describe, expect, it, vi } from 'vitest';
import { sendStoredDownload } from '../../lib/sendDownload.js';

function makeResponse() {
  return {
    headersSent: false,
    status: vi.fn(function status(code) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn(),
    download: vi.fn(),
  };
}

describe('sendStoredDownload', () => {
  it('returns a 404 JSON response when the file is missing', () => {
    const res = makeResponse();
    const next = vi.fn();
    res.download.mockImplementation((filePath, filename, options, callback) => {
      callback({ code: 'ENOENT' });
    });

    sendStoredDownload(res, next, 'C:\\missing.pdf', {
      originalName: 'missing.pdf',
      mimeType: 'application/pdf',
    });

    expect(res.download).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Attachment file is missing' });
    expect(next).not.toHaveBeenCalled();
  });

  it('sanitizes the download filename and forwards unexpected errors', () => {
    const res = makeResponse();
    const next = vi.fn();
    const err = new Error('boom');
    res.download.mockImplementation((filePath, filename, options, callback) => {
      expect(filename).toBe('bad_name___.pdf');
      expect(options.headers['Content-Type']).toBe('application/pdf');
      callback(err);
    });

    sendStoredDownload(res, next, 'C:\\missing.pdf', {
      originalName: 'bad;name"\r\n.pdf',
      mimeType: 'application/pdf',
    });

    expect(next).toHaveBeenCalledWith(err);
  });
});
