import {spawnSync} from 'node:child_process';
import {delimiter, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const localBin = join(repositoryRoot, 'node_modules', '.bin');
const gtsPath = join(
  repositoryRoot,
  'node_modules',
  'gts',
  'build',
  'src',
  'cli.js',
);
const result = spawnSync(
  process.execPath,
  [gtsPath, 'lint', ...process.argv.slice(2)],
  {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      PATH: `${localBin}${delimiter}${process.env['PATH'] ?? ''}`,
    },
    stdio: 'inherit',
  },
);

if (result.error) {
  console.error(`[gts] Unable to start GTS: ${result.error.message}`);
  process.exitCode = 1;
} else if (result.signal) {
  console.error(`[gts] GTS terminated by ${result.signal}`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
