import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

function importConfigWithEnv(overrides) {
  return spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', "import('./config.js').then(() => console.log('loaded'))"],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        JWT_SECRET: 'x'.repeat(32),
        DB_PASSWORD: 'test-password',
        ALLOWED_ORIGIN: 'https://app.example.test',
        ...overrides,
      },
    },
  );
}

describe('config production secret gates', () => {
  it('refuses production startup without ENCRYPTION_KEY', () => {
    const result = importConfigWithEnv({
      NODE_ENV: 'production',
      ENCRYPTION_KEY: '',
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain('ENCRYPTION_KEY');
  });

  it('allows non-production startup without ENCRYPTION_KEY', () => {
    const result = importConfigWithEnv({
      NODE_ENV: 'test',
      ENCRYPTION_KEY: '',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('loaded');
  });
});
