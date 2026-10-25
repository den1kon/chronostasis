import {spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';

function git(args, allowMissing = false) {
  const result = spawnSync('git', args, {encoding: 'utf8'});
  if (result.status === 0) return result.stdout.trim();
  if (allowMissing && result.status === 1) return null;
  throw new Error('Unable to read repository configuration.');
}

function prefixCommit(messagePath) {
  const branch = git(['symbolic-ref', '--quiet', '--short', 'HEAD'], true);
  if (branch === null || !/^(feature|bugfix|maintenance)\//u.test(branch))
    return;

  const ticket = /^(?:feature|bugfix|maintenance)\/(CHR-\d+)$/u.exec(
    branch,
  )?.[1];
  if (!ticket)
    throw new Error(
      'Ticket branches must use feature/CHR-N, bugfix/CHR-N, or maintenance/CHR-N.',
    );

  const commentSetting =
    git(['config', '--get', 'core.commentString'], true) ??
    git(['config', '--get', 'core.commentChar'], true) ??
    '#';
  const comment = commentSetting === 'auto' ? '#' : commentSetting;
  const text = readFileSync(messagePath, 'utf8');
  let offset = 0;
  for (const line of text.split(/(?<=\n)/u)) {
    const subject = line.replace(/[\r\n]+$/u, '');
    if (
      subject ===
      `${comment} ------------------------ >8 ------------------------`
    )
      return;
    if (!subject.trim() || subject.startsWith(comment)) {
      offset += line.length;
      continue;
    }

    const prefix = `[${ticket}] `;
    const content = subject.trimStart();
    if (content.startsWith('[')) {
      if (!content.startsWith(prefix))
        throw new Error(
          `The commit subject must use exactly one ${prefix.trim()} prefix matching the branch.`,
        );
      const description = content.slice(prefix.length);
      if (!description.trim() || description.trimStart().startsWith('[')) {
        throw new Error(
          'The commit subject must have one ticket prefix and a non-empty description.',
        );
      }
      return;
    }

    // Inserting at a single offset preserves comments, body, line endings,
    // and the absence of a trailing newline byte-for-byte.
    writeFileSync(
      messagePath,
      text.slice(0, offset) + prefix + text.slice(offset),
    );
    return;
  }
  // Leave empty/comment-only messages alone so Git can abort empty commits.
}

try {
  if (process.argv.length !== 3)
    throw new Error('Expected one commit message file path.');
  prefixCommit(process.argv[2]);
} catch (error) {
  const message =
    error instanceof Error && !('code' in error)
      ? error.message
      : 'Unable to read or update the commit message file.';
  console.error(`commit-msg: ${message}`);
  process.exitCode = 1;
}
