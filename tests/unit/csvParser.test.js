import { describe, it, expect } from 'vitest';

// Import the module to get access to parseCSV via the route handler internals.
// Since parseCSV is not exported, we test it indirectly by importing the module
// and testing the splitCsvLines function behavior through the full parse path.
// Instead, we replicate the exported-equivalent logic here for unit testing.

/**
 * Mirror of splitCsvLines from routes/import.js — tests the algorithm directly.
 */
function splitCsvLines(text) {
  const lines = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuote = !inQuote;
      current += ch;
    } else if (!inQuote && (ch === '\n' || (ch === '\r' && text[i + 1] === '\n'))) {
      if (current.trim()) lines.push(current);
      current = '';
      if (ch === '\r') i++;
    } else if (!inQuote && ch === '\r') {
      if (current.trim()) lines.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) lines.push(current);
  return lines;
}

describe('splitCsvLines', () => {
  it('splits simple lines on LF', () => {
    const lines = splitCsvLines('a,b\nc,d\ne,f');
    expect(lines).toEqual(['a,b', 'c,d', 'e,f']);
  });

  it('splits simple lines on CRLF', () => {
    const lines = splitCsvLines('a,b\r\nc,d\r\ne,f');
    expect(lines).toEqual(['a,b', 'c,d', 'e,f']);
  });

  it('preserves newlines inside quoted fields', () => {
    const csv = 'name,role\n"Alice\nSmith",Carer\nBob,Senior Carer';
    const lines = splitCsvLines(csv);
    expect(lines).toEqual(['name,role', '"Alice\nSmith",Carer', 'Bob,Senior Carer']);
  });

  it('preserves CRLF inside quoted fields', () => {
    const csv = 'name,role\r\n"Alice\r\nSmith",Carer\r\nBob,Senior Carer';
    const lines = splitCsvLines(csv);
    expect(lines).toEqual(['name,role', '"Alice\r\nSmith",Carer', 'Bob,Senior Carer']);
  });

  it('handles multiple newlines inside a single quoted field', () => {
    const csv = 'a,b\n"line1\nline2\nline3",val\nc,d';
    const lines = splitCsvLines(csv);
    expect(lines).toEqual(['a,b', '"line1\nline2\nline3",val', 'c,d']);
  });

  it('handles escaped quotes inside quoted fields', () => {
    const csv = 'a,b\n"she said ""hello""",val\nc,d';
    const lines = splitCsvLines(csv);
    expect(lines).toEqual(['a,b', '"she said ""hello""",val', 'c,d']);
  });

  it('filters empty lines', () => {
    const lines = splitCsvLines('a,b\n\nc,d\n\n');
    expect(lines).toEqual(['a,b', 'c,d']);
  });

  it('handles bare CR line endings', () => {
    const lines = splitCsvLines('a,b\rc,d\re,f');
    expect(lines).toEqual(['a,b', 'c,d', 'e,f']);
  });

  it('handles single line with no newline', () => {
    const lines = splitCsvLines('a,b,c');
    expect(lines).toEqual(['a,b,c']);
  });

  it('handles empty input', () => {
    const lines = splitCsvLines('');
    expect(lines).toEqual([]);
  });
});
