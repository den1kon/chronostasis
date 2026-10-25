# CHR-7: Developer tooling and workflow design

Status: implementation in progress. This design and its plan guide CHR-7; they do not authorize staging or committing changes.

## Suggested ticket metadata

- **Title:** Adopt GTS and document the development workflow
- **Labels:** `improvement` and new topical label `tooling`
- **Description:**

  Standardize TypeScript formatting and lint fixes with Google TypeScript Style (GTS), add fast staged-file checks while preserving the existing ticket-prefix commit hook, and provide one local full verification command that reports the failing check clearly. Document the local development workflow, including Docker Compose services and the PostgreSQL/Drizzle workflow, so a contributor can set up, change, and verify the project without relying on tribal knowledge. Keep the verification command reusable as a later Jenkins pipeline step.

## Intent

Make the repository easier to contribute to and safer to change by giving developers one documented style/fix workflow, a quick commit-time guard, a clear local full-check gate, and an accurate guide to the codebase and its database. The existing full check suite should remain runnable locally before Jenkins is introduced.

## Current state

- The repository is a pnpm workspace using Node 24.20.0 and pnpm 10.34.7.
- `pnpm lint` runs a strict custom ESLint flat config with TypeScript, React Hooks, and import-boundary rules. There is no configured formatter or unified autofix command.
- Type checking, unit tests, PostgreSQL integration tests, hook tests, Playwright E2E, and production build are separate commands.
- `.githooks/commit-msg` and `pnpm hooks:install` implement the ticket-prefix behavior through repository-local `core.hooksPath=.githooks`.
- Docker Compose runs the web client, local API, PostgreSQL, migration/seed initializer, and isolated test services. `packages/db` owns Drizzle schema, migrations, pool, repositories, and seed data.
- README and `ARCHITECTURE.md` already document the bootstrap; there is no detailed contributor/development guide or CI pipeline.

## Goals

1. Adopt GTS as the authoritative source of formatting, general lint rules, and automatic fixes, with predictable root pnpm commands.
2. Keep strict type checks, React-specific rules, and browser/server import boundaries as additional project safeguards alongside GTS.
3. Run only fast, relevant formatting/lint checks on staged files before a commit. Keep integration, E2E, and production build out of the commit hook.
4. Preserve ticket-prefix processing in `.githooks/commit-msg`; hook setup must enable both commit-time checks and commit-message processing without replacing the custom `core.hooksPath`.
5. Add `pnpm verify:all`, which serially runs the complete local acceptance set, prints the name and command of each check, stops at the first failure while preserving its diagnostics, and exits nonzero. A successful run is the local signal that the contributor may request review.
6. Write a practical development guide for setup, code layout, Docker services, environment, database changes, tests, formatting, hooks, and the full local verification command. Keep README concise and architecture accurate.
7. Keep the gate runnable without Jenkins so Jenkins can later invoke the same command rather than duplicate the check list.

## Non-goals

- No Jenkins installation, Jenkinsfile, hosted CI, branch protection, or PR creation.
- No application feature or database schema change. The database scope is setup and development documentation for the existing model and workflows.
- No broad reworking of authentication, Docker, or test architecture.
- No full test suite in the pre-commit hook.

## Design and approaches

### TypeScript style

Use the full GTS config as the authority for JavaScript and TypeScript source style and general lint rules, exposed through root pnpm scripts. The full config is included with its TypeScript parser/plugin references unified to the workspace's parser instance to avoid an ESLint plugin collision. Keep strict type-aware checks, React Hooks, and browser/server import boundaries as separate safeguards. Do not run `gts init` blindly because it can change TypeScript configuration and package scripts that this workspace already owns. Make check mode non-mutating and fix mode explicit. Apply GTS formatting to source files and review the resulting diff for behavior changes.

Considered alternatives:

1. Replace the current ESLint setup wholesale with GTS defaults. This is simpler but risks losing React Hooks, import-boundary, and type-aware rules; not selected.
2. Add a separate formatter while leaving GTS out. This avoids GTS compatibility risk but does not meet the requested GTS standard; not selected.
3. Use GTS as the style and general lint authority, with existing project type and runtime-boundary safeguards layered alongside it. Selected because it establishes one style source while preserving checks GTS does not provide.

### Git hooks

Use pre-commit for staged-file selection and hook configuration, but keep the existing repository hook directory as the single Git hook path. The local pre-commit hook invokes the workspace-pinned GTS CLI; this avoids a duplicate package install in pre-commit's Node environment. Extend the repository-owned hook installer and `.githooks` entrypoints so the `pre-commit` event delegates to the configured checks and `commit-msg` continues to add/validate ticket prefixes. Do not depend on a default `pre-commit install` that writes under `.git/hooks`, where Git will ignore it while `core.hooksPath` points at `.githooks`. Document the pre-commit prerequisite and setup. If a safe additive integration cannot be made, stop and report the conflict rather than overwriting the existing hook path.

Commit-time checks should be limited to staged TypeScript/JavaScript and supported configuration/documentation file types for formatting/linting. They should not run tests, database commands, or builds. Developers can run the same hooks manually on all tracked files.

### Pre-PR verification command

Add a root command `pnpm verify:all` backed by a small Node script. It runs, serially and in the repository root, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration`, `pnpm test:hooks`, `pnpm test:e2e`, and `pnpm build`. Before each child process it prints a stable step label and command; it inherits output so tool diagnostics remain visible. It stops on the first nonzero result, identifies the failed step, and exits nonzero. It exits zero and reports success only after all steps pass. Do not include dependency installation in this script; contributors install using `pnpm install --frozen-lockfile` first. Keep checks serial so Docker-heavy test runners do not compete for resources and output order is reproducible.

### Development documentation

Add `docs/DEVELOPMENT.md` as the detailed contributor guide, then link to it from README. Explain current behavior, not planned product functionality. Cover Node/pnpm setup, Clerk environment prerequisites, Compose start/stop and service roles, API request path, persistent and isolated test databases, schema/migration/seed workflow, test commands and prerequisites, hook installation, formatting/lint/fix, `verify:all`, and a normal ticket-to-review work loop. Update `ARCHITECTURE.md` for implemented tooling/runtime boundaries only; do not describe future Jenkins as present.

## Constraints and open implementation decisions

- Keep Node 24.20.0 and pnpm 10.34.7 pins; commit the lockfile with dependency changes.
- Select mutually compatible, pinned GTS/pre-commit/tool versions and record any non-Node prerequisite plainly.
- Check whether GTS exposes the required formatter and ESLint behavior under the current ESLint 10 flat config. If the current release cannot preserve the existing policy, surface that compatibility issue before relaxing rules or choosing a substitute.
- The new verifier must propagate spawn failures, signals, and command exit codes as a named failed check; it must not print secrets from environment values.
- Integration and E2E checks need Docker. Authenticated E2E also needs Clerk development settings and the dedicated test account in `.env`; setup errors must identify the check that could not run.
- Keep `.env` secrets out of docs, process output, Docker build contexts, and committed test fixtures.

## Acceptance criteria

- [x] GTS is installed/configured with compatible pinned dependencies and documented format-check, lint, and explicit autofix commands.
- [x] Existing strict TypeScript, React Hooks, and import-boundary checks still run and are not weakened.
- [x] Repository source is formatted consistently; the formatting diff was reviewed for unrelated behavior edits.
- [x] pre-commit runs only fast relevant checks for staged files; setup cooperates with `core.hooksPath=.githooks` and preserves `commit-msg` ticket-prefix behavior.
- [x] Hook installation is repeatable and its focused tests cover both hook entrypoints and failure/configuration cases.
- [x] `pnpm verify:all` runs GTS formatting plus all seven acceptance commands serially, labels each, stops with a clear failing command and nonzero exit, and reports success only when every command passes.
- [x] The verifier has focused tests for success, a named command failure, and process-spawn failure.
- [x] `docs/DEVELOPMENT.md`, README, and `ARCHITECTURE.md` accurately describe setup, Docker, DB, commands, hooks, and the contributor workflow.
- [ ] The full configured lint, type-check, unit, integration, hook, authenticated E2E, and build commands pass; report any unavailable checks rather than claiming success.
- [ ] Bugbot and Security Review are completed after implementation and local verification; findings are resolved or explicitly ignored by the user.
- [ ] The user explicitly approves ticket completion after reviewing the unstaged changes and verification/review evidence.

Current local evidence: GTS formatting, ESLint, typecheck, 108 unit tests, 13 PostgreSQL integration tests, 38 hook tests, pre-commit validation/all-files checks, and the production build passed. `pnpm verify:all` stopped at authenticated E2E because this checkout has no Clerk settings or dedicated `E2E_CLERK_USER_EMAIL`; therefore full ticket acceptance remains pending.

## Suggested ticket label

Create `tooling` as a topical label for developer tools and workflow changes; retain the existing `improvement` label to express the issue category. This ticket spans formatting, hooks, the PR-check script, and developer docs, so `tooling` is more useful for filtering than `maintenance` alone.
