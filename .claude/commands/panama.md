---
description: "Panama Staffing complete architecture reference. ALWAYS trigger when: building new features, adding endpoints, creating pages, writing migrations, adding API wrappers, wiring routes, creating repositories, writing services, building frontend components, or any development work on Panama. Covers the full layered architecture (DB -> Repo -> Service -> Route -> Frontend API -> Page), multi-home isolation, auth chain, optimistic locking, Zod validation, audit trail, design tokens, navigation wiring, testing patterns, and cross-module integration rules. Without this skill, new code will use wrong patterns (fetchJSON instead of apiFetch, wrong middleware order, missing _version extraction, inline modals instead of Modal component, raw Tailwind instead of design tokens). Use alongside experienced-dev and its sub-skills."
---

# Panama Architecture — Complete Reference

Read this BEFORE writing any Panama code. Every pattern here is extracted from the actual codebase. Deviations cause bugs.

For deep reference files, see references/ directory:

- `references/backend-patterns.md` — Full repo/service/route templates with line-by-line commentary
- `references/frontend-patterns.md` — Page structure, design tokens, modal/pagination/hooks
- `references/wiring-checklist.md` — Step-by-step checklist for adding a new module

## Contents

1. System Overview
2. Layered Architecture
3. Security Architecture
4. Database Conventions
5. Frontend Architecture
6. Error Handling
7. Testing Patterns
8. Cross-Module Integration

---

## System Overview

Panama is a care home business management ERP. Multi-tenant. Monolithic deployment.

- **Stack**: Node 20+, Express 5, PostgreSQL 15+, React 18, Vite, Tailwind CSS, Vitest.
- **Scale**: 1 home (40 staff, 35 residents) to 24 homes (1,000+ staff).
- **Size**: 37 repositories, 10 services, 27 route files, 54 pages, 89 migrations, 638 tests.

File structure:

```
server.js           <- Express app, route mounting, error handler
config.js           <- All env vars centralised, fail-fast on missing
db.js               <- pg Pool, withTransaction, date type parser
errors.js           <- AppError subclasses (400/401/403/404/409)
logger.js           <- Pino structured logging

routes/             <- HTTP layer (27 files)
services/           <- Business logic (10 files)
repositories/       <- Data access / raw SQL (37 files)
middleware/         <- auth.js (requireAuth, requireAdmin, requireHomeAccess)
lib/                <- Server-side helpers (rateLimiter, audit)
migrations/         <- Sequential NNN_description.sql (89 files)

src/
  lib/api.js        <- apiFetch + authHeaders + CRUD wrappers
  lib/design.js     <- Design token system (BTN, CARD, TABLE, INPUT, etc.)
  lib/navigation.js <- NAV_TOP + NAV_SECTIONS sidebar config
  components/       <- Shared components (Modal, Pagination, StaffPicker)
  hooks/            <- useDirtyGuard, useLiveDate, useIsAdmin, useEscapeKey
  pages/            <- Page components (54 files)
  contexts/         <- React contexts

tests/integration/  <- Vitest integration tests (direct repo/service, needs live PG)
```

---

## Layered Architecture

Every request flows through exactly these layers. No shortcuts. A route NEVER imports a repo. A repo NEVER imports a service. Frontend NEVER calls a repo.

```
Browser -> apiFetch() -> Express Route -> Service -> Repository -> PostgreSQL
                              |               |          |
                           Middleware       Business    Raw SQL
                           (auth, zod,     Logic       + shapers
                            rate limit,    (transactions,
                            audit)          validation)
```

### Database Layer (db.js)

Single pool. All repos import `{ pool }` from `'../db.js'`. Never create a second pool.

```javascript
import { pool, withTransaction } from '../db.js';
```

Date handling: DATE columns return ISO strings ('YYYY-MM-DD') via type parser 1082 set in db.js. TIMESTAMPTZ columns return Date objects — shapers convert via `ts()`.

Transactions:

```javascript
return withTransaction(async (client) => {
  const existing = await repo.findById(id, homeId, client);
  await repo.createFeeChange(homeId, data, client);
  return repo.update(id, homeId, data, client, version);
});
```

Use when: any operation that reads then writes based on what it read (TOCTOU). Fee changes, invoice numbering, bed transitions.

### Repository Layer

**Location**: `repositories/[entity]Repo.js`

Does: Raw SQL, parameterised queries, result shaping. Nothing else. No business logic. No auth. No validation beyond SQL constraints.

Standard helpers at top of every repo:

```javascript
const d = v => v instanceof Date ? v.toISOString().slice(0, 10) : v;  // DATE -> string
const ts = v => v instanceof Date ? v.toISOString() : v;              // TIMESTAMPTZ -> string
const f = v => v != null ? parseFloat(v) : null;                      // NUMERIC -> float
```

Every function signature: `(id?, homeId, data?, client?, version?)` — client param enables transaction passthrough.

List query pattern — `COUNT(*) OVER()` for total without second query:

```javascript
export async function findAll(homeId, { status, limit = 100, offset = 0 } = {}, client) {
  const conn = client || pool;
  let sql = 'SELECT *, COUNT(*) OVER() AS _total FROM entities WHERE home_id = $1 AND deleted_at IS NULL';
  const params = [homeId];
  if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
  sql += ' ORDER BY created_at DESC';
  params.push(Math.min(limit, 500)); sql += ` LIMIT $${params.length}`;
  params.push(offset); sql += ` OFFSET $${params.length}`;
  const { rows } = await conn.query(sql, params);
  const total = rows.length > 0 ? parseInt(rows[0]._total) : 0;
  return { rows: rows.map(shapeEntity), total };
}
```

Update with optimistic locking:

```javascript
export async function update(id, homeId, data, client, version) {
  const conn = client || pool;
  const fields = []; const params = [id, homeId];
  const settable = ['name', 'status', 'amount', 'notes'];  // whitelist prevents mass assignment
  for (const key of settable) {
    if (key in data) { params.push(data[key] ?? null); fields.push(`${key} = $${params.length}`); }
  }
  if (fields.length === 0) return findById(id, homeId, client);
  fields.push('version = version + 1');
  let sql = `UPDATE entities SET ${fields.join(', ')} WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`;
  if (version != null) { params.push(version); sql += ` AND version = $${params.length}`; }
  sql += ' RETURNING *';
  const { rows, rowCount } = await conn.query(sql, params);
  if (rowCount === 0 && version != null) return null;  // stale -> route sends 409
  return rows[0] ? shapeEntity(rows[0]) : null;
}
```

Soft delete: `SET deleted_at = NOW()`. Never `DELETE FROM`. GDPR and audit require retention.

### Service Layer

**Location**: `services/[domain]Service.js`

Most services are thin pass-throughs. Only add logic when there are real business rules.

Thin pass-through (majority of services):

```javascript
export async function findAll(homeId, filters) { return entityRepo.findAll(homeId, filters); }
```

Real logic (fee change tracking, cross-table writes): Use `withTransaction` when reads + writes must be atomic. See `references/backend-patterns.md` for full example.

### Route Layer

**Location**: `routes/[domain].js`

Does: Auth middleware, Zod validation, HTTP -> service mapping, audit logging, error responses. No business logic. No SQL.

Two Zod validation patterns (deliberate split):

- **Pagination/query params** -> `.parse()` — throws ZodError, caught by global error handler, returns 400 automatically. Used because pagination failures are always client errors.
- **Body schemas** -> `.safeParse()` — manual 400 with first issue message. Used because body validation errors need the specific field message returned to the user.

```javascript
// Pagination — .parse() throws on invalid, global handler catches
const pg = paginationSchema.parse(req.query);

// Body — .safeParse() for controlled error message
const parsed = bodySchema.safeParse(req.body);
if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
```

**CRITICAL — `_version` extraction:**

```javascript
// _version read from raw req.body BEFORE Zod parsing
// Zod strips unknown keys (default strip mode) — _version would be lost
const version = req.body._version != null ? parseInt(req.body._version, 10) : null;
```

Response shape — raw, not wrapped:

```javascript
res.json(result);                    // { rows: [...], total: N } for lists
res.status(201).json(result);        // shaped entity for creates
res.json({ deleted: true });         // for deletes
```

Panama does NOT use `{ data: ..., meta: ... }` envelope pattern.

Route ordering: Static routes BEFORE parameterised. `/residents/with-beds` before `/residents/:id` — Express matches top-down.

Mounting in server.js:

```javascript
import entityRouter from './routes/entity.js';
app.use('/api/entity', entityRouter);
```

Constraint error handling (defined per route file that needs it):

```javascript
function handleConstraintError(err, res) {
  if (err.code === '23505') return res.status(409).json({ error: 'Duplicate record' });
  if (err.code === '23503') return res.status(400).json({ error: 'Referenced record not found' });
  if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
  throw err;
}
```

Audit on every mutation:

```javascript
await auditService.log('entity_update', req.home.slug, req.user.username,
  { id: idP.data, entity: 'entity_name', changes: diffFields(existing, result) });
```

`diffFields(before, after)` compares all fields (skipping metadata) and returns `[{ field, old, new }]`.

### Frontend API Layer (src/lib/api.js)

Central fetch wrapper — ALWAYS use `apiFetch` + `authHeaders`:

```javascript
const API_BASE = '/api';

async function apiFetch(url, options = {}) {
  const res = await fetch(url, options);
  if (res.status === 401) { const err = new Error('Session expired'); err.status = 401; throw err; }
  if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error || `Request failed (${res.status})`); }
  return res.json();
}

function authHeaders(extra = {}) {
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}`, ...extra };
}

const h = (homeSlug) => encodeURIComponent(homeSlug);
```

**NEVER use `fetchJSON`** — it does not exist. Always `apiFetch`.

Home is passed as query param `?home=slug`, NOT as path param:

```javascript
export async function getEntities(homeSlug, filters = {}) {
  const params = new URLSearchParams({ home: homeSlug });
  if (filters.status) params.set('status', filters.status);
  if (filters.limit) params.set('limit', filters.limit);
  if (filters.offset) params.set('offset', filters.offset);
  return apiFetch(`${API_BASE}/entities?${params}`, { headers: authHeaders() });
}
```

---

## Security Architecture

### Multi-Home Isolation

Every table has `home_id`. Every query filters by it. This is the primary security boundary.

```
Request: GET /api/finance/residents?home=oak-lodge
  -> requireHomeAccess resolves "oak-lodge" -> home_id=7
  -> Checks user has access to home_id=7
  -> Sets req.home = { id: 7, slug: 'oak-lodge', name: 'Oak Lodge' }
  -> All queries use req.home.id
```

### Auth Middleware Chain (always this order)

```
requireAuth -> requireAdmin? -> requireHomeAccess
     |              |                |
  JWT valid    role=admin       user has access
  req.user     (mutations)      to this home
  attached                      req.home attached
```

Read-only endpoints that non-admin staff need (roster, resident list, handover) omit `requireAdmin`.

### Rate Limiting

```javascript
writeRateLimiter  // POST/PUT/DELETE — 120 per 15min per IP
readRateLimiter   // GET-heavy endpoints — 300 per 15min per IP
```

Applied at router level via `router.use(writeRateLimiter)`. Read-heavy route files (audit, export, bankHolidays, careCert, scheduling) use `readRateLimiter` instead.

### Optimistic Locking Flow

```
1. Frontend loads entity -> gets version: 3
2. User edits form
3. Save sends: { ...formData, _version: 3 }     <- underscore prefix REQUIRED
4. Route reads req.body._version BEFORE Zod parse
5. Repo: UPDATE ... WHERE id=$1 AND home_id=$2 AND version=3
6a. Version matches -> updated, version=4, return row
6b. Version stale -> rowCount=0, repo returns null
7. Route maps null -> 409 response
```

### Input Validation

Parameterised queries only. Never concatenate user input into SQL.

```javascript
// CORRECT — search as parameter
params.push(`%${search}%`); sql += ` AND name ILIKE $${params.length}`;

// NEVER — SQL injection vulnerability
sql += ` AND name ILIKE '%${search}%'`;
```

---

## Database Conventions

### Migration Files

**Location**: `migrations/NNN_description.sql` — sequential three-digit prefix.

Structure:

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
  -- Standard columns (every table)
  version           INTEGER NOT NULL DEFAULT 1,
  created_by        VARCHAR(100) NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);
-- Partial indexes — only non-deleted rows
CREATE INDEX idx_entity_home_status ON entity_name(home_id, status) WHERE deleted_at IS NULL;

-- DOWN
DROP TABLE IF EXISTS entity_name;
```

Rules:

- **Money**: `NUMERIC(10,2)` — exact decimal. Never FLOAT.
- **Enums**: CHECK constraints, not PostgreSQL ENUM type (CHECK is trivial to alter).
- Every table gets: `id`, `home_id`, `version`, `created_by`, `created_at`, `updated_at`, `deleted_at`.
- Partial indexes with `WHERE deleted_at IS NULL`.

---

## Frontend Architecture

### Page Structure

```javascript
import { useState, useEffect, useMemo } from 'react';
import { BTN, CARD, TABLE, INPUT, PAGE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import { getCurrentHome, getLoggedInUser, getEntities, updateEntity } from '../lib/api.js';

export default function EntityPage() {
  const home = getCurrentHome();
  const isAdmin = getLoggedInUser()?.role === 'admin';
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});

  async function load() { /* fetch -> setItems -> setError -> setLoading */ }
  useEffect(() => { load(); }, [home]);

  async function handleSave() {
    if (editing) await updateEntity(home, editing.id, { ...form, _version: editing.version });
    else await createEntity(home, form);
    setShowModal(false); load();
  }
  // ...
}
```

### Design Tokens — ALWAYS import from design.js

```javascript
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE, TAB } from '../lib/design.js';
```

Never write raw Tailwind classes. Use: `BTN.primary`, `BTN.secondary`, `BTN.danger`, `BTN.ghost`, `BTN.xs`, `BTN.sm`, `CARD.base`, `CARD.padded`, `CARD.elevated`, `TABLE.wrapper`, `TABLE.table`, `TABLE.thead`, `TABLE.th`, `TABLE.tr`, `TABLE.td`, `INPUT.base`, `INPUT.select`, `INPUT.label`, `BADGE.blue/green/amber/red/gray/purple`, `PAGE.container`, `PAGE.header`, `PAGE.title`, `TAB.bar`, `TAB.button`, `TAB.active`, `TAB.inactive`.

### Modal Component

```javascript
import Modal from '../components/Modal.jsx';
<Modal isOpen={showModal} onClose={closeModal} title="Edit Entity" size="xl">
  {/* body */}
</Modal>
```

Props: `isOpen`, `onClose`, `title`, `size` ('sm'|'md'|'lg'|'xl'|'wide'). Use for ALL new modals.

### Navigation (src/lib/navigation.js)

```javascript
// Top level
export const NAV_TOP = [{ path: '/', label: 'Dashboard', icon: '...' }];
// Grouped sections — adminOnly: true hides from non-admins
export const NAV_SECTIONS = [{ id: 'section', label: 'Section', adminOnly: true, items: [...] }];
```

### Routing (src/components/AppRoutes.jsx)

```javascript
const EntityPage = lazy(() => import('../pages/EntityPage.jsx'));
<Route path="/entity" element={<RouteErrorBoundary><EntityPage /></RouteErrorBoundary>} />
```

### Excel Export — Dynamic Import

```javascript
async function handleExport() {
  const { downloadXLSX } = await import('../lib/excel.js');
  downloadXLSX('entities.xlsx', [{ name: 'Sheet', headers: [...], rows: [...] }]);
}
```

Never top-level import — XLSX library is large.

### Custom Hooks

| Hook | Purpose |
|------|---------|
| `useDirtyGuard(isDirty)` | Warns before navigating from unsaved changes |
| `useLiveDate()` | Reactive today string, updates at midnight |
| `useIsAdmin()` | Admin role check |
| `useEscapeKey(cb)` | Escape key handler |

### Component Directory

Small modules: single file in `pages/`. Large modules (3+ sub-components): directory in `components/entity/`. New standard — monolithic 500+ line pages are being replaced.

---

## Error Handling

### Error Classes (errors.js)

`ValidationError(400)`, `AuthenticationError(401)`, `ForbiddenError(403)`, `NotFoundError(404)`, `ConflictError(409)`.

### Global Handler (server.js)

Catches AppError subclasses -> status + message. Catches ZodError -> 400 + first issue. Everything else -> 500 + "Internal server error". Stack traces logged server-side, never sent to client. Sentry enabled conditionally via `config.sentryDsn`.

### Config (config.js)

All `process.env` reads centralised. Server refuses to start if required vars missing. Import `{ config }` — never read `process.env` elsewhere.

---

## Testing Patterns

**Location**: `tests/integration/[module].test.js` — Vitest, direct repo/service calls, live PostgreSQL.

**Setup**: Create test homes with unique slugs ('test-a'). Clean child tables first (FK constraints), then parents. Each test file isolated.

What to test per module:

- Create returns shaped entity with version=1
- Read by id works, returns null for wrong home (multi-home isolation)
- Update increments version, returns null on stale version (optimistic locking)
- List returns `{ rows, total }`, empty for other home
- Soft delete makes record invisible
- Filters work individually and combined
- SQL injection in search doesn't break (parameterised queries)
- Edge: zero rows, boundary values, empty strings

---

## Cross-Module Integration

**Rule: Read across, write within.**

- Module A can READ Module B's data (LEFT JOIN, API call)
- Module A does NOT WRITE to Module B's tables
- Cross-module writes use links: "Update in Module B ->"
- Safety net: dashboard warnings for cross-module inconsistencies, not blocking actions

**Example**: Residents page reads beds data (LEFT JOIN). Writes to `finance_residents` (own table). Links to BedManager for bed mutations. Neither module directly mutates the other.

**Why**: Two API calls without shared transaction = half-done state on failure. Loose coupling means either module updates independently.
