import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hook = join(sourceRoot, '.githooks', 'commit-msg');
const installer = join(sourceRoot, 'scripts', 'install-hooks.mjs');

// Real temporary Git repositories catch wrong branch parsing, accidental message
// rewrites, and destructive hook installation without touching the working repo.
function fixture(t, branch = 'feature/CHR-1234') {
  const root = mkdtempSync(join(tmpdir(), 'chronostasis hooks '));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
  };
  for (const key of Object.keys(env)) {
    if (
      key.startsWith('GIT_') &&
      !['GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL'].includes(key)
    )
      delete env[key];
  }
  const run = (command, args) =>
    spawnSync(command, args, {cwd: root, env, encoding: 'utf8'});
  const git = (...args) => {
    const result = run('git', args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '--quiet', `--initial-branch=${branch}`);
  const messagePath = join(root, 'commit message.txt');
  return {
    root,
    git,
    run,
    apply(message) {
      writeFileSync(messagePath, message);
      const result = run('sh', [hook, messagePath]);
      return {...result, message: readFileSync(messagePath, 'utf8')};
    },
    install() {
      return run(process.execPath, [installer]);
    },
    copyHookFiles() {
      for (const relative of [
        '.githooks/commit-msg',
        'scripts/prefix-commit.mjs',
      ]) {
        const target = join(root, relative);
        mkdirSync(dirname(target), {recursive: true});
        copyFileSync(join(sourceRoot, relative), target);
      }
      chmodSync(join(root, '.githooks/commit-msg'), 0o755);
    },
  };
}

for (const branch of [
  'feature/CHR-1234',
  'bugfix/CHR-2',
  'maintenance/CHR-5',
]) {
  test(`prefixes the ticket on ${branch}`, t => {
    const repo = fixture(t, branch);
    const result = repo.apply('feat: add timer\n');
    const expected = {
      'feature/CHR-1234': '[CHR-1234] feat: add timer\n',
      'bugfix/CHR-2': '[CHR-2] feat: add timer\n',
      'maintenance/CHR-5': '[CHR-5] feat: add timer\n',
    };
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.message, expected[branch]);
  });
}

test('does not duplicate the matching prefix when invoked twice', t => {
  const repo = fixture(t);
  const first = repo.apply('fix: normalize tokens\n');
  const second = repo.apply(first.message);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.message, '[CHR-1234] fix: normalize tokens\n');
});

for (const message of [
  '[CHR-99] fix: normalize tokens\n',
  '[FFMTHV-6299] fix: normalize tokens\n',
  '[CHR-1234] [CHR-1234] fix: normalize tokens\n',
  '[CHR-1234] [CHR-99] fix: normalize tokens\n',
  '[CHR-1234]fix: normalize tokens\n',
  '[CHR-1234] \n',
]) {
  test(`rejects invalid prefix without modifying message: ${message.trim()}`, t => {
    const result = fixture(t).apply(message);
    assert.notEqual(result.status, 0);
    assert.equal(result.message, message);
  });
}

for (const branch of [
  'feature/CHR-nope',
  'bugfix/ABC-2',
  'maintenance/CHR-3/extra',
  'feature/CHR-',
  'feature/CHR-5-extra',
]) {
  test(`rejects malformed ticket branch ${branch}`, t => {
    const result = fixture(t, branch).apply('chore: update tooling\n');
    assert.notEqual(result.status, 0);
    assert.equal(result.message, 'chore: update tooling\n');
  });
}

for (const branch of ['main', 'release/CHR-2', 'feature-other/CHR-3']) {
  test(`leaves unrelated branch ${branch} unchanged`, t => {
    const result = fixture(t, branch).apply('[CHR-99] chore: update tooling\n');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.message, '[CHR-99] chore: update tooling\n');
  });
}

test('leaves detached HEAD unchanged', t => {
  const repo = fixture(t);
  repo.git(
    '-c',
    'user.name=Hook Test',
    '-c',
    'user.email=hooks@example.invalid',
    'commit',
    '--allow-empty',
    '--no-verify',
    '-m',
    'fixture',
  );
  repo.git('checkout', '--quiet', '--detach');
  const result = repo.apply('fix: normalize tokens\n');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.message, 'fix: normalize tokens\n');
});

for (const [message, expected] of [
  [
    'feat: add timer\n\nUser-authored body\n# comment\n',
    '[CHR-1234] feat: add timer\n\nUser-authored body\n# comment\n',
  ],
  [
    '# template\n\nfeat: add timer\n\nBody without newline',
    '# template\n\n[CHR-1234] feat: add timer\n\nBody without newline',
  ],
  ['feat: add timer', '[CHR-1234] feat: add timer'],
  [
    'feat: add timer\r\n\r\nBody\r\n',
    '[CHR-1234] feat: add timer\r\n\r\nBody\r\n',
  ],
  [
    'fix: handle [CHR-7] references\n',
    '[CHR-1234] fix: handle [CHR-7] references\n',
  ],
  ['', ''],
  [' \n\t\n', ' \n\t\n'],
  ['# comment-only template\n\n', '# comment-only template\n\n'],
  [
    '# ------------------------ >8 ------------------------\nfeat: discarded text\n',
    '# ------------------------ >8 ------------------------\nfeat: discarded text\n',
  ],
]) {
  test(`preserves message content outside the subject: ${JSON.stringify(message)}`, t => {
    const result = fixture(t).apply(message);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.message, expected);
  });
}

test('respects a configured comment character', t => {
  const repo = fixture(t);
  repo.git('config', 'core.commentChar', ';');
  const result = repo.apply('; template\nfeat: add timer\n');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.message, '; template\n[CHR-1234] feat: add timer\n');
});

test('fails safely for a missing message file', t => {
  const repo = fixture(t);
  const result = repo.run('sh', [hook, join(repo.root, 'absent message')]);
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(join(repo.root, 'absent message')), false);
});

test('installs and reinstalls repository-local hook configuration', t => {
  const repo = fixture(t);
  repo.copyHookFiles();
  const first = repo.install();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(
    repo.git('config', '--local', '--get', 'core.hooksPath'),
    '.githooks',
  );
  const second = repo.install();
  assert.equal(second.status, 0, second.stderr);
  assert.equal(
    repo.git('config', '--local', '--get', 'core.hooksPath'),
    '.githooks',
  );
});

test('refuses to overwrite an existing custom hook path', t => {
  const repo = fixture(t);
  repo.copyHookFiles();
  repo.git('config', '--local', 'core.hooksPath', 'custom hooks');
  const result = repo.install();
  assert.notEqual(result.status, 0);
  assert.equal(
    repo.git('config', '--local', '--get', 'core.hooksPath'),
    'custom hooks',
  );
});

test('refuses installation when the hook is not executable', t => {
  const repo = fixture(t);
  repo.copyHookFiles();
  chmodSync(join(repo.root, '.githooks/commit-msg'), 0o644);
  const result = repo.install();
  assert.notEqual(result.status, 0);
  assert.equal(
    repo.run('git', ['config', '--local', '--get', 'core.hooksPath']).status,
    1,
  );
});

for (const message of [
  '  [CHR-99] fix: normalize tokens\n',
  '\t[CHR-1234] [CHR-1234] fix: normalize tokens\n',
]) {
  test(`rejects invalid prefixes after leading whitespace: ${JSON.stringify(message)}`, t => {
    const result = fixture(t).apply(message);
    assert.notEqual(result.status, 0);
    assert.equal(result.message, message);
  });
}

test('does not duplicate a matching prefix after leading whitespace', t => {
  const result = fixture(t).apply('  [CHR-1234] fix: normalize tokens\n');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.message, '  [CHR-1234] fix: normalize tokens\n');
});

test('Git invokes the installed hook and records one ticket prefix', t => {
  const repo = fixture(t, 'maintenance/CHR-5');
  repo.copyHookFiles();
  const installed = repo.install();
  assert.equal(installed.status, 0, installed.stderr);
  repo.git(
    '-c',
    'user.name=Hook Test',
    '-c',
    'user.email=hooks@example.invalid',
    'commit',
    '--allow-empty',
    '-m',
    'chore: define ticket workflow',
  );
  assert.equal(
    repo.git('log', '-1', '--format=%s'),
    '[CHR-5] chore: define ticket workflow',
  );
  assert.equal(repo.git('log', '-1', '--format=%b'), '');
});
