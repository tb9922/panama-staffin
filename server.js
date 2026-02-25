import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import pino from 'pino';
import { z } from 'zod';
import { config } from './config.js';
import { AppError, ValidationError } from './errors.js';

// ── Logger ────────────────────────────────────────────────────────────────────

const logger = pino({
  level: config.logLevel,
  ...(config.nodeEnv !== 'production' && {
    transport: { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } },
  }),
});

// ── Zod schemas ───────────────────────────────────────────────────────────────

const loginSchema = z.object({
  username: z.string().min(1, 'Username required'),
  password: z.string().min(1, 'Password required'),
});

const homeIdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/, 'Invalid home ID').optional();

// Convenience aliases kept for readability in route handlers below
const { jwtSecret: JWT_SECRET, allowedOrigin: ALLOWED_ORIGIN, port: PORT } = config;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = config.dataDir;
const LEGACY_FILE = config.legacyFile;
const BACKUP_DIR = config.backupDir;
const AUDIT_FILE = config.auditFile;
const USERS = config.users;

// Ensure directories exist
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR);
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
  if (fs.existsSync(LEGACY_FILE)) {
    const data = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf-8'));
    const name = data.config?.home_name?.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default';
    fs.copyFileSync(LEGACY_FILE, path.join(DATA_DIR, `${name}.json`));
  }
}

// ── App setup ────────────────────────────────────────────────────────────────

const app = express();

app.use(helmet());
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json({ limit: config.requestBodyLimit }));

// ── Request ID + structured request logging ───────────────────────────────────

app.use((req, res, next) => {
  req.id = randomUUID();
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    logger.info({ reqId: req.id, method: req.method, url: req.url, status: res.statusCode, ms }, 'request');
  });
  next();
});

// ── Auth middleware ───────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorised' });
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden — admin role required' });
  next();
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts — try again in 15 minutes' },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function getHomes() {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  if (files.length === 0 && fs.existsSync(LEGACY_FILE)) {
    fs.copyFileSync(LEGACY_FILE, path.join(DATA_DIR, 'default.json'));
    return ['default.json'];
  }
  return files;
}

function getDataFile(homeId) {
  const safeName = homeId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeName) throw new Error(`Invalid home ID: "${homeId}"`);
  return path.join(DATA_DIR, `${safeName}.json`);
}

function backupData(homeId) {
  try {
    const dataFile = getDataFile(homeId);
    if (!fs.existsSync(dataFile)) return; // new home — nothing to back up (undefined = ok to proceed)
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(BACKUP_DIR, `${homeId}_${ts}.json`);
    fs.copyFileSync(dataFile, backupFile);

    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith(`${homeId}_`) && f.endsWith('.json'))
      .sort()
      .reverse();
    files.slice(20).forEach(f => {
      try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch {}
    });
  } catch (err) {
    logger.error({ err: err.message, homeId }, 'backup failed');
    return false; // explicit false = backup attempted but failed
  }
  return true;
}

// Per-home write serialisation — prevents race condition on concurrent saves
const writeQueues = new Map();

async function serialisedWrite(homeId, dataJson) {
  const prev = writeQueues.get(homeId) ?? Promise.resolve();
  let resolve;
  const barrier = new Promise(r => { resolve = r; });
  writeQueues.set(homeId, barrier);
  try {
    await prev;
    const dataFile = getDataFile(homeId);
    const tmpFile = dataFile + '.tmp';
    fs.writeFileSync(tmpFile, dataJson);
    fs.renameSync(tmpFile, dataFile); // atomic on same filesystem
  } finally {
    resolve();
  }
}

function logAudit(action, homeId, user, details) {
  try {
    let log = [];
    if (fs.existsSync(AUDIT_FILE)) {
      log = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf-8'));
    }
    log.push({ ts: new Date().toISOString(), action, home: homeId, user: user || 'system', details: details || '' });
    if (log.length > 500) log = log.slice(-500);
    fs.writeFileSync(AUDIT_FILE, JSON.stringify(log, null, 2));
  } catch (err) {
    logger.error({ err: err.message }, 'audit log write failed');
  }
}

// ── Compliance validators (one function per domain) ───────────────────────────

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
  const leaveYearStart = data.config.leave_year_start || '04-01';
  const [lyMM, lyDD] = leaveYearStart.split('-').map(Number);
  const now = new Date();
  const thisYearBoundary = new Date(Date.UTC(now.getUTCFullYear(), lyMM - 1, lyDD));
  let lyStart, lyEnd;
  if (now >= thisYearBoundary) {
    lyStart = thisYearBoundary;
    const nextBoundary = new Date(Date.UTC(now.getUTCFullYear() + 1, lyMM - 1, lyDD));
    lyEnd = new Date(nextBoundary);
    lyEnd.setUTCDate(lyEnd.getUTCDate() - 1);
  } else {
    lyStart = new Date(Date.UTC(now.getUTCFullYear() - 1, lyMM - 1, lyDD));
    lyEnd = new Date(thisYearBoundary);
    lyEnd.setUTCDate(lyEnd.getUTCDate() - 1);
  }
  const lyStartStr = lyStart.toISOString().slice(0, 10);
  const lyEndStr = lyEnd.toISOString().slice(0, 10);

  const alUsed = {};
  for (const [dateKey, dayOverrides] of Object.entries(data.overrides)) {
    if (dateKey < lyStartStr || dateKey > lyEndStr) continue;
    for (const [staffId, override] of Object.entries(dayOverrides)) {
      if (override.shift === 'AL') alUsed[staffId] = (alUsed[staffId] || 0) + 1;
    }
  }
  for (const [staffId, used] of Object.entries(alUsed)) {
    const staff = data.staff.find(s => s.id === staffId);
    const base = staff?.al_entitlement != null ? staff.al_entitlement : (data.config.al_entitlement_days || 28);
    const entitlement = base + (staff?.al_carryover || 0);
    if (used > entitlement) {
      warnings.push(`${staff?.name || staffId}: ${used} AL days in leave year exceeds entitlement of ${entitlement}`);
    }
  }
}

function validateNLW(data, warnings) {
  const nlwRate = data.config.nlw_rate || 12.21;
  for (const s of data.staff.filter(s => s.active !== false)) {
    if (s.hourly_rate != null && s.hourly_rate < nlwRate) {
      warnings.push(`${s.name}: rate £${s.hourly_rate.toFixed(2)} is below NLW £${nlwRate.toFixed(2)}`);
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
      const daysLeft = Math.ceil((new Date(rtw.expiry_date) - new Date()) / 86400000);
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
  const riddorDeadlineDays = { death: 1, specified_injury: 1, dangerous_occurrence: 1, over_7_day: 15 };

  for (const inc of data.incidents) {
    if (inc.cqc_notifiable && !inc.cqc_notified && inc.date) {
      const deadlineHours = inc.cqc_notification_deadline === 'immediate' ? 24 : 72;
      const deadline = new Date(new Date(inc.date + 'T' + (inc.time || '00:00') + ':00').getTime() + deadlineHours * 3600000);
      if (now > deadline) overdueCqc++;
    }
    if (inc.riddor_reportable && !inc.riddor_reported && inc.date) {
      const days = riddorDeadlineDays[inc.riddor_category] ?? 1;
      const deadline = new Date(new Date(inc.date).getTime() + days * 86400000);
      if (now > deadline) overdueRiddor++;
    }
    if (inc.investigation_status !== 'closed' && inc.date) {
      if (Math.floor((now - new Date(inc.date)) / 86400000) > 14) staleInvestigations++;
    }
    if (inc.duty_of_candour_applies && !inc.candour_notification_date && inc.date) {
      const deadline = new Date(new Date(inc.date + 'T00:00:00').getTime() + 14 * 86400000);
      if (now > deadline) overdueDoc++;
    }
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
      const ackDeadline = new Date(new Date(c.date + 'T00:00:00').getTime() + 2 * 86400000);
      if (now > ackDeadline) unacknowledged++;
    }
    const deadline = c.response_deadline || (c.date
      ? new Date(new Date(c.date + 'T00:00:00').getTime() + responseDays * 86400000).toISOString().slice(0, 10)
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
    if ((risk.likelihood || 1) * (risk.impact || 1) >= 16) critical++;
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
      const deadline = new Date(new Date(c.date_raised + 'T00:00:00').getTime() + 3 * 86400000);
      if (now > deadline) unacknowledged++;
    }
    if (c.status === 'investigating' && c.investigation_start_date) {
      const days = Math.floor((now - new Date(c.investigation_start_date + 'T00:00:00')) / 86400000);
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
      const weeks = Math.floor((now - new Date(cc.start_date + 'T00:00:00')) / (7 * 86400000));
      if (weeks > 12) overdue++;
    }
  }
  if (overdue > 0) warnings.push(`Care Certificate: ${overdue} staff exceeding 12-week completion target`);
}

// Thin orchestrator — calls each domain validator in turn
function validateOverrides(data) {
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

// ── Routes ────────────────────────────────────────────────────────────────────

app.post('/api/login', loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid request body' });
  const { username, password } = parsed.data;
  const user = USERS.find(u => u.username === username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const valid = await bcrypt.compare(password, user.hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
  logAudit('login', '-', username);
  res.json({ username: user.username, role: user.role, token });
});

app.get('/api/homes', requireAuth, (req, res) => {
  const homes = getHomes().map(f => {
    const id = f.replace('.json', '');
    try {
      const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf-8'));
      return { id, name: data.config?.home_name || id, beds: data.config?.registered_beds, type: data.config?.care_type };
    } catch {
      return { id, name: id };
    }
  });
  res.json(homes);
});

app.get('/api/data', requireAuth, (req, res) => {
  try {
    const homeParam = homeIdSchema.safeParse(req.query.home);
    if (!homeParam.success) return res.status(400).json({ error: 'Invalid home parameter' });
    const homeId = homeParam.data || getHomes()[0]?.replace('.json', '') || 'default';
    const dataFile = getDataFile(homeId);
    if (!fs.existsSync(dataFile)) {
      if (fs.existsSync(LEGACY_FILE)) return res.json(JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf-8')));
      return res.status(404).json({ error: 'Home not found' });
    }
    let payload = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
    // Viewer role: strip resident health data (GDPR special category — DoB, capacity, restrictions)
    if (req.user.role !== 'admin') {
      const { dols, mca_assessments, ...safePayload } = payload;
      payload = safePayload;
    }
    res.json(payload);
  } catch (err) {
    logger.error({ reqId: req.id, err: err.message }, 'GET /api/data failed');
    res.status(500).json({ error: 'Failed to read data file' });
  }
});

app.post('/api/data', requireAuth, requireAdmin, async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || !Array.isArray(body.staff) || typeof body.config !== 'object') {
      return res.status(400).json({ error: 'Invalid data shape — expected { config, staff, overrides }' });
    }
    const homeParam = homeIdSchema.safeParse(req.query.home);
    if (!homeParam.success) return res.status(400).json({ error: 'Invalid home parameter' });
    const homeId = homeParam.data || body.config?.home_name?.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default';
    const backedUp = backupData(homeId);
    // Abort if an existing file couldn't be backed up — prevents data loss
    if (backedUp === false) {
      return res.status(500).json({ error: 'Backup failed — data not saved. Check disk space and permissions.' });
    }
    const warnings = validateOverrides(body);
    // Atomic write via tmp file + rename, serialised per home to prevent race conditions
    await serialisedWrite(homeId, JSON.stringify(body, null, 2));
    // Log warning count only — full warning text contains staff names (PII)
    const auditDetail = warnings.length > 0 ? `${warnings.length} compliance warning(s)` : '';
    logAudit('save', homeId, req.user?.username || req.query.user || 'unknown', auditDetail);
    res.json({ ok: true, warnings, backedUp });
  } catch (err) {
    logger.error({ reqId: req.id, err: err.message }, 'POST /api/data failed');
    res.status(500).json({ error: 'Failed to write data file' });
  }
});

app.get('/api/audit', requireAuth, requireAdmin, (req, res) => {
  try {
    if (fs.existsSync(AUDIT_FILE)) {
      const log = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf-8'));
      return res.json(log.slice(-100).reverse());
    }
    res.json([]);
  } catch {
    res.json([]);
  }
});

app.get('/api/export', requireAuth, requireAdmin, (req, res) => {
  try {
    const homeParam = homeIdSchema.safeParse(req.query.home);
    if (!homeParam.success) return res.status(400).json({ error: 'Invalid home parameter' });
    const homeId = homeParam.data || getHomes()[0]?.replace('.json', '') || 'default';
    const dataFile = getDataFile(homeId);
    const data = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
    res.setHeader('Content-Disposition', `attachment; filename=${homeId}_data.json`);
    res.setHeader('Content-Type', 'application/json');
    res.json(data);
  } catch (err) {
    logger.error({ reqId: req.id, err: err.message }, 'GET /api/export failed');
    res.status(500).json({ error: 'Failed to export data' });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    homes: getHomes().length,
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/bank-holidays', requireAuth, async (req, res) => {
  try {
    const response = await fetch('https://www.gov.uk/bank-holidays.json');
    const data = await response.json();
    res.json((data['england-and-wales']?.events || []).map(e => ({ date: e.date, name: e.title })));
  } catch (err) {
    logger.error({ reqId: req.id, err: err.message }, 'bank holiday fetch failed');
    res.status(500).json({ error: 'Failed to fetch bank holidays from GOV.UK' });
  }
});

// ── Global error handler ──────────────────────────────────────────────────────
// Must be registered after all routes. Express identifies it by the 4-arg signature.
// AppError subclasses map to their own status codes. Anything else is a 500.
// Stack traces are logged server-side but never sent to the client.

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ reqId: req.id, err: err.message, code: err.code }, 'server error');
    } else {
      logger.warn({ reqId: req.id, err: err.message, code: err.code, status: err.statusCode }, 'client error');
    }
    return res.status(err.statusCode).json({ error: err.message });
  }

  // Zod validation errors forwarded via next(err) from middleware
  if (err?.name === 'ZodError') {
    const message = err.issues?.[0]?.message || 'Invalid request';
    logger.warn({ reqId: req.id, err: message }, 'validation error');
    return res.status(400).json({ error: message });
  }

  // Unexpected errors — log fully, return generic message (never leak internals)
  logger.error({ reqId: req.id, err: err?.message, stack: err?.stack }, 'unhandled error');
  res.status(500).json({ error: 'An unexpected error occurred' });
});

const server = app.listen(PORT, () => {
  logger.info({ port: PORT, origin: ALLOWED_ORIGIN, homes: getHomes().length }, 'server started');
});

// Graceful shutdown — allow in-flight writes to complete
function shutdown(signal) {
  logger.info({ signal }, 'shutdown signal received');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
  // Force exit after 5 seconds if connections don't drain
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
// SIGINT (Ctrl+C) only in interactive terminals — piped stdin on Windows fires it spuriously
if (process.stdin.isTTY) process.on('SIGINT', () => shutdown('SIGINT'));
