## Git workflow

- Use a separate branch for each ticket: `feature/CHR-<number>`,
  `bugfix/CHR-<number>`, or `maintenance/CHR-<number>`.
- Before implementation, obtain the ticket ID if it has not been provided.
  Do not invent a ticket ID or implement ticket work on `main`.
- Prefix every commit subject with the ticket ID in square brackets,
  followed by a space, for example `[CHR-1234] `.
- Keep the complete subject, including the ticket prefix, within 36 characters.
- Start the description after the prefix with a lowercase imperative verb.
- Do not use Conventional Commit prefixes such as `feat:`, `fix:`, or `chore:`.
- Let the existing hook add the ticket prefix when appropriate; verify the
  resulting subject has exactly one prefix before considering the commit done.
- Keep implementation changes unstaged until the user reviews the unstaged
  diff and explicitly confirms that review is complete.
- Do not commit or amend implementation code before that review.
- Stage implementation changes only after the user confirms the unstaged review.
- Before committing, verify that the staged changes contain only the intended
  work.
- Use only a commit subject; do not add a commit-message body. The user writes
  commit descriptions.
- Do not create or open a pull request unless the user explicitly requests it.

**Examples:**

- `[CHR-1234] add timer`
- `[CHR-1234] fix double reward`
- `[CHR-1234] update tooling`

## Implementation plans

- Split every implementation plan into tasks, each scoped to one Git commit.
- Include the prepared ticket-prefixed subject and the unprefixed input for the
  commit hook in each task.
- Include implementation, tests, and directly related documentation in that
  task's planned commit.
- A planned commit does not authorize staging or committing before the user
  confirms the unstaged review.

## Verification scope

- Use Node.js `24.20.0` and pnpm `10.34.7`; install with
  `pnpm install --frozen-lockfile`.
- Run `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`,
  `pnpm test:integration`, `pnpm test:hooks`, `pnpm test:e2e`, and `pnpm build`
  before proposing a ticket as complete.
- GTS is authoritative for JavaScript/TypeScript formatting and general lint
  rules. Run `pnpm format:check` and use `pnpm format:fix` for autofixes.
- `pnpm verify:all` runs GTS formatting and the complete local check set in
  sequence; report the named failure and any checks that could not run.
- `pnpm test:integration` and `pnpm test:e2e` require Docker. The authenticated
  E2E suite also requires the Clerk development settings and dedicated test
  account described in README.md. `pnpm test:e2e:signed-out` is a reduced
  public-route check and is not full acceptance.
- Install the repository hook with `pnpm hooks:install`; run its focused suite
  with `pnpm test:hooks` or `node scripts/test-hooks.mjs`.
- Install the pinned pre-commit runner from `requirements-dev.txt` in `.venv`
  before enabling the staged-file hook.
- Before proposing a ticket as complete, run the full configured lint,
  type-check, unit-test, Playwright-test, and production-build commands.
- All required checks must pass. Report missing, skipped, or unavailable checks;
  do not describe them as passing.
- For changes to hooks or other tooling, also run focused checks covering their
  behavior.
- After implementation and local verification, ask the user for permission to
  run both Bugbot and Security Review. Do not launch either review without that
  permission.
- Resolve every review finding unless the user explicitly marks it ignored.
- After fixes, rerun affected checks and obtain follow-up review within the
  permission granted by the user.
- A ticket is complete only when required checks pass, both reviews have
  finished, findings are resolved or explicitly ignored, and the user
  explicitly approves ticket completion.
- Approval of the unstaged diff does not by itself approve ticket completion.

## Code comments

- Add a brief comment above new or modified functions whose purpose,
  side effects, or constraints are not clear from their name and signature.
- Usually keep function comments to one or two lines; use more when
  complex behavior needs explanation.
- Explain intent, important constraints, and non-obvious decisions.
  Avoid comments that merely repeat the code.
- Update comments when changing the behavior they describe.

## Database design

- Store entity metadata once and model relationships with foreign keys.
- Use junction tables with composite primary keys for many-to-many relationships
  instead of ID arrays or duplicated entity data.

## Documentation upkeep

- Before proposing a ticket as complete, review all project documentation and
  update each document affected by that ticket.
- Keep `ARCHITECTURE.md` current with the implemented project architecture.

## Rewriting local agent commits

- Rewrite only commits created by the current agent during the current task
  and not pushed to `origin`.
- Before rewriting, verify the branch name, identify each targeted commit from
  the current task, and confirm that no `origin/*` reference contains it. If
  provenance or remote status is uncertain, do not rewrite it.
- Prefer recoverable operations such as `git reset --soft` followed by
  recommitting or amending. Never rewrite user-created commits or commits
  already pushed to `origin`.
