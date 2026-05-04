import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { config } from '../../config.js';
import { assertGenericAttachmentUploadSafe } from '../../lib/uploadSecurity.js';

const ORIGINAL_UPLOAD_CONFIG = { ...config.upload };
const ORIGINAL_NODE_ENV = config.nodeEnv;

afterEach(() => {
  Object.assign(config.upload, ORIGINAL_UPLOAD_CONFIG);
  config.nodeEnv = ORIGINAL_NODE_ENV;
});

async function withTempFile(filename, contents, callback) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'panama-upload-security-'));
  const filePath = path.join(dir, filename);
  await writeFile(filePath, contents);
  try {
    return await callback(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

describe('upload security helpers', () => {
  it('allows text attachments when declared type and extension match', async () => {
    config.upload.scanCommand = null;
    await withTempFile('notes.txt', 'safe notes', async (filePath) => {
      await expect(assertGenericAttachmentUploadSafe({
        path: filePath,
        originalname: 'notes.txt',
        mimetype: 'text/plain',
      })).resolves.toBeUndefined();
    });
  });

  it('rejects signature-required attachments when content cannot be verified', async () => {
    config.upload.scanCommand = null;
    await withTempFile('fake.png', 'not actually a png', async (filePath) => {
      await expect(assertGenericAttachmentUploadSafe({
        path: filePath,
        originalname: 'fake.png',
        mimetype: 'image/png',
      })).rejects.toMatchObject({
        message: 'File content could not be verified',
        statusCode: 400,
      });
    });
  });
});
