import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { requireAuth, requireAdmin, requireHomeAccess } from '../middleware/auth.js';
import { writeRateLimiter, readRateLimiter } from '../lib/rateLimiter.js';
import { withTransaction } from '../db.js';
import * as staffRepo from '../repositories/staffRepo.js';
import * as auditService from '../services/auditService.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
});

const STAFF_ROLES = ['Senior Carer', 'Carer', 'Team Lead', 'Night Senior', 'Night Carer', 'Float Senior', 'Float Carer'];
const STAFF_TEAMS = ['Day A', 'Day B', 'Night A', 'Night B', 'Float'];
const STAFF_PREFS = ['E', 'L', 'EL', 'N', 'ANY'];

const staffCsvRowSchema = z.object({
  name:            z.string().min(1).max(200),
  role:            z.enum(STAFF_ROLES),
  team:            z.enum(STAFF_TEAMS),
  pref:            z.enum(STAFF_PREFS).nullable().optional().default(null),
  skill:           z.coerce.number().min(0).max(5).optional().default(1),
  hourly_rate:     z.coerce.number().positive(),
  start_date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  contract_hours:  z.coerce.number().min(0).nullable().optional().default(null),
  wtr_opt_out:     z.preprocess(v => v === 'true' || v === '1' || v === true, z.boolean().optional().default(false)),
});

const CSV_HEADERS = ['name', 'role', 'team', 'pref', 'skill', 'hourly_rate', 'start_date', 'contract_hours', 'wtr_opt_out'];

function parseCSV(buffer) {
  const text = buffer.toString('utf-8').replace(/^\uFEFF/, ''); // strip BOM
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || '';
    }
    row._line = i + 1;
    rows.push(row);
  }
  return { headers, rows };
}

// GET /api/import/staff/template?home=X — CSV template with header row
router.get('/staff/template', readRateLimiter, requireAuth, requireAdmin, requireHomeAccess, (req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="staff_import_template.csv"');
  res.send(CSV_HEADERS.join(',') + '\n');
});

// POST /api/import/staff?home=X — CSV upload + validate/import
router.post('/staff', writeRateLimiter, requireAuth, requireAdmin, requireHomeAccess, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!req.file.originalname.toLowerCase().endsWith('.csv')) {
      return res.status(400).json({ error: 'Only CSV files are accepted' });
    }

    const dryRun = req.query.dryRun !== 'false'; // default true
    const { headers, rows } = parseCSV(req.file.buffer);

    // Validate headers
    const missingHeaders = CSV_HEADERS.filter(h => !headers.includes(h));
    if (missingHeaders.length > 0) {
      return res.status(400).json({ error: `Missing CSV columns: ${missingHeaders.join(', ')}` });
    }

    // Validate each row
    const errors = [];
    const validRows = [];
    for (const row of rows) {
      const parsed = staffCsvRowSchema.safeParse(row);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          errors.push({ line: row._line, field: issue.path.join('.'), message: issue.message });
        }
      } else {
        validRows.push(parsed.data);
      }
    }

    if (dryRun) {
      return res.json({ dryRun: true, valid: validRows.length, errors, total: rows.length });
    }

    // Live run — all or nothing
    if (errors.length > 0) {
      return res.status(400).json({ error: 'Validation failed — fix errors before importing', valid: validRows.length, errors, total: rows.length });
    }

    // Check for duplicates within the batch
    const seen = new Set();
    for (const row of validRows) {
      const key = `${row.name}|${row.start_date}`;
      if (seen.has(key)) {
        return res.status(400).json({ error: `Duplicate staff in CSV: ${row.name} starting ${row.start_date}` });
      }
      seen.add(key);
    }

    // Check for duplicates against existing staff
    const existing = await staffRepo.findByHome(req.home.id);
    const existingKeys = new Set(existing.map(s => `${s.name}|${s.start_date}`));
    const dupes = validRows.filter(r => existingKeys.has(`${r.name}|${r.start_date}`));
    if (dupes.length > 0) {
      return res.status(400).json({
        error: `${dupes.length} staff already exist with same name + start date`,
        duplicates: dupes.map(d => ({ name: d.name, start_date: d.start_date })),
      });
    }

    // Insert all within a transaction
    let imported = 0;
    await withTransaction(async (client) => {
      for (let i = 0; i < validRows.length; i++) {
        const row = validRows[i];
        const staffId = `S${Date.now()}-${i}`;
        await client.query(
          `INSERT INTO staff (id, home_id, name, role, team, pref, skill, hourly_rate, active, wtr_opt_out, start_date, contract_hours, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10,$11,NOW())`,
          [staffId, req.home.id, row.name, row.role, row.team, row.pref, row.skill, row.hourly_rate, row.wtr_opt_out, row.start_date, row.contract_hours]
        );
        imported++;
      }

      // Log import
      await client.query(
        `INSERT INTO import_log (home_id, import_type, filename, row_count, error_count, imported_by)
         VALUES ($1, 'staff', $2, $3, 0, $4)`,
        [req.home.id, req.file.originalname, imported, req.user.username]
      );
    });

    await auditService.log('staff_import', req.home.slug, req.user.username, { count: imported, filename: req.file.originalname });
    res.status(201).json({ imported, filename: req.file.originalname });
  } catch (err) { next(err); }
});

export default router;
