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
  'GET *', // SPA fallback — serves static index.html in production
]);

// Routes that require requireAdmin in addition to requireAuth
const ADMIN_ROUTES = new Set([
  'POST /api/data',
  'GET /api/audit',
  'DELETE /api/audit/purge',
  'GET /api/export',
  // Webhooks — admin-only
  'GET /api/webhooks',
  'POST /api/webhooks',
  'PUT /api/webhooks/:id',
  'DELETE /api/webhooks/:id',
  'GET /api/webhooks/:id/deliveries',
  // Staff import — admin-only
  'GET /api/import/staff/template',
  'POST /api/import/staff',
  'POST /api/handover',
  'PUT /api/handover/:id',
  'DELETE /api/handover/:id',
  // HR — all routes admin-only (GDPR special category data)
  'GET /api/hr/cases/disciplinary',
  'POST /api/hr/cases/disciplinary',
  'GET /api/hr/cases/disciplinary/:id',
  'PUT /api/hr/cases/disciplinary/:id',
  'GET /api/hr/cases/grievance',
  'POST /api/hr/cases/grievance',
  'GET /api/hr/cases/grievance/:id',
  'PUT /api/hr/cases/grievance/:id',
  'GET /api/hr/cases/grievance/:id/actions',
  'POST /api/hr/cases/grievance/:id/actions',
  'PUT /api/hr/grievance-actions/:id',
  'GET /api/hr/cases/performance',
  'POST /api/hr/cases/performance',
  'GET /api/hr/cases/performance/:id',
  'PUT /api/hr/cases/performance/:id',
  'GET /api/hr/absence/summary',
  'GET /api/hr/absence/staff/:staffId',
  'GET /api/hr/rtw-interviews',
  'POST /api/hr/rtw-interviews',
  'PUT /api/hr/rtw-interviews/:id',
  'GET /api/hr/oh-referrals',
  'POST /api/hr/oh-referrals',
  'PUT /api/hr/oh-referrals/:id',
  'GET /api/hr/contracts',
  'POST /api/hr/contracts',
  'GET /api/hr/contracts/:id',
  'PUT /api/hr/contracts/:id',
  'GET /api/hr/family-leave',
  'POST /api/hr/family-leave',
  'GET /api/hr/family-leave/:id',
  'PUT /api/hr/family-leave/:id',
  'GET /api/hr/flexible-working',
  'POST /api/hr/flexible-working',
  'GET /api/hr/flexible-working/:id',
  'PUT /api/hr/flexible-working/:id',
  'GET /api/hr/edi',
  'POST /api/hr/edi',
  'GET /api/hr/edi/:id',
  'PUT /api/hr/edi/:id',
  'GET /api/hr/tupe',
  'POST /api/hr/tupe',
  'GET /api/hr/tupe/:id',
  'PUT /api/hr/tupe/:id',
  'GET /api/hr/renewals',
  'POST /api/hr/renewals',
  'GET /api/hr/renewals/:id',
  'PUT /api/hr/renewals/:id',
  'GET /api/hr/warnings',
  'GET /api/hr/stats',
  'GET /api/hr/case-notes/:caseType/:caseId',
  'POST /api/hr/case-notes/:caseType/:caseId',
  // File attachments & investigation meetings
  'GET /api/hr/attachments/:caseType/:caseId',
  'POST /api/hr/attachments/:caseType/:caseId',
  'GET /api/hr/attachments/download/:id',
  'DELETE /api/hr/attachments/:id',
  'GET /api/hr/meetings/:caseType/:caseId',
  'POST /api/hr/meetings/:caseType/:caseId',
  'PUT /api/hr/meetings/:id',
  // Payroll — admin-only mutation routes
  'POST /api/payroll/rates',
  'PUT /api/payroll/rates/:ruleId',
  'DELETE /api/payroll/rates/:ruleId',
  'POST /api/payroll/timesheets',
  'POST /api/payroll/timesheets/:id/approve',
  'POST /api/payroll/timesheets/:id/dispute',
  'POST /api/payroll/timesheets/bulk-approve',
  'POST /api/payroll/timesheets/batch-upsert',
  'POST /api/payroll/timesheets/approve-range',
  'POST /api/payroll/runs',
  'POST /api/payroll/runs/:runId/calculate',
  'POST /api/payroll/runs/:runId/approve',
  'GET /api/payroll/runs/:runId/export',
  'GET /api/payroll/runs/:runId/payslips/:staffId',
  'GET /api/payroll/runs/:runId/payslips',
  'GET /api/payroll/runs/:runId/summary-pdf',
  'POST /api/payroll/agency/providers',
  'PUT /api/payroll/agency/providers/:id',
  'POST /api/payroll/agency/shifts',
  'PUT /api/payroll/agency/shifts/:id',
  'POST /api/payroll/tax-codes',
  'POST /api/payroll/pensions',
  'POST /api/payroll/sick-periods',
  'PUT /api/payroll/sick-periods/:id',
  'PUT /api/payroll/hmrc/:id/paid',
  // Scheduling — override + day-note mutations are admin-only
  'PUT /api/scheduling/overrides',
  'DELETE /api/scheduling/overrides',
  'POST /api/scheduling/overrides/bulk',
  'DELETE /api/scheduling/overrides/month',
  'PUT /api/scheduling/day-notes',
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
