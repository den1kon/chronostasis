import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const checks = [
  ['GTS formatting', 'format:check'],
  ['lint', 'lint'],
  ['type checking', 'typecheck'],
  ['unit tests', 'test:unit'],
  ['database integration tests', 'test:integration'],
  ['Git hook tests', 'test:hooks'],
  ['Playwright E2E', 'test:e2e'],
  ['production build', 'build'],
];

console.log(`[verify:pr] Running ${checks.length} checks in order.`);

for (const [label, script] of checks) {
  const command = `corepack pnpm ${script}`;
  console.log(`\n[verify:pr] Running ${label}: ${command}`);
  const result = spawnSync('corepack', ['pnpm', script], {
    cwd: repositoryRoot,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(
      `[verify:pr] FAILED: ${label} (unable to start ${command}: ${result.error.message})`,
    );
    process.exitCode = 1;
    break;
  }

  if (result.signal) {
    console.error(
      `[verify:pr] FAILED: ${label} (${command} terminated by ${result.signal})`,
    );
    process.exitCode = 1;
    break;
  }

  if (result.status !== 0) {
    console.error(
      `[verify:pr] FAILED: ${label} (${command} exited ${result.status ?? 1})`,
    );
    process.exitCode = result.status ?? 1;
    break;
  }

  console.log(`[verify:pr] Passed: ${label}`);
}

if (process.exitCode === undefined) {
  console.log('\n[verify:pr] All PR checks passed.');
}
