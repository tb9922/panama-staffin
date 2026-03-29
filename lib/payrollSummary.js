/**
 * payrollSummary.js — Generate a one-page payroll summary PDF for the accountant.
 *
 * Accountant uses this to verify their Sage/Xero totals after importing the CSV.
 * Shows: gross pay breakdown, staff count, reference estimates, HMRC due date.
 *
 * Input:
 *   run    — payroll_run object
 *   lines  — payroll_line objects (array)
 *   home   — { name, config }
 *
 * Returns a jsPDF instance.
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const PRIMARY = [31, 41, 55];    // Gray-800
const LIGHT   = [249, 250, 251]; // Gray-50
const BLUE50  = [239, 246, 255]; // Blue-50
const AMBER   = [254, 243, 199]; // Amber-100

function fmtGbp(n) {
  const v = parseFloat(n) || 0;
  return `£${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function sum(lines, field) {
  return lines.reduce((s, l) => s + (parseFloat(l[field]) || 0), 0);
}

/**
 * Generate payroll summary PDF.
 * @param {object} run   payroll_run row
 * @param {Array}  lines payroll_line rows
 * @param {object} home  { name, config }
 * @returns {jsPDF}
 */
export function generateSummaryPDF(run, lines, home) {
  const doc  = new jsPDF('portrait', 'mm', 'a4');
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 15;
  let y = margin;

  // ── Header bar ─────────────────────────────────────────────────────────────

  doc.setFillColor(...PRIMARY);
  doc.rect(0, 0, pageW, 28, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(home?.name || 'Care Home', margin, 12);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('PAYROLL SUMMARY', margin, 20);
  doc.text(`Run ID: ${run.id}`, pageW - margin, 12, { align: 'right' });
  doc.text(`${run.pay_frequency}`, pageW - margin, 20, { align: 'right' });

  doc.setTextColor(0, 0, 0);
  y = 36;

  // ── Estimated notice ───────────────────────────────────────────────────────

  doc.setFillColor(...BLUE50);
  doc.rect(margin, y, pageW - margin * 2, 10, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 64, 175);
  doc.text(
    'FOR ACCOUNTANT USE — Gross pay is source of truth. Reference estimates are Panama-internal only.',
    margin + 2, y + 7,
  );
  doc.setTextColor(0, 0, 0);
  y += 14;

  // ── Period info ────────────────────────────────────────────────────────────

  doc.setFillColor(...LIGHT);
  doc.rect(margin, y, pageW - margin * 2, 14, 'F');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('Period:', margin + 2, y + 5);
  doc.text('Status:', margin + 80, y + 5);
  doc.text('Approved by:', margin + 130, y + 5);
  doc.setFont('helvetica', 'normal');
  doc.text(`${run.period_start}  to  ${run.period_end}`, margin + 2, y + 12);
  doc.text(run.status || '—', margin + 80, y + 12);
  doc.text(run.approved_by || '—', margin + 130, y + 12);
  y += 20;

  // ── Gross pay breakdown ────────────────────────────────────────────────────

  const basicPay     = sum(lines, 'base_pay');
  const nightEnh     = sum(lines, 'night_enhancement');
  const weekendEnh   = sum(lines, 'weekend_enhancement');
  const bhEnh        = sum(lines, 'bank_holiday_enhancement');
  const otPay        = sum(lines, 'overtime_enhancement');
  const sleepIn      = sum(lines, 'sleep_in_pay');
  const onCall       = sum(lines, 'on_call_enhancement');
  const holidayPay   = sum(lines, 'holiday_pay');
  const sspAmount    = sum(lines, 'ssp_amount');
  const totalGross   = sum(lines, 'gross_pay');

  const grossRows = [
    ['Basic Pay', fmtGbp(basicPay)],
    nightEnh   > 0 && ['Night Enhancement', fmtGbp(nightEnh)],
    weekendEnh > 0 && ['Weekend Enhancement', fmtGbp(weekendEnh)],
    bhEnh      > 0 && ['Bank Holiday Enhancement', fmtGbp(bhEnh)],
    otPay      > 0 && ['Overtime Pay', fmtGbp(otPay)],
    sleepIn    > 0 && ['Sleep-in Pay', fmtGbp(sleepIn)],
    onCall     > 0 && ['On-Call Enhancement', fmtGbp(onCall)],
    holidayPay > 0 && ['Holiday Pay', fmtGbp(holidayPay)],
    sspAmount  > 0 && ['Statutory Sick Pay', fmtGbp(sspAmount)],
    ['TOTAL GROSS PAY', fmtGbp(totalGross)],
  ].filter(Boolean);

  autoTable(doc, {
    startY: y,
    head: [['GROSS PAY BREAKDOWN', 'Amount']],
    body: grossRows,
    styles: { fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: PRIMARY, fontSize: 9 },
    columnStyles: { 1: { halign: 'right', cellWidth: 40 } },
    margin: { left: margin, right: margin },
    tableWidth: pageW - margin * 2,
    didParseCell: (d) => {
      if (d.row.index === grossRows.length - 1) {
        d.cell.styles.fontStyle = 'bold';
        d.cell.styles.fillColor = LIGHT;
      }
    },
  });

  y = doc.lastAutoTable.finalY + 8;

  // ── Staff summary ──────────────────────────────────────────────────────────

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(`STAFF COUNT: ${lines.length}`, margin, y);
  doc.setFont('helvetica', 'normal');
  y += 8;

  // ── Reference estimates ───────────────────────────────────────────────────

  const estPAYE    = sum(lines, 'tax_deducted');
  const estEmpNI   = sum(lines, 'employee_ni');
  const estErNI    = sum(lines, 'employer_ni');
  const estPensEE  = sum(lines, 'pension_employee');
  const estPensER  = sum(lines, 'pension_employer');
  const estNet     = sum(lines, 'net_pay');

  const refRows = [
    ['Est. PAYE',                fmtGbp(estPAYE)],
    ['Est. Employee NI',         fmtGbp(estEmpNI)],
    ['Est. Employer NI',         fmtGbp(estErNI)],
    ['Est. Pension (Employee)',  fmtGbp(estPensEE)],
    ['Est. Pension (Employer)',  fmtGbp(estPensER)],
    ['Est. Net Pay',             fmtGbp(estNet)],
  ];

  autoTable(doc, {
    startY: y,
    head: [['REFERENCE ESTIMATES — Panama internal (accountant recalculates)', 'Amount']],
    body: refRows,
    styles: { fontSize: 8.5, cellPadding: 2.5 },
    headStyles: { fillColor: [...AMBER, 255], textColor: [92, 45, 0], fontSize: 8.5 },
    columnStyles: { 1: { halign: 'right', cellWidth: 40 } },
    margin: { left: margin, right: margin },
    tableWidth: pageW - margin * 2,
  });

  y = doc.lastAutoTable.finalY + 8;

  // ── Footer ─────────────────────────────────────────────────────────────────

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(120, 120, 120);
  doc.text(
    `Generated by Panama Staffing on ${new Date().toISOString().slice(0, 10)}. Official figures from your payroll software.`,
    margin, y,
  );

  return doc;
}
