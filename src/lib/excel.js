// Guard against Excel formula injection — strings starting with =, +, -, @, \t, \r
// are interpreted as formulas by Excel. Prefix with a single quote to force text.
function sanitizeCell(value) {
  if (typeof value !== 'string') return value;
  if (/^[=+\-@\t\r]/.test(value)) return "'" + value;
  return value;
}

/**
 * Download one or more sheets as an .xlsx file.
 * @param {string} filename - e.g. 'costs_June_2025.xlsx'
 * @param {Array<{name: string, headers: string[], rows: any[][]}>} sheets
 */
export async function downloadXLSX(filename, sheets) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  sheets.forEach(({ name, headers, rows }) => {
    const ws = wb.addWorksheet(name.slice(0, 31)); // Excel sheet name max 31 chars
    ws.addRow(headers.map(sanitizeCell));
    rows.forEach(row => ws.addRow(row.map(sanitizeCell)));
  });
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
