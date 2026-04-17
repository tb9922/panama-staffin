# Wiring Checklist — Adding a New Module

Step-by-step checklist for adding a complete new module to Panama. Follow in order.

---

## 1. Migration

- [ ] Create `migrations/NNN_description.sql` (next sequential number)
- [ ] Include: `id SERIAL PRIMARY KEY`, `home_id INTEGER NOT NULL REFERENCES homes(id) ON DELETE CASCADE`
- [ ] Include standard columns: `version`, `created_by`, `created_at`, `updated_at`, `deleted_at`
- [ ] Use `NUMERIC(10,2)` for money, `CHECK` for enums, `VARCHAR` with lengths
- [ ] Add partial index: `WHERE deleted_at IS NULL`
- [ ] Include `-- DOWN` section with `DROP TABLE IF EXISTS`
- [ ] Run: `node scripts/migrate.js`

## 2. Repository

- [ ] Create `repositories/entityRepo.js`
- [ ] Add type converters: `d()`, `ts()`, `f()`
- [ ] Define explicit `COLS` constant (no `SELECT *`)
- [ ] Create `shape(row)` function with all type conversions
- [ ] Implement: `findById(id, homeId, client)`
- [ ] Implement: `findAll(homeId, filters, client)` with `COUNT(*) OVER()` pagination
- [ ] Implement: `create(homeId, data, client)` with `RETURNING`
- [ ] Implement: `update(id, homeId, data, client, version)` with optimistic locking
- [ ] Implement: `softDelete(id, homeId, client)`
- [ ] Every function accepts optional `client` param (for transactions)
- [ ] Every query includes `AND deleted_at IS NULL`
- [ ] Every query scopes by `home_id`

## 3. Service

- [ ] Create `services/entityService.js`
- [ ] Import repo, NOT pool/db directly
- [ ] Thin pass-through for simple CRUD
- [ ] Add `withTransaction` for any read-then-write operations
- [ ] Add `logger.info` on creates/updates with entity ID and home ID
- [ ] Business validation at service level (not route, not repo)

## 4. Route

- [ ] Create `routes/entity.js`
- [ ] Import: `Router`, `z` (zod), middleware, service, auditService
- [ ] Define Zod schemas: `idSchema`, `paginationSchema`, `bodySchema`
- [ ] Add `handleConstraintError` function
- [ ] Add `diffFields` function for audit diffs
- [ ] Middleware chain: `rateLimiter, requireAuth, requireHomeAccess, requireModule('module', 'read'|'write')`
- [ ] GET `/` — list with pagination (readRateLimiter)
- [ ] GET `/:id` — find by ID (readRateLimiter)
- [ ] POST `/` — create with body validation (writeRateLimiter)
- [ ] PUT `/:id` — update with `_version` extraction BEFORE Zod parse
- [ ] DELETE `/:id` — soft delete
- [ ] Audit log on every mutation: `auditService.log()`
- [ ] Static routes BEFORE parameterised routes
- [ ] Export `default router`

## 5. Mount in server.js

- [ ] Add import: `import entityRouter from './routes/entity.js';`
- [ ] Add mount: `app.use('/api/entities', entityRouter);`
- [ ] Place AFTER auth middleware, BEFORE error handler

## 6. API Wrappers (src/lib/api.js)

- [ ] Add `getEntities(homeSlug, filters)` — GET with URLSearchParams
- [ ] Add `createEntity(homeSlug, data)` — POST with JSON body
- [ ] Add `updateEntity(homeSlug, id, data)` — PUT with JSON body
- [ ] Add `deleteEntity(homeSlug, id)` — DELETE
- [ ] Use `apiFetch` + `authHeaders()` (NEVER `fetchJSON`)
- [ ] Home as query param: `?home=${h(homeSlug)}`
- [ ] IDs via `encodeURIComponent(id)`

## 7. Frontend Page

- [ ] Create `src/pages/EntityPage.jsx`
- [ ] Import design tokens: `BTN, CARD, TABLE, INPUT, PAGE, BADGE`
- [ ] Import `Modal` from `../components/Modal.jsx`
- [ ] Import API wrappers from `../lib/api.js`
- [ ] Use `getCurrentHome()` for home slug
- [ ] Use `useData().canWrite('module')` for RBAC
- [ ] State: `items`, `total`, `loading`, `error`, `showModal`, `editing`, `form`
- [ ] `load()` wrapped in `useCallback` with `[home]` dependency
- [ ] `useEffect(() => { load(); }, [load])`
- [ ] `openCreate()`, `openEdit(item)`, `closeModal()`, `handleSave()`, `handleDelete(item)`
- [ ] Send `_version: editing.version` on updates
- [ ] Call `load()` after save (not manual state update)
- [ ] Guard edit buttons with `canEdit`

## 8. Navigation

- [ ] Add to `src/lib/navigation.js` in correct `NAV_SECTIONS` group
- [ ] Include: `path`, `label`, `module`, `icon` (Heroicons SVG path)

## 9. Routing

- [ ] Add to `src/components/AppRoutes.jsx`
- [ ] Lazy import: `const EntityPage = lazy(() => import('../pages/EntityPage.jsx'));`
- [ ] Route with guards: `<RouteErrorBoundary><RequireModule module="module"><EntityPage /></RequireModule></RouteErrorBoundary>`

## 10. RBAC (if new module)

- [ ] Add module to `shared/roles.js` MODULES array
- [ ] Define access levels per role in ROLE_DEFINITIONS
- [ ] Update CLAUDE.md module count and role table

## 11. Tests

- [ ] Create `tests/integration/entity.test.js`
- [ ] Test: create returns shaped entity with version=1
- [ ] Test: findById works, returns null for wrong home (multi-home isolation)
- [ ] Test: update increments version, returns null on stale version (optimistic locking)
- [ ] Test: findAll returns `{ rows, total }`, empty for other home
- [ ] Test: soft delete makes record invisible to findAll/findById
- [ ] Test: filters work individually and combined
- [ ] Test: SQL injection in search doesn't break
- [ ] Test: edge cases — zero rows, boundary values, empty strings

## 12. Verification

- [ ] `node scripts/migrate.js` — migration applies clean
- [ ] `npm test` — all tests pass
- [ ] `npm run audit:routes` — new routes detected and authenticated
- [ ] `npm run dev` — page loads, CRUD works end-to-end
- [ ] Check multi-home isolation: data from home A not visible in home B
- [ ] Check optimistic locking: stale version returns 409
- [ ] Check RBAC: viewer role can't see write buttons or call write endpoints

---

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Using `fetchJSON` | Use `apiFetch` + `authHeaders()` |
| `SELECT *` in repo | Explicit column list via `COLS` constant |
| Missing `client \|\| pool` | Every repo function needs optional client param |
| `_version` lost after Zod | Extract from `req.body._version` BEFORE `.safeParse()` |
| Raw Tailwind on buttons | Use `BTN.primary`, `BTN.secondary`, etc. |
| Inline modal markup | Use `<Modal>` component |
| `DELETE FROM` in SQL | Use `SET deleted_at = NOW()` (soft delete) |
| Missing `home_id` in query | Every query must scope by `home_id` |
| FLOAT for money | Use `NUMERIC(10,2)` |
| Top-level Excel import | Dynamic: `await import('../lib/excel.js')` |
| `/:id` before `/sub-resource` | Static routes FIRST in Express |
| No audit log on mutation | `auditService.log()` on every create/update/delete |
