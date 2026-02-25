#!/usr/bin/env node
/**
 * Route Auth Audit — scripts/audit-routes.js
 *
 * Static analysis of server.js to verify every route has appropriate auth middleware.
 * Run with: node scripts/audit-routes.js
 * Exit code 0 = all pass. Exit code 1 = gaps found.
 *
 * Rules:
 *   - All /api/* routes must have requireAuth (unless explicitly whitelisted)
 *   - /api/data POST, /api/audit, /api/export must also have requireAdmin
 *   - /health is intentionally public (health check — no auth)
 *   - /api/login is intentionally public (auth endpoint itself — has rate limiter)
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, '..', 'server.js');
const source = readFileSync(serverPath, 'utf-8');

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
]);

// Parse all route registrations: app.METHOD('path', middleware..., handler)
const ROUTE_PATTERN = /app\.(get|post|put|delete|patch)\(\s*'([^']+)'(.*?)(?=app\.|\/\/\s*─{2,}|$)/gs;

const routes = [];
let match;
while ((match = ROUTE_PATTERN.exec(source)) !== null) {
  const method = match[1].toUpperCase();
  const routePath = match[2];
  const middlewareStr = match[3];
  routes.push({ method, path: routePath, middlewareStr, key: `${method} ${routePath}` });
}

let pass = true;
const results = [];

for (const route of routes) {
  const { method, path: routePath, middlewareStr, key } = route;
  const hasRequireAuth = middlewareStr.includes('requireAuth');
  const hasRequireAdmin = middlewareStr.includes('requireAdmin');
  const isPublic = PUBLIC_ROUTES.has(key);
  const needsAdmin = ADMIN_ROUTES.has(key);

  const issues = [];

  if (isPublic) {
    if (hasRequireAuth) {
      issues.push('WARNING: public route unexpectedly has requireAuth');
    }
  } else {
    if (!hasRequireAuth) {
      issues.push('FAIL: missing requireAuth');
      pass = false;
    }
  }

  if (needsAdmin && !hasRequireAdmin) {
    issues.push('FAIL: missing requireAdmin (admin-only route)');
    pass = false;
  }

  if (needsAdmin && !hasRequireAuth) {
    issues.push('FAIL: missing requireAuth (admin-only route must have both)');
    pass = false;
  }

  const status = issues.length === 0
    ? (isPublic ? 'PUBLIC (intentional)' : needsAdmin ? 'PASS (auth + admin)' : 'PASS (auth)')
    : issues.join('; ');

  results.push({ key, status });
}

// Print report
const maxKey = Math.max(...results.map(r => r.key.length));
console.log('\nRoute Auth Audit — server.js\n');
for (const { key, status } of results) {
  const padded = key.padEnd(maxKey + 2);
  const icon = status.startsWith('FAIL') ? '✗' : status.startsWith('WARNING') ? '!' : '✓';
  console.log(`  ${icon}  ${padded}${status}`);
}

console.log('');
if (pass) {
  console.log('All routes pass auth audit.\n');
  process.exit(0);
} else {
  console.log('Auth gaps found — fix before deployment.\n');
  process.exit(1);
}
