// All 17 domain validators moved verbatim from server.js.
// No logic changes — these are pure functions operating on the assembled data object.
import { RIDDOR_CATEGORIES, isCqcNotificationOverdue, isDutyOfCandourOverdue } from '../shared/incidents.js';
import { getLeaveYear, getALDeductionHours, STATUTORY_WEEKS } from '../shared/rotation.js';
import { getMinimumWageRate } from '../shared/nmw.js';

function validateALPerDay(data, warnings) {
  const maxAL = data.config.max_al_same_day || 2;
  for (const [dateKey, dayOverrides] of Object.entries(data.overrides)) {
    const alCount = Object.values(dayOverrides).filter(o => o.shift === 'AL').length;
    if (alCount > maxAL) {
      warnings.push(`${dateKey}: ${alCount} AL bookings exceeds max ${maxAL}`);
    }
  }
}

function validateALEntitlement(data, warnings) {
  const leaveYear = getLeaveYear(new Date(), data.config.leave_year_start);

  // Sum AL hours per staff in the leave year
  const alHoursUsed = {};
  for (const [dateKey, dayOverrides] of Object.entries(data.overrides)) {
    if (dateKey < leaveYear.startStr || dateKey > leaveYear.endStr) continue;
    for (const [staffId, override] of Object.entries(dayOverrides)) {
      if (override.shift !== 'AL') continue;
      const staff = data.staff.find(s => s.id === staffId);
      let hrs;
      if (override.al_hours != null) {
        hrs = parseFloat(override.al_hours);
      } else if (staff) {
        // Legacy booking — derive from scheduled shift
        hrs = getALDeductionHours(staff, dateKey, data.config);
      } else {
        hrs = 8; // unknown staff fallback
      }
      alHoursUsed[staffId] = (alHoursUsed[staffId] || 0) + hrs;
    }
  }
  for (const [staffId, used] of Object.entries(alHoursUsed)) {
    const staff = data.staff.find(s => s.id === staffId);
    const contractHours = parseFloat(staff?.contract_hours) || 0;
    const base = staff?.al_entitlement != null
      ? parseFloat(staff.al_entitlement)
      : (contractHours > 0 ? STATUTORY_WEEKS * contractHours : 0);
    const entitlement = base + (parseFloat(staff?.al_carryover) || 0);
    if (entitlement > 0 && used > entitlement) {
      warnings.push(`${staff?.name || staffId}: ${used.toFixed(1)}h AL used in leave year exceeds ${entitlement.toFixed(1)}h entitlement`);
    }
  }
}

function validateNLW(data, warnings) {
  for (const s of data.staff.filter(s => s.active !== false)) {
    if (s.hourly_rate == null) continue;
    const { rate, label } = getMinimumWageRate(s.date_of_birth, data.config);
    if (s.hourly_rate < rate) {
      warnings.push(`${s.name}: rate £${s.hourly_rate.toFixed(2)} is below ${label} £${rate.toFixed(2)}`);
    }
  }
}

function validateTraining(data, warnings, todayStr) {
  if (!data.config.training_types || !data.training) return;
  const activeStaff = data.staff.filter(s => s.active !== false);
  const activeTypes = data.config.training_types.filter(t => t.active);
  let expiredCount = 0;
  let notStartedCount = 0;
  for (const s of activeStaff) {
    const staffRecords = data.training[s.id] || {};
    for (const t of activeTypes) {
      if (t.roles && !t.roles.includes(s.role)) continue;
      const rec = staffRecords[t.id];
      if (!rec || !rec.completed) notStartedCount++;
      else if (rec.expiry && rec.expiry < todayStr) expiredCount++;
    }
  }
  if (expiredCount > 0) warnings.push(`Training: ${expiredCount} expired training record${expiredCount > 1 ? 's' : ''} across active staff`);
  if (notStartedCount > 0) warnings.push(`Training: ${notStartedCount} required training record${notStartedCount > 1 ? 's' : ''} not started`);
}

function validateOnboarding(data, warnings, todayStr) {
  if (!data.staff) return;
  const careRoles = ['Senior Carer', 'Carer', 'Team Lead', 'Night Senior', 'Night Carer', 'Float Senior', 'Float Carer'];
  const activeCarers = data.staff.filter(s => s.active !== false && careRoles.includes(s.role));
  const onboarding = data.onboarding || {};
  const sections = ['dbs_check', 'right_to_work', 'references', 'identity_check', 'health_declaration', 'qualifications', 'contract', 'day1_induction', 'policy_acknowledgement'];
  const workingShifts = ['E', 'L', 'EL', 'N', 'OC-E', 'OC-L', 'OC-EL', 'OC-N', 'BH-D', 'BH-N'];
  const blockingTrainingTypes = ['fire-safety', 'moving-handling', 'safeguarding-adults'];

  let dbsMissing = 0;
  let onboardingIncomplete = 0;

  for (const s of activeCarers) {
    const staffOnb = onboarding[s.id] || {};
    if (!staffOnb.dbs_check || staffOnb.dbs_check.status !== 'completed') dbsMissing++;

    const rtw = staffOnb.right_to_work;
    if (rtw?.expiry_date) {
      const daysLeft = Math.ceil((new Date(rtw.expiry_date + 'T00:00:00Z') - new Date()) / 86400000);
      if (daysLeft < 0) warnings.push(`${s.name}: Right to Work EXPIRED`);
      else if (daysLeft <= 60) warnings.push(`${s.name}: Right to Work expires in ${daysLeft} days`);
    }

    const completed = sections.filter(sec => staffOnb[sec]?.status === 'completed').length;
    if (completed < sections.length) onboardingIncomplete++;
  }

  if (dbsMissing > 0) warnings.push(`Onboarding: ${dbsMissing} active care staff without completed DBS check`);
  if (onboardingIncomplete > 0) warnings.push(`Onboarding: ${onboardingIncomplete} active care staff with incomplete onboarding`);

  if (data.config.enforce_onboarding_blocking && data.overrides) {
    let blockedCount = 0;
    for (const dayOverrides of Object.values(data.overrides)) {
      for (const [staffId, override] of Object.entries(dayOverrides)) {
        if (!workingShifts.includes(override.shift)) continue;
        const staff = activeCarers.find(s => s.id === staffId);
        if (!staff) continue;
        const o = onboarding[staffId] || {};
        if (o.dbs_check?.status !== 'completed' || o.right_to_work?.status !== 'completed' ||
            o.references?.status !== 'completed' || o.identity_check?.status !== 'completed') {
          blockedCount++;
        }
      }
    }
    if (blockedCount > 0) warnings.push(`Roster blocking: ${blockedCount} shift(s) assigned to staff with incomplete onboarding`);
  }

  if (data.config.enforce_training_blocking && data.overrides && data.training) {
    let blockedTraining = 0;
    for (const dayOverrides of Object.values(data.overrides)) {
      for (const [staffId, override] of Object.entries(dayOverrides)) {
        if (!workingShifts.includes(override.shift)) continue;
        const staff = activeCarers.find(s => s.id === staffId);
        if (!staff) continue;
        const staffRec = data.training[staffId] || {};
        const types = data.config.training_types || [];
        for (const typeId of blockingTrainingTypes) {
          const t = types.find(tt => tt.id === typeId);
          if (!t || !t.active) continue;
          if (t.roles && !t.roles.includes(staff.role)) continue;
          const rec = staffRec[typeId];
          if (!rec || !rec.completed || (rec.expiry && rec.expiry < todayStr)) {
            blockedTraining++;
            break;
          }
        }
      }
    }
    if (blockedTraining > 0) warnings.push(`Roster blocking: ${blockedTraining} shift(s) assigned to staff with expired critical training`);
  }
}

function validateSupervisions(data, warnings) {
  if (!data.staff || !data.supervisions) return;
  const activeStaff = data.staff.filter(s => s.active !== false);
  const now = new Date();
  let overdue = 0;
  let noRecord = 0;
  for (const s of activeStaff) {
    const sups = data.supervisions[s.id] || [];
    if (sups.length === 0) { noRecord++; continue; }
    const latest = [...sups].sort((a, b) => b.date.localeCompare(a.date))[0];
    const probMonths = data.config.supervision_probation_months || 6;
    const startDate = s.start_date ? new Date(s.start_date + 'T00:00:00Z') : null;
    let inProbation = false;
    if (startDate) {
      const probEnd = new Date(startDate);
      probEnd.setUTCMonth(probEnd.getUTCMonth() + probMonths);
      inProbation = now < probEnd;
    }
    const freq = inProbation ? (data.config.supervision_frequency_probation || 30) : (data.config.supervision_frequency_standard || 49);
    const nextDue = new Date(new Date(latest.date + 'T00:00:00Z').getTime() + freq * 86400000);
    if (now > nextDue) overdue++;
  }
  if (overdue > 0) warnings.push(`Supervisions: ${overdue} staff with overdue supervision`);
  if (noRecord > 0) warnings.push(`Supervisions: ${noRecord} staff with no supervision records`);
}

function validateAppraisals(data, warnings) {
  if (!data.staff || !data.appraisals) return;
  const now = new Date();
  let overdue = 0;
  for (const s of data.staff.filter(s => s.active !== false)) {
    const aprs = data.appraisals[s.id] || [];
    if (aprs.length === 0) continue;
    const latest = [...aprs].sort((a, b) => b.date.localeCompare(a.date))[0];
    const nextDue = latest.next_due || (() => {
      const d = new Date(latest.date + 'T00:00:00Z');
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      return d.toISOString().slice(0, 10);
    })();
    if (now > new Date(nextDue + 'T00:00:00Z')) overdue++;
  }
  if (overdue > 0) warnings.push(`Appraisals: ${overdue} staff with overdue annual appraisal`);
}

function validateFireDrills(data, warnings) {
  if (!data.fire_drills?.length) {
    warnings.push('Fire drills: no drills recorded — quarterly requirement not met');
    return;
  }
  const now = new Date();
  const sorted = [...data.fire_drills].sort((a, b) => b.date.localeCompare(a.date));
  const nextDue = new Date(new Date(sorted[0].date + 'T00:00:00Z').getTime() + 91 * 86400000);
  if (now > nextDue) warnings.push(`Fire drills: overdue — last drill was ${sorted[0].date}`);
  const yearAgo = new Date(now);
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
  const drillsThisYear = data.fire_drills.filter(d => new Date(d.date + 'T00:00:00Z') >= yearAgo).length;
  if (drillsThisYear < 4) warnings.push(`Fire drills: only ${drillsThisYear} in last 12 months (minimum 4 required)`);
}

function validateIncidents(data, warnings, todayStr) {
  if (!data.incidents?.length) return;
  const now = new Date();
  let overdueCqc = 0, overdueRiddor = 0, staleInvestigations = 0, overdueDoc = 0, overdueActions = 0;

  const bankHolidays = data.config?.bank_holidays || [];
  for (const inc of data.incidents) {
    if (isCqcNotificationOverdue(inc, now)) overdueCqc++;
    if (inc.riddor_reportable && !inc.riddor_reported && inc.date) {
      const cat = RIDDOR_CATEGORIES.find(r => r.id === inc.riddor_category);
      // deadlineDays=0 means "immediate" — give 1 day grace, same logic as incidents.js isRiddorOverdue
      const days = cat ? (cat.deadlineDays === 0 ? 1 : cat.deadlineDays) : 1;
      const deadline = new Date(new Date(inc.date + 'T00:00:00Z').getTime() + days * 86400000);
      if (now > deadline) overdueRiddor++;
    }
    if ((inc.investigation_status === 'open' || inc.investigation_status === 'under_review') && inc.date) {
      if (Math.floor((now - new Date(inc.date + 'T00:00:00Z')) / 86400000) > 14) staleInvestigations++;
    }
    if (isDutyOfCandourOverdue(inc, now, bankHolidays)) overdueDoc++;
    for (const action of (inc.corrective_actions || [])) {
      if (action.status !== 'completed' && action.due_date && action.due_date < todayStr) overdueActions++;
    }
  }

  if (overdueCqc > 0) warnings.push(`Incidents: ${overdueCqc} CQC notification${overdueCqc > 1 ? 's' : ''} overdue`);
  if (overdueRiddor > 0) warnings.push(`Incidents: ${overdueRiddor} RIDDOR report${overdueRiddor > 1 ? 's' : ''} overdue`);
  if (staleInvestigations > 0) warnings.push(`Incidents: ${staleInvestigations} open investigation${staleInvestigations > 1 ? 's' : ''} older than 14 days`);
  if (overdueDoc > 0) warnings.push(`Incidents: ${overdueDoc} Duty of Candour notification${overdueDoc > 1 ? 's' : ''} overdue`);
  if (overdueActions > 0) warnings.push(`Incidents: ${overdueActions} corrective action${overdueActions > 1 ? 's' : ''} past due date`);
}

function validateComplaints(data, warnings, todayStr) {
  if (!data.complaints?.length) return;
  const responseDays = data.config?.complaint_response_days || 28;
  const now = new Date();
  let unacknowledged = 0, overdueResponse = 0;
  for (const c of data.complaints) {
    if (c.status === 'resolved' || c.status === 'closed') continue;
    if (!c.acknowledged_date && c.date) {
      const ackDeadline = new Date(new Date(c.date + 'T00:00:00Z').getTime() + 2 * 86400000);
      if (now > ackDeadline) unacknowledged++;
    }
    const deadline = c.response_deadline || (c.date
      ? new Date(new Date(c.date + 'T00:00:00Z').getTime() + responseDays * 86400000).toISOString().slice(0, 10)
      : null);
    if (deadline && todayStr > deadline) overdueResponse++;
  }
  if (unacknowledged > 0) warnings.push(`Complaints: ${unacknowledged} not acknowledged within 2 days`);
  if (overdueResponse > 0) warnings.push(`Complaints: ${overdueResponse} response deadline${overdueResponse > 1 ? 's' : ''} overdue`);
}

function validateIPC(data, warnings, todayStr) {
  if (!data.ipc_audits?.length) return;
  let activeOutbreaks = 0, overdueActions = 0;
  for (const audit of data.ipc_audits) {
    if (audit.outbreak?.status === 'suspected' || audit.outbreak?.status === 'confirmed') activeOutbreaks++;
    for (const action of (audit.corrective_actions || [])) {
      if (action.status !== 'completed' && action.due_date && action.due_date < todayStr) overdueActions++;
    }
  }
  if (activeOutbreaks > 0) warnings.push(`IPC: ${activeOutbreaks} active outbreak${activeOutbreaks > 1 ? 's' : ''}`);
  if (overdueActions > 0) warnings.push(`IPC: ${overdueActions} corrective action${overdueActions > 1 ? 's' : ''} overdue`);
}

function validateRisks(data, warnings, todayStr) {
  if (!data.risk_register?.length) return;
  let critical = 0, overdueReviews = 0, overdueActions = 0;
  for (const risk of data.risk_register) {
    if (risk.status === 'closed') continue;
    const rl = risk.residual_likelihood || risk.likelihood || 1;
    const ri = risk.residual_impact    || risk.impact    || 1;
    if (rl * ri >= 16) critical++;
    if (risk.next_review && risk.next_review < todayStr) overdueReviews++;
    for (const action of (risk.actions || [])) {
      if (action.status !== 'completed' && action.due_date && action.due_date < todayStr) overdueActions++;
    }
  }
  if (critical > 0) warnings.push(`Risk Register: ${critical} critical risk${critical > 1 ? 's' : ''} (score >= 16)`);
  if (overdueReviews > 0) warnings.push(`Risk Register: ${overdueReviews} overdue risk review${overdueReviews > 1 ? 's' : ''}`);
  if (overdueActions > 0) warnings.push(`Risk Register: ${overdueActions} overdue risk action${overdueActions > 1 ? 's' : ''}`);
}

function validatePolicies(data, warnings, todayStr) {
  if (!data.policy_reviews?.length) return;
  let overdue = 0;
  for (const pol of data.policy_reviews) {
    if (pol.next_review_due && pol.next_review_due < todayStr) overdue++;
    else if (!pol.last_reviewed) overdue++;
  }
  if (overdue > 0) warnings.push(`Policies: ${overdue} policy review${overdue > 1 ? 's' : ''} overdue`);
}

function validateWhistleblowing(data, warnings) {
  if (!data.whistleblowing_concerns?.length) return;
  const now = new Date();
  let unacknowledged = 0, longInvestigations = 0;
  for (const c of data.whistleblowing_concerns) {
    if (c.status === 'resolved' || c.status === 'closed') continue;
    if (!c.acknowledgement_date && c.date_raised) {
      const deadline = new Date(new Date(c.date_raised + 'T00:00:00Z').getTime() + 3 * 86400000);
      if (now > deadline) unacknowledged++;
    }
    if (c.status === 'investigating' && c.investigation_start_date) {
      const days = Math.floor((now - new Date(c.investigation_start_date + 'T00:00:00Z')) / 86400000);
      if (days > 30) longInvestigations++;
    }
  }
  if (unacknowledged > 0) warnings.push(`Whistleblowing: ${unacknowledged} concern${unacknowledged > 1 ? 's' : ''} not acknowledged within 3 days`);
  if (longInvestigations > 0) warnings.push(`Whistleblowing: ${longInvestigations} investigation${longInvestigations > 1 ? 's' : ''} exceeding 30 days`);
}

function validateMaintenance(data, warnings, todayStr) {
  if (!data.maintenance?.length) return;
  let overdueChecks = 0, expiredCerts = 0;
  for (const m of data.maintenance) {
    if (m.next_due && m.next_due < todayStr) overdueChecks++;
    if (m.certificate_expiry && m.certificate_expiry < todayStr) expiredCerts++;
  }
  if (overdueChecks > 0) warnings.push(`Maintenance: ${overdueChecks} check${overdueChecks > 1 ? 's' : ''} overdue`);
  if (expiredCerts > 0) warnings.push(`Maintenance: ${expiredCerts} certificate${expiredCerts > 1 ? 's' : ''} expired`);
}

function validateDoLS(data, warnings, todayStr) {
  if (!data.dols?.length && !data.mca_assessments?.length) return;
  let expired = 0, overdueReviews = 0;
  for (const d of (data.dols || [])) {
    if (d.authorised && d.expiry_date && d.expiry_date < todayStr) expired++;
  }
  for (const mca of (data.mca_assessments || [])) {
    if (mca.next_review_date && mca.next_review_date < todayStr) overdueReviews++;
  }
  if (expired > 0) warnings.push(`DoLS/LPS: ${expired} expired authorisation${expired > 1 ? 's' : ''}`);
  if (overdueReviews > 0) warnings.push(`MCA: ${overdueReviews} assessment review${overdueReviews > 1 ? 's' : ''} overdue`);
}

function validateCareCertificate(data, warnings) {
  if (!data.care_certificate || Object.keys(data.care_certificate).length === 0) return;
  const now = new Date();
  let overdue = 0;
  for (const cc of Object.values(data.care_certificate)) {
    if (cc.status === 'completed') continue;
    if (cc.start_date) {
      const weeks = Math.floor((now - new Date(cc.start_date + 'T00:00:00Z')) / (7 * 86400000));
      if (weeks > 12) overdue++;
    }
  }
  if (overdue > 0) warnings.push(`Care Certificate: ${overdue} staff exceeding 12-week completion target`);
}

// Thin orchestrator — calls each domain validator in turn
export function validateAll(data) {
  const warnings = [];
  if (!data.overrides || !data.config || !data.staff) return warnings;
  const todayStr = new Date().toISOString().slice(0, 10);

  validateALPerDay(data, warnings);
  validateALEntitlement(data, warnings);
  validateNLW(data, warnings);
  validateTraining(data, warnings, todayStr);
  validateOnboarding(data, warnings, todayStr);
  validateSupervisions(data, warnings);
  validateAppraisals(data, warnings);
  validateFireDrills(data, warnings);
  validateIncidents(data, warnings, todayStr);
  validateComplaints(data, warnings, todayStr);
  validateIPC(data, warnings, todayStr);
  validateRisks(data, warnings, todayStr);
  validatePolicies(data, warnings, todayStr);
  validateWhistleblowing(data, warnings);
  validateMaintenance(data, warnings, todayStr);
  validateDoLS(data, warnings, todayStr);
  validateCareCertificate(data, warnings);

  return warnings;
}
