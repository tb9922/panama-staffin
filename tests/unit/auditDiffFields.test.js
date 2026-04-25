import { describe, expect, it } from 'vitest';
import { diffFields } from '../../lib/audit.js';

describe('diffFields extraSensitive redaction', () => {
  it('keeps generic description changes visible by default', () => {
    const changes = diffFields(
      { description: 'Old plain description' },
      { description: 'New plain description' },
    );

    expect(changes).toEqual([
      { field: 'description', old: 'Old plain description', new: 'New plain description' },
    ]);
  });

  it('redacts description when the caller marks it extra sensitive', () => {
    const changes = diffFields(
      { description: 'Resident health narrative' },
      { description: 'Updated resident health narrative' },
      { extraSensitive: ['description'] },
    );

    expect(changes).toEqual([
      { field: 'description', old: '[REDACTED]', new: '[REDACTED]' },
    ]);
  });

  it('keeps global sensitive fields redacted when extraSensitive is used', () => {
    const changes = diffFields(
      { ni_number: 'AB123456C', description: 'Old' },
      { ni_number: 'CD789012D', description: 'New' },
      { extraSensitive: new Set(['description']) },
    );

    expect(changes).toContainEqual({ field: 'ni_number', old: '[REDACTED]', new: '[REDACTED]' });
    expect(changes).toContainEqual({ field: 'description', old: '[REDACTED]', new: '[REDACTED]' });
  });

  it('redacts removed sensitive fields too', () => {
    const changes = diffFields(
      { ni_number: 'AB123456C', description: 'Resident health narrative' },
      {},
      { extraSensitive: ['description'] },
    );

    expect(changes).toContainEqual({ field: 'ni_number', old: '[REDACTED]', new: '[REDACTED]' });
    expect(changes).toContainEqual({ field: 'description', old: '[REDACTED]', new: '[REDACTED]' });
  });
});
