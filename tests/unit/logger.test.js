import { describe, expect, it } from 'vitest';
import { LOGGER_REDACT_PATHS } from '../../logger.js';

describe('LOGGER_REDACT_PATHS', () => {
  it('covers auth secrets and location PII', () => {
    expect(LOGGER_REDACT_PATHS).toEqual(expect.arrayContaining([
      'headers.authorization',
      'req.headers.cookie',
      'body.password',
      'req.body.invite_token',
      'payload.lat',
      'payload.lng',
    ]));
  });

  it('covers common personal data fields', () => {
    expect(LOGGER_REDACT_PATHS).toEqual(expect.arrayContaining([
      'email',
      'body.phone',
      'req.body.date_of_birth',
      'payload.ni_number',
    ]));
  });
});
