import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const signedOutOnly =
  process.argv[2] === '--signed-out' && process.argv.length === 3;
if (process.argv.length > 2 && !signedOutOnly) {
  console.error('Usage: pnpm test:e2e [--signed-out]');
  process.exitCode = 2;
} else {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const preflight = spawnSync(
    process.execPath,
    ['scripts/check-e2e-env.mjs', ...(signedOutOnly ? ['--signed-out'] : [])],
    {stdio: 'inherit', env: process.env},
  );

  if (preflight.error || preflight.status !== 0) {
    process.exitCode = preflight.status ?? 1;
  } else {
    const projectName = `chronostasis-e2e-${process.pid}`;
    const composeArgs = [
      'compose',
      '--project-name',
      projectName,
      '--file',
      'compose.yaml',
      '--file',
      'compose.e2e.yaml',
      '--profile',
      'e2e',
    ];
    const composeEnvironment = {
      ...process.env,
      E2E_RUN_MODE: signedOutOnly ? 'signed-out' : 'authenticated',
      WEB_PORT: '0',
    };
    let testStatus = 1;

    try {
      const run = spawnSync(
        'docker',
        [...composeArgs, 'up', '--build', '--exit-code-from', 'e2e', 'e2e'],
        {stdio: 'inherit', env: composeEnvironment},
      );
      testStatus = run.status ?? 1;
      if (run.error)
        console.error('Unable to start the isolated E2E Compose project.');
    } finally {
      const cleanup = spawnSync(
        'docker',
        [...composeArgs, 'down', '--volumes', '--remove-orphans'],
        {
          stdio: 'inherit',
          env: composeEnvironment,
        },
      );
      if (cleanup.error || cleanup.status !== 0) {
        console.error(
          'Could not fully remove the isolated E2E Compose project.',
        );
        if (testStatus === 0) testStatus = 1;
      }
    }

    process.exitCode = testStatus;
  }
}
