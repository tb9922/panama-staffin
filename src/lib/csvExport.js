function sanitizeSpreadsheetCell(value) {
  if (typeof value !== 'string') return value;
  if (/^[=+\-@\t\r\n|]/.test(value)) return `'${value}`;
  return value;
}

export function escapeCsvCell(value) {
  const text = String(sanitizeSpreadsheetCell(value) ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

export function downloadCSV(filename, headers, rows) {
  const csv = [headers.map(escapeCsvCell).join(','), ...rows.map(row => row.map(escapeCsvCell).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
