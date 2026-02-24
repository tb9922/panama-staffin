import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'homes');
const LEGACY_FILE = path.join(__dirname, 'staffing_data.json');
const BACKUP_DIR = path.join(__dirname, 'backups');
const AUDIT_FILE = path.join(__dirname, 'audit_log.json');
const app = express();
const PORT = 3001;

// Simple auth
const USERS = [
  { username: 'admin', password: 'admin123', role: 'admin' },
  { username: 'viewer', password: 'view123', role: 'viewer' },
];

// Ensure directories exist
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR);
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
  // Migrate legacy file if it exists
  if (fs.existsSync(LEGACY_FILE)) {
    const data = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf-8'));
    const name = data.config?.home_name?.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default';
    fs.copyFileSync(LEGACY_FILE, path.join(DATA_DIR, `${name}.json`));
  }
}

// Ensure at least one home exists
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
  return path.join(DATA_DIR, `${safeName}.json`);
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Backup before save — keeps last 20 per home
function backupData(homeId) {
  try {
    const dataFile = getDataFile(homeId);
    if (!fs.existsSync(dataFile)) return;
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(BACKUP_DIR, `${homeId}_${ts}.json`);
    fs.copyFileSync(dataFile, backupFile);

    // Prune old backups for this home
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith(`${homeId}_`) && f.endsWith('.json'))
      .sort()
      .reverse();
    files.slice(20).forEach(f => {
      try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch {}
    });
  } catch (err) {
    console.error('Backup failed:', err.message);
  }
}

// Audit logging
function logAudit(action, homeId, user, details) {
  try {
    let log = [];
    if (fs.existsSync(AUDIT_FILE)) {
      log = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf-8'));
    }
    log.push({
      ts: new Date().toISOString(),
      action,
      home: homeId,
      user: user || 'system',
      details: details || '',
    });
    // Keep last 500 entries
    if (log.length > 500) log = log.slice(-500);
    fs.writeFileSync(AUDIT_FILE, JSON.stringify(log, null, 2));
  } catch {}
}

// Auth endpoint
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = USERS.find(u => u.username === username && u.password === password);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  logAudit('login', '-', username);
  res.json({ username: user.username, role: user.role });
});

// List homes
app.get('/api/homes', (req, res) => {
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

// Get data for a specific home
app.get('/api/data', (req, res) => {
  try {
    const homeId = req.query.home || getHomes()[0]?.replace('.json', '') || 'default';
    const dataFile = getDataFile(homeId);
    if (!fs.existsSync(dataFile)) {
      // Fallback to legacy file
      if (fs.existsSync(LEGACY_FILE)) {
        const data = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf-8'));
        return res.json(data);
      }
      return res.status(404).json({ error: 'Home not found' });
    }
    const data = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read data file' });
  }
});

// Validate overrides before saving
function validateOverrides(data) {
  const warnings = [];
  if (!data.overrides || !data.config || !data.staff) return warnings;

  const maxAL = data.config.max_al_same_day || 2;

  // Check max AL per day
  for (const [dateKey, dayOverrides] of Object.entries(data.overrides)) {
    const alCount = Object.values(dayOverrides).filter(o => o.shift === 'AL').length;
    if (alCount > maxAL) {
      warnings.push(`${dateKey}: ${alCount} AL bookings exceeds max ${maxAL}`);
    }
  }

  // Determine current leave year boundaries
  const leaveYearStart = data.config.leave_year_start || '04-01';
  const [lyMM, lyDD] = leaveYearStart.split('-').map(Number);
  const now = new Date();
  const thisYearBoundary = new Date(Date.UTC(now.getUTCFullYear(), lyMM - 1, lyDD));
  let lyStart, lyEnd;
  if (now >= thisYearBoundary) {
    lyStart = thisYearBoundary;
    const nextBoundary = new Date(Date.UTC(now.getUTCFullYear() + 1, lyMM - 1, lyDD));
    lyEnd = new Date(nextBoundary); lyEnd.setUTCDate(lyEnd.getUTCDate() - 1);
  } else {
    lyStart = new Date(Date.UTC(now.getUTCFullYear() - 1, lyMM - 1, lyDD));
    lyEnd = new Date(thisYearBoundary); lyEnd.setUTCDate(lyEnd.getUTCDate() - 1);
  }
  const lyStartStr = lyStart.toISOString().slice(0, 10);
  const lyEndStr = lyEnd.toISOString().slice(0, 10);

  // Check AL entitlement per staff within the current leave year
  const alUsed = {};
  for (const [dateKey, dayOverrides] of Object.entries(data.overrides)) {
    if (dateKey < lyStartStr || dateKey > lyEndStr) continue;
    for (const [staffId, override] of Object.entries(dayOverrides)) {
      if (override.shift === 'AL') {
        alUsed[staffId] = (alUsed[staffId] || 0) + 1;
      }
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

  // NMW compliance check
  const nlwRate = data.config.nlw_rate || 12.21;
  for (const s of data.staff.filter(s => s.active !== false)) {
    if (s.hourly_rate != null && s.hourly_rate < nlwRate) {
      warnings.push(`${s.name}: rate £${s.hourly_rate.toFixed(2)} is below NLW £${nlwRate.toFixed(2)}`);
    }
  }

  // Training compliance check
  if (data.config.training_types && data.training) {
    const activeStaff = data.staff.filter(s => s.active !== false);
    const activeTypes = data.config.training_types.filter(t => t.active);
    const todayStr = new Date().toISOString().slice(0, 10);
    let expiredCount = 0;
    let notStartedCount = 0;
    for (const s of activeStaff) {
      const staffRecords = data.training[s.id] || {};
      for (const t of activeTypes) {
        // Check if training is required for this staff member
        if (t.roles && !t.roles.includes(s.role)) continue;
        const rec = staffRecords[t.id];
        if (!rec || !rec.completed) {
          notStartedCount++;
        } else if (rec.expiry && rec.expiry < todayStr) {
          expiredCount++;
        }
      }
    }
    if (expiredCount > 0) {
      warnings.push(`Training: ${expiredCount} expired training record${expiredCount > 1 ? 's' : ''} across active staff`);
    }
    if (notStartedCount > 0) {
      warnings.push(`Training: ${notStartedCount} required training record${notStartedCount > 1 ? 's' : ''} not started`);
    }
  }

  return warnings;
}

// Save data for a specific home
app.post('/api/data', (req, res) => {
  try {
    const homeId = req.query.home || req.body?.config?.home_name?.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default';
    const warnings = validateOverrides(req.body);
    backupData(homeId);
    const dataFile = getDataFile(homeId);
    fs.writeFileSync(dataFile, JSON.stringify(req.body, null, 2));
    logAudit('save', homeId, req.query.user || 'unknown', warnings.length > 0 ? warnings.join('; ') : '');
    res.json({ ok: true, warnings });
  } catch (err) {
    res.status(500).json({ error: 'Failed to write data file' });
  }
});

// Audit log endpoint
app.get('/api/audit', (req, res) => {
  try {
    if (fs.existsSync(AUDIT_FILE)) {
      const log = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf-8'));
      res.json(log.slice(-100).reverse());
    } else {
      res.json([]);
    }
  } catch {
    res.json([]);
  }
});

app.get('/api/export', (req, res) => {
  try {
    const homeId = req.query.home || getHomes()[0]?.replace('.json', '') || 'default';
    const dataFile = getDataFile(homeId);
    const data = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
    res.setHeader('Content-Disposition', `attachment; filename=${homeId}_data.json`);
    res.setHeader('Content-Type', 'application/json');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// Bank holiday proxy — fetches from GOV.UK API (avoids CORS)
app.get('/api/bank-holidays', async (req, res) => {
  try {
    const response = await fetch('https://www.gov.uk/bank-holidays.json');
    const data = await response.json();
    const englandWales = data['england-and-wales']?.events || [];
    res.json(englandWales.map(e => ({ date: e.date, name: e.title })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bank holidays from GOV.UK' });
  }
});

app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
  console.log(`Homes directory: ${DATA_DIR}`);
  console.log(`Backups stored in: ${BACKUP_DIR}`);
  console.log(`Homes found: ${getHomes().join(', ') || '(none — will create on first save)'}`);
});
