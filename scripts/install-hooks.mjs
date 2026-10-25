import {spawnSync} from 'node:child_process';
import {accessSync, constants} from 'node:fs';
import {join} from 'node:path';

function git(args, allowMissing = false) {
  const result = spawnSync('git', args, {encoding: 'utf8'});
  if (result.status === 0) return result.stdout.trim();
  if (allowMissing && result.status === 1) return null;
  throw new Error('Unable to read or update repository Git configuration.');
}

try {
  const root = git(['rev-parse', '--show-toplevel']);
  const existing = git(['config', '--get', 'core.hooksPath'], true);
  if (existing !== null && existing !== '.githooks') {
    throw new Error(
      'A custom core.hooksPath is already configured. Review it before replacing it.',
    );
  }
  accessSync(join(root, '.githooks', 'commit-msg'), constants.X_OK);
  accessSync(join(root, 'scripts', 'prefix-commit.mjs'), constants.R_OK);
  git(['config', '--local', 'core.hooksPath', '.githooks']);
  console.log('Git hooks enabled for this repository: .githooks');
} catch (error) {
  const message =
    error instanceof Error && !('code' in error)
      ? error.message
      : 'The hook must exist and be executable, and its Node script must be readable.';
  console.error(`hooks:install: ${message}`);
  process.exitCode = 1;
}
