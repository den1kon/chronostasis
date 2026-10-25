import {spawnSync} from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, describe, expect, it} from 'vitest';

const runnerPath = fileURLToPath(new URL('./verify-all.mjs', import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, {recursive: true, force: true});
  }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'chronostasis verify-all '));
  temporaryDirectories.push(root);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const logPath = join(root, 'commands.log');
  const corepackPath = join(bin, 'corepack');
  writeFileSync(
    corepackPath,
    '#!/bin/sh\n[ "$1" = "pnpm" ] || exit 18\nshift\nprintf "%s\\n" "$*" >> "$VERIFY_LOG"\nif [ "${VERIFY_FAIL-}" = "$1" ]; then exit 17; fi\n',
  );
  chmodSync(corepackPath, 0o755);
  return {root, bin, logPath};
}

describe('full verification runner', () => {
  it('runs every required check serially and reports success only at the end', () => {
    const {bin, logPath} = fixture();
    const result = spawnSync(process.execPath, [runnerPath], {
      encoding: 'utf8',
      env: {PATH: bin, VERIFY_LOG: logPath},
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('[verify:all] All checks passed.');
    expect(readFileSync(logPath, 'utf8').trim().split('\n')).toEqual([
      'format:check',
      'lint',
      'typecheck',
      'test:unit',
      'test:integration',
      'test:hooks',
      'test:e2e',
      'build',
    ]);
  });

  it('names the first failed check and skips later checks', () => {
    const {bin, logPath} = fixture();
    const result = spawnSync(process.execPath, [runnerPath], {
      encoding: 'utf8',
      env: {PATH: bin, VERIFY_LOG: logPath, VERIFY_FAIL: 'test:integration'},
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      '[verify:all] FAILED: database integration tests (corepack pnpm test:integration exited 17)',
    );
    expect(result.stdout).not.toContain('[verify:all] All checks passed.');
    expect(readFileSync(logPath, 'utf8').trim().split('\n')).toEqual([
      'format:check',
      'lint',
      'typecheck',
      'test:unit',
      'test:integration',
    ]);
  });

  it('names a process-spawn failure', () => {
    const {logPath} = fixture();
    const result = spawnSync(process.execPath, [runnerPath], {
      encoding: 'utf8',
      env: {PATH: '', VERIFY_LOG: logPath},
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      '[verify:all] FAILED: GTS formatting (unable to start corepack pnpm format:check:',
    );
  });
});
