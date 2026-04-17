import { describe, expect, it } from 'vitest';
import { AppError, getHttpErrorResponse } from '../../errors.js';

describe('getHttpErrorResponse', () => {
  it('returns AppError details', () => {
    expect(getHttpErrorResponse(new AppError('Nope', 409, 'CONFLICT'))).toEqual({
      statusCode: 409,
      message: 'Nope',
      code: 'CONFLICT',
    });
  });

  it('honours plain errors with a valid statusCode', () => {
    const err = Object.assign(new Error('Locked out'), { statusCode: 423, code: 'LOCKED' });
    expect(getHttpErrorResponse(err)).toEqual({
      statusCode: 423,
      message: 'Locked out',
      code: 'LOCKED',
    });
  });

  it('ignores invalid statusCode values', () => {
    const err = Object.assign(new Error('bad'), { statusCode: 200 });
    expect(getHttpErrorResponse(err)).toBeNull();
  });
});
