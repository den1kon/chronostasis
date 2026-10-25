import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const checkerPath = fileURLToPath(new URL('./check-e2e-env.mjs', import.meta.url));

describe('authenticated E2E environment preflight', () => {
  it('fails with missing setting names and never prints secret values', () => {
    const secretSentinel = 'do-not-print-this-secret-value';
    const result = spawnSync(process.execPath, [checkerPath], {
      encoding: 'utf8',
      env: { PATH: process.env['PATH'], CLERK_SECRET_KEY: secretSentinel },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('VITE_CLERK_PUBLISHABLE_KEY');
    expect(result.stderr).toContain('E2E_CLERK_USER_EMAIL');
    expect(result.stderr).not.toContain(secretSentinel);
    expect(result.stdout).not.toContain(secretSentinel);
  });

  it('allows the signed-out project without a test-account email', () => {
    const result = spawnSync(process.execPath, [checkerPath, '--signed-out'], {
      encoding: 'utf8',
      env: {
        PATH: process.env['PATH'],
        VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_safe-placeholder',
        CLERK_SECRET_KEY: 'sk_test_safe-placeholder',
        CLERK_ISSUER: 'https://example.clerk.accounts.dev',
        CLERK_AUTHORIZED_PARTIES: 'http://localhost:5173',
      },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });
});
