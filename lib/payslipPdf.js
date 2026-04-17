/**
 * payslipPdf.js — Generate a payslip PDF using jsPDF + jspdf-autotable.
 *
 * Shows full earnings breakdown + deductions + net pay.
 * YTD figures shown for approved runs; "Estimated" shown for draft/calculated.
 *
 * Input: payslip object from payrollService.assemblePayslipData()
 * {
 *   run:          payroll_run object,
 *   line:         payroll_line object (including all Phase 2 deduction columns),
 *   staff:        staff object,
 *   home:         { name, config },
 *   shifts:       [payroll_line_shift objects],
 *   ytd:          ytd object or null (null = not yet approved),
 *   ytdEstimated: boolean (true when run is not yet approved),
 * }
 *
 * Returns a jsPDF instance (caller calls .output() or .save()).
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const PRIMARY = [31, 41, 55];    // Gray-800
const LIGHT   = [249, 250, 251]; // Gray-50
const WARN    = [254, 243, 199]; // Amber-100 for NMW warning
const GREEN   = [220, 252, 231]; // Green-100 for net pay
const BLUE50  = [239, 246, 255]; // Blue-50 for info

function todayLocalISO(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Generate a payslip PDF.
 * @param {object} payslip  From assemblePayslipData()
 * @returns {jsPDF} doc instance
 */
export function generatePayslipPDF(payslip) {
  const { run, line, staff, home, shifts, ytd, ytdEstimated } = payslip;
  const doc = new jsPDF('portrait', 'mm', 'a4');
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 15;

  let y = margin;

  // ── Header ─────────────────────────────────────────────────────────────────

  doc.setFillColor(...PRIMARY);
  doc.rect(0, 0, pageW, 28, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(home?.name || 'Care Home', margin, 12);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('PAYSLIP', margin, 20);
  doc.text(`Pay period: ${run.period_start} to ${run.period_end}`, pageW - margin, 12, { align: 'right' });
  doc.text(`Frequency: ${run.pay_frequency}`, pageW - margin, 20, { align: 'right' });

  doc.setTextColor(0, 0, 0);
  y = 36;

  // ── Employee Details ────────────────────────────────────────────────────────

  doc.setFillColor(...LIGHT);
  doc.rect(margin, y, pageW - margin * 2, 18, 'F');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('Employee', margin + 2, y + 5);
  doc.text('Staff ID', margin + 60, y + 5);
  doc.text('Role', margin + 100, y + 5);
  doc.text('NI Number', margin + 140, y + 5);
  doc.setFont('helvetica', 'normal');
  doc.text(staff.name || '', margin + 2, y + 12);
  doc.text(staff.id || '', margin + 60, y + 12);
  doc.text(staff.role || '', margin + 100, y + 12);
  doc.text(staff.ni_number || '—', margin + 140, y + 12);
  y += 24;

  // ── Estimated Notice ───────────────────────────────────────────────────────

  doc.setFillColor(...BLUE50);
  doc.rect(margin, y, pageW - margin * 2, 14, 'F');
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 64, 175);
  doc.text('ESTIMATED PAYSLIP — For reference only.', margin + 2, y + 5);
  doc.setFont('helvetica', 'normal');
  doc.text(
    'Your official payslip is issued by your employer\'s payroll provider. Deductions shown are Panama estimates and may differ from final figures.',
    margin + 2, y + 11,
  );
  doc.setTextColor(0, 0, 0);
  y += 18;

  // ── NMW Warning ────────────────────────────────────────────────────────────

  if (line.nmw_compliant === false) {
    doc.setFillColor(...WARN);
    doc.rect(margin, y, pageW - margin * 2, 10, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(146, 64, 14);
    doc.text(
      `NMW Compliance Issue: effective rate £${(line.nmw_lowest_rate || 0).toFixed(2)}/hr — review required`,
      margin + 2, y + 7,
    );
    doc.setTextColor(0, 0, 0);
    y += 14;
  }

  // ── Earnings (left column) ─────────────────────────────────────────────────

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Earnings', margin, y);
  y += 4;

  const earningsRows = [
    ['Base Pay', fmtGbp(line.base_pay)],
    line.night_enhancement    > 0 && ['Night Enhancement', fmtGbp(line.night_enhancement)],
    line.weekend_enhancement  > 0 && ['Weekend Enhancement', fmtGbp(line.weekend_enhancement)],
    line.bank_holiday_enhancement > 0 && ['Bank Holiday Enhancement', fmtGbp(line.bank_holiday_enhancement)],
    line.overtime_enhancement > 0 && ['Overtime Pay', fmtGbp(line.overtime_enhancement)],
    line.on_call_enhancement  > 0 && ['On-Call Enhancement', fmtGbp(line.on_call_enhancement)],
    line.sleep_in_pay         > 0 && [`Sleep-ins (${line.sleep_in_count})`, fmtGbp(line.sleep_in_pay)],
    line.holiday_pay          > 0 && [`Holiday Pay (${(line.holiday_days || 0).toFixed(1)} days)`, fmtGbp(line.holiday_pay)],
    line.ssp_amount           > 0 && [`Statutory Sick Pay (${line.ssp_days || 0} days)`, fmtGbp(line.ssp_amount)],
  ].filter(Boolean);

  const grossTotal = (line.gross_pay || 0) + (line.holiday_pay || 0) + (line.ssp_amount || 0);
  earningsRows.push(['GROSS PAY', fmtGbp(grossTotal)]);

  const halfW = (pageW - margin * 2) / 2 - 3;

  autoTable(doc, {
    startY: y,
    head: [['Earnings', 'Amount']],
    body: earningsRows,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: PRIMARY, fontSize: 8 },
    columnStyles: { 1: { halign: 'right' } },
    margin: { left: margin, right: margin + halfW + 6 },
    tableWidth: halfW,
    didParseCell: (d) => {
      if (d.row.index === earningsRows.length - 1) {
        d.cell.styles.fontStyle = 'bold';
        d.cell.styles.fillColor = LIGHT;
      }
    },
  });

  const earningsBottom = doc.lastAutoTable.finalY;

  // ── Deductions (right column) ──────────────────────────────────────────────

  const deductionRows = [
    line.tax_deducted     > 0 && ['Income Tax', `(${fmtGbp(line.tax_deducted)})`],
    line.employee_ni      > 0 && ['National Insurance (EE)', `(${fmtGbp(line.employee_ni)})`],
    line.pension_employee > 0 && ['Pension (Employee)', `(${fmtGbp(line.pension_employee)})`],
    line.student_loan     > 0 && ['Student Loan', `(${fmtGbp(line.student_loan)})`],
    line.other_deductions > 0 && ['Other Deductions', `(${fmtGbp(line.other_deductions)})`],
  ].filter(Boolean);

  const _hasDeductions = deductionRows.length > 0;
  deductionRows.push(['EST. NET PAY', fmtGbp(line.net_pay || grossTotal)]);

  autoTable(doc, {
    startY: y,
    head: [['Deductions', 'Amount']],
    body: deductionRows,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: PRIMARY, fontSize: 8 },
    columnStyles: { 1: { halign: 'right' } },
    margin: { left: margin + halfW + 6, right: margin },
    tableWidth: halfW,
    didParseCell: (d) => {
      if (d.row.index === deductionRows.length - 1) {
        d.cell.styles.fontStyle = 'bold';
        d.cell.styles.fillColor = GREEN;
      }
    },
  });

  y = Math.max(earningsBottom, doc.lastAutoTable.finalY) + 6;

  // ── Employer Contributions (informational) ─────────────────────────────────

  if ((line.employer_ni || 0) > 0 || (line.pension_employer || 0) > 0) {
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(100, 100, 100);
    const erParts = [];
    if (line.employer_ni     > 0) erParts.push(`Employer NI: ${fmtGbp(line.employer_ni)}`);
    if (line.pension_employer > 0) erParts.push(`Employer Pension: ${fmtGbp(line.pension_employer)}`);
    doc.text(`Employer contributions (not deducted from pay): ${erParts.join(' | ')}`, margin, y);
    doc.setTextColor(0, 0, 0);
    y += 6;
  }

  // ── YTD Summary ────────────────────────────────────────────────────────────

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(ytdEstimated ? 'Year-to-Date (Estimated)' : 'Year-to-Date', margin, y);
  y += 4;

  const ytdSource = ytd || {};
  const ytdRows = [
    ['Gross Pay', fmtGbp(ytdSource.gross_pay)],
    ['Tax Deducted', fmtGbp(ytdSource.tax_deducted)],
    ['Employee NI', fmtGbp(ytdSource.employee_ni)],
    ['Student Loan', fmtGbp(ytdSource.student_loan)],
    ['Pension (EE)', fmtGbp(ytdSource.pension_employee)],
    ['Net Pay', fmtGbp(ytdSource.net_pay)],
  ];

  autoTable(doc, {
    startY: y,
    head: [['YTD Category', 'Total' + (ytdEstimated ? ' (est.)' : '')]],
    body: ytdRows,
    styles: { fontSize: 8, cellPadding: 1.5 },
    headStyles: { fillColor: PRIMARY, fontSize: 8 },
    columnStyles: { 1: { halign: 'right' } },
    margin: { left: margin, right: margin },
    tableWidth: halfW,
  });

  y = doc.lastAutoTable.finalY + 6;

  // ── Shift Detail ────────────────────────────────────────────────────────────

  const workShifts = (shifts || []).filter(s => s.shift_code !== 'AL' && s.shift_code !== 'SICK');
  if (workShifts.length > 0) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('Shift Detail', margin, y);
    y += 4;

    const shiftRows = workShifts.map(s => {
      const enhancements = (s.enhancements_json || [])
        .map(e => `${e.type} +£${(e.enhancementAmount || 0).toFixed(2)}`)
        .join(', ');
      return [
        s.date,
        s.shift_code,
        fmt(s.hours),
        fmtGbp(s.base_amount),
        enhancements || '—',
        fmtGbp(s.total_amount),
      ];
    });

    autoTable(doc, {
      startY: y,
      head: [['Date', 'Shift', 'Hrs', 'Base', 'Enhancements', 'Total']],
      body: shiftRows,
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: PRIMARY, fontSize: 7 },
      columnStyles: {
        2: { halign: 'right' },
        3: { halign: 'right' },
        5: { halign: 'right' },
      },
      margin: { left: margin, right: margin },
    });

    y = doc.lastAutoTable.finalY + 4;
  }

  // ── NMW Reference ───────────────────────────────────────────────────────────

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);
  const nmwLine = line.nmw_lowest_rate
    ? `Lowest effective rate this period: £${line.nmw_lowest_rate.toFixed(2)}/hr — NMW compliance: ${line.nmw_compliant ? 'PASS' : 'FAIL'}`
    : 'NMW compliance: not calculated';
  doc.text(nmwLine, margin, y);
  y += 6;

  // ── Footer ──────────────────────────────────────────────────────────────────

  const pageH = doc.internal.pageSize.getHeight();
  doc.setFontSize(7);
  doc.setTextColor(150, 150, 150);
  doc.text(
    `Generated ${todayLocalISO()} | Run ID: ${run.id} | ${home?.name || ''}`,
    pageW / 2, pageH - 8, { align: 'center' },
  );

  return doc;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n) {
  return (parseFloat(n) || 0).toFixed(2);
}

function fmtGbp(n) {
  const v = parseFloat(n) || 0;
  return v === 0 ? '£0.00' : `£${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
