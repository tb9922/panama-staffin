import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

vi.mock('../../repositories/gdprRepo.js', () => ({
  getAccessLog: vi.fn(),
  getAccessLogByHomeSlugs: vi.fn(),
}));

import * as gdprRepo from '../../repositories/gdprRepo.js';
import { config } from '../../config.js';
import { deleteErasureAttachmentFiles, getAccessLog } from '../../services/gdprService.js';

describe('gdprService.getAccessLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an empty list when no home slugs are available', async () => {
    const result = await getAccessLog({ limit: 50, offset: 10, homeSlugs: [] });

    expect(result).toEqual([]);
    expect(gdprRepo.getAccessLog).not.toHaveBeenCalled();
    expect(gdprRepo.getAccessLogByHomeSlugs).not.toHaveBeenCalled();
  });

  it('loads scoped access logs when home slugs are present', async () => {
    gdprRepo.getAccessLogByHomeSlugs.mockResolvedValue([{ id: 1 }]);

    const result = await getAccessLog({ limit: 25, offset: 5, homeSlugs: ['home-a'] });

    expect(result).toEqual([{ id: 1 }]);
    expect(gdprRepo.getAccessLogByHomeSlugs).toHaveBeenCalledWith(['home-a'], { limit: 25, offset: 5 });
    expect(gdprRepo.getAccessLog).not.toHaveBeenCalled();
  });
});

describe('gdprService.deleteErasureAttachmentFiles', () => {
  const originalUploadDir = config.upload.dir;

  beforeEach(() => {
    config.upload.dir = originalUploadDir;
  });

  afterEach(() => {
    config.upload.dir = originalUploadDir;
  });

  it('deletes files under the upload root and tolerates already-missing files', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'panama-erasure-'));
    config.upload.dir = tempRoot;
    const filePath = path.join(tempRoot, '1', 'training', 'S1', 'fire', 'cert.pdf');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, 'certificate');

    await deleteErasureAttachmentFiles([filePath, path.join(tempRoot, 'missing.pdf')]);

    await expect(fs.access(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('rejects paths outside the upload root', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'panama-erasure-'));
    config.upload.dir = tempRoot;

    await expect(deleteErasureAttachmentFiles([path.join(os.tmpdir(), 'outside.pdf')]))
      .rejects.toThrow(/outside the upload directory/i);

    await fs.rm(tempRoot, { recursive: true, force: true });
  });
});
