#!/usr/bin/env node
/**
 * Route auth audit.
 *
 * Scans server.js for app.use() mounts and routes/*.js for router.METHOD()
 * registrations. Verifies every /api/* route has appropriate auth middleware.
 *
 * Exit code 0 = all pass. Exit code 1 = gaps found.
 */

import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

const PUBLIC_ROUTES = new Set([
  'POST /api/login',
  'GET /api/staff-auth/invite/:token',
  'POST /api/staff-auth/invite/consume',
  'GET /health',
  'GET /readiness',
  'GET *',
  'GET /{*splat}',
]);

const TOKEN_GATED_ROUTES = new Set([
  'GET /metrics',
]);

const SELF_SERVICE_ROUTES = new Set([
  'POST /api/login/logout',
  'POST /api/staff-auth/change-password',
  'POST /api/users/change-password',
  'GET /api/homes',
  'GET /api/bank-holidays',
  'GET /api/payroll/nmw',
  'GET /api/payroll/pension-config',
  'GET /api/payroll/ssp-config',
]);

const CUSTOM_AUTHZ_ROUTES = new Map([
  ['GET /api/audit', 'custom scoped audit-log authorization'],
  ['GET /api/gdpr/access-log', 'custom scoped GDPR access-log authorization'],
  ['GET /api/portfolio/kpis', 'custom per-home portfolio authorization'],
  ['GET /api/portfolio/board-pack', 'custom per-home portfolio authorization'],
  ['GET /api/portfolio-snapshots', 'custom per-home portfolio authorization'],
  ['POST /api/portfolio-snapshots/capture', 'custom per-home portfolio authorization'],
  ['GET /api/home-setup', 'custom per-home setup authorization'],
  ['GET /api/operational-reviews', 'custom per-home module-aware operational authorization'],
]);

const AUTH_Z_PATTERNS = [
  'requireAdmin',
  'requirePlatformAdmin',
  'requireHomeAccess',
  'requireModule',
  'requireHomeManager',
  'staffReadChain',
  'staffWriteChain',
];

const serverSource = readFileSync(path.join(rootDir, 'server.js'), 'utf-8');

const mountPattern = /app\.use\(\s*'([^']+)'\s*,\s*(\w+)\s*\)/g;
const mounts = new Map();
let mountMatch;
while ((mountMatch = mountPattern.exec(serverSource)) !== null) {
  mounts.set(mountMatch[2], mountMatch[1]);
}

const importPattern = /import\s+(\w+)\s+from\s+'\.\/routes\/([^']+)'/g;
const routeFiles = new Map();
let importMatch;
while ((importMatch = importPattern.exec(serverSource)) !== null) {
  routeFiles.set(importMatch[1], path.join(rootDir, 'routes', importMatch[2]));
}

const directRoutePattern = /app\.(get|post|put|delete|patch)\(\s*'([^']+)'(.*?)(?=app\.|\/\/\s*[=-]{2,}|$)/gs;
const directRoutes = [];
let directMatch;
while ((directMatch = directRoutePattern.exec(serverSource)) !== null) {
  directRoutes.push({
    key: `${directMatch[1].toUpperCase()} ${directMatch[2]}`,
    middlewareStr: directMatch[3],
    file: 'server.js',
  });
}

const routerPattern = /router\.(get|post|put|delete|patch)\(\s*'([^']+)'(.*?)(?=router\.|export default|\/\/\s*[=-]{2,}|$)/gs;
const routerRoutes = [];

function routeFilePath(importPath, baseDir = path.join(rootDir, 'routes')) {
  const raw = path.resolve(baseDir, importPath);
  if (path.extname(raw)) return raw;
  return `${raw}.js`;
}

function resolveRouteFile(filePath, seen = new Set()) {
  const candidate = path.extname(filePath) ? filePath : `${filePath}.js`;
  if (seen.has(candidate)) return candidate;
  seen.add(candidate);
  if (!existsSync(candidate)) return candidate;
  const source = readFileSync(candidate, 'utf-8');
  const reExport = source.match(/export\s+\{\s*default\s*\}\s+from\s+'([^']+)'/);
  if (!reExport) return candidate;
  return resolveRouteFile(routeFilePath(reExport[1], path.dirname(candidate)), seen);
}

function joinRoutePath(base, subPath = '') {
  if (!subPath || subPath === '/') return base;
  return `${base}${subPath}`;
}

function collectImports(source, filePath) {
  const imports = new Map();
  const localImportPattern = /import\s+(\w+)\s+from\s+'([^']+)'/g;
  let match;
  while ((match = localImportPattern.exec(source)) !== null) {
    const importTarget = match[2];
    if (!importTarget.startsWith('.')) continue;
    imports.set(match[1], routeFilePath(importTarget, path.dirname(filePath)));
  }
  return imports;
}

function addCaseFactoryRoutes(source, filePath, mountPath, output) {
  const casePattern = /registerCaseRoutes\(\s*router\s*,\s*\{([\s\S]*?)\}\s*\);/g;
  let match;
  while ((match = casePattern.exec(source)) !== null) {
    const block = match[1];
    const pathMatch = block.match(/path:\s*'([^']+)'/);
    if (!pathMatch) continue;
    const routePath = joinRoutePath(mountPath, pathMatch[1]);
    const file = path.relative(rootDir, filePath);
    const middlewareStr = 'requireAuth requireHomeAccess requireModule';
    for (const method of ['GET', 'POST']) {
      output.push({ key: `${method} ${routePath}`, middlewareStr, file });
    }
    output.push({ key: `GET ${routePath}/:id`, middlewareStr, file });
    output.push({ key: `PUT ${routePath}/:id`, middlewareStr, file });
    if (block.includes('table:')) {
      output.push({ key: `DELETE ${routePath}/:id`, middlewareStr, file });
    }
  }
}

function collectRouterRoutes(filePath, mountPath, output, seen = new Set()) {
  const resolved = resolveRouteFile(filePath);
  const seenKey = `${resolved}:${mountPath}`;
  if (seen.has(seenKey) || !existsSync(resolved)) return;
  seen.add(seenKey);

  const source = readFileSync(resolved, 'utf-8');
  const imports = collectImports(source, resolved);

  const pattern = new RegExp(routerPattern.source, 'gs');
  let routeMatch;
  while ((routeMatch = pattern.exec(source)) !== null) {
    const method = routeMatch[1].toUpperCase();
    const subPath = routeMatch[2];
    const middlewareStr = routeMatch[3];
    output.push({
      key: `${method} ${joinRoutePath(mountPath, subPath)}`,
      middlewareStr,
      file: path.relative(rootDir, resolved),
    });
  }

  addCaseFactoryRoutes(source, resolved, mountPath, output);

  const routerUsePattern = /router\.use\(\s*(?:(['"])([^'"]*)\1\s*,\s*)?(\w+)\s*\)/g;
  let useMatch;
  while ((useMatch = routerUsePattern.exec(source)) !== null) {
    const subPath = useMatch[2] || '';
    const routerVar = useMatch[3];
    const importedFile = imports.get(routerVar);
    if (!importedFile) continue;
    collectRouterRoutes(importedFile, joinRoutePath(mountPath, subPath), output, seen);
  }
}

for (const [varName, filePath] of routeFiles) {
  const mountPath = mounts.get(varName);
  if (!mountPath) continue;
  collectRouterRoutes(filePath, mountPath, routerRoutes);
}

const allRoutes = [...directRoutes, ...routerRoutes];
const REQUIRED_DISCOVERED_ROUTES = [
  'GET /api/hr/stats',
  'GET /api/hr/cases/disciplinary',
  'POST /api/hr/cases/grievance/:id/actions',
  'GET /api/hr/attachments/download/:id',
  'POST /api/hr/admin/purge-expired',
];
const discoveredKeys = new Set(allRoutes.map(route => route.key));
for (const requiredRoute of REQUIRED_DISCOVERED_ROUTES) {
  if (!discoveredKeys.has(requiredRoute)) {
    allRoutes.push({
      key: requiredRoute,
      middlewareStr: '',
      file: 'scripts/audit-routes.js',
      forcedIssue: 'FAIL: route not discovered by audit script',
    });
  }
}
let pass = true;
const results = [];

for (const { key, middlewareStr, file, forcedIssue } of allRoutes) {
  const hasRequireAuth = middlewareStr.includes('requireAuth')
    || middlewareStr.includes('staffReadChain')
    || middlewareStr.includes('staffWriteChain');
  const hasAuthZ = AUTH_Z_PATTERNS.some((pattern) => middlewareStr.includes(pattern));
  const isPublic = PUBLIC_ROUTES.has(key);
  const isTokenGated = TOKEN_GATED_ROUTES.has(key);
  const isSelfService = SELF_SERVICE_ROUTES.has(key);
  const customAuthZ = CUSTOM_AUTHZ_ROUTES.get(key);

  const issues = [];

  if (forcedIssue) {
    issues.push(forcedIssue);
    pass = false;
  } else if (isPublic) {
    if (hasRequireAuth) issues.push('WARNING: public route unexpectedly has requireAuth');
  } else if (isTokenGated) {
    // Intentionally not requireAuth - protected by an ops token.
  } else {
    if (!hasRequireAuth) {
      issues.push('FAIL: missing requireAuth');
      pass = false;
    }
    if (!isSelfService && !customAuthZ && !hasAuthZ) {
      issues.push('FAIL: missing authorization middleware');
      pass = false;
    }
  }

  let status;
  if (issues.length > 0) {
    status = issues.join('; ');
  } else if (isPublic) {
    status = 'PUBLIC (intentional)';
  } else if (isTokenGated) {
    status = 'PASS (ops token)';
  } else if (isSelfService) {
    status = 'PASS (self-service)';
  } else if (customAuthZ) {
    status = `PASS (${customAuthZ})`;
  } else {
    const authZUsed = AUTH_Z_PATTERNS.filter((pattern) => middlewareStr.includes(pattern));
    status = `PASS (${authZUsed.join(' + ')})`;
  }

  results.push({ key, status, file });
}

const maxKey = Math.max(...results.map((result) => result.key.length));
const maxFile = Math.max(...results.map((result) => result.file.length));

console.log('\nRoute Auth Audit - routes/*.js\n');
for (const { key, status, file } of results) {
  const icon = status.startsWith('FAIL') ? 'x' : status.startsWith('WARNING') ? '!' : 'v';
  console.log(`  ${icon}  ${key.padEnd(maxKey + 2)}${file.padEnd(maxFile + 2)}${status}`);
}

console.log('');
if (pass) {
  console.log('All routes pass auth audit.\n');
  process.exit(0);
} else {
  console.log('Auth gaps found - fix before deployment.\n');
  process.exit(1);
}
