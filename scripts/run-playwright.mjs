import {spawnSync} from 'node:child_process';

const mode = process.env['E2E_RUN_MODE'] ?? 'authenticated';
const args = ['exec', 'playwright', 'test'];
if (mode === 'signed-out') args.push('--project=signed-out');

const result = spawnSync('pnpm', args, {stdio: 'inherit'});
if (result.error) {
  console.error('Unable to start the Playwright runner.');
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
