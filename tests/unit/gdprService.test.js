import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../repositories/gdprRepo.js', () => ({
  getAccessLog: vi.fn(),
  getAccessLogByHomeSlugs: vi.fn(),
}));

import * as gdprRepo from '../../repositories/gdprRepo.js';
import { getAccessLog } from '../../services/gdprService.js';

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
