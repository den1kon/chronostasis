# CHR-7: GTS, pre-commit, and developer workflow plan

Status: implementation is in place. Formatting, lint, typecheck, unit, integration, hook, and build checks pass; authenticated E2E awaits Clerk test configuration, and Bugbot/Security Review await user permission. Each task is one planned commit. The plan does not authorize staging or committing before the user reviews the unstaged diff and explicitly confirms.

## Preconditions

- Work on `feature/CHR-7` (created for this ticket); do not implement on `main`.
- Use Node.js 24.20.0 and pnpm 10.34.7. Install with `pnpm install --frozen-lockfile` after changing package metadata.
- Read `docs/superpowers/specs/2026-10-25-chr-7-dev-tooling-design.md` before implementation.
- GTS is authoritative for source formatting and general lint conventions. Preserve the strict type-aware checks and React/browser-boundary rules as additional project safeguards, not as alternate style authorities.
- Before selecting versions, verify GTS and pre-commit integration against the checked-in ESLint flat config, TypeScript 6, and the existing hook installer.
- Install repository hooks with `pnpm hooks:install`; do not replace `core.hooksPath` or overwrite user hook configuration.

## Task 1: Configure GTS and style commands

**Commit subject:** `[CHR-7] adopt GTS style`
**Commit-hook input:** `adopt GTS style`

Files: root `package.json`, `pnpm-lock.yaml`, ESLint/formatter configuration, and existing tracked source files that need the initial formatting pass.

1. Inspect GTS's supported configuration/API and pinned dependencies. Confirm the selected release works with ESLint 10, TypeScript 6, Node 24, and the flat config. The full GTS config is included; its TypeScript parser/plugin references are unified with the workspace's parser instance to avoid an ESLint plugin collision. Do not run `gts init` if it would overwrite workspace settings.
2. Add root scripts with distinct non-mutating GTS check and explicit autofix actions. Keep `pnpm lint` as the no-fix ESLint command and retain `pnpm typecheck` unchanged. Include GTS formatting in `pnpm verify:all`.
3. Compose GTS rules with the existing TypeScript, React Hooks, and import-boundary rules. Ensure a lint/fix run never turns off type checking or permits browser imports of server-only code.
4. Apply the formatter once to its intended tracked files. Review the entire formatting diff for accidental changes outside formatting.

Verification:

- `pnpm install --frozen-lockfile` completes and pins the selected dependency graph.
- Run the GTS formatting check and autofix command; the second check is clean and rerunning autofix creates no further diff.
- `pnpm lint` and `pnpm typecheck` pass.
- `git diff --check` reports no whitespace errors.

## Task 2: Integrate staged-file hooks safely

**Commit subject:** `[CHR-7] add staged checks`
**Commit-hook input:** `add staged checks`

Files: `.pre-commit-config.yaml`, `.githooks/pre-commit`, `.githooks/commit-msg` only if needed for compatibility, `scripts/run-gts.mjs`, `scripts/install-hooks.mjs`, `scripts/test-hooks.mjs`, hook documentation comments as appropriate.

1. Configure pre-commit to invoke `scripts/run-gts.mjs` for fast formatting/lint checks on applicable staged files. This runs the workspace-pinned GTS CLI using the current Node runtime and local bin directory on `PATH`, avoiding a duplicate GTS install. Do not run typecheck, tests, Docker, or build at commit time.
2. Extend the repo-owned hook setup so `.githooks/pre-commit` delegates to pre-commit and `.githooks/commit-msg` still performs the existing ticket-prefix logic. Keep `core.hooksPath=.githooks`; do not install into the ignored default `.git/hooks` location or overwrite an existing unrelated path.
3. Make installer behavior idempotent. When pre-commit is unavailable or setup cannot preserve the existing path, return an actionable error without partially changing hook configuration.
4. Extend focused hook tests using temporary repositories to prove staged checks execute, commit-message prefixing still executes independently, and existing configuration is preserved.

Verification:

- `pnpm hooks:install` succeeds twice with the same repository hook path and does not alter the ticket hook contents unexpectedly.
- `pnpm test:hooks` passes, including both hook types and installer failure paths.
- `pre-commit validate-config` passes.
- `pre-commit run --all-files` passes on the formatted tree; a staged-file smoke check confirms the pre-commit hook scopes to staged supported files.
- `git diff --check` passes.

## Task 3: Add the full local verification runner

**Commit subject:** `[CHR-7] add full verifier`
**Commit-hook input:** `add full verifier`

Files: `scripts/verify-all.mjs`, root `package.json`, focused script tests and their test configuration.

1. Add `pnpm verify:all` to call a Node runner that executes this ordered list serially: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration`, `pnpm test:hooks`, `pnpm test:e2e`, and `pnpm build`.
2. Before each process, print a stable label and exact command. Inherit child stdout/stderr. Stop on the first nonzero exit, signal termination, or spawn error; print the failed label/command and return nonzero. Print overall success only if all eight checks succeed. Do not echo environment values.
3. Add focused tests by substituting a fake Corepack executable through a temporary `PATH`. Assert exact order and successful summary; assert first failing stage is named and later stages do not run; assert a spawn error is also named and exits unsuccessfully.
4. Keep installation (`pnpm install --frozen-lockfile`) separate from the verifier and explain this distinction in Task 4.

Verification:

- Focused verifier tests pass without requiring Docker or Clerk credentials.
- `pnpm verify:all` passes in a complete local environment; if Docker or Clerk setup is missing, preserve the named failing step and actionable underlying diagnostics.
- Independently run each constituent command when diagnosing a verifier failure; the verifier itself must use the same commands.

## Task 4: Document the contributor and database workflow

**Commit subject:** `[CHR-7] document development flow`
**Commit-hook input:** `document development flow`

Files: `docs/DEVELOPMENT.md` (new), `README.md`, `ARCHITECTURE.md`, and any directly related project docs identified during the documentation review.

1. Write a task-oriented development guide: prerequisites and environment, project/workspace map, Docker Compose service roles and startup flow, API request path, database persistence/isolated test data, Drizzle schema-to-migration-to-seed process, local verification commands, GTS format/lint/fix commands, hook install, and ticket branch-to-review workflow.
2. Keep README concise: link to the development guide and show the short local start and `pnpm verify:all` path. Preserve Clerk setup requirements and existing explanations needed to start the app.
3. Update `ARCHITECTURE.md` only for implemented tool/hook boundaries and contributor verification flow. Do not imply Jenkins exists.
4. Review all documentation under the repository for stale setup/check guidance and update directly affected docs. Use relative links that work from each document.

Verification:

- Follow every documented local command and relative link for correctness.
- Confirm the docs say that authenticated E2E requires the dedicated Clerk development account and that integration/E2E use Docker-backed isolated resources.
- `git diff --check` passes; inspect the full docs diff for claims that exceed the implementation.

## Final ticket verification and review

Run the full gate on Node 24.20.0/pnpm 10.34.7 after implementation:

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm verify:all
pnpm test:hooks
pre-commit run --all-files
```

`pnpm verify:all` covers GTS formatting, lint, typecheck, unit, integration, hooks, authenticated E2E, and build. The focused hook suite and pre-commit all-files run are repeated explicitly because this ticket changes tooling and hook behavior. Report every unavailable/skipped check. Ask permission for Bugbot and Security Review only after local verification, resolve findings, run affected checks and follow-up reviews, then present the complete unstaged diff for user review. Do not stage or commit until the user explicitly confirms the diff review; separate explicit approval is required to mark CHR-7 complete.

## Plan self-review

- **Spec coverage:** GTS and preservation of lint policy are Task 1; pre-commit and hook coexistence are Task 2; the reusable CI-ready gate is Task 3; database/developer docs and README/architecture upkeep are Task 4; full checks and both reviews are in final verification.
- **Commit granularity:** four independently reviewable commits; each has a ticket-prefixed subject and exact unprefixed hook input within the 36-character subject limit.
- **Failure cases covered:** formatter idempotence; missing pre-commit / unsafe hook path; existing hook preservation; verifier command failure, spawn failure, and successful execution; missing Docker/Clerk surfaced by the labeled stage.
- **Review focus:** GTS remains authoritative and its formatter is applied consistently; strict TypeScript and runtime boundary safeguards remain active; existing `core.hooksPath` is never replaced; tests never target the development DB; verifier never reports success after a failed/spawned command; docs describe only implemented behavior.
