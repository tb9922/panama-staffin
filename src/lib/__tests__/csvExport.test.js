import { describe, expect, it } from 'vitest';
import { escapeCsvCell } from '../csvExport.js';

describe('csvExport', () => {
  it.each(['=1+1', '+cmd', '-10+20', '@SUM(A1:A2)', '\t=cmd', '\r=cmd', '\n=cmd', '|cmd'])(
    'neutralises spreadsheet formula prefix %s',
    (value) => {
      expect(escapeCsvCell(value)).toBe(`"'${value.replace(/"/g, '""')}"`);
    },
  );

  it('quotes and escapes regular CSV text', () => {
    expect(escapeCsvCell('hello, "Teddy"')).toBe('"hello, ""Teddy"""');
  });
});
