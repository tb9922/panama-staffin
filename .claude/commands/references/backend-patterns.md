# Backend Patterns — Line-by-Line Reference

Every backend pattern extracted from the production codebase. Copy these templates when creating new modules.

---

## Repository Template

```javascript
import { pool } from '../db.js';

// --- Type converters (top of every repo) ---
const d = v => v instanceof Date ? v.toISOString().slice(0, 10) : v;   // DATE -> 'YYYY-MM-DD'
const ts = v => v instanceof Date ? v.toISOString() : v;               // TIMESTAMPTZ -> ISO string
const f = v => v != null ? parseFloat(v) : null;                       // NUMERIC -> float (pg returns strings)

// --- Explicit columns (never SELECT *) ---
const COLS = `id, home_id, name, status, amount, version, created_by, created_at, updated_at`;

// --- Shape function (row -> DTO) ---
function shape(row) {
  if (!row) return null;
  return {
    id: row.id,
    home_id: row.home_id,
    name: row.name,
    status: row.status,
    amount: f(row.amount),          // NUMERIC -> float
    version: row.version,
    created_by: row.created_by,
    created_at: ts(row.created_at), // TIMESTAMPTZ -> ISO string
    updated_at: ts(row.updated_at),
  };
}
```

### Find by ID

```javascript
export async function findById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${COLS} FROM entities WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`,
    [id, homeId]
  );
  return shape(rows[0]);
}
```

### List with Pagination

```javascript
export async function findAll(homeId, { status, search, limit = 100, offset = 0 } = {}, client) {
  const conn = client || pool;
  let sql = `SELECT ${COLS}, COUNT(*) OVER() AS _total FROM entities WHERE home_id = $1 AND deleted_at IS NULL`;
  const params = [homeId];

  // Dynamic WHERE — parameterised, never concatenated
  if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
  if (search) { params.push(`%${search}%`); sql += ` AND name ILIKE $${params.length}`; }

  sql += ' ORDER BY created_at DESC';
  params.push(Math.min(limit, 500)); sql += ` LIMIT $${params.length}`;
  params.push(offset); sql += ` OFFSET $${params.length}`;

  const { rows } = await conn.query(sql, params);
  const total = rows.length > 0 ? parseInt(rows[0]._total) : 0;
  return { rows: rows.map(shape), total };
}
```

### Create

```javascript
export async function create(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO entities (home_id, name, status, amount, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${COLS}`,
    [homeId, data.name, data.status ?? 'active', data.amount ?? 0, data.created_by]
  );
  return shape(rows[0]);
}
```

### Update with Optimistic Locking

```javascript
export async function update(id, homeId, data, client, version) {
  const conn = client || pool;
  const fields = [];
  const params = [id, homeId];
  const settable = ['name', 'status', 'amount', 'notes'];  // whitelist — prevents mass assignment

  for (const key of settable) {
    if (key in data) {
      params.push(data[key] ?? null);
      fields.push(`${key} = $${params.length}`);
    }
  }
  if (fields.length === 0) return findById(id, homeId, client);

  fields.push('version = version + 1', 'updated_at = NOW()');
  let sql = `UPDATE entities SET ${fields.join(', ')} WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`;

  if (version != null) { params.push(version); sql += ` AND version = $${params.length}`; }
  sql += ` RETURNING ${COLS}`;

  const { rows, rowCount } = await conn.query(sql, params);
  if (rowCount === 0 && version != null) return null;  // stale -> route returns 409
  return rows[0] ? shape(rows[0]) : null;
}
```

### Soft Delete

```javascript
export async function softDelete(id, homeId, client) {
  const conn = client || pool;
  const { rowCount } = await conn.query(
    `UPDATE entities SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL RETURNING id`,
    [id, homeId]
  );
  return rowCount > 0;
}
```

### Find with JOIN

```javascript
export async function findWithRelated(homeId, filters, client) {
  const conn = client || pool;
  // Prefix columns with table alias when joining
  const eCols = COLS.split(',').map(c => `e.${c.trim()}`).join(', ');

  let sql = `
    SELECT ${eCols}, COUNT(*) OVER() AS _total,
      r.id AS related_id, r.name AS related_name
    FROM entities e
    LEFT JOIN related_table r ON r.entity_id = e.id AND r.home_id = e.home_id
    WHERE e.home_id = $1 AND e.deleted_at IS NULL`;

  const params = [homeId];
  // ... filters, ORDER BY, LIMIT, OFFSET same as findAll
}
```

---

## Service Template

```javascript
import { withTransaction } from '../db.js';
import logger from '../logger.js';
import * as entityRepo from '../repositories/entityRepo.js';

// Thin pass-through (most operations)
export async function findAll(homeId, filters) {
  return entityRepo.findAll(homeId, filters);
}

export async function findById(id, homeId) {
  return entityRepo.findById(id, homeId);
}

export async function create(homeId, data) {
  const result = await entityRepo.create(homeId, data);
  logger.info({ homeId, id: result.id }, 'Entity created');
  return result;
}

// Transaction when reads + writes must be atomic
export async function updateWithAudit(id, homeId, data, username, version) {
  return withTransaction(async (client) => {
    const existing = await entityRepo.findById(id, homeId, client);
    if (!existing) return null;

    // Business logic that needs the existing record
    if (existing.status === 'closed') {
      throw Object.assign(new Error('Cannot update closed entity'), { statusCode: 400 });
    }

    return entityRepo.update(id, homeId, data, client, version);
  });
}
```

---

## Route Template

```javascript
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { writeRateLimiter, readRateLimiter } from '../lib/rateLimiter.js';
import * as entityService from '../services/entityService.js';
import * as auditService from '../services/auditService.js';

const router = Router();

// --- Schemas ---
const idSchema = z.coerce.number().int().positive();

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const dateSchema = z.preprocess(
  v => v === '' ? null : v,
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()
);

const bodySchema = z.object({
  name: z.string().min(1).max(200),
  status: z.enum(['active', 'closed']).optional(),
  amount: z.coerce.number().min(0).optional(),
  notes: z.string().nullable().optional(),
});

// Safe query param helpers
const safeStr = (v, max = 50) => typeof v === 'string' ? v.slice(0, max) : undefined;
const safeDate = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : undefined;

// --- Constraint handler ---
function handleConstraintError(err, res) {
  if (err.code === '23505') return res.status(409).json({ error: 'Duplicate record' });
  if (err.code === '23503') return res.status(400).json({ error: 'Referenced record not found' });
  if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
  throw err;
}

// --- diffFields for audit ---
function diffFields(before, after) {
  const skip = new Set(['version', 'created_at', 'updated_at', 'created_by', 'home_id']);
  const changes = [];
  for (const key of Object.keys(after)) {
    if (skip.has(key)) continue;
    if (String(before[key] ?? '') !== String(after[key] ?? '')) {
      changes.push({ field: key, old: before[key], new: after[key] });
    }
  }
  return changes;
}

// --- LIST ---
router.get('/',
  readRateLimiter, requireAuth, requireHomeAccess, requireModule('module', 'read'),
  async (req, res, next) => {
    try {
      const pg = paginationSchema.parse(req.query);
      const filters = { limit: pg.limit, offset: pg.offset };
      if (req.query.status) filters.status = safeStr(req.query.status);
      res.json(await entityService.findAll(req.home.id, filters));
    } catch (err) { next(err); }
  }
);

// --- GET BY ID ---
router.get('/:id',
  readRateLimiter, requireAuth, requireHomeAccess, requireModule('module', 'read'),
  async (req, res, next) => {
    try {
      const idP = idSchema.safeParse(req.params.id);
      if (!idP.success) return res.status(400).json({ error: 'Invalid ID' });
      const result = await entityService.findById(idP.data, req.home.id);
      if (!result) return res.status(404).json({ error: 'Not found' });
      res.json(result);
    } catch (err) { next(err); }
  }
);

// --- CREATE ---
router.post('/',
  writeRateLimiter, requireAuth, requireHomeAccess, requireModule('module', 'write'),
  async (req, res, next) => {
    try {
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

      const result = await entityService.create(req.home.id, {
        ...parsed.data,
        created_by: req.user.username,
      });

      await auditService.log('entity_create', req.home.slug, req.user.username,
        { id: result.id, entity: 'entity_name' });

      res.status(201).json(result);
    } catch (err) {
      handleConstraintError(err, res);
    }
  }
);

// --- UPDATE ---
router.put('/:id',
  writeRateLimiter, requireAuth, requireHomeAccess, requireModule('module', 'write'),
  async (req, res, next) => {
    try {
      const idP = idSchema.safeParse(req.params.id);
      if (!idP.success) return res.status(400).json({ error: 'Invalid ID' });

      const parsed = bodySchema.partial().safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

      // CRITICAL: read _version BEFORE Zod strips it
      const version = req.body._version != null ? parseInt(req.body._version, 10) : null;

      const existing = await entityService.findById(idP.data, req.home.id);
      if (!existing) return res.status(404).json({ error: 'Not found' });

      const result = await entityService.update(idP.data, req.home.id, parsed.data, version);
      if (result === null) {
        return res.status(409).json({ error: 'Record modified by another user. Please refresh.' });
      }

      await auditService.log('entity_update', req.home.slug, req.user.username,
        { id: idP.data, entity: 'entity_name', changes: diffFields(existing, result) });

      res.json(result);
    } catch (err) {
      handleConstraintError(err, res);
    }
  }
);

// --- DELETE (soft) ---
router.delete('/:id',
  writeRateLimiter, requireAuth, requireHomeAccess, requireModule('module', 'write'),
  async (req, res, next) => {
    try {
      const idP = idSchema.safeParse(req.params.id);
      if (!idP.success) return res.status(400).json({ error: 'Invalid ID' });

      const deleted = await entityService.softDelete(idP.data, req.home.id);
      if (!deleted) return res.status(404).json({ error: 'Not found' });

      await auditService.log('entity_delete', req.home.slug, req.user.username,
        { id: idP.data, entity: 'entity_name' });

      res.json({ deleted: true });
    } catch (err) { next(err); }
  }
);

export default router;
```

---

## Migration Template

```sql
-- UP
CREATE TABLE IF NOT EXISTS entity_name (
  id                SERIAL PRIMARY KEY,
  home_id           INTEGER NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  -- Business columns
  name              VARCHAR(200) NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','closed','archived')),
  amount            NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes             TEXT,
  -- Standard columns (every table)
  version           INTEGER NOT NULL DEFAULT 1,
  created_by        VARCHAR(100) NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

-- Partial indexes: only non-deleted rows
CREATE INDEX IF NOT EXISTS idx_entity_home_status
  ON entity_name(home_id, status) WHERE deleted_at IS NULL;

-- DOWN
DROP TABLE IF EXISTS entity_name;
```

Rules:
- **Money**: `NUMERIC(10,2)` — exact decimal, never FLOAT
- **Enums**: CHECK constraints, not PostgreSQL ENUM type (CHECK is trivial to ALTER)
- **Every table**: `id`, `home_id`, `version`, `created_by`, `created_at`, `updated_at`, `deleted_at`
- **Partial indexes**: `WHERE deleted_at IS NULL`
- **Naming**: `NNN_description.sql` — three-digit sequential prefix

---

## Error Classes (errors.js)

```javascript
// 400 — bad input
throw new ValidationError('Name is required');

// 401 — not authenticated
throw new AuthenticationError();

// 403 — authenticated but not authorised
throw new ForbiddenError('Insufficient permissions for finance');

// 404 — resource not found
throw new NotFoundError('Resident not found');

// 409 — conflict (optimistic locking, duplicate)
throw new ConflictError('Record was modified by another user');
```

Global error handler in server.js catches these and returns `{ error: message }`.

---

## Middleware Chain (always this order)

```
rateLimiter -> requireAuth -> requireHomeAccess -> requireModule(module, level)
     |              |                |                      |
  Rate limit    JWT valid      user has access        role has module
  per IP       req.user set    req.home set           permission
                               req.homeRole set
```

- `readRateLimiter`: 300/15min (GET-heavy routes)
- `writeRateLimiter`: 120/15min (POST/PUT/DELETE)
- Platform admins (`req.user.is_platform_admin`) bypass `requireModule`

---

## Key Rules

1. **No SELECT ***: explicit column lists prevent schema leaks
2. **client || pool**: every repo function accepts optional `client` for transactions
3. **Shape everything**: never return raw `rows[0]` — always pass through shape function
4. **NUMERIC -> parseFloat()**: PostgreSQL returns strings for NUMERIC columns
5. **_version before Zod**: extract from `req.body._version` before `.safeParse()` strips it
6. **Soft delete everywhere**: `SET deleted_at = NOW()`, filter with `AND deleted_at IS NULL`
7. **home_id on every query**: the primary security boundary
8. **Audit every mutation**: `auditService.log()` after successful create/update/delete
9. **Constraint errors**: catch `err.code === '23505'` (duplicate) and `'23503'` (FK violation)
10. **Static routes first**: `/residents/with-beds` before `/residents/:id` in Express
