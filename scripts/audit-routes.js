#!/usr/bin/env node
/**
 * Route Auth Audit — scripts/audit-routes.js
 *
 * Scans server.js for app.use() mounts and routes/*.js for router.METHOD() registrations.
 * Verifies every /api/* route has appropriate auth middleware.
 *
 * Run with: node scripts/audit-routes.js
 * Exit code 0 = all pass. Exit code 1 = gaps found.
 *
 * Rules:
 *   - All /api/* routes must have requireAuth (unless explicitly whitelisted)
 *   - POST /api/data, GET /api/audit, GET /api/export must also have requireAdmin
 *   - /health is intentionally public (health check — no auth)
 *   - /api/login is intentionally public (auth endpoint itself — has rate limiter)
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

// Routes that are intentionally public (no requireAuth)
const PUBLIC_ROUTES = new Set([
  'POST /api/login',
  'GET /health',
]);

// Routes that require requireAdmin in addition to requireAuth
const ADMIN_ROUTES = new Set([
  'POST /api/data',
  'GET /api/audit',
  'GET /api/export',
  'POST /api/handover',
  'PUT /api/handover/:id',
  'DELETE /api/handover/:id',
]);

// ── Step 1: parse server.js for app.use() mounts and import mappings ──────────

const serverSource = readFileSync(path.join(rootDir, 'server.js'), 'utf-8');

// Match: app.use('/api/xxx', someRouter)
const MOUNT_PATTERN = /app\.use\(\s*'([^']+)'\s*,\s*(\w+)\s*\)/g;
const mounts = new Map(); // routerVarName → mountPath
let mountMatch;
while ((mountMatch = MOUNT_PATTERN.exec(serverSource)) !== null) {
  mounts.set(mountMatch[2], mountMatch[1]);
}

// Match: import routerVar from './routes/xxx.js'
const IMPORT_PATTERN = /import\s+(\w+)\s+from\s+'\.\/routes\/([^']+)'/g;
const routeFiles = new Map(); // routerVarName → resolved file path
let importMatch;
while ((importMatch = IMPORT_PATTERN.exec(serverSource)) !== null) {
  routeFiles.set(importMatch[1], path.join(rootDir, 'routes', importMatch[2]));
}

// Direct routes in server.js (e.g. health check)
const DIRECT_ROUTE_PATTERN = /app\.(get|post|put|delete|patch)\(\s*'([^']+)'(.*?)(?=app\.|\/\/\s*─{2,}|$)/gs;
const directRoutes = [];
let directMatch;
while ((directMatch = DIRECT_ROUTE_PATTERN.exec(serverSource)) !== null) {
  directRoutes.push({
    key: `${directMatch[1].toUpperCase()} ${directMatch[2]}`,
    middlewareStr: directMatch[3],
    file: 'server.js',
  });
}

// ── Step 2: parse each route file for router.METHOD() registrations ────────────

const ROUTER_PATTERN = /router\.(get|post|put|delete|patch)\(\s*'([^']+)'(.*?)(?=router\.|export default|\/\/\s*─{2,}|$)/gs;

const routerRoutes = [];

for (const [varName, filePath] of routeFiles) {
  const mountPath = mounts.get(varName);
  if (!mountPath) continue;

  let source;
  try { source = readFileSync(filePath, 'utf-8'); } catch { continue; }

  const pattern = new RegExp(ROUTER_PATTERN.source, 'gs');
  let routeMatch;
  while ((routeMatch = pattern.exec(source)) !== null) {
    const method = routeMatch[1].toUpperCase();
    const subPath = routeMatch[2];
    const middlewareStr = routeMatch[3];
    const fullPath = subPath === '/' ? mountPath : `${mountPath}${subPath}`;
    routerRoutes.push({
      key: `${method} ${fullPath}`,
      middlewareStr,
      file: path.relative(rootDir, filePath),
    });
  }
}

// ── Step 3: audit all routes ───────────────────────────────────────────────────

const allRoutes = [...directRoutes, ...routerRoutes];

let pass = true;
const results = [];

for (const { key, middlewareStr, file } of allRoutes) {
  const hasRequireAuth = middlewareStr.includes('requireAuth');
  const hasRequireAdmin = middlewareStr.includes('requireAdmin');
  const isPublic = PUBLIC_ROUTES.has(key);
  const needsAdmin = ADMIN_ROUTES.has(key);

  const issues = [];

  if (isPublic) {
    if (hasRequireAuth) issues.push('WARNING: public route unexpectedly has requireAuth');
  } else {
    if (!hasRequireAuth) { issues.push('FAIL: missing requireAuth'); pass = false; }
  }

  if (needsAdmin && !hasRequireAdmin) { issues.push('FAIL: missing requireAdmin'); pass = false; }
  if (needsAdmin && !hasRequireAuth)  { issues.push('FAIL: missing requireAuth (admin route)'); pass = false; }

  const status = issues.length === 0
    ? (isPublic ? 'PUBLIC (intentional)' : needsAdmin ? 'PASS (auth + admin)' : 'PASS (auth)')
    : issues.join('; ');

  results.push({ key, status, file });
}

// ── Step 4: print report ───────────────────────────────────────────────────────

const maxKey = Math.max(...results.map(r => r.key.length));
const maxFile = Math.max(...results.map(r => r.file.length));

console.log('\nRoute Auth Audit — routes/*.js\n');
for (const { key, status, file } of results) {
  const icon = status.startsWith('FAIL') ? '✗' : status.startsWith('WARNING') ? '!' : '✓';
  console.log(`  ${icon}  ${key.padEnd(maxKey + 2)}${file.padEnd(maxFile + 2)}${status}`);
}

console.log('');
if (pass) {
  console.log('All routes pass auth audit.\n');
  process.exit(0);
} else {
  console.log('Auth gaps found — fix before deployment.\n');
  process.exit(1);
}
