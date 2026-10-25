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
  for (const hook of ['pre-commit', 'commit-msg']) {
    accessSync(join(root, '.githooks', hook), constants.X_OK);
  }
  accessSync(join(root, '.pre-commit-config.yaml'), constants.R_OK);
  accessSync(join(root, 'scripts', 'prefix-commit.mjs'), constants.R_OK);

  const localPreCommit = join(root, '.venv', 'bin', 'pre-commit');
  const preCommitAvailable = [localPreCommit, 'pre-commit'].some(command => {
    const result = spawnSync(command, ['--version'], {
      cwd: root,
      encoding: 'utf8',
    });
    return result.status === 0;
  });
  if (!preCommitAvailable) {
    throw new Error(
      'pre-commit is required. Create .venv and install requirements-dev.txt before enabling hooks.',
    );
  }

  git(['config', '--local', 'core.hooksPath', '.githooks']);
  console.log(
    'Git hooks enabled for this repository: pre-commit and commit-msg.',
  );
} catch (error) {
  const message =
    error instanceof Error && !('code' in error)
      ? error.message
      : 'The hook must exist and be executable, and its Node script must be readable.';
  console.error(`hooks:install: ${message}`);
  process.exitCode = 1;
}
