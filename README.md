# Chronostasis

A mobile-first focus application where completed sessions will unlock chests containing one collectible item.

## Bootstrap status

CHR-5 is in progress on `maintenance/CHR-5`. The ticket workflow and commit hook are implemented. The application workspace, Docker Compose services, authentication, database, and browser tests are planned and not yet available. Deployment is a separate ticket.

- [Design specification](docs/superpowers/specs/2026-10-23-chr-5-bootstrap-design.md)
- [Implementation plan](docs/superpowers/plans/2026-10-23-chr-5-bootstrap.md)
- [Repository instructions](AGENTS.md)

## Commit hook

Prerequisites: Git, a POSIX shell, and Node.js 24. The hook uses Node built-ins and requires no package installation.

Enable the versioned hook explicitly after cloning, from the repository root:

```sh
node scripts/install-hooks.mjs
```

The installer sets repository-local `core.hooksPath` to `.githooks`. Re-running it is safe. It refuses to replace another configured hook path or activate an absent/non-executable hook. Installation changes only local Git configuration; it does not stage or commit files. No package lifecycle script installs hooks automatically.

Use a separate branch for each ticket:

- `feature/CHR-1234`
- `bugfix/CHR-1234`
- `maintenance/CHR-1234`

Supply the Conventional Commit subject without the ticket prefix, for example `feat: add timer`. Git's `commit-msg` hook derives the ticket from the branch and records `[CHR-1234] feat: add timer`.

The hook preserves a matching existing prefix and rejects conflicting or duplicate leading ticket prefixes, including after indentation. Malformed ticket names under the three reserved branch categories are rejected. Unrelated branches and detached HEAD are left unchanged. Empty/comment-only messages remain empty so Git can abort the commit; user-authored bodies, comments, and line endings are preserved. The hook reads the configured comment character/string and recognizes the scissors marker; automatic comment-character selection falls back to `#`.

The hook does not enforce Conventional Commit syntax or subject length. Follow `AGENTS.md`: the subject excluding the ticket prefix must be at most 50 characters, and agent-created commits must have no body. Staging and committing require explicit confirmation that the user has completed the unstaged review.

## Current verification commands

Run the complete hook test suite:

```sh
node scripts/test-hooks.mjs
```

The suite uses disposable temporary repositories, including a real commit to verify that Git invokes the installed hook. It never creates test commits in Chronostasis.

Check syntax without running the scripts:

```sh
sh -n .githooks/commit-msg
node --check scripts/prefix-commit.mjs
node --check scripts/install-hooks.mjs
node --check scripts/test-hooks.mjs
```

The implementation plan adds pnpm aliases in Task 2. Application linting, type checks, unit tests, integration tests, and Playwright smoke tests will be documented as those tools are established. `ARCHITECTURE.md` will describe the verified application architecture after implementation.
