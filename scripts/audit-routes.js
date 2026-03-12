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
 *   - All non-public /api/* routes must have at least one authorization middleware:
 *     requireAdmin, requirePlatformAdmin, requireHomeAccess, requireModule, or requireHomeManager
 *   - Self-service routes (change-password) only need requireAuth (no authorization middleware)
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
  'GET /readiness',  // Kubernetes readiness probe — no auth
  'GET *',           // SPA fallback — serves static index.html in production
]);

// Routes that only need requireAuth (no authorization middleware needed)
// These are self-service endpoints available to any authenticated user.
const SELF_SERVICE_ROUTES = new Set([
  'POST /api/login/logout',          // Any user can log out
  'POST /api/users/change-password', // Any user can change own password
  'GET /api/homes',                  // Returns only homes user has access to (filtered server-side)
  'GET /api/bank-holidays',          // Public reference data — no home scoping needed
  'GET /api/payroll/nmw',            // NMW rates — public reference data
  'GET /api/payroll/pension-config', // Pension thresholds — public reference data
  'GET /api/payroll/ssp-config',     // SSP rates — public reference data
]);

// Authorization middleware patterns — any non-public route must have at least one
const AUTH_Z_PATTERNS = [
  'requireAdmin',
  'requirePlatformAdmin',
  'requireHomeAccess',
  'requireModule',
  'requireHomeManager',
];

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
  const hasAuthZ = AUTH_Z_PATTERNS.some(p => middlewareStr.includes(p));
  const isPublic = PUBLIC_ROUTES.has(key);
  const isSelfService = SELF_SERVICE_ROUTES.has(key);

  const issues = [];

  if (isPublic) {
    if (hasRequireAuth) issues.push('WARNING: public route unexpectedly has requireAuth');
  } else {
    if (!hasRequireAuth) { issues.push('FAIL: missing requireAuth'); pass = false; }
    if (!isSelfService && !hasAuthZ) { issues.push('FAIL: missing authorization middleware'); pass = false; }
  }

  let status;
  if (issues.length > 0) {
    status = issues.join('; ');
  } else if (isPublic) {
    status = 'PUBLIC (intentional)';
  } else if (isSelfService) {
    status = 'PASS (self-service)';
  } else {
    // Show which authorization is used
    const authZUsed = AUTH_Z_PATTERNS.filter(p => middlewareStr.includes(p));
    status = `PASS (${authZUsed.join(' + ')})`;
  }

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
