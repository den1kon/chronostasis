import {describe, expect, it} from 'vitest';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runDeployment} from './deploy-build.mjs';

const integrationRuntime =
  'postgresql://app:secret@ep-integration-pooler.us-east-2.aws.neon.tech/chronostasis?sslmode=require';
const integrationDirect =
  'postgresql://app:secret@ep-integration.us-east-2.aws.neon.tech/chronostasis?sslmode=require';

function env(branch = 'feature/new-thing'): Record<string, string | undefined> {
  return {
    VERCEL: '1',
    VERCEL_ENV: 'preview',
    VERCEL_GIT_COMMIT_REF: branch,
    NEON_POSTGRES_URL: integrationRuntime,
    NEON_POSTGRES_URL_NON_POOLING: integrationDirect,
    DEPLOYMENT_INTEGRATION_DB_HOST: 'ep-integration.us-east-2.aws.neon.tech',
    DEPLOYMENT_PRODUCTION_DB_HOST: 'ep-production.us-east-2.aws.neon.tech',
  };
}

describe('runDeployment', () => {
  it.each(['.', 'apps/web'])(
    'runs from %s without network or hosted database calls',
    cwd => {
      const temporaryDirectory = mkdtempSync(join(tmpdir(), 'chr-12-deploy-'));
      const logPath = join(temporaryDirectory, 'commands.jsonl');
      const executablePath = join(temporaryDirectory, 'corepack');
      writeFileSync(
        executablePath,
        '#!/usr/bin/env node\n' +
          "const fs = require('node:fs');\n" +
          "fs.appendFileSync(process.env['FAKE_COMMAND_LOG'], JSON.stringify(process.argv.slice(2)) + '\\n');\n",
      );
      chmodSync(executablePath, 0o755);
      const root = fileURLToPath(new URL('../', import.meta.url));
      const result = spawnSync(
        process.execPath,
        [join(root, 'scripts/deploy-build.mjs')],
        {
          cwd: resolve(root, cwd),
          encoding: 'utf8',
          env: {
            ...env(),
            PATH: `${temporaryDirectory}:${process.env['PATH'] ?? ''}`,
            FAKE_COMMAND_LOG: logPath,
          },
        },
      );
      const calls = readFileSync(logPath, 'utf8')
        .trim()
        .split('\n')
        .map(line => JSON.parse(line) as string[]);
      rmSync(temporaryDirectory, {recursive: true, force: true});
      expect(result.status).toBe(0);
      expect(calls).toEqual([
        ['pnpm', '--filter', '@chronostasis/web', 'typecheck'],
        ['pnpm', 'build'],
      ]);
    },
  );

  it('typechecks and builds an ordinary Preview without preparing the DB', () => {
    const calls: Array<{
      args: string[];
      options: {cwd: string; env: Record<string, string | undefined>};
    }> = [];
    const status = runDeployment({
      env: env(),
      run: (_executable, args, options) => {
        calls.push({args, options});
        return {status: 0};
      },
    });
    expect(status).toBe(0);
    expect(calls.map(call => call.args)).toEqual([
      ['pnpm', '--filter', '@chronostasis/web', 'typecheck'],
      ['pnpm', 'build'],
    ]);
    expect(calls[0]?.options.cwd).toBe(calls[1]?.options.cwd);
    expect(calls[0]?.options.env['NEON_POSTGRES_URL']).toBe(integrationRuntime);
    expect(calls[0]?.options.env['NEON_POSTGRES_URL_NON_POOLING']).toBe(
      integrationDirect,
    );
  });

  it.each(['integration', 'main'])(
    'prepares the expected target for %s',
    branch => {
      const envValues = env(branch);
      if (branch === 'main') {
        envValues['VERCEL_ENV'] = 'production';
        envValues['NEON_POSTGRES_URL'] =
          'postgresql://app:secret@ep-production-pooler.us-east-2.aws.neon.tech/chronostasis?sslmode=require';
        envValues['NEON_POSTGRES_URL_NON_POOLING'] =
          'postgresql://app:secret@ep-production.us-east-2.aws.neon.tech/chronostasis?sslmode=require';
      }
      const calls: Array<{
        args: string[];
        options: {env: Record<string, string | undefined>};
      }> = [];
      const status = runDeployment({
        env: envValues,
        run: (_executable, args, options) => {
          calls.push({args, options});
          return {status: 0};
        },
      });
      expect(status).toBe(0);
      expect(calls).toHaveLength(3);
      expect(calls[2]?.args).toEqual(['pnpm', 'db:prepare']);
      expect(calls[2]?.options.env['DATABASE_URL']).toBe(
        envValues['NEON_POSTGRES_URL'],
      );
      expect(calls[2]?.options.env['MIGRATION_DATABASE_URL']).toBe(
        envValues['NEON_POSTGRES_URL_NON_POOLING'],
      );
    },
  );

  it('does not launch processes for invalid configuration', () => {
    let calls = 0;
    const status = runDeployment({
      env: {...env(), DATABASE_URL: 'postgres://bad'},
      run: () => {
        calls += 1;
        return {status: 0};
      },
    });
    expect(status).not.toBe(0);
    expect(calls).toBe(0);
  });

  it.each([
    {failedStage: 0, expectedCalls: 1},
    {failedStage: 1, expectedCalls: 2},
    {failedStage: 2, expectedCalls: 3},
  ])(
    'stops after a failed child stage ($failedStage)',
    ({failedStage, expectedCalls}) => {
      let calls = 0;
      const status = runDeployment({
        env: env('integration'),
        run: () => {
          const current = calls++;
          return {status: current === failedStage ? 1 : 0};
        },
      });
      expect(status).not.toBe(0);
      expect(calls).toBe(expectedCalls);
    },
  );

  it('fails on child start errors and signals', () => {
    expect(
      runDeployment({
        env: env(),
        run: () => ({status: null, error: new Error('failure')}),
      }),
    ).not.toBe(0);
    expect(
      runDeployment({
        env: env(),
        run: () => ({status: null, signal: 'SIGTERM'}),
      }),
    ).not.toBe(0);
  });
});
