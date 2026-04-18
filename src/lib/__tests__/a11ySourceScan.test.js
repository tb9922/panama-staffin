import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const srcRoot = path.join(repoRoot, 'src');
const TARGETED_LABEL_FILES = [
  'src/components/incidents/IncidentTrackerModal.jsx',
  'src/components/InvestigationMeetings.jsx',
  'src/components/training/TrainingRecordModal.jsx',
  'src/pages/AnnualLeave.jsx',
  'src/pages/StaffRegister.jsx',
  'src/staff/pages/MyProfile.jsx',
];

function collectSourceFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      if (entry === '__tests__') continue;
      files.push(...collectSourceFiles(fullPath));
      continue;
    }
    if (fullPath.endsWith('.js') || fullPath.endsWith('.jsx')) {
      files.push(fullPath);
    }
  }
  return files;
}

function toRepoRelative(filePath) {
  return path.relative(repoRoot, filePath).replaceAll('\\', '/');
}

function findSvgOnlyButtonViolations(filePath, content) {
  const violations = [];
  const buttonPattern = /<button\b([^>]*)>([\s\S]*?)<\/button>/g;
  for (const match of content.matchAll(buttonPattern)) {
    const [, attributes, body] = match;
    if (/\baria-label=|\baria-labelledby=/.test(attributes)) continue;

    const strippedBody = body
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\s+/g, '');
    if (!/^<svg[\s\S]*<\/svg>$/.test(strippedBody)) continue;

    const line = content.slice(0, match.index).split('\n').length;
    violations.push(`${toRepoRelative(filePath)}:${line}`);
  }
  return violations;
}

describe('a11y source scan', () => {
  it('does not allow raw clickable table rows in src', () => {
    const offenders = [];
    for (const filePath of collectSourceFiles(srcRoot)) {
      const content = readFileSync(filePath, 'utf8');
      if (/<tr\b[^>]*\bonClick=/.test(content)) {
        offenders.push(toRepoRelative(filePath));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the highest-traffic forms on explicit htmlFor labels', () => {
    const offenders = [];
    for (const relPath of TARGETED_LABEL_FILES) {
      const content = readFileSync(path.join(repoRoot, relPath), 'utf8');
      const matches = content.match(/<label className=\{INPUT\.label\}>/g);
      if (matches?.length) {
        offenders.push(`${relPath} (${matches.length})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('does not allow svg-only buttons without an accessible name', () => {
    const offenders = [];
    for (const filePath of collectSourceFiles(srcRoot)) {
      const content = readFileSync(filePath, 'utf8');
      offenders.push(...findSvgOnlyButtonViolations(filePath, content));
    }
    expect(offenders).toEqual([]);
  });
});
