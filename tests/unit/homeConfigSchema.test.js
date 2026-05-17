import { describe, expect, it } from 'vitest';
import { homeConfigSchema } from '../../lib/zodHelpers.js';

describe('homeConfigSchema', () => {
  it('accepts bounded core home settings', () => {
    const parsed = homeConfigSchema.parse({
      home_name: 'Pandi Home',
      registered_beds: '32',
      care_type: 'Residential',
      edit_lock_pin: '1234',
    });

    expect(parsed.registered_beds).toBe(32);
  });

  it('rejects invalid registered beds and short edit-lock pins', () => {
    expect(() => homeConfigSchema.parse({ registered_beds: 0 })).toThrow();
    expect(() => homeConfigSchema.parse({ registered_beds: 201 })).toThrow();
    expect(() => homeConfigSchema.parse({ edit_lock_pin: '123' })).toThrow();
  });

  it('validates explicit pension relief mode', () => {
    expect(homeConfigSchema.parse({ pension_mode: 'ras' }).pension_mode).toBe('ras');
    expect(() => homeConfigSchema.parse({ pension_mode: 'grossed-up-magic' })).toThrow();
  });
});
