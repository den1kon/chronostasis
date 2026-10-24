## Git workflow

- Use a separate branch for each ticket:
  - `feature/CHR-<number>` for features.
  - `bugfix/CHR-<number>` for bug fixes.
  - `maintenance/CHR-<number>` for maintenance.
- Before implementation, obtain the ticket ID if it has not been provided.
  Do not invent a ticket ID or implement ticket work on `main`.
- Use Conventional Commit subjects with a lowercase type and a lowercase
  imperative description, for example `feat: add timer`.
- Let the Git hook prepend the ticket ID derived from the branch name.
  The final subject must contain exactly one matching ticket prefix,
  followed by a space, for example `[CHR-1234] feat: add timer`.
- Keep the subject, not including the ticket prefix, within 50 characters.
- Keep implementation changes unstaged until the user reviews the unstaged
  diff and explicitly confirms that review is complete.
- Do not commit or amend implementation code before that review.
- Stage implementation changes only after the user confirms the unstaged review.
- Before committing, verify that the staged changes contain only the
  intended work.
- Use only a commit subject; do not add a commit-message body.
- Do not create or open a pull request unless the user explicitly
  requests it.

**Examples:**

- Branch `feature/CHR-1`: `[CHR-1] feat: add timer`
- Branch `bugfix/CHR-2`: `[CHR-2] fix: prevent double loot`
- Branch `maintenance/CHR-3`: `[CHR-3] chore: update tooling`
- Branch `maintenance/CHR-4`: `[CHR-4] refactor: simplify auth`

## Implementation plans

- Split every implementation plan into tasks, each scoped to one Git commit.
- Include the prepared Conventional Commit subject in each task, showing
  the final ticket-prefixed subject and the unprefixed input for the hook.
- Include the implementation, tests, and directly related documentation
  for that task in the same planned commit.
- A planned commit does not authorize staging or committing before the
  user confirms the unstaged review.

## Current verification commands

- Hook behavior: `node scripts/test-hooks.mjs`.
- Hook shell syntax: `sh -n .githooks/commit-msg`.
- Node script syntax: `node --check scripts/prefix-commit.mjs`,
  `node --check scripts/install-hooks.mjs`, and
  `node --check scripts/test-hooks.mjs`.
- Workspace checks: `pnpm lint`, `pnpm typecheck`, `pnpm test:hooks`, and
  `pnpm build`.
- Unit tests: `pnpm test:unit`.
- Isolated Postgres integration tests: `pnpm test:integration` (requires Docker).
- Playwright is added later. Missing/empty suites must not be reported as passing.
- Use the Node.js and pnpm versions pinned in `.node-version` and
  `package.json`; install dependencies with `pnpm install --frozen-lockfile`.

## Verification scope

- Before proposing a ticket as complete, run the full configured lint,
  type-check, unit-test, Playwright-test, and production-build commands.
- All required checks must pass. Missing checks, skipped tests, or checks
  that could not run must be reported and must not be described as passing.
- For changes to hooks or other tooling, also run focused checks covering
  their behavior.
- After implementation and local verification, ask the user for permission
  to run both the Bugbot and Security Review subagents.
- Do not launch either review subagent without the user's permission.
- Resolve every review finding unless the user explicitly marks that
  finding as ignored.
- After fixes, rerun affected checks and obtain follow-up review of the
  fixes within the permission granted by the user.
- A ticket is complete only when all required checks pass, both reviews
  have finished, all findings are resolved or explicitly ignored by the
  user, and the user explicitly approves ticket completion.
- Approval of the unstaged diff does not by itself constitute approval
  of ticket completion.

## Database design

- Store entity metadata once and model relationships with foreign keys.
- Use junction tables with composite primary keys for many-to-many
  relationships instead of ID arrays or duplicated entity data.

## Documentation upkeep

- Before proposing a ticket as complete, review all project documentation
  and update every document affected by that ticket so it reflects the
  implemented behavior and architecture.
- Keep `ARCHITECTURE.md` current with the implemented project architecture.

## Rewriting local agent commits

- Rewrite only commits created by the current agent during the current task
  and not pushed to `origin`.
- Before rewriting, verify the branch name, identify each targeted commit
  from the current task, and confirm that no `origin/*` reference contains
  it. If provenance or remote status is uncertain, do not rewrite it.
- Prefer recoverable operations such as `git reset --soft` followed by
  recommitting or amending. Never rewrite user-created commits or commits
  already pushed to `origin`.
