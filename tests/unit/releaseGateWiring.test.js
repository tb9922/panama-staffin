import fs from 'fs';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const workflow = fs.readFileSync('.github/workflows/test.yml', 'utf8');
const baselineScript = fs.readFileSync('scripts/verify-baseline.sh', 'utf8');

describe('release gate wiring', () => {
  it('keeps the release script wired to required V1 gates', () => {
    const releaseScript = packageJson.scripts['test:release'];

    expect(releaseScript).toContain('npm run test:ci');
    expect(releaseScript).toContain('npm run test:integration');
    expect(releaseScript).toContain('npm run audit:routes');
    expect(releaseScript).toContain('npm run verify:action-backfill');
    expect(releaseScript).toContain('npm run verify:v1-operational');
    expect(releaseScript).toContain('npm run test:v1-scale');
    expect(releaseScript).toContain('npm run test:ui-stress');
    expect(releaseScript).toContain('npm audit --omit=dev');
  });

  it('keeps CI wired to operational, scale, and stress gates', () => {
    expect(workflow).toContain('Run integration tests');
    expect(workflow).toContain('Run V1 action backfill gate');
    expect(workflow).toContain('Run V1 operational gate');
    expect(workflow).toContain('Run V1 scale/load gate');
    expect(workflow).toContain('Run UI stress tests');
  });

  it('requires deploy and baseline checks to assert the expected VPS HEAD', () => {
    expect(workflow).toContain('EXPECTED_COMMIT="${{ github.sha }}"');
    expect(workflow).toContain('does not match expected GitHub SHA');
    expect(baselineScript).toContain('ERROR: VPS alignment not checked');
    expect(baselineScript).toContain('BASELINE_ALLOW_VPS_SKIP=1');
  });
});
