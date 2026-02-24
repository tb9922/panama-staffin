// PDF Report Generation using jsPDF + autoTable
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { getStaffForDay, formatDate, isWorkingShift, isCareRole, getShiftHours } from './rotation.js';
import { calculateDayCost, getDayCoverageStatus } from './escalation.js';

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
