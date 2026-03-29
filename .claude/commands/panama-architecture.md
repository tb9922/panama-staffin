---
name: panama-architecture
description: "Panama care home ERP — architecture patterns and templates. ALWAYS read before writing ANY Panama code. Covers layered architecture (DB → Repo → Service → Route → Frontend API → Page), multi-home isolation, RBAC auth chain, optimistic locking, Zod validation, audit trail, design tokens, navigation wiring, testing patterns, and cross-module integration. Without this, new code uses wrong patterns (fetchJSON instead of apiFetch, wrong middleware order, missing _version extraction, inline modals instead of Modal component, raw Tailwind instead of design tokens, requireAdmin instead of requireModule). For current file counts, module inventory, and known issues see CLAUDE.md (auto-loaded every conversation)."
---

# Panama Architecture — Patterns & Templates

Read this BEFORE writing any Panama code. Every pattern here is extracted from the actual codebase. Deviations cause bugs.

For current file counts, module list, migration numbers, and known issues — see CLAUDE.md (loaded automatically every conversation). This skill covers only **stable patterns and templates** that rarely change.

---

## 1. Layered Architecture

Every request flows through exactly these layers. No shortcuts. A route NEVER imports a repo. A repo NEVER imports a service. Frontend NEVER calls a repo.

```
Browser → apiFetch() → Express Route → Service → Repository → PostgreSQL
                           ↓               ↓          ↓
                        Middleware       Business    Raw SQL
                        (auth, zod,     Logic       + shapers
                         rate limit,    (transactions,
                         audit)          validation)
```

---

## 2. Database Layer (db.js)

Single pool. All repos import `{ pool }` from `'../db.js'`. Never create a second pool.

```javascript
import { pool, withTransaction } from '../db.js';
```

**Date handling:** DATE columns return ISO strings ('YYYY-MM-DD') via type parser 1082 set in db.js. TIMESTAMPTZ columns return Date objects — shapers convert via `ts()`.

**Transactions:**
```javascript
return withTransaction(async (client) => {
  const existing = await repo.findById(id, homeId, client);
  await repo.createFeeChange(homeId, data, client);
  return repo.update(id, homeId, data, client, version);
});
```
Use when: any operation that reads then writes based on what it read (TOCTOU).

---

## 3. Repository Layer

**Location:** `repositories/[entity]Repo.js`

**Does:** Raw SQL, parameterised queries, result shaping. **Nothing else.** No business logic. No auth. No validation beyond SQL constraints.

### Full Repository Template
```javascript
import { pool } from '../db.js';

const d = v => v instanceof Date ? v.toISOString().slice(0, 10) : v;
const ts = v => v instanceof Date ? v.toISOString() : v;
const f = v => v != null ? parseFloat(v) : null;

function shapeEntity(row) {
  if (!row) return null;
  return {
    id: row.id,
    home_id: row.home_id,
    name: row.name,
    status: row.status,
    amount: f(row.amount),
    event_date: d(row.event_date),
    notes: row.notes || null,
    version: row.version,
    created_by: row.created_by,
    created_at: ts(row.created_at),
    updated_at: ts(row.updated_at),
  };
}

export async function create(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO entities (home_id, name, status, amount, event_date, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [homeId, data.name, data.status || 'active', data.amount || 0,
     data.event_date || null, data.notes || null, data.created_by]
  );
  return shapeEntity(rows[0]);
}

export async function findById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    'SELECT * FROM entities WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL',
    [id, homeId]
  );
  return rows[0] ? shapeEntity(rows[0]) : null;
}

export async function findAll(homeId, { status, search, limit = 100, offset = 0 } = {}, client) {
  const conn = client || pool;
  let sql = 'SELECT *, COUNT(*) OVER() AS _total FROM entities WHERE home_id = $1 AND deleted_at IS NULL';
  const params = [homeId];
  if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
  if (search) { params.push(`%${search}%`); sql += ` AND name ILIKE $${params.length}`; }
  sql += ' ORDER BY created_at DESC';
  params.push(Math.min(limit, 500)); sql += ` LIMIT $${params.length}`;
  params.push(offset); sql += ` OFFSET $${params.length}`;
  const { rows } = await conn.query(sql, params);
  const total = rows.length > 0 ? parseInt(rows[0]._total) : 0;
  return { rows: rows.map(shapeEntity), total };
}

export async function update(id, homeId, data, client, version) {
  const conn = client || pool;
  const fields = [];
  const params = [id, homeId];
  const settable = ['name', 'status', 'amount', 'event_date', 'notes'];
  for (const key of settable) {
    if (key in data) { params.push(data[key] ?? null); fields.push(`${key} = $${params.length}`); }
  }
  if (fields.length === 0) return findById(id, homeId, client);
  fields.push('version = version + 1');
  let sql = `UPDATE entities SET ${fields.join(', ')} WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`;
  if (version != null) { params.push(version); sql += ` AND version = $${params.length}`; }
  sql += ' RETURNING *';
  const { rows, rowCount } = await conn.query(sql, params);
  if (rowCount === 0 && version != null) return null;
  return rows[0] ? shapeEntity(rows[0]) : null;
}

export async function softDelete(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `UPDATE entities SET deleted_at = NOW() WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL RETURNING id`,
    [id, homeId]
  );
  return rows[0] || null;
}
```

### Repository Rules
- Every function: `(id?, homeId, data?, client?, version?)` — client enables transaction passthrough
- `const conn = client || pool` at the top of every function
- `WHERE home_id = $N AND deleted_at IS NULL` on every query
- Parameterised SQL only — NEVER concatenate user input
- `settable` whitelist prevents mass assignment
- `version = version + 1` on every update; returns null on stale
- Soft delete: `SET deleted_at = NOW()`. Never `DELETE FROM`
- `COUNT(*) OVER() AS _total` in list queries — no second COUNT query
- `Math.min(limit, 500)` hard ceiling on all list queries

---

## 4. Service Layer

**Location:** `services/[domain]Service.js`

Most services are thin pass-throughs. Only add logic when there are real business rules.

```javascript
import * as entityRepo from '../repositories/entityRepo.js';
import { withTransaction } from '../db.js';

// Thin pass-through (majority of methods)
export async function findAll(homeId, filters) { return entityRepo.findAll(homeId, filters); }
export async function findById(id, homeId) { return entityRepo.findById(id, homeId); }
export async function create(homeId, data) { return entityRepo.create(homeId, data); }
export async function softDelete(id, homeId) { return entityRepo.softDelete(id, homeId); }

// Real logic only when needed (cross-table writes, fee tracking, etc.)
export async function update(id, homeId, data, username, version) {
  if ('amount' in data && data.amount != null) {
    return withTransaction(async (client) => {
      const existing = await entityRepo.findById(id, homeId, client);
      if (!existing) return null;
      // ... business logic ...
      return entityRepo.update(id, homeId, data, client, version);
    });
  }
  return entityRepo.update(id, homeId, data, null, version);
}
```

### Service Rules
- Import repo, never pool/SQL directly
- No HTTP concepts (no req, no res, no status codes)
- `withTransaction` only when reads + writes must be atomic

---

## 5. Route Layer (RBAC)

**Location:** `routes/[domain].js`

**Does:** Auth middleware, Zod validation, HTTP → service mapping, audit logging. **No business logic. No SQL.**

### Auth Middleware Chain (ALWAYS this order)

```
rateLimiter → requireAuth → requireHomeAccess → requireModule(module, level)
```

- `requireAuth` — JWT validation, sets `req.user`
- `requireHomeAccess` — resolves home slug → `req.home`, resolves per-home role → `req.homeRole`, `req.staffId`
- `requireModule(moduleId, level)` — checks `hasModuleAccess(req.homeRole, moduleId, level)` from `shared/roles.js`
- `requireHomeManager` — for user management routes (checks `ROLES[req.homeRole].canManageUsers`)
- Platform admins (`req.user.is_platform_admin`) bypass all module checks

**DO NOT use `requireAdmin` for new routes.** That's legacy. Use `requireModule('moduleName', 'write')`.

### Full Route Template
```javascript
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { writeRateLimiter } from '../lib/rateLimiter.js';
import * as entityService from '../services/entityService.js';
import * as auditService from '../services/auditService.js';
import { diffFields } from '../lib/audit.js';

const router = Router();
router.use(writeRateLimiter);

const idSchema = z.coerce.number().int().positive();
const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
const bodySchema = z.object({
  name: z.string().min(1).max(200),
  status: z.enum(['active', 'closed']).optional(),
  amount: z.coerce.number().min(0).optional(),
  notes: z.string().nullable().optional(),
});
const updateSchema = bodySchema.partial();

// LIST — requireModule('mymodule', 'read')
router.get('/', requireAuth, requireHomeAccess, requireModule('mymodule', 'read'), async (req, res, next) => {
  try {
    const pg = paginationSchema.parse(req.query);
    const filters = { limit: pg.limit, offset: pg.offset };
    if (req.query.status) filters.status = req.query.status;
    if (req.query.search) filters.search = req.query.search;
    res.json(await entityService.findAll(req.home.id, filters));
  } catch (err) { next(err); }
});

// GET BY ID
router.get('/:id', requireAuth, requireHomeAccess, requireModule('mymodule', 'read'), async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid ID' });
    const result = await entityService.findById(idP.data, req.home.id);
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  } catch (err) { next(err); }
});

// CREATE — requireModule('mymodule', 'write')
router.post('/', requireAuth, requireHomeAccess, requireModule('mymodule', 'write'), async (req, res, next) => {
  try {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const result = await entityService.create(req.home.id, {
      ...parsed.data, created_by: req.user.username,
    });
    await auditService.log('entity_create', req.home.slug, req.user.username,
      { id: result.id, entity: 'entity_name' });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// UPDATE — _version BEFORE Zod parse
router.put('/:id', requireAuth, requireHomeAccess, requireModule('mymodule', 'write'), async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid ID' });
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    const existing = await entityService.findById(idP.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    // CRITICAL: _version from raw body BEFORE Zod strips it
    const version = req.body._version != null ? parseInt(req.body._version, 10) : null;
    const result = await entityService.update(idP.data, req.home.id, parsed.data, req.user.username, version);

    if (result === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }

    await auditService.log('entity_update', req.home.slug, req.user.username,
      { id: idP.data, entity: 'entity_name', changes: diffFields(existing, result) });
    res.json(result);
  } catch (err) { next(err); }
});

// DELETE (soft)
router.delete('/:id', requireAuth, requireHomeAccess, requireModule('mymodule', 'write'), async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid ID' });
    const result = await entityService.softDelete(idP.data, req.home.id);
    if (!result) return res.status(404).json({ error: 'Not found' });
    await auditService.log('entity_delete', req.home.slug, req.user.username,
      { id: idP.data, entity: 'entity_name' });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

export default router;
```

### Route Rules
- **Zod split:** `.parse()` for pagination (throws, global handler catches). `.safeParse()` for body (manual 400 with field message)
- **_version:** Extract from `req.body._version` BEFORE Zod parse — Zod strips unknown keys
- **Response shape:** Raw `res.json(result)` — no `{ data: ..., meta: ... }` envelope
- **Static before parameterised:** `/residents/with-beds` before `/residents/:id`
- **Audit on every mutation:** `auditService.log(action, homeSlug, username, details)`
- **Constraint errors:** Handle PG 23505 (duplicate) → 409, 23503 (FK missing) → 400
- **Mount in server.js:** `import entityRouter from './routes/entity.js'; app.use('/api/entity', entityRouter);`

---

## 6. Security Architecture

### Multi-Home Isolation
Every table has `home_id`. Every query filters by it. This is the primary security boundary.

### RBAC (shared/roles.js)
8 roles, 10 modules. Roles defined in code, NOT database. Per-home assignment via `user_home_roles` table.

```
Modules: scheduling, staff, hr, compliance, governance, finance, payroll, gdpr, reports, config
Levels: write > read > own > none
```

Backend: `requireModule('finance', 'write')` — checks `hasModuleAccess(req.homeRole, 'finance', 'write')`
Frontend: `const canEdit = canWrite('finance')` — from `useData()` context

### Optimistic Locking Flow
```
1. Frontend loads entity → gets version: 3
2. Save sends: { ...formData, _version: 3 }
3. Route reads req.body._version BEFORE Zod parse
4. Repo: UPDATE ... WHERE id=$1 AND home_id=$2 AND version=3
5a. Match → updated, version=4
5b. Stale → rowCount=0, repo returns null → route sends 409
```

### Rate Limiting
- `writeRateLimiter` — POST/PUT/DELETE: 120/15min per IP
- `readRateLimiter` — GET-heavy endpoints: 300/15min per IP

---

## 7. Frontend API Layer (src/lib/api.js)

**ALWAYS use apiFetch + authHeaders. NEVER use fetchJSON — it does not exist.**

```javascript
export async function getEntities(homeSlug, filters = {}) {
  const params = new URLSearchParams({ home: homeSlug });
  if (filters.status) params.set('status', filters.status);
  if (filters.limit) params.set('limit', filters.limit);
  if (filters.offset) params.set('offset', filters.offset);
  return apiFetch(`${API_BASE}/entity?${params}`, { headers: authHeaders() });
}

export async function createEntity(homeSlug, data) {
  return apiFetch(`${API_BASE}/entity?home=${h(homeSlug)}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function updateEntity(homeSlug, id, data) {
  return apiFetch(`${API_BASE}/entity/${id}?home=${h(homeSlug)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
  });
}

export async function deleteEntity(homeSlug, id) {
  return apiFetch(`${API_BASE}/entity/${id}?home=${h(homeSlug)}`, {
    method: 'DELETE', headers: authHeaders(),
  });
}
```

**Home is ALWAYS query param `?home=slug`, NOT path param.**

---

## 8. Frontend Page Template (RBAC-aware)

```javascript
import { useState, useEffect, useMemo } from 'react';
import { BTN, CARD, TABLE, INPUT, BADGE, PAGE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import Pagination from '../components/Pagination.jsx';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import { useData } from '../contexts/DataContext.jsx';
import { getCurrentHome, getEntities, createEntity, updateEntity, deleteEntity } from '../lib/api.js';

const EMPTY_FORM = { name: '', status: 'active', amount: '', notes: '' };

export default function EntityPage() {
  const home = getCurrentHome();
  const { canWrite } = useData();
  const canEdit = canWrite('mymodule');

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  useDirtyGuard(showModal);

  const [filterStatus, setFilterStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const LIMIT = 100;

  async function load() {
    if (!home) return;
    setLoading(true); setError(null);
    try {
      const data = await getEntities(home, { status: filterStatus || undefined, limit: LIMIT, offset });
      setItems(data.rows || []); setTotal(data.total || 0);
    } catch (e) { setError(e.message || 'Failed to load'); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [home, filterStatus, offset]);

  function openNew() {
    setEditing(null); setForm({ ...EMPTY_FORM }); setFormError(''); setShowModal(true);
  }
  function openEdit(item) {
    setEditing(item);
    setForm({ name: item.name || '', status: item.status || 'active',
      amount: item.amount != null ? String(item.amount) : '', notes: item.notes || '' });
    setFormError(''); setShowModal(true);
  }
  function closeModal() { setShowModal(false); setEditing(null); setFormError(''); }

  async function handleSave() {
    if (!form.name.trim()) { setFormError('Name is required'); return; }
    setSaving(true); setFormError('');
    try {
      const payload = { ...form, amount: form.amount !== '' ? parseFloat(form.amount) : 0 };
      if (editing) await updateEntity(home, editing.id, { ...payload, _version: editing.version });
      else await createEntity(home, payload);
      closeModal(); load();
    } catch (e) { setFormError(e.message || 'Save failed'); }
    finally { setSaving(false); }
  }

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <h1 className={PAGE.title}>Entities</h1>
        {canEdit && <button className={BTN.primary} onClick={openNew}>+ Add</button>}
      </div>
      {/* table, filters, pagination, modal — all using design tokens */}
      <Modal isOpen={showModal} onClose={closeModal} title={editing ? 'Edit' : 'New'} size="lg">
        {/* form fields using INPUT.base, INPUT.label, INPUT.select */}
      </Modal>
    </div>
  );
}
```

### Frontend Rules
- `const { canWrite } = useData()` then `const canEdit = canWrite('module')` — NOT isAdmin
- `useDirtyGuard(showModal)` on every page with forms
- `useEffect` deps: `[home, filterStatus, offset]` — NOT searchInput (search triggers on Enter only)
- Save sends `_version: editing.version` for optimistic locking
- All design tokens from `src/lib/design.js` — never raw Tailwind
- All modals via `<Modal>` component — never inline
- Excel export via dynamic import: `const { downloadXLSX } = await import('../lib/excel.js')`
- Lazy-loaded in AppRoutes: `const EntityPage = lazy(() => import('../pages/EntityPage.jsx'))`

---

## 9. Design Tokens (src/lib/design.js)

| Token | Use |
|-------|-----|
| `BTN.primary/secondary/danger/ghost/success` | Buttons |
| `BTN.xs/sm` | Size modifiers (append to variant) |
| `CARD.base/padded/elevated/flush` | Cards |
| `TABLE.wrapper/table/thead/th/tr/td` | Tables |
| `INPUT.base/sm/select/label/inline/inlineSelect` | Form inputs |
| `BADGE.blue/green/amber/red/gray/purple/orange/pink` | Status pills |
| `PAGE.container/header/title` | Page layout |
| `TAB.bar/button/active/inactive` | Tab bars |

Use `<Modal isOpen onClose title size>` for all modals. Sizes: sm, md, lg, xl, wide.

---

## 10. Migration Template

**Location:** `migrations/NNN_description.sql` — sequential three-digit prefix.

```sql
-- UP
CREATE TABLE IF NOT EXISTS entity_name (
  id                SERIAL PRIMARY KEY,
  home_id           INTEGER NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  name              VARCHAR(200) NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','closed','archived')),
  amount            NUMERIC(10,2) NOT NULL DEFAULT 0,
  event_date        DATE,
  notes             TEXT,
  version           INTEGER NOT NULL DEFAULT 1,
  created_by        VARCHAR(100) NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

CREATE INDEX idx_entity_home_status ON entity_name(home_id, status) WHERE deleted_at IS NULL;

-- DOWN
DROP TABLE IF EXISTS entity_name;
```

**Rules:** Money = `NUMERIC(10,2)`. Enums = `CHECK` constraints (not PG ENUM). Every table gets: id, home_id, version, created_by, created_at, updated_at, deleted_at. Partial indexes with `WHERE deleted_at IS NULL`.

---

## 11. Testing Patterns

**Location:** `tests/integration/[module].test.js` — Vitest, direct repo/service calls, live PostgreSQL.

**What to test per module:**
- Create returns shaped entity with version=1
- Read by id works, returns null for wrong home (multi-home isolation)
- Update increments version, returns null on stale version (optimistic locking)
- List returns `{ rows, total }`, empty for other home
- Soft delete makes record invisible to subsequent queries
- Filters work individually and combined
- Edge: zero rows, boundary values, empty strings

---

## 12. Cross-Module Integration

**Rule: Read across, write within.**
- Module A can READ Module B's data (LEFT JOIN, API call)
- Module A does NOT WRITE to Module B's tables
- Cross-module writes use UI links: "Update in Module B →"

---

## 13. Wiring Checklist — New Module

### Backend
- [ ] Migration: `NNN_create_entity.sql` with standard columns + partial indexes
- [ ] Repo: `repositories/entityRepo.js` — d/ts/f helpers, shaper, CRUD with home_id + version
- [ ] Service: `services/entityService.js` — thin pass-through, withTransaction only when needed
- [ ] Route: `routes/entity.js` — `requireAuth → requireHomeAccess → requireModule('module', 'level')`
- [ ] Mount: `app.use('/api/entity', entityRouter)` in server.js
- [ ] API wrappers: CRUD functions in `src/lib/api.js` using apiFetch + authHeaders

### Frontend
- [ ] Page: design tokens, `useData()` for canWrite, `_version` on saves, `useDirtyGuard`
- [ ] Navigation: add to `NAV_SECTIONS` in `src/lib/navigation.js`, set `module` for RBAC filtering
- [ ] Route: lazy import + `<RequireModule module="x">` wrapper in `src/components/AppRoutes.jsx`
- [ ] Modal: use `<Modal>` component, never inline
- [ ] Excel export: dynamic import only

### Testing
- [ ] Integration test: create, read, update (version), list, soft delete, home isolation, stale version → null

### Verification
- [ ] Navigate to page, CRUD a record
- [ ] Check RBAC: role without module access can't see page or mutate
- [ ] Check home isolation: switch homes, verify no data leak
- [ ] Check optimistic locking: two tabs, edit both
- [ ] Run test suite

---

## 14. Common Mistakes

| Mistake | Correct Pattern |
|---------|----------------|
| `fetchJSON()` | `apiFetch()` — fetchJSON does not exist |
| `requireAdmin` on new routes | `requireModule('module', 'write')` |
| `isAdmin` in pages | `const canEdit = canWrite('module')` via `useData()` |
| Raw Tailwind classes | Import from `design.js` |
| Inline modals with MODAL tokens | Use `<Modal>` component |
| `_version` after Zod parse | Extract from `req.body._version` BEFORE Zod |
| Home as path param | Home as query param `?home=slug` |
| `DELETE FROM` | `SET deleted_at = NOW()` (soft delete) |
| PG ENUM types | `CHECK` constraints |
| FLOAT for money | `NUMERIC(10,2)` |
| Concatenating SQL | Parameterised queries with `$N` |
| Top-level XLSX import | Dynamic: `await import('../lib/excel.js')` |
| Missing `next(err)` in catch | Every route catch block must call `next(err)` |
| Missing `home_id` in WHERE | Every query filters by `home_id` |
| Missing `deleted_at IS NULL` | Every query excludes soft-deleted rows |
| Route imports repo | Route → Service → Repo (never skip) |
| `process.env.X` in files | Import `{ config }` from `config.js` |
| Second DB pool | Single pool in `db.js` only |
| Missing version increment | `version = version + 1` in every UPDATE |
| Parameterised route first | Static routes before `/:id` routes |
