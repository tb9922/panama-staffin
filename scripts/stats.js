import { readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const ROOT = process.cwd();
const IGNORE_DIRS = new Set([
  '.git',
  '.claude',
  '.github',
  '.playwright',
  '.vite',
  'backups',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
  'uploads',
]);

function walk(dir, predicate, results = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    if (entry.isDirectory() && entry.name === '__tests__') {
      walk(join(dir, entry.name), predicate, results);
      continue;
    }
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, predicate, results);
      continue;
    }
    if (predicate(fullPath)) {
      results.push(relative(ROOT, fullPath).replace(/\\/g, '/'));
    }
  }
  return results;
}

function inDir(prefix) {
  const normalized = `${prefix.replace(/\\/g, '/')}/`;
  return (filePath) => relative(ROOT, filePath).replace(/\\/g, '/').startsWith(normalized);
}

function hasExtension(...extensions) {
  const set = new Set(extensions);
  return (filePath) => set.has(extname(filePath));
}

function all(...predicates) {
  return (filePath) => predicates.every((predicate) => predicate(filePath));
}

const isRouteFile = all(inDir('routes'), hasExtension('.js'));
const isRepoFile = all(inDir('repositories'), hasExtension('.js'));
const isServiceFile = all(inDir('services'), hasExtension('.js'));
const isMigrationFile = all(inDir('migrations'), hasExtension('.sql'));
const isTestFile = (filePath) => {
  const rel = relative(ROOT, filePath).replace(/\\/g, '/');
  return rel.includes('/__tests__/') || /\.(test|spec)\.(js|jsx)$/.test(rel) || rel.endsWith('/auth.setup.js');
};

const stats = {
  routes: walk(ROOT, isRouteFile).length,
  repositories: walk(ROOT, isRepoFile).length,
  services: walk(ROOT, isServiceFile).length,
  migrations: walk(ROOT, isMigrationFile).length,
  pages: walk(ROOT, (filePath) => {
    const rel = relative(ROOT, filePath).replace(/\\/g, '/');
    return rel.startsWith('src/pages/') && !rel.includes('/__tests__/') && extname(filePath) === '.jsx';
  }).length,
  tests: walk(ROOT, isTestFile).length,
};

console.log(JSON.stringify(stats, null, 2));
