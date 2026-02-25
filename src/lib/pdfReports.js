// PDF Report Generation using jsPDF + autoTable
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { getStaffForDay, formatDate, isWorkingShift, isCareRole, getShiftHours } from './rotation.js';
import { calculateDayCost, getDayCoverageStatus } from './escalation.js';
import {
  QUALITY_STATEMENTS, METRIC_DEFINITIONS, calculateComplianceScore,
  getDateRange, calculateTrainingBreakdown, getCoverageSummary,
  calculateSafeguardingTrainingPct, getDbsStatusList, getFatigueSummary,
  calculateSickRate, calculateOnboardingCompletionPct, getScoreBand,
  calculateFireDrillCompliancePct, calculateAppraisalCompletionPct,
  calculateMcaTrainingCompliancePct, calculateEqualityTrainingPct,
  calculateDataProtectionTrainingPct, calculateStaffTurnover,
  calculateFatigueBreachesPct, calculateTrainingTrend,
} from './cqc.js';
import { getTrainingTypes, getFireDrillStatus, getAppraisalStats } from './training.js';
import { ONBOARDING_SECTIONS, buildOnboardingMatrix, getOnboardingStats } from './onboarding.js';
import { calculateActionCompletionRate, getIncidentTrendData } from './incidents.js';
import { getComplaintStats, getSurveyStats } from './complaints.js';
import { getMaintenanceStats, getMaintenanceStatus, FREQUENCY_OPTIONS } from './maintenance.js';
import { getIpcStats } from './ipc.js';
import { getRiskStats, getRiskBand, RISK_CATEGORIES } from './riskRegister.js';
import { getPolicyStats, getPolicyStatus, POLICY_STATUSES } from './policyReview.js';
import { getWhistleblowingStats } from './whistleblowing.js';
import { getDolsStats } from './dols.js';

function addHeader(doc, title, subtitle, homeName) {
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(homeName || 'Panama Staffing', 14, 18);
  doc.setFontSize(12);
  doc.text(title, 14, 26);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100);
  doc.text(subtitle, 14, 32);
  doc.text(`Generated: ${new Date().toLocaleDateString('en-GB')} ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`, 14, 37);
  doc.setTextColor(0);
  doc.setDrawColor(50);
  doc.line(14, 39, doc.internal.pageSize.width - 14, 39);
  return 44;
}

function getMonthDates(year, month) {
  const dates = [];
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) {
    dates.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

// Weekly Roster PDF
export function generateRosterPDF(data, weekStart) {
  const doc = new jsPDF('landscape', 'mm', 'a4');
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    dates.push(d);
  }

  const weekLabel = `${dates[0].toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} — ${dates[6].toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  let y = addHeader(doc, 'Weekly Roster', weekLabel, data.config.home_name);

  const activeStaff = data.staff.filter(s => s.active !== false && isCareRole(s.role));
  const headers = [
    'Staff', 'Team', 'Role',
    ...dates.map(d => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })),
    'Hours',
  ];

  const rows = activeStaff.map(s => {
    let totalHours = 0;
    const shifts = dates.map(date => {
      const staffForDay = getStaffForDay(data.staff, date, data.overrides, data.config);
      const me = staffForDay.find(x => x.id === s.id);
      const shift = me?.shift || 'OFF';
      if (isWorkingShift(shift)) totalHours += getShiftHours(shift, data.config);
      return shift;
    });
    return [s.name, s.team, s.role, ...shifts, totalHours.toFixed(1)];
  });

  doc.autoTable({
    startY: y,
    head: [headers],
    body: rows,
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [31, 41, 55], fontSize: 7 },
    columnStyles: {
      0: { cellWidth: 30 },
      1: { cellWidth: 20 },
      2: { cellWidth: 22 },
    },
    didParseCell(hookData) {
      if (hookData.section === 'body' && hookData.column.index >= 3 && hookData.column.index <= 9) {
        const val = hookData.cell.raw;
        if (val === 'SICK') { hookData.cell.styles.fillColor = [254, 226, 226]; hookData.cell.styles.textColor = [153, 27, 27]; }
        else if (val === 'AL') { hookData.cell.styles.fillColor = [254, 249, 195]; hookData.cell.styles.textColor = [133, 77, 14]; }
        else if (val === 'OFF') { hookData.cell.styles.fillColor = [243, 244, 246]; hookData.cell.styles.textColor = [156, 163, 175]; }
        else if (val?.startsWith('AG-')) { hookData.cell.styles.fillColor = [254, 202, 202]; hookData.cell.styles.textColor = [127, 29, 29]; }
        else if (val?.startsWith('OC-')) { hookData.cell.styles.fillColor = [255, 237, 213]; hookData.cell.styles.textColor = [154, 52, 18]; }
        else if (val === 'N') { hookData.cell.styles.fillColor = [233, 213, 255]; hookData.cell.styles.textColor = [88, 28, 135]; }
        else if (isWorkingShift(val)) { hookData.cell.styles.fillColor = [220, 252, 231]; hookData.cell.styles.textColor = [22, 101, 52]; }
      }
    },
  });

  // Coverage summary below table
  let cy = doc.lastAutoTable.finalY + 8;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Daily Coverage Summary', 14, cy);
  cy += 5;

  const covHeaders = ['Date', 'Early Heads', 'Late Heads', 'Night Heads', 'Escalation', 'Day Cost'];
  const covRows = dates.map(date => {
    const staffForDay = getStaffForDay(data.staff, date, data.overrides, data.config);
    const cov = getDayCoverageStatus(staffForDay, data.config);
    const cost = calculateDayCost(staffForDay, data.config);
    const worst = Math.max(cov.early.escalation.level, cov.late.escalation.level, cov.night.escalation.level);
    const escLabel = worst <= 1 ? 'Normal' : worst <= 2 ? 'OT' : worst <= 3 ? 'Agency' : worst <= 4 ? 'SHORT' : 'UNSAFE';
    return [
      date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
      `${cov.early.coverage.headCount}/${cov.early.coverage.required.heads}`,
      `${cov.late.coverage.headCount}/${cov.late.coverage.required.heads}`,
      `${cov.night.coverage.headCount}/${cov.night.coverage.required.heads}`,
      escLabel,
      `£${cost.total.toFixed(0)}`,
    ];
  });

  doc.autoTable({
    startY: cy,
    head: [covHeaders],
    body: covRows,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [31, 41, 55], fontSize: 8 },
    didParseCell(hookData) {
      if (hookData.section === 'body' && hookData.column.index === 4) {
        const val = hookData.cell.raw;
        if (val === 'SHORT' || val === 'UNSAFE') { hookData.cell.styles.fillColor = [254, 226, 226]; hookData.cell.styles.textColor = [153, 27, 27]; hookData.cell.styles.fontStyle = 'bold'; }
        else if (val === 'Agency') { hookData.cell.styles.fillColor = [254, 249, 195]; hookData.cell.styles.textColor = [133, 77, 14]; }
      }
    },
  });

  doc.save(`Roster_${formatDate(weekStart)}.pdf`);
}

// Monthly Cost Report PDF
export function generateCostPDF(data, year, month) {
  const doc = new jsPDF('portrait', 'mm', 'a4');
  const monthDates = getMonthDates(year, month);
  const monthLabel = new Date(year, month).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  let y = addHeader(doc, 'Monthly Cost Report', monthLabel, data.config.home_name);

  // Calculate daily costs
  let cumulative = 0;
  const dayData = monthDates.map((date, i) => {
    const staffForDay = getStaffForDay(data.staff, date, data.overrides, data.config);
    const cost = calculateDayCost(staffForDay, data.config);
    cumulative += cost.total;
    return { date, cost, cumulative, dayNum: i + 1 };
  });

  const totals = dayData.reduce((acc, d) => ({
    base: acc.base + d.cost.base,
    otPremium: acc.otPremium + d.cost.otPremium,
    agencyDay: acc.agencyDay + d.cost.agencyDay,
    agencyNight: acc.agencyNight + d.cost.agencyNight,
    bhPremium: acc.bhPremium + d.cost.bhPremium,
    total: acc.total + d.cost.total,
    agency: acc.agency + d.cost.agency,
  }), { base: 0, otPremium: 0, agencyDay: 0, agencyNight: 0, bhPremium: 0, total: 0, agency: 0 });

  // Summary box
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  const summaryItems = [
    ['Month Total', `£${Math.round(totals.total).toLocaleString()}`],
    ['Base Staff', `£${Math.round(totals.base).toLocaleString()}`],
    ['OT Premium', `£${Math.round(totals.otPremium).toLocaleString()}`],
    ['Agency Total', `£${Math.round(totals.agency).toLocaleString()}`],
    ['BH Premium', `£${Math.round(totals.bhPremium).toLocaleString()}`],
    ['Agency %', `${totals.total > 0 ? ((totals.agency / totals.total) * 100).toFixed(1) : 0}%`],
    ['Daily Average', `£${Math.round(totals.total / monthDates.length).toLocaleString()}`],
    ['Annual Projection', `£${Math.round(totals.total / monthDates.length * 365).toLocaleString()}`],
  ];

  doc.autoTable({
    startY: y,
    head: [['Metric', 'Value']],
    body: summaryItems,
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [31, 41, 55] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50 } },
    tableWidth: 110,
  });

  // Budget comparison if set
  const budget = data.config.monthly_staff_budget;
  if (budget) {
    const budgetY = doc.lastAutoTable.finalY + 6;
    const variance = totals.total - budget;
    const variancePct = ((variance / budget) * 100).toFixed(1);
    doc.autoTable({
      startY: budgetY,
      head: [['Budget Analysis', '']],
      body: [
        ['Monthly Budget', `£${Math.round(budget).toLocaleString()}`],
        ['Actual Spend', `£${Math.round(totals.total).toLocaleString()}`],
        ['Variance', `£${Math.round(Math.abs(variance)).toLocaleString()} ${variance > 0 ? 'OVER' : 'under'} (${variancePct}%)`],
      ],
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: variance > 0 ? [220, 38, 38] : [22, 163, 74] },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50 } },
      tableWidth: 110,
    });
  }

  // Daily breakdown table
  const tableY = (budget ? doc.lastAutoTable.finalY : doc.lastAutoTable.finalY) + 8;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Daily Breakdown', 14, tableY);

  const headers = ['Day', 'Date', 'Base £', 'OT £', 'AG Day £', 'AG Night £', 'BH £', 'Total £', 'Cumul £'];
  const rows = dayData.map(d => [
    d.date.toLocaleDateString('en-GB', { weekday: 'short' }),
    d.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    d.cost.base.toFixed(0),
    d.cost.otPremium > 0 ? d.cost.otPremium.toFixed(0) : '-',
    d.cost.agencyDay > 0 ? d.cost.agencyDay.toFixed(0) : '-',
    d.cost.agencyNight > 0 ? d.cost.agencyNight.toFixed(0) : '-',
    d.cost.bhPremium > 0 ? d.cost.bhPremium.toFixed(0) : '-',
    d.cost.total.toFixed(0),
    d.cumulative.toFixed(0),
  ]);

  // Add totals row
  rows.push([
    '', 'TOTAL',
    totals.base.toFixed(0), totals.otPremium.toFixed(0),
    totals.agencyDay.toFixed(0), totals.agencyNight.toFixed(0),
    totals.bhPremium.toFixed(0), totals.total.toFixed(0), '',
  ]);

  doc.autoTable({
    startY: tableY + 3,
    head: [headers],
    body: rows,
    styles: { fontSize: 7, cellPadding: 1.5, halign: 'right' },
    headStyles: { fillColor: [31, 41, 55], fontSize: 7 },
    columnStyles: { 0: { halign: 'left' }, 1: { halign: 'left' } },
    didParseCell(hookData) {
      if (hookData.section === 'body' && hookData.row.index === rows.length - 1) {
        hookData.cell.styles.fontStyle = 'bold';
        hookData.cell.styles.fillColor = [243, 244, 246];
      }
    },
  });

  doc.save(`Cost_Report_${monthLabel.replace(' ', '_')}.pdf`);
}

// Coverage & Escalation Report PDF
export function generateCoveragePDF(data, weekStart) {
  const doc = new jsPDF('portrait', 'mm', 'a4');
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    dates.push(d);
  }

  const weekLabel = `${dates[0].toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} — ${dates[6].toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  let y = addHeader(doc, 'Coverage & Escalation Report', weekLabel, data.config.home_name);

  // Min staffing reference
  const mins = data.config.minimum_staffing;
  doc.autoTable({
    startY: y,
    head: [['Minimum Staffing Requirements', 'Heads', 'Skill Points']],
    body: [
      ['Early', mins.early.heads, mins.early.skill_points],
      ['Late', mins.late.heads, mins.late.skill_points],
      ['Night', mins.night.heads, mins.night.skill_points],
    ],
    styles: { fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: [31, 41, 55] },
    tableWidth: 120,
  });

  y = doc.lastAutoTable.finalY + 8;

  // Daily coverage detail
  const headers = ['Date', 'Period', 'Heads', 'Skill Pts', 'Gap', 'Escalation', 'Cost'];
  const rows = [];

  dates.forEach(date => {
    const staffForDay = getStaffForDay(data.staff, date, data.overrides, data.config);
    const cov = getDayCoverageStatus(staffForDay, data.config);
    const cost = calculateDayCost(staffForDay, data.config);
    const dateLabel = date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

    ['early', 'late', 'night'].forEach(period => {
      const c = cov[period];
      rows.push([
        period === 'early' ? dateLabel : '',
        period.charAt(0).toUpperCase() + period.slice(1),
        `${c.coverage.headCount}/${c.coverage.required.heads}`,
        `${c.coverage.skillPoints.toFixed(1)}/${c.coverage.required.skill_points}`,
        c.coverage.headGap > 0 ? `-${c.coverage.headGap}` : 'OK',
        c.escalation.status,
        period === 'early' ? `£${cost.total.toFixed(0)}` : '',
      ]);
    });
  });

  doc.autoTable({
    startY: y,
    head: [headers],
    body: rows,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [31, 41, 55], fontSize: 8 },
    didParseCell(hookData) {
      if (hookData.section === 'body' && hookData.column.index === 5) {
        const val = hookData.cell.raw;
        if (val?.includes('LVL4') || val?.includes('LVL5')) { hookData.cell.styles.fillColor = [254, 226, 226]; hookData.cell.styles.textColor = [153, 27, 27]; hookData.cell.styles.fontStyle = 'bold'; }
        else if (val?.includes('LVL3')) { hookData.cell.styles.fillColor = [254, 249, 195]; hookData.cell.styles.textColor = [133, 77, 14]; }
        else if (val?.includes('LVL2')) { hookData.cell.styles.fillColor = [255, 237, 213]; hookData.cell.styles.textColor = [154, 52, 18]; }
      }
      if (hookData.section === 'body' && hookData.column.index === 4) {
        if (hookData.cell.raw !== 'OK') { hookData.cell.styles.textColor = [220, 38, 38]; hookData.cell.styles.fontStyle = 'bold'; }
      }
    },
  });

  doc.save(`Coverage_Report_${formatDate(weekStart)}.pdf`);
}

// Staff Register PDF
export function generateStaffPDF(data) {
  const doc = new jsPDF('landscape', 'mm', 'a4');
  let y = addHeader(doc, 'Staff Register', `${data.staff.filter(s => s.active !== false).length} active staff`, data.config.home_name);

  const activeStaff = data.staff.filter(s => s.active !== false).sort((a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name));

  const headers = ['Name', 'Team', 'Role', 'Preference', 'Skill', 'Hourly Rate', 'WTR Opt-out', 'Contract'];
  const rows = activeStaff.map(s => [
    s.name,
    s.team,
    s.role,
    s.pref || s.default_shift || '-',
    s.skill?.toFixed(1) || '-',
    `£${(s.hourly_rate || 0).toFixed(2)}`,
    s.wtr_opt_out ? 'Yes' : 'No',
    s.contract_type || 'Full-time',
  ]);

  doc.autoTable({
    startY: y,
    head: [headers],
    body: rows,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [31, 41, 55], fontSize: 8 },
  });

  // Summary stats
  const summaryY = doc.lastAutoTable.finalY + 8;
  const careStaff = activeStaff.filter(s => isCareRole(s.role));
  const totalSkill = careStaff.reduce((s, x) => s + (x.skill || 0), 0);
  const avgRate = activeStaff.reduce((s, x) => s + (x.hourly_rate || 0), 0) / (activeStaff.length || 1);
  const teams = [...new Set(activeStaff.map(s => s.team))];

  doc.autoTable({
    startY: summaryY,
    head: [['Summary', 'Value']],
    body: [
      ['Total Active Staff', activeStaff.length],
      ['Care Roles', careStaff.length],
      ['Total Skill Points', totalSkill.toFixed(1)],
      ['Average Hourly Rate', `£${avgRate.toFixed(2)}`],
      ['Teams', teams.join(', ')],
    ],
    styles: { fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: [31, 41, 55] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50 } },
    tableWidth: 140,
  });

  doc.save(`Staff_Register_${formatDate(new Date())}.pdf`);
}

// CQC Compliance Evidence Pack PDF
export function generateEvidencePackPDF(data, dateRangeDays = 28) {
  const doc = new jsPDF('portrait', 'mm', 'a4');
  const today = formatDate(new Date());
  const dateRange = getDateRange(dateRangeDays);
  const score = calculateComplianceScore(data, dateRange, today);
  const homeName = data.config.home_name || 'Care Home';
  const periodLabel = `${formatDate(dateRange.from)} to ${formatDate(dateRange.to)}`;

  // ── Page 1: Cover & Summary ──────────────────────────────────────────────
  let y = addHeader(doc, 'CQC Compliance Evidence Pack', periodLabel, homeName);

  // Overall score
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Overall Compliance Score', 14, y);
  y += 6;

  const bandLabel = score.band.label;
  const scoreColor = score.band.color === 'green' ? [22, 163, 74] : score.band.color === 'amber' ? [217, 119, 6] : [220, 38, 38];

  doc.setFontSize(28);
  doc.setTextColor(...scoreColor);
  doc.text(`${score.overallScore}%`, 14, y + 8);
  doc.setFontSize(12);
  doc.text(bandLabel, 44, y + 8);
  doc.setTextColor(0);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(`Based on ${score.availableMetrics.length} of ${METRIC_DEFINITIONS.length} weighted metrics (${Math.round(score.availableWeight * 100)}% weight available)`, 14, y + 14);
  y += 22;

  // Metric summary table
  const metricRows = METRIC_DEFINITIONS.map(m => {
    const result = score.metrics[m.id];
    return [
      m.label,
      `${Math.round(m.weight * 100)}%`,
      m.available ? 'Yes' : 'No',
      result ? `${result.raw}%` : '-',
      result ? `${result.score}` : '-',
    ];
  });

  doc.autoTable({
    startY: y,
    head: [['Metric', 'Weight', 'Available', 'Raw Value', 'Score']],
    body: metricRows,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [31, 41, 55], fontSize: 8 },
    didParseCell(hookData) {
      if (hookData.section === 'body' && hookData.column.index === 2) {
        if (hookData.cell.raw === 'No') {
          hookData.cell.styles.textColor = [156, 163, 175];
          hookData.cell.styles.fillColor = [249, 250, 251];
        }
      }
    },
  });

  // ── Page 2: S1 — Staffing Levels ──────────────────────────────────────────
  doc.addPage();
  y = addHeader(doc, 'S1: Staffing Levels', 'Regulation 18 — Safe Staffing', homeName);

  const fillResult = score.metrics.staffingFillRate?.detail;
  const agencyResult = score.metrics.agencyDependency?.detail;

  doc.autoTable({
    startY: y,
    head: [['Staffing KPI', 'Value']],
    body: [
      ['Fill Rate', `${fillResult?.pct || '-'}%`],
      ['Slots Filled / Required', `${fillResult?.filledSlots || '-'} / ${fillResult?.totalSlots || '-'}`],
      ['Shortfall Days', `${fillResult?.shortfallDays || 0}`],
      ['Agency Cost', `£${(agencyResult?.agencyCost || 0).toLocaleString()}`],
      ['Agency as % of Total', `${agencyResult?.pct || 0}%`],
      ['Total Staffing Cost', `£${(agencyResult?.totalCost || 0).toLocaleString()}`],
    ],
    styles: { fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: [31, 41, 55] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60 } },
    tableWidth: 130,
  });

  // Coverage detail table (limit to 28 days max in PDF)
  const covDays = Math.min(dateRangeDays, 28);
  const covRange = getDateRange(covDays);
  const coverage = getCoverageSummary(data, covRange);

  y = doc.lastAutoTable.finalY + 6;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(`Daily Coverage — Last ${covDays} Days`, 14, y);
  y += 3;

  const escLabels = ['Normal', 'Float', 'OT', 'Agency', 'Short', 'UNSAFE'];
  doc.autoTable({
    startY: y,
    head: [['Date', 'Early', 'Late', 'Night', 'Worst']],
    body: coverage.map(r => [
      r.date,
      `${r.early.actual}/${r.early.required}`,
      `${r.late.actual}/${r.late.required}`,
      `${r.night.actual}/${r.night.required}`,
      escLabels[r.worst] || 'Normal',
    ]),
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [31, 41, 55], fontSize: 7 },
    didParseCell(hookData) {
      if (hookData.section === 'body' && hookData.column.index === 4) {
        const val = hookData.cell.raw;
        if (val === 'Short' || val === 'UNSAFE') { hookData.cell.styles.fillColor = [254, 226, 226]; hookData.cell.styles.textColor = [153, 27, 27]; hookData.cell.styles.fontStyle = 'bold'; }
        else if (val === 'Agency') { hookData.cell.styles.fillColor = [254, 249, 195]; hookData.cell.styles.textColor = [133, 77, 14]; }
      }
    },
  });

  // ── Page 3: S2 — Training ──────────────────────────────────────────────────
  doc.addPage();
  y = addHeader(doc, 'S2: Staff Training & Competency', 'Regulation 18 — Staffing', homeName);

  const training = calculateTrainingBreakdown(data, today);

  doc.autoTable({
    startY: y,
    head: [['Training KPI', 'Value']],
    body: [
      ['Overall Compliance', `${training.stats.compliancePct}%`],
      ['Total Required', `${training.stats.totalRequired}`],
      ['Compliant', `${training.stats.compliant}`],
      ['Expiring Soon (30-60d)', `${training.stats.expiringSoon}`],
      ['Urgent (<30d)', `${training.stats.urgent}`],
      ['Expired', `${training.stats.expired}`],
      ['Not Started', `${training.stats.notStarted}`],
    ],
    styles: { fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: [31, 41, 55] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60 } },
    tableWidth: 130,
  });

  // Per-type breakdown
  y = doc.lastAutoTable.finalY + 6;
  doc.autoTable({
    startY: y,
    head: [['Training Type', 'Legislation', 'Compliant', 'Expired', 'Not Started', 'Total']],
    body: training.perType.map(t => [t.name, t.legislation, t.compliant, t.expired, t.notStarted, t.total]),
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [31, 41, 55], fontSize: 7 },
    didParseCell(hookData) {
      if (hookData.section === 'body') {
        if (hookData.column.index === 3 && Number(hookData.cell.raw) > 0) {
          hookData.cell.styles.fillColor = [254, 226, 226]; hookData.cell.styles.textColor = [153, 27, 27]; hookData.cell.styles.fontStyle = 'bold';
        }
        if (hookData.column.index === 4 && Number(hookData.cell.raw) > 0) {
          hookData.cell.styles.fillColor = [254, 249, 195]; hookData.cell.styles.textColor = [133, 77, 14];
        }
      }
    },
  });

  // Non-compliant staff list (top 20)
  if (training.nonCompliant.length > 0) {
    y = doc.lastAutoTable.finalY + 6;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Non-Compliant Staff', 14, y);
    y += 3;

    doc.autoTable({
      startY: y,
      head: [['Staff', 'Role', 'Training', 'Status', 'Days']],
      body: training.nonCompliant.slice(0, 20).map(nc => [
        nc.staffName, nc.staffRole, nc.trainingName,
        nc.status === 'expired' ? 'EXPIRED' : 'URGENT',
        nc.daysUntilExpiry < 0 ? `${Math.abs(nc.daysUntilExpiry)}d overdue` : `${nc.daysUntilExpiry}d left`,
      ]),
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [31, 41, 55], fontSize: 7 },
      didParseCell(hookData) {
        if (hookData.section === 'body' && hookData.column.index === 3) {
          if (hookData.cell.raw === 'EXPIRED') { hookData.cell.styles.fillColor = [254, 226, 226]; hookData.cell.styles.textColor = [153, 27, 27]; }
          else { hookData.cell.styles.fillColor = [255, 237, 213]; hookData.cell.styles.textColor = [154, 52, 18]; }
        }
      },
    });
  }

  // ── Page 4: S3 — Safeguarding ──────────────────────────────────────────────
  doc.addPage();
  y = addHeader(doc, 'S3: Safeguarding', 'Regulation 13, 19 — Safeguarding & Fit Persons', homeName);

  const sgPct = calculateSafeguardingTrainingPct(data, today);
  const dbsList = getDbsStatusList(data);
  const dbsComplete = dbsList.filter(d => d.dbsStatus === 'Clear').length;

  doc.autoTable({
    startY: y,
    head: [['Safeguarding KPI', 'Value']],
    body: [
      ['Safeguarding Training Compliance', `${sgPct}%`],
      ['DBS Checks Complete', `${dbsComplete}/${dbsList.length}`],
      ['DBS Completion Rate', `${dbsList.length > 0 ? Math.round((dbsComplete / dbsList.length) * 100) : 100}%`],
    ],
    styles: { fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: [31, 41, 55] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60 } },
    tableWidth: 130,
  });

  // DBS status table
  y = doc.lastAutoTable.finalY + 6;
  doc.autoTable({
    startY: y,
    head: [['Staff', 'Role', 'DBS Status', 'DBS Number', 'Barred List', 'RTW Expiry']],
    body: dbsList.map(d => [d.name, d.role, d.dbsStatus, d.dbsNumber, d.barredListChecked, d.rtwExpiry]),
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [31, 41, 55], fontSize: 7 },
    didParseCell(hookData) {
      if (hookData.section === 'body' && hookData.column.index === 2) {
        if (hookData.cell.raw === 'Missing') { hookData.cell.styles.fillColor = [254, 226, 226]; hookData.cell.styles.textColor = [153, 27, 27]; hookData.cell.styles.fontStyle = 'bold'; }
        else if (hookData.cell.raw === 'In Progress') { hookData.cell.styles.fillColor = [254, 249, 195]; hookData.cell.styles.textColor = [133, 77, 14]; }
        else { hookData.cell.styles.fillColor = [220, 252, 231]; hookData.cell.styles.textColor = [22, 101, 52]; }
      }
    },
  });

  // ── Page 5: WL1 — Governance ───────────────────────────────────────────────
  doc.addPage();
  y = addHeader(doc, 'WL1: Governance & Audit', 'Regulation 17 — Good Governance', homeName);

  const activeStaff = (data.staff || []).filter(s => s.active !== false);
  const obMatrix = buildOnboardingMatrix(activeStaff, ONBOARDING_SECTIONS, data.onboarding || {});
  const obStats = getOnboardingStats(obMatrix);

  doc.autoTable({
    startY: y,
    head: [['Governance KPI', 'Value']],
    body: [
      ['Onboarding Completion', `${obStats.completionPct}%`],
      ['Total Checkpoints', `${obStats.total}`],
      ['Completed', `${obStats.completed}`],
      ['In Progress', `${obStats.inProgress}`],
      ['Not Started', `${obStats.notStarted}`],
    ],
    styles: { fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: [31, 41, 55] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60 } },
    tableWidth: 130,
  });

  // Incomplete onboarding items by staff
  const incompleteStaff = activeStaff.filter(s => {
    const staffMap = obMatrix.get(s.id);
    if (!staffMap) return true;
    for (const [, result] of staffMap) {
      if (result.status !== 'completed') return true;
    }
    return false;
  });

  if (incompleteStaff.length > 0) {
    y = doc.lastAutoTable.finalY + 6;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Staff with Incomplete Onboarding', 14, y);
    y += 3;

    const obRows = [];
    for (const s of incompleteStaff) {
      const staffMap = obMatrix.get(s.id);
      const missing = [];
      for (const sec of ONBOARDING_SECTIONS) {
        const result = staffMap?.get(sec.id);
        if (!result || result.status !== 'completed') missing.push(sec.name);
      }
      obRows.push([s.name, s.role, s.start_date || '-', missing.join(', ')]);
    }

    doc.autoTable({
      startY: y,
      head: [['Staff', 'Role', 'Start Date', 'Missing Sections']],
      body: obRows,
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [31, 41, 55], fontSize: 7 },
      columnStyles: { 3: { cellWidth: 80 } },
    });
  }

  // ── Page 6: S4-S5 — Premises Safety & Incident Learning ──────────────────
  doc.addPage();
  y = addHeader(doc, 'S4-S5: Premises Safety & Incident Learning', 'Regulation 12, 15', homeName);

  const fireDrillPct = calculateFireDrillCompliancePct(data, today);
  const fdStatus = getFireDrillStatus(data.fire_drills || [], today);
  const fromStr = formatDate(dateRange.from);
  const toStr = formatDate(dateRange.to);
  const acr = calculateActionCompletionRate(data.incidents || [], fromStr, toStr);
  const incidentTrends = getIncidentTrendData(data.incidents || [], fromStr, toStr);

  doc.autoTable({
    startY: y,
    head: [['Premises & Incident KPI', 'Value']],
    body: [
      ['Fire Drill Compliance', `${fireDrillPct}%`],
      ['Drills This Year', `${fdStatus.drillsThisYear || 0}`],
      ['Avg Evacuation Time', `${fdStatus.avgEvacTime || '-'} seconds`],
      ['Next Drill Due', fdStatus.nextDue ? formatDate(fdStatus.nextDue) : 'OVERDUE'],
      ['Corrective Actions — Total', `${acr.total}`],
      ['Corrective Actions — Completed', `${acr.completed}`],
      ['Corrective Actions — Overdue', `${acr.overdue}`],
      ['Action Completion Rate', `${acr.completionPct}%`],
      ['Incidents in Period', `${incidentTrends.monthlyTrend.reduce((s, m) => s + m.count, 0)}`],
    ],
    styles: { fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: [31, 41, 55] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60 } },
    tableWidth: 130,
  });

  // Fire drill history
  const drills = (data.fire_drills || []).sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 8);
  if (drills.length > 0) {
    y = doc.lastAutoTable.finalY + 6;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Recent Fire Drills', 14, y);
    y += 3;
    doc.autoTable({
      startY: y,
      head: [['Date', 'Scenario', 'Evac Time (s)', 'Staff Present', 'Conducted By']],
      body: drills.map(d => [d.date, (d.scenario || '').substring(0, 60), d.evacuation_time_seconds || '-', d.staff_present?.length || 0, d.conducted_by || '-']),
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [31, 41, 55], fontSize: 7 },
    });
  }

  // ── Page 7: Effective — E1-E3 ──────────────────────────────────────────────
  doc.addPage();
  y = addHeader(doc, 'Effective: Training, Competence & Consent', 'Regulation 11, 18', homeName);

  const aprStats = getAppraisalStats(activeStaff, data.appraisals || {}, today);
  const mcaPct = calculateMcaTrainingCompliancePct(data, today);
  const trendData = calculateTrainingTrend(data, today);

  doc.autoTable({
    startY: y,
    head: [['Effective KPI', 'Value']],
    body: [
      ['Training Compliance', `${training.stats.compliancePct}%`],
      ['Training Trend (90-day)', `${trendData.trend >= 0 ? '+' : ''}${trendData.trend}pp (${trendData.pastPct}% → ${trendData.currentPct}%)`],
      ['Appraisal Completion', `${aprStats.completionPct}%`],
      ['Appraisals — Up to Date', `${aprStats.upToDate}`],
      ['Appraisals — Overdue', `${aprStats.overdue}`],
      ['Appraisals — Not Started', `${aprStats.notStarted}`],
      ['Supervision Completion', `${score.metrics.supervisionCompletion?.raw || 0}%`],
      ['Onboarding Completion', `${obStats.completionPct}%`],
      ['MCA/DoLS Training', `${mcaPct}%`],
    ],
    styles: { fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: [16, 120, 100] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60 } },
    tableWidth: 130,
  });

  // ── Page 8: Caring — C1-C2 ─────────────────────────────────────────────────
  doc.addPage();
  y = addHeader(doc, 'Caring: Dignity, Respect & Privacy', 'Regulation 10', homeName);

  const eqPct = calculateEqualityTrainingPct(data, today);
  const dpPct = calculateDataProtectionTrainingPct(data, today);

  doc.autoTable({
    startY: y,
    head: [['Caring KPI', 'Value']],
    body: [
      ['Equality & Diversity Training', `${eqPct}%`],
      ['Data Protection Training', `${dpPct}%`],
    ],
    styles: { fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: [190, 24, 93] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60 } },
    tableWidth: 130,
  });

  // Manual evidence for Caring/Responsive
  const caringEvidence = (data.cqc_evidence || []).filter(e => ['C1', 'C2', 'R1', 'R2'].includes(e.quality_statement));
  if (caringEvidence.length > 0) {
    y = doc.lastAutoTable.finalY + 6;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Manual Evidence — Caring & Responsive', 14, y);
    y += 3;
    doc.autoTable({
      startY: y,
      head: [['Statement', 'Type', 'Title', 'Description', 'Period']],
      body: caringEvidence.map(e => {
        const qs = QUALITY_STATEMENTS.find(q => q.id === e.quality_statement);
        return [
          qs?.name || e.quality_statement,
          e.type,
          e.title,
          (e.description || '').substring(0, 80) + (e.description?.length > 80 ? '...' : ''),
          `${e.date_from || '-'} to ${e.date_to || 'ongoing'}`,
        ];
      }),
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [190, 24, 93], fontSize: 7 },
    });
  } else {
    y = doc.lastAutoTable.finalY + 8;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(120);
    doc.text('No manual evidence recorded for Caring or Responsive statements. Add evidence via the CQC Evidence page.', 14, y);
    doc.setTextColor(0);
  }

  // ── Page 9: WL1-3 — Governance & Workforce ────────────────────────────────
  doc.addPage();
  y = addHeader(doc, 'WL1-3: Governance, Quality & Workforce', 'Regulation 17, 18', homeName);

  const sickResult = calculateSickRate(data, dateRange);
  const fatigueRisks = getFatigueSummary(data);

  doc.autoTable({
    startY: y,
    head: [['Governance & Workforce KPI', 'Value']],
    body: [
      ['Onboarding Completion', `${obStats.completionPct}%`],
      ['Completed Checkpoints', `${obStats.completed}/${obStats.total}`],
      ['Sickness Rate', `${sickResult.pct}%`],
      ['Sick Days (period)', `${sickResult.sickDays}`],
      ['Total Working Days', `${sickResult.totalWorkingDays}`],
      ['Staff at Fatigue Risk', `${fatigueRisks.length}`],
      ['Active Care Staff', `${activeStaff.filter(s => isCareRole(s.role)).length}`],
    ],
    styles: { fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: [31, 41, 55] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60 } },
    tableWidth: 130,
  });

  // Fatigue risks
  if (fatigueRisks.length > 0) {
    y = doc.lastAutoTable.finalY + 6;
    doc.autoTable({
      startY: y,
      head: [['Staff at Fatigue Risk', 'Role', 'Consecutive Days', 'Status']],
      body: fatigueRisks.map(f => [f.name, f.role, f.consecutive, f.exceeded ? 'EXCEEDED' : 'At Limit']),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [31, 41, 55], fontSize: 8 },
      didParseCell(hookData) {
        if (hookData.section === 'body' && hookData.column.index === 3) {
          if (hookData.cell.raw === 'EXCEEDED') { hookData.cell.styles.fillColor = [254, 226, 226]; hookData.cell.styles.textColor = [153, 27, 27]; }
        }
      },
    });
  }

  // ── Page 10: WL4-5 — Engagement & Improvement ─────────────────────────────
  doc.addPage();
  y = addHeader(doc, 'WL4-5: Staff Engagement & Continuous Improvement', 'Regulation 17, 18', homeName);

  const turnover = calculateStaffTurnover(data, dateRange);
  const fbPct = calculateFatigueBreachesPct(data, dateRange);

  doc.autoTable({
    startY: y,
    head: [['Engagement & Improvement KPI', 'Value']],
    body: [
      ['Staff Turnover', `${turnover.pct}% (${turnover.leavers} leavers / ${turnover.avgHeadcount} headcount)`],
      ['Sickness Rate', `${sickResult.pct}%`],
      ['Fatigue Breach Rate', `${fbPct}%`],
      ['Action Completion Rate', `${acr.completionPct}%`],
      ['Training Trend (90-day)', `${trendData.trend >= 0 ? '+' : ''}${trendData.trend}pp`],
      ['Training Current', `${trendData.currentPct}%`],
      ['Training 90 Days Ago', `${trendData.pastPct}%`],
    ],
    styles: { fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: [88, 28, 135] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60 } },
    tableWidth: 130,
  });

  // Manual evidence items (all statements)
  const manualEvidence = (data.cqc_evidence || []).filter(e => !['C1', 'C2', 'R1', 'R2'].includes(e.quality_statement));
  if (manualEvidence.length > 0) {
    y = doc.lastAutoTable.finalY + 8;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Additional Manual Evidence', 14, y);
    y += 3;

    doc.autoTable({
      startY: y,
      head: [['Statement', 'Type', 'Title', 'Description', 'Period']],
      body: manualEvidence.map(e => {
        const qs = QUALITY_STATEMENTS.find(q => q.id === e.quality_statement);
        return [
          qs?.cqcRef || e.quality_statement,
          e.type,
          e.title,
          (e.description || '').substring(0, 80) + (e.description?.length > 80 ? '...' : ''),
          `${e.date_from || '-'} to ${e.date_to || 'ongoing'}`,
        ];
      }),
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [31, 41, 55], fontSize: 7 },
    });
  }

  // ── Page 11: Complaints & Feedback ────────────────────────────────────────
  doc.addPage();
  y = addHeader(doc, 'Complaints & Feedback', 'Regulation 16 — QS23', homeName);

  const complaintStats = getComplaintStats(data.complaints || [], data.config, fromStr, toStr);
  const surveyStats = getSurveyStats(data.complaint_surveys || [], fromStr, toStr);

  doc.autoTable({
    startY: y,
    head: [['Complaints KPI', 'Value']],
    body: [
      ['Total Complaints', `${complaintStats.total}`],
      ['Open / Active', `${complaintStats.open}`],
      ['Resolved', `${complaintStats.resolved}`],
      ['Resolution Rate', `${complaintStats.resolutionRate}%`],
      ['Avg Response Time', complaintStats.avgResponseDays != null ? `${complaintStats.avgResponseDays} days` : 'N/A'],
      ['Overdue Responses', `${complaintStats.overdue}`],
      ['Survey Satisfaction', surveyStats.avgSatisfaction != null ? `${surveyStats.avgSatisfaction}/5` : 'No surveys'],
      ['Survey Response Rate', surveyStats.responseRate != null ? `${surveyStats.responseRate}%` : 'N/A'],
    ],
    styles: { fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: [31, 41, 55] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60 } },
    tableWidth: 130,
  });

  const recentComplaints = (data.complaints || []).sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 10);
  if (recentComplaints.length > 0) {
    y = doc.lastAutoTable.finalY + 6;
    doc.autoTable({
      startY: y,
      head: [['Date', 'Category', 'Title', 'Status', 'Response Days']],
      body: recentComplaints.map(c => {
        const st = c.resolution_date && c.date ? Math.round((new Date(c.resolution_date) - new Date(c.date)) / (1000 * 60 * 60 * 24)) : '-';
        return [c.date || '-', c.category || '-', (c.title || '').substring(0, 40), c.status || '-', st];
      }),
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [31, 41, 55], fontSize: 7 },
    });
  }

  // ── Page 12: Maintenance & Environment ──────────────────────────────────
  doc.addPage();
  y = addHeader(doc, 'Maintenance & Environment', 'Regulation 15 — QS5/QS34', homeName);

  const maintStats = getMaintenanceStats(data.maintenance || [], today);

  doc.autoTable({
    startY: y,
    head: [['Maintenance KPI', 'Value']],
    body: [
      ['Total Checks', `${maintStats.total}`],
      ['Compliant', `${maintStats.compliant}`],
      ['Due Soon', `${maintStats.dueSoon}`],
      ['Overdue', `${maintStats.overdue}`],
      ['Not Started', `${maintStats.notStarted}`],
      ['Compliance %', `${maintStats.compliancePct}%`],
    ],
    styles: { fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: [31, 41, 55] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60 } },
    tableWidth: 130,
  });

  const maintItems = (data.maintenance || []).map(m => ({
    ...m,
    _status: getMaintenanceStatus(m, today),
  })).sort((a, b) => {
    const order = { overdue: 0, due_soon: 1, not_started: 2, compliant: 3 };
    return (order[a._status.status] ?? 9) - (order[b._status.status] ?? 9);
  });

  if (maintItems.length > 0) {
    y = doc.lastAutoTable.finalY + 6;
    doc.autoTable({
      startY: y,
      head: [['Category', 'Frequency', 'Last Completed', 'Next Due', 'Status', 'Certificate']],
      body: maintItems.map(m => [
        m.category_name || m.category,
        FREQUENCY_OPTIONS.find(f => f.id === m.frequency)?.name || m.frequency,
        m.last_completed || '-',
        m._status.nextDue || m.next_due || '-',
        m._status.status,
        m.certificate_ref || '-',
      ]),
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [31, 41, 55], fontSize: 7 },
      didParseCell(hookData) {
        if (hookData.section === 'body' && hookData.column.index === 4) {
          if (hookData.cell.raw === 'overdue') { hookData.cell.styles.fillColor = [254, 226, 226]; hookData.cell.styles.textColor = [153, 27, 27]; }
          else if (hookData.cell.raw === 'due_soon') { hookData.cell.styles.fillColor = [254, 249, 195]; hookData.cell.styles.textColor = [133, 77, 14]; }
          else if (hookData.cell.raw === 'compliant') { hookData.cell.styles.fillColor = [220, 252, 231]; hookData.cell.styles.textColor = [22, 101, 52]; }
        }
      },
    });
  }

  // ── Page 13: IPC Audit Summary ─────────────────────────────────────────
  doc.addPage();
  y = addHeader(doc, 'Infection Prevention & Control', 'Regulation 12 — QS7', homeName);

  const ipcStats = getIpcStats(data.ipc_audits || [], today);

  doc.autoTable({
    startY: y,
    head: [['IPC KPI', 'Value']],
    body: [
      ['Average Audit Score', ipcStats.avgScore != null ? `${ipcStats.avgScore}%` : 'No audits'],
      ['Audits This Quarter', `${ipcStats.auditsThisQuarter}`],
      ['Active Outbreaks', `${ipcStats.activeOutbreaks}`],
      ['Action Completion', `${ipcStats.actionCompletion}%`],
    ],
    styles: { fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: [31, 41, 55] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60 } },
    tableWidth: 130,
  });

  const recentAudits = (data.ipc_audits || []).sort((a, b) => (b.audit_date || '').localeCompare(a.audit_date || '')).slice(0, 10);
  if (recentAudits.length > 0) {
    y = doc.lastAutoTable.finalY + 6;
    doc.autoTable({
      startY: y,
      head: [['Date', 'Type', 'Auditor', 'Score', 'Risk Areas', 'Actions']],
      body: recentAudits.map(a => [
        a.audit_date || '-',
        a.audit_type || '-',
        a.auditor || '-',
        a.compliance_pct != null ? `${a.compliance_pct}%` : '-',
        (a.risk_areas || []).length,
        (a.corrective_actions || []).length,
      ]),
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [31, 41, 55], fontSize: 7 },
    });
  }

  // ── Page 14: Risk Register Summary ─────────────────────────────────────
  doc.addPage();
  y = addHeader(doc, 'Risk Register', 'Regulation 17 — QS31', homeName);

  const riskStats = getRiskStats(data.risk_register || [], today);

  doc.autoTable({
    startY: y,
    head: [['Risk KPI', 'Value']],
    body: [
      ['Total Open Risks', `${riskStats.total}`],
      ['Critical (Score >= 16)', `${riskStats.critical}`],
      ['High (Score 10-15)', `${riskStats.high}`],
      ['Reviews Overdue', `${riskStats.reviewsOverdue}`],
      ['Actions Overdue', `${riskStats.actionsOverdue}`],
    ],
    styles: { fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: [31, 41, 55] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60 } },
    tableWidth: 130,
  });

  const openRisks = (data.risk_register || []).filter(r => r.status !== 'closed')
    .sort((a, b) => ((b.likelihood || 1) * (b.impact || 1)) - ((a.likelihood || 1) * (a.impact || 1))).slice(0, 15);
  if (openRisks.length > 0) {
    y = doc.lastAutoTable.finalY + 6;
    doc.autoTable({
      startY: y,
      head: [['Title', 'Category', 'L', 'I', 'Score', 'Band', 'Next Review']],
      body: openRisks.map(r => {
        const sc = (r.likelihood || 1) * (r.impact || 1);
        const band = getRiskBand(sc);
        return [
          (r.title || '').substring(0, 40), r.category || '-',
          r.likelihood || '-', r.impact || '-', sc, band?.name || '-', r.next_review || '-',
        ];
      }),
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [31, 41, 55], fontSize: 7 },
      didParseCell(hookData) {
        if (hookData.section === 'body' && hookData.column.index === 5) {
          const val = hookData.cell.raw;
          if (val === 'Critical') { hookData.cell.styles.fillColor = [233, 213, 255]; hookData.cell.styles.textColor = [88, 28, 135]; }
          else if (val === 'High') { hookData.cell.styles.fillColor = [254, 226, 226]; hookData.cell.styles.textColor = [153, 27, 27]; }
          else if (val === 'Medium') { hookData.cell.styles.fillColor = [254, 249, 195]; hookData.cell.styles.textColor = [133, 77, 14]; }
        }
      },
    });
  }

  // ── Page 15: Governance — Policies, DoLS, Speak Up ─────────────────────
  doc.addPage();
  y = addHeader(doc, 'Governance: Policies, DoLS & Speak Up', 'Regulation 11, 13, 17', homeName);

  const polStats = getPolicyStats(data.policy_reviews || [], today);
  const dolStats = getDolsStats(data.dols || [], data.mca_assessments || [], today);
  const wbStats = getWhistleblowingStats(data.whistleblowing_concerns || [], fromStr, toStr);

  doc.autoTable({
    startY: y,
    head: [['Governance KPI', 'Value']],
    body: [
      ['Policies — Current', `${polStats.current}`],
      ['Policies — Due for Review', `${polStats.due}`],
      ['Policies — Overdue', `${polStats.overdue}`],
      ['Policy Compliance', `${polStats.compliancePct}%`],
      ['DoLS/LPS — Active', `${dolStats.activeCount}`],
      ['DoLS/LPS — Expiring <90d', `${dolStats.expiringSoon}`],
      ['DoLS/LPS — Expired', `${dolStats.expired}`],
      ['MCA Assessments', `${dolStats.mcaTotal}`],
      ['MCA Reviews Overdue', `${dolStats.mcaOverdue}`],
      ['Speak Up Concerns (period)', `${wbStats.total}`],
      ['Speak Up — Open', `${wbStats.open}`],
      ['Avg Investigation Days', wbStats.avgInvestigationDays != null ? `${wbStats.avgInvestigationDays}` : 'N/A'],
      ['Protection Rate', `${wbStats.protectionRate}%`],
    ],
    styles: { fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: [31, 41, 55] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60 } },
    tableWidth: 130,
  });

  // Policy detail table
  if ((data.policy_reviews || []).length > 0) {
    y = doc.lastAutoTable.finalY + 6;
    doc.autoTable({
      startY: y,
      head: [['Policy', 'Version', 'Last Reviewed', 'Next Due', 'Status']],
      body: (data.policy_reviews || []).map(p => {
        const st = getPolicyStatus(p, today);
        return [p.policy_name || '-', p.version || '-', p.last_reviewed || 'Never', p.next_review_due || '-', st.status];
      }),
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [31, 41, 55], fontSize: 7 },
      didParseCell(hookData) {
        if (hookData.section === 'body' && hookData.column.index === 4) {
          if (hookData.cell.raw === 'overdue') { hookData.cell.styles.fillColor = [254, 226, 226]; hookData.cell.styles.textColor = [153, 27, 27]; }
          else if (hookData.cell.raw === 'due') { hookData.cell.styles.fillColor = [254, 249, 195]; hookData.cell.styles.textColor = [133, 77, 14]; }
          else if (hookData.cell.raw === 'current') { hookData.cell.styles.fillColor = [220, 252, 231]; hookData.cell.styles.textColor = [22, 101, 52]; }
        }
      },
    });
  }

  // ── Footer note on last page ───────────────────────────────────────────────
  const finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 10 : y + 10;
  doc.setFontSize(7);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(120);
  doc.text('This evidence pack was auto-generated from the Panama Staffing platform. Data covers all 5 CQC core questions:', 14, finalY);
  doc.text('Safe, Effective, Caring, Responsive, Well-Led. Verify figures against source records before presenting to CQC.', 14, finalY + 4);
  doc.setTextColor(0);

  doc.save(`CQC_Evidence_Pack_${homeName.replace(/\s+/g, '_')}_${today}.pdf`);
}
