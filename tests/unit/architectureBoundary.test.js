// Architectural boundary tests — enforce the "backend MUST NOT import from src/" rule
// from P0-X1 in .review/full-main-review/_CODEX_MASTER_ACTION_PLAN.md.
//
// The ESLint `no-restricted-imports` rule blocks this at lint time. These tests
// catch the same class of violation at test time so a CI run flags it even if
// someone runs tests without lint, and they also lock down the
// transitive-import safety guarantee for the one legacy exception.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function listJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
      out.push(...listJsFiles(full));
    } else if (entry.isFile() && (full.endsWith('.js') || full.endsWith('.mjs'))) {
      out.push(full);
    }
  }
  return out;
}

const SRC_IMPORT_RE = /from\s+['"](\.{1,2}\/)+src\//g;

const ALLOWED_LEGACY_OFFENDERS = new Set([
  // P0-X1 documented exception — assessmentService imports the server-authoritative
  // scoring engines from src/lib/. Those files and their transitive imports are
  // verified browser-API-free (see test below). Removing this exception requires
  // moving ~16 files from src/lib/ to shared/.
  path.join('services', 'assessmentService.js'),
]);

describe('Architectural boundary: backend → src/ imports', () => {
  it('no NEW backend file imports from src/ (only the documented legacy exception is allowed)', () => {
    const backendDirs = ['services', 'routes', 'repositories', 'middleware', 'lib', 'shared', 'scripts'];
    const offenders = [];
    for (const dir of backendDirs) {
      const abs = path.join(REPO_ROOT, dir);
      if (!fs.existsSync(abs)) continue;
      for (const file of listJsFiles(abs)) {
        const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/').replace(/\//g, path.sep);
        const content = fs.readFileSync(file, 'utf8');
        if (SRC_IMPORT_RE.test(content)) {
          if (!ALLOWED_LEGACY_OFFENDERS.has(rel)) {
            offenders.push(rel);
          }
        }
        SRC_IMPORT_RE.lastIndex = 0;
      }
    }
    if (offenders.length > 0) {
      throw new Error(
        `Backend files importing from src/ (forbidden by P0-X1):\n` +
        offenders.map(f => `  - ${f}`).join('\n') +
        `\n\nMove the helper to shared/ or remove the dependency. ` +
        `If genuinely unavoidable, add to ALLOWED_LEGACY_OFFENDERS with a CODEX_MASTER_ACTION_PLAN reference.`
      );
    }
    expect(offenders).toEqual([]);
  });

  it('the documented exception (assessmentService) and its transitive src/ imports are browser-API-free', () => {
    // Functions/objects that are browser-only and would crash on the server.
    // We grep the legacy files (and their src/lib transitive imports) for these.
    const BROWSER_API_PATTERNS = [
      /\bwindow\./, /\bdocument\./, /\blocalStorage\b/, /\bsessionStorage\b/,
      /\bnavigator\./, /\balert\(/, /\bconfirm\(/, /\bprompt\(/,
    ];

    const TRANSITIVE_FILES = [
      // Direct imports of assessmentService
      'src/lib/cqc.js', 'src/lib/cqcReadiness.js', 'src/lib/gdpr.js',
      // Transitive (imported by the above)
      'src/lib/escalation.js', 'src/lib/training.js', 'src/lib/onboarding.js',
      'src/lib/incidents.js', 'src/lib/complaints.js', 'src/lib/maintenance.js',
      'src/lib/ipc.js', 'src/lib/riskRegister.js', 'src/lib/policyReview.js',
      'src/lib/whistleblowing.js', 'src/lib/dols.js', 'src/lib/careCertificate.js',
      'src/lib/cqcEvidenceCategories.js', 'src/lib/cqcStatementExpectations.js',
      'src/lib/localDates.js', 'src/lib/rotation.js',
    ];

    const violations = [];
    for (const rel of TRANSITIVE_FILES) {
      const abs = path.join(REPO_ROOT, rel);
      if (!fs.existsSync(abs)) continue;
      const content = fs.readFileSync(abs, 'utf8');
      // Strip comments to avoid false positives in commentary
      const stripped = content
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const pattern of BROWSER_API_PATTERNS) {
        if (pattern.test(stripped)) {
          violations.push(`${rel} contains ${pattern.source}`);
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Browser-API usage found in files imported by services/assessmentService.js:\n` +
        violations.map(v => `  - ${v}`).join('\n') +
        `\nThis breaks the safety invariant for the P0-X1 documented exception. ` +
        `Either remove the browser API or refactor to move the function to shared/.`
      );
    }
    expect(violations).toEqual([]);
  });
});
