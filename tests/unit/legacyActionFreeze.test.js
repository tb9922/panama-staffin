import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LEGACY_ACTION_FREEZE_ENV,
  isLegacyActionFreezeEnabled,
  legacyActionFieldsWithContent,
  rejectLegacyActionWriteIfFrozen,
} from '../../lib/legacyActionFreeze.js';

describe('legacy action freeze guard', () => {
  afterEach(() => {
    delete process.env[LEGACY_ACTION_FREEZE_ENV];
  });

  it('is disabled unless explicitly enabled', () => {
    expect(isLegacyActionFreezeEnabled()).toBe(false);
    process.env[LEGACY_ACTION_FREEZE_ENV] = 'true';
    expect(isLegacyActionFreezeEnabled()).toBe(true);
  });

  it('only blocks legacy fields that carry content', () => {
    expect(legacyActionFieldsWithContent({
      corrective_actions: [],
      actions: '  ',
      improvements: 'Fix weekly lessons-learned review',
    }, ['corrective_actions', 'actions', 'improvements'])).toEqual(['improvements']);
  });

  it('returns a 409 when a frozen legacy action field is written', () => {
    process.env[LEGACY_ACTION_FREEZE_ENV] = '1';
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    const blocked = rejectLegacyActionWriteIfFrozen(
      res,
      { actions: [{ description: 'Move into Manager Actions' }] },
      ['actions'],
      'risk_register',
    );

    expect(blocked).toBe(true);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      source: 'risk_register',
      fields: ['actions'],
    }));
  });
});
