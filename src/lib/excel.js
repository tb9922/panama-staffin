import * as XLSX from 'xlsx';

/**
 * Download one or more sheets as an .xlsx file.
 * @param {string} filename - e.g. 'costs_June_2025.xlsx'
 * @param {Array<{name: string, headers: string[], rows: any[][]}>} sheets
 */
export function downloadXLSX(filename, sheets) {
  const wb = XLSX.utils.book_new();
  sheets.forEach(({ name, headers, rows }) => {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31)); // Excel sheet name max 31 chars
  });
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}
