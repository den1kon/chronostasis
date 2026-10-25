# CHR-5 Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Native execution is recommended here because tasks share runtime, auth, and workspace interfaces; use subagents only if the user selects that execution approach.

**Goal:** Bootstrap a reproducible local application proving React → authenticated TypeScript API → Postgres persistence, with developer checks and documentation.

**Architecture:** A pnpm workspace contains a Vite frontend, shared Web Request/Response API handlers, thin Vercel adapters, a local Node adapter, public contracts, and server-only Drizzle data access. Docker Compose runs frontend, API, initialization, and persistent Postgres. Clerk is external; Vercel and Neon deployment belongs to another ticket.

**Tech Stack:** TypeScript, React, Vite, Tailwind CSS, pnpm workspaces, Vercel Functions, Neon-compatible Postgres, Drizzle, Clerk, Vitest, Playwright, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-23-chr-5-bootstrap-design.md` (read it before executing).

Status: approved for implementation by the user on 2026-10-23. Task 1 was reviewed and committed as `d645c1c`. Task 2 was reviewed and committed as `cd62a97`. Task 3 includes the verified user/item foundation and implemented chest catalogue. The user authorized bug review only (Security Review skipped for this step), followed by commit if clear and continuation to Task 4. Task 3 is committed as `7dc32f0`. Task 4 is committed as `6cfd5f3`. Task 5 is committed as `f9de4ac`. Task 6 is in progress; Task 7 has not started.

## Global Constraints

- Work is on `maintenance/CHR-5`.
- Deployment is a separate ticket: no Vercel project linking, cloud deployment, or Neon resource creation in CHR-5.
- Proposed baseline: Node 24 LTS, pnpm 10, Postgres 17. Verify dependency engine compatibility at implementation time; pin exact selected Node/container and package-manager versions and commit the generated lockfile.
- Nothing is staged or committed without the user's explicit unstaged-diff review approval.
- Current session rules: no Conventional Commit category; use a lowercase imperative verb and keep the complete ticket-prefixed subject within 36 characters.
- Normalize chest/item metadata into `chests`, `items`, and `chest_items`; one initial chest type must not impose a singleton schema. The future opening flow awards exactly one eligible item.
- Tailwind CSS / @tailwindcss/vite 4.3.3 belongs to Task 2’s existing commit; use utilities for component styling and `@theme` for shared tokens.
- No development authentication bypass, hard-coded token, or test-only login endpoint is shipped.
- Missing Clerk credentials must fail the authenticated suite with an actionable setup error, not silently skip it.
- Final Bugbot and Security Review runs require a separate user permission request after implementation and verification.
- PWA installation/service worker, Capacitor/iOS packaging, notifications, focus timer, chest opening, loot selection, and inventory behavior are deferred.

The user waived existing testing gates while the tooling is being established. Establish tests as part of the tasks below, then run the resulting checks; do not retroactively claim tests existed before scaffolding. Each task below represents exactly one planned Git commit, including its implementation, tests, and directly related documentation. The prepared subject is not permission to stage or commit. At each task boundary, present that task's complete unstaged changes, obtain explicit review confirmation, inspect the intended staged contents, and only then create that task's commit. If review is pending, leave the task uncommitted; do not combine tasks or bypass the review gate.

## Review Focus

- Fresh checkout and stale dependency volumes: documented startup must work after dependency changes (Task 5 startup/rebuild check).
- Retry/concurrent initialization: one verified Clerk subject must create exactly one user (Task 3 integration test).
- Token and origin failures: missing, expired, invalid, or wrong-party tokens must never reach database access (Task 4 auth tests).
- Runtime drift: local and Vercel adapters must preserve methods, headers, bodies, and errors consistently (Task 4 parity tests).
- Missing external credentials: authenticated smoke tests must fail visibly instead of silently passing a reduced suite (Task 6 configuration test).

## File map

- Root `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json`, `eslint.config.js`, `.gitignore`, `.dockerignore`: workspace and tooling.
- Root `Dockerfile.dev`, `compose.yaml`, `.env.example`: reproducible local environment.
- `apps/web/package.json`, `index.html`, `vite.config.ts`, `tsconfig.json`, `src/main.tsx`, `src/app.tsx`, `src/styles.css`, `src/lib/api.ts`, `src/lib/api.test.ts`: frontend and proxy.
- `apps/web/api/health.ts`, `apps/web/api/me.ts`, `apps/web/vercel.json`: future Vercel adapters/routing configuration, not deployment.
- `apps/api/package.json`, `tsconfig.json`, `src/server.ts`, `src/server.test.ts`: local Node server.
- `packages/contracts/package.json`, `tsconfig.json`, `src/index.ts`: Zod public API schemas/types.
- `packages/db/package.json`, `tsconfig.json`, `drizzle.config.ts`, `src/env.ts`, `src/client.ts`, `src/schema.ts`, `src/users.ts`, `src/seed.ts`, `src/seeding.ts`, `src/migrations.ts`, `drizzle/`, `tests/users.integration.test.ts`, `tests/catalogue.integration.test.ts`: database implementation and migration artifacts.
- `packages/api/package.json`, `tsconfig.json`, `src/env.ts`, `src/auth.ts`, `src/handlers.ts`, `src/vercel.ts`, `src/index.ts`, corresponding `*.test.ts`: shared API and Vercel conversion.
- `vitest.config.ts`, `vitest.integration.config.ts`, `playwright.config.ts`, `tests/e2e/auth.setup.ts`, `tests/e2e/signed-out.spec.ts`, `tests/e2e/bootstrap.spec.ts`, `scripts/check-e2e-env.mjs`: verification.
- `.githooks/commit-msg`, `scripts/prefix-commit.mjs`, `scripts/install-hooks.mjs`, `scripts/test-hooks.mjs`: ticket prefix automation.
- `README.md`, `ARCHITECTURE.md`, `AGENTS.md`, this plan, and the design spec: documentation.

## Commit sequence

1. `[CHR-5] chore: define ticket workflow`
2. `[CHR-5] chore: scaffold typescript workspaces`
3. `[CHR-5] feat: add local postgres persistence`
4. `[CHR-5] feat: add authenticated api`
5. `[CHR-5] feat: add mobile application shell`
6. `[CHR-5] add e2e smoke tests`
7. `[CHR-5] document architecture`

Implement in this order. Task 1 installs the hook before the first repository commit, so every planned commit receives its ticket prefix. Before pnpm exists, use the Node hook commands specified there. Do not create empty commits to check off tasks. If implementation or review changes a commit boundary, update this plan and its prepared subject before proceeding. Keep each task's documentation updates with its commit; the final documentation task consolidates the verified whole-project architecture.

## Task 1: Ticket workflow, planning artifacts, and commit hook

**Planned commit:** `[CHR-5] chore: define ticket workflow`

**Input to Git (hook adds prefix):** `chore: define ticket workflow`

**Commit boundary:** this task’s listed files, tests, dependency/lockfile changes, and directly related documentation only.

**Interfaces**

- Consumes: branch name and Git-provided commit message file path.
- Produces: executable `.githooks/commit-msg`; explicit `node scripts/install-hooks.mjs`; `node scripts/test-hooks.mjs` with temporary-repository fixtures. Task 2 adds pnpm aliases for these commands.

**Files:** `.githooks/commit-msg`, `scripts/prefix-commit.mjs`, `scripts/install-hooks.mjs`, `scripts/test-hooks.mjs`, `AGENTS.md`, both CHR-5 design/plan files, and a minimal `README.md` hook-activation section. The hook test runner uses Node built-ins and needs no package installation.

- [x] Confirm `maintenance/CHR-5`, preserve current user edits, and include the approved spec/plan and AGENTS.md rules in this task.
- [x] Write hook fixtures first: all three valid branch categories; correct existing prefix; mismatched and duplicate prefixes; malformed CHR suffix; unrelated branch; detached HEAD; file path with spaces; empty/comment-only subject; subject followed by body/editor comments. Confirm tests fail without the hook.
- [x] Implement a portable shell hook entrypoint delegating to a dependency-free Node script, with anchored branch matching and safe file operations. Add only the matching `[CHR-N] ` once; reject conflicting/duplicate ticket prefixes and malformed reserved branch names. Leave unrelated branches/detached HEAD untouched. Preserve user-authored bodies/comments and never truncate an aborted message into a prefix-only commit.
- [x] Implement explicit installation using repository-local `core.hooksPath`. If a different custom path exists, stop rather than overwrite it. Document reactivation after clone. No automatic package lifecycle installation.
- [x] Run `node scripts/test-hooks.mjs` with temporary repositories and assert rewritten text and exit codes. Do not create test commits in Chronostasis.
- [x] Activate the hook in Chronostasis after verifying no conflicting hook path exists; read back the configuration and executable mode. Verify installation before this task’s review/commit checkpoint.

- [x] **Review and commit gate:** present this task’s complete unstaged diff, including untracked files, and wait for the user to explicitly confirm review is complete. Do not use `git add -N` without permission. Then stage only this task’s intended changes, inspect the staged diff, and create exactly one commit with subject input `chore: define ticket workflow`. Verify the resulting subject is exactly `[CHR-5] chore: define ticket workflow` and has no message body. If review is pending, leave the task uncommitted.


**Verification evidence:** `node scripts/test-hooks.mjs`: 37 passed, 0 failed, 0 skipped. Shell/Node syntax checks passed. Repository-local `core.hooksPath` reads `.githooks`; the hook is executable. Explicit user review/commit approval received; committed as `d645c1c` with exactly one `[CHR-5]` prefix and no body.

## Task 2: TypeScript workspace and baseline checks

**Planned commit:** `[CHR-5] chore: scaffold typescript workspaces`

**Input to Git (hook adds prefix):** `chore: scaffold typescript workspaces`

**Commit boundary:** this task’s listed files, tests, dependency/lockfile changes, and directly related documentation only.

**Interfaces**

- Consumes: ticket hook and planning/rules from Task 1; compatible Node and pnpm.
- Produces: installable pnpm workspace, strict shared TS/ESLint settings, Vitest runner, and minimal buildable React/Vite entrypoint styled with Tailwind CSS. Add scripts `lint`, `typecheck`, `test:unit`, `test:hooks`, `hooks:install`, and `build`; later tasks introduce their own executable commands alongside their implementation, not as stubs.

**Files:** root `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json`, `eslint.config.js`, `vitest.config.ts`, `.gitignore`, `.dockerignore`, `.npmrc`, `.node-version`, `tsconfig.json`, `tsconfig.tooling.json`; `apps/web` manifest/configuration/minimal entrypoint; `README.md` prerequisites and workspace command sections; AGENTS.md verification commands and spec/plan execution status. Do not create manifests pointing at absent API/database implementations.

- [x] Verify current branch/status and reread AGENTS.md. Record existing files; do not overwrite user changes.
- [x] Resolve compatible package versions against the spec baseline. Pin exact Node, pnpm, and package versions/lockfile; report any baseline incompatibility before changing it.
- [x] Set up workspaces, strict TS configuration, type-aware ESLint with `--max-warnings=0`, and Vitest. Frontend TS must not include Node-only globals; server packages must not be imported by browser entrypoints.
- [x] Add pnpm aliases for the dependency-free hook install/tests from Task 1. Set up a minimal buildable React/Vite shell; routing/authentication arrive in Task 5.
- [x] Add exact `tailwindcss` and `@tailwindcss/vite` 4.3.3 dev dependencies to `apps/web`, register the official Vite plugin, and import Tailwind in `src/styles.css`.
- [x] Migrate scaffold selectors to Tailwind utilities, preserving the existing content, semantic markup, colors, and responsive spacing. Keep shared colors in `@theme` and document-level base styles in the CSS entrypoint.
- [x] Verify the Tailwind-enabled production build and browser rendering at desktop and 390 × 844 mobile dimensions. Confirm no horizontal overflow and that the theme colors, utility spacing, and borders render correctly. Do not add CSS-selector snapshot tests.
- [x] Generate the initial lockfile with `pnpm install`, then verify reproducibility with `pnpm install --frozen-lockfile`. Run `pnpm lint`, `pnpm typecheck`, `pnpm test:hooks`, and `pnpm build`. Expected: successful exits. Do not add dummy unit tests merely to make an empty initial test suite appear meaningful; behavioral unit tests arrive with their owning tasks.
- [x] Update README with the actual prerequisites, workspace layout, scripts, and the fact that Compose and authentication are not yet implemented at this commit.

- [x] **Review and commit gate:** present this task’s complete unstaged diff, including untracked files, and wait for the user to explicitly confirm review is complete. Do not use `git add -N` without permission. Then stage only this task’s intended changes, inspect the staged diff, and create exactly one commit with subject input `chore: scaffold typescript workspaces`. Verify the resulting subject is exactly `[CHR-5] chore: scaffold typescript workspaces` and has no message body. If review is pending, leave the task uncommitted.


**Verification evidence:** after the Tailwind addition, frozen install, lint, typecheck, build, and all 37 hook tests passed. Tailwind utilities/theme colors were verified in the browser at 390 × 844 and 1280 × 800 CSS viewports with no horizontal overflow; desktop content remains capped at 640px. The temporary viewport override was reset. Temporary negative probes confirmed implicit-any/browser-Node-global type errors and the explicit-any lint rule; probes were removed afterward. Browser inspection confirmed the scaffold renders on port 5174 (local port 5173 is intercepted by OrbStack). `pnpm test:unit` exits 1 because no application unit tests exist yet; this is reported rather than bypassed.

**Commit evidence:** user approved the complete Tailwind-inclusive patch; committed as `cd62a97` with exactly one ticket prefix and no body.

## Task 3: Database schema, normalized chest catalogue, and persistence

**Planned commit:** `[CHR-5] feat: add local postgres persistence`

**Input to Git (hook adds prefix):** `feat: add local postgres persistence`

**Commit boundary:** this task’s listed files, tests, dependency/lockfile changes, and directly related documentation only.

**Interfaces**

- Consumes: `DATABASE_URL` and optional `MIGRATION_DATABASE_URL`; database-only environment validation.
- Produces: `createDatabase(connectionString: string)` returning a Drizzle client/pool wrapper; `ensureUser(clerkUserId: string): Promise<PublicUser>` and `findUser(clerkUserId: string): Promise<PublicUser | null>` through an injected database/repository factory. `PublicUser = { id: string; clerkUserId: string }` is owned by contracts. The database wrapper exposes `close(): Promise<void>` for scripts/tests and a lightweight `probe(): Promise<void>`. Add `seedCatalogue(database: Database): Promise<void>` to atomically upsert items, chest types, and eligibility relationships; update the seed entrypoint and callers to use it.

**Files:** contracts/database files in the file map, generated migrations, integration Vitest config; root `Dockerfile.dev`, `compose.yaml`, `.env.example`, `scripts/test-integration.mjs`, workspace/lockfile updates, shared TypeScript project-reference configuration; README database setup section, current/planned `ARCHITECTURE.md`, AGENTS.md verification/normalization rules, and spec/plan progress. At this task boundary Compose contains Postgres and the one-shot initializer; later tasks add API/frontend services.

- [x] Add manifests/configuration for contracts and database workspaces; add `db:migrate`, `db:seed`, and `test:integration` root commands. Define `PublicUserSchema`, `UserResponseSchema`, `HealthResponseSchema`, and `ApiErrorSchema` in contracts. Export inferred types only from these schemas.
- [x] Write database integration tests using a separate test database: `ensureUser` twice and concurrently returns the same ID; `findUser` for another Clerk subject returns null; distinct subjects remain separate. Assert the users table has exactly one row for the repeated subject.
- [x] Run `pnpm test:integration` and confirm these behavior tests fail before repository implementation. Supply an isolated test URL; refuse a test reset against the regular development URL.
- [x] Implement `users` and `items` exactly as specified, using a uniqueness constraint and SQL conflict-safe upsert rather than select-before-insert. Use `pg` with bounded pooling and Drizzle; close pools in one-shot scripts.
- [x] Generate migrations using Drizzle Kit; inspect SQL for keys, nullability, UUID defaults, and timezone-aware timestamps. Implement a stable-ID seed upsert for the three specified items.
- [x] Create the development Docker image and Compose Postgres/initializer services with a pinned Postgres 17 image, a persistent named database volume, and a `pg_isready` health check. Wire initialization to migrate then seed; do not reference not-yet-created API/frontend services. Add local database URL examples without exposing Postgres on the host by default.
- [x] Run migrations and seeds twice against isolated Postgres; assert exactly three catalogue IDs remain and integration tests pass. Verify initializer failures propagate as a nonzero exit; test dependent-service gating in Task 5 once those services exist. Recreate Postgres and verify seeded/user data persists. Run `docker compose config --quiet` without printing resolved secrets. Update README with migration/seed and data-retention commands.

### Chest-catalogue extension requested on 2026-10-24

- [x] Create `packages/db/tests/catalogue.integration.test.ts` first. Migrate and seed an isolated database; assert exactly one initial chest `{ id: 'basic-chest', name: 'Basic chest' }`, the three specified items, and exactly the three expected `(chest_id, item_id)` pairs. Observe the tests fail before implementing the chest tables.
- [x] Extend `packages/db/src/schema.ts` with `chests` (text primary-key `id`, non-null `name`) and `chest_items` (non-null text `chest_id`/`item_id` foreign keys, composite primary key, restrictive deletion). Keep metadata on its owning table. Do not add ownership, opening history, reward weights, or arrays of item IDs.
- [x] Run `pnpm db:generate --name chest_catalogue` to produce an additive migration and matching snapshot/journal changes. Preserve `0000_bootstrap.sql` and its snapshot. Review SQL for both foreign keys and the composite primary key; an already-initialized user/item database must upgrade without losing data.
- [x] Replace `seedItems` with `seedCatalogue` in `src/seeding.ts`, the seed entrypoint, and existing tests. Use one database transaction: upsert all item definitions, then the `basic-chest` definition, then the three eligibility links. Use conflict-safe insertion for links. Do not delete other definitions or links on repeated seeding.
- [x] Add real integration assertions that duplicate eligibility links are rejected, missing chest/item references are rejected, referenced definitions cannot be silently deleted, and an existing item can be linked to a second chest without changing its original link. Isolate/clean up test-created definitions so file order and repeat runs do not affect initial-seed assertions.
- [x] Run migrations and catalogue seeds twice against an isolated database and verify stable counts: 1 initial chest, 3 items, 3 links. Verify the additive migration preserves existing users/items, and verify later added chest definitions survive reseeding. Update Compose verification expectations to cover these counts and persistence after container recreation.
- [x] Update README and `ARCHITECTURE.md` from planned to implemented only after verification. Rerun frozen install, lint, typecheck, unit/integration/hook tests, production build, and migration/schema consistency check. Preserve the prepared Task 3 commit subject and unstaged-review gate.

- [x] **Review and commit gate:** present this task’s complete unstaged diff, including untracked files, and wait for the user to explicitly confirm review is complete. Do not use `git add -N` without permission. Then stage only this task’s intended changes, inspect the staged diff, and create exactly one commit with subject input `feat: add local postgres persistence`. Verify the resulting subject is exactly `[CHR-5] feat: add local postgres persistence` and has no message body. If review is pending, leave the task uncommitted.


**Historical verification evidence (before chest extension):** 25 unit tests and 6 real-Postgres integration tests passed. Isolated Compose verification ran the initializer twice (exactly 3 catalogue rows), recreated the database container while retaining the same user UUID and seed rows, checked nonzero migration failure/skipped seed with no secret disclosure, and confirmed no published database port. Verification projects/volumes were removed afterward. Final frozen install, lint, typecheck, production build, all 37 hook tests, and migration/schema consistency check passed. `pnpm db:generate` reported no schema changes for the earlier user/item schema. Chest extension evidence is recorded separately below.

**Implementation decisions:** Postgres 17.11 and Node 24.20.0 images are pinned by digest. Root `pnpm test:integration` orchestrates a unique Docker project; the container runs Vitest directly to avoid recursion. Compose uses fixed internal development URLs independent of exported host settings. Contracts/database emit declaration files for cross-workspace references; only the database package skips third-party declaration checking due to stable Drizzle’s optional-driver errors. Source checks remain strict. No unused drivers or source-level type suppressions were added.


**Commit evidence:** explicit conditional user approval was followed by independent bug review, fix/follow-up, passing checks, staged-scope inspection, and commit `7dc32f0` (`[CHR-5] bootstrap local postgres`). No Security Review was run, as requested.

## Task 4: Shared handlers, real auth, and runtime adapters

**Planned commit:** `[CHR-5] add authenticated api`

**Input to Git (hook adds prefix):** `add authenticated api`

**Commit boundary:** this task’s listed files, tests, dependency/lockfile changes, and directly related documentation only.

**Interfaces**

- Consumes: contracts and database repository from Task 3; validated server settings.
- Produces: `ApiDependencies = { authenticate(request: Request): Promise<{ clerkUserId: string } | null>; ensureUser(clerkUserId: string): Promise<PublicUser>; findUser(clerkUserId: string): Promise<PublicUser | null>; probe(): Promise<void> }`; `createApiHandler(deps: ApiDependencies): (request: Request) => Promise<Response>`. Production composition wires only real dependencies.
- Produces: `toVercelHandler(handler)` wrapping the shared handler in the current supported `@vercel/node` request/response types; local adapter calls the same handler.

**Files:** packages/api files; apps/api local adapter; apps/web/api adapters and vercel.json; new API workspace manifests/configuration, root lockfile/scripts, Compose API service, `.env.example` server settings, and README API/authentication sections.

- [x] Create API workspace manifests/configurations, database-backed production composition, and server-only environment settings. Extend Compose with the local API service gated on successful initialization; it remains internal to the container network.
- [x] Write Vitest cases for the exact health/me contracts in the spec. For example:

```ts
const response = await handler(new Request('http://localhost/api/me'));
expect(response.status).toBe(401);
expect(deps.findUser).not.toHaveBeenCalled();
expect(deps.ensureUser).not.toHaveBeenCalled();
```

- [x] Add cases: POST ignores a forged body identity and uses verified `sub`; GET absent user is 404; PUT is 405 with `Allow`; failed DB health is 503; unexpected DB errors return safe 500 without SQL/stack; user responses use `Cache-Control: no-store`.
- [x] Write auth-unit tests for missing bearer, expired/invalid token, wrong authorized party, and correct verified subject. Mock the Clerk SDK boundary, not the authentication result under test. Add environment tests proving missing variable errors contain names but not values and migration scripts do not require Clerk keys.
- [x] Run `pnpm test:unit` to establish the failing cases. Implement server env parsing, Clerk SDK verification with expected instance/origins, safe error conversion, and shared method/path dispatch.
- [x] Implement local request/response streaming conversion and thin Vercel adapters. Both receive full URLs, headers, methods, and body. Reject oversized bodies with a documented bounded limit (choose 64 KiB for these bootstrap endpoints) consistently in both adapters; avoid concatenating unbounded input.
- [x] Add adapter parity tests for GET, POST body forwarding, bearer header, status/JSON/cache/Allow headers, empty POST, unknown paths, and 64 KiB body boundary (exactly the limit accepted; limit + 1 rejected with 413). No hosted Vercel account is required for handler tests.
- [x] Configure SPA fallback without rewriting `/api` paths to HTML. Run unit/type checks and probe `/api/health` and unauthenticated `/api/me` from inside the API container; expect 200 and 401 respectively after DB initialization.

- [x] Update README with API startup, required Clerk development settings, supported endpoints, and future Vercel adapter boundaries.

- [x] **Review and commit gate:** present this task’s complete unstaged diff, including untracked files, and wait for the user to explicitly confirm review is complete. Do not use `git add -N` without permission. Then stage only this task’s intended changes, inspect the staged diff, and create exactly one commit with subject input `add authenticated api`. Verify the resulting subject is exactly `[CHR-5] add authenticated api` and has no message body. If review is pending, leave the task uncommitted.


**Verification evidence:** 84 unit tests pass; initial shared-handler/auth/env stubs produced 33 failing cases and adapter stubs produced seven failing parity cases. Real SDK cryptographic checks use an isolated JWKS boundary. Container startup waited for migrations/seeds; internal probes returned 200/401/404/405/413 and a safe 503 while the scratch database was stopped. Configured Clerk key/issuer consistency and a read-only JWKS request passed with no values displayed. Lint/type checks and the static build pass. The expanded image passed all 13 Postgres integration tests. Hosted Vercel invocation and real browser authentication remain unverified.

**Execution decisions:** backend verification retrieves JWKS using the secret key, so no separate JWT PEM variable is needed. `skipLibCheck` is scoped to the shared API as well as DB because the installed Clerk/Drizzle third-party declarations fail strict declaration checking; source strictness and runtime tests remain. The latest session-provided Git rules take precedence over the earlier Conventional Commit/length policy for the prepared Task 4 subject. No staging/commit permission is assumed for this task.


**Commit:** user approved staging/commit and explicitly requested no Bugbot. Committed as `6cfd5f3` with exactly one ticket prefix and no body.

## Task 5: Mobile-first shell and authenticated persistence flow

**Planned commit:** `[CHR-5] add mobile app shell`

**Input to Git (hook adds prefix):** `add mobile app shell`

**Commit boundary:** this task’s listed files, tests, dependency/lockfile changes, and directly related documentation only.

**Interfaces**

- Consumes: `/api` routes from Task 4, public response contracts, and fresh Clerk session tokens.
- Produces: `/sign-in`, `/`, `/inventory`; typed `initializeUser(token: string): Promise<PublicUser>` and `getCurrentUser(token: string): Promise<PublicUser>` frontend API functions. A shared authenticated request helper handles 401, network errors, and invalid response shape without exposing sensitive data.

**Files:** frontend files and frontend API unit tests in the file map; Compose frontend service, Dockerfile development stages/mounts as needed, `.env.example` public settings, lockfile updates, and README full local-startup section.

- [x] Write API-client tests: sends bearer headers, parses valid response, rejects invalid response schema, exposes a safe retryable network failure, and handles 401 without displaying account-ready status.
- [x] Run those tests to confirm failure. Implement typed fetch helpers using contracts; database packages never enter the client dependency graph.
- [x] Add the Compose frontend service on host port 5173 with `/api` proxy to the internal API. Gate API/frontend startup on successful database initialization, configure source hot reload and container-owned dependency volumes, and keep backend secrets out of the frontend environment.
- [x] Add Clerk provider/sign-in and protected routes. After login POST `/api/me`, then GET `/api/me`, and display account-ready status only after the read succeeds. Prevent stale responses from updating state after sign-out/unmount; allow safe retry.
- [x] Use the existing Tailwind utilities and shared theme tokens to add accessible navigation, loading/error states, and clearly labeled Focus/Inventory placeholders. No functional timer/chest is implied. Verify narrow viewport layout and keyboard navigation.
- [x] Run `pnpm test:unit`, `pnpm typecheck`, and `pnpm build`. Inspect the frontend bundle for server imports and secret-bearing configuration. Source placeholders in `.env.example` are not proof of actual secret leakage; do not print real keys during checks.

- [x] Document and verify an exact dependency refresh command for the chosen volume layout, preserving the database volume. Never require deleting developer data to update dependencies.
- [x] Run `docker compose config --quiet` and `docker compose up --build -d --wait`; verify UI hot reload and restore the edit, then recreate containers and confirm data remains. Test a failed initializer in an isolated Compose project: API/frontend must not start ready. Rebuild after a manifest change in a scratch copy to verify dependency refresh. Update README with the now-working one-command startup and troubleshooting.

- [x] **Review and commit gate:** the user reviewed the complete unstaged diff and approved staging/commit. Staged only Task 5 files, inspected the staged patch, and committed with input `add mobile app shell`; the resulting subject is `[CHR-5] add mobile app shell` with no body.


**Verification evidence:** 101 unit tests and 13 real-Postgres integration tests pass. Client/gate stubs failed ten/six cases before implementation. The configured development account completed real Clerk email-based test sign-in; authenticated account sync/read, reload persistence, Inventory navigation/direct load, sign-out, and 390 × 844 overflow checks passed. Sign-in keyboard focus and source hot reload/restoration were verified. The normal full Compose startup succeeded on host port 5174 (5173 remains its default). A manifest/lock change in a scratch checkout installed a new dependency through the retained dependency volume while preserving the same database UUID/catalogue. Full recreation also retained the actual authenticated user UUID and catalogue; a separate failed initializer blocked API/frontend readiness. Configured backend/test secrets are absent from browser assets and the frontend container environment; `.env` is excluded from its image/mounts.

**Execution decisions:** Clerk’s password helper reached `needs_client_trust`, so verification uses its documented/recommended email-based helper, which creates a real development session using the backend secret. No authentication setting was weakened, and no bypass was shipped. Browser app `skipLibCheck` is scoped for published Clerk declaration errors; source remains strict. Dependency volumes contain the shared pnpm virtual store, while immutable workspace symlinks live in the rebuilt image; source-only mounts prevent host dependency/secret contamination. Bugbot is not run per the user’s current instruction.

## Task 6: Smoke tests and real end-to-end verification

**Planned commit:** `[CHR-5] add e2e smoke tests`

**Input to Git (hook adds prefix):** `add e2e smoke tests`

**Commit boundary:** this task’s listed files, tests, dependency/lockfile changes, and directly related documentation only.

**Interfaces**

- Consumes: running application backed by isolated Postgres; Clerk development instance/account and testing helpers.
- Produces: separate signed-out and authenticated Playwright projects, plus root `pnpm test:e2e` running both; no successful exit when authenticated prerequisites are missing.

**Files:** `playwright.config.ts`, `tests/e2e/`, `scripts/check-e2e-env.mjs`, its unit test, Compose runner and orchestration scripts; `Dockerfile.e2e`, `compose.e2e.yaml`, root scripts/dependencies/lockfile, tooling TypeScript/Vitest configuration, and README/spec/architecture/plan updates.

- [x] Add the authenticated preflight and unit-test absent Clerk/test-user settings: nonzero exit, required variable names, no secret values. Add a signed-out-only mode that omits the dedicated account email without implying full acceptance.
- [x] Run the preflight test RED before implementing the checker, then GREEN after implementation.
- [x] Add a Playwright auth-setup project using Clerk's supported email helper and a real development session; use a real Chromium test image with the project's exact Node/pnpm pins.
- [x] Add signed-out smoke coverage for sign-in, unauthenticated API 401, protected direct route loading, and the 390 × 844 layout.
- [x] Add authenticated smoke coverage for account readiness, POST/GET identity equality, reload persistence, direct Inventory route loading, and mobile width.
- [x] Run tests before any UI corrections; the authenticated and signed-out flows passed without product UI changes.
- [x] Run `pnpm test:e2e` against a uniquely named isolated Compose project. All four signed-out/setup/authenticated tests passed. Run `pnpm test:e2e:signed-out` with `E2E_CLERK_USER_EMAIL` empty; its public-route test passed. Both projects removed only their own database/dependency volumes.

- [ ] **Review and commit gate:** present this task’s complete unstaged diff, including untracked files, and wait for the user to explicitly confirm review is complete. Do not use `git add -N` without permission. Then stage only this task’s intended changes, inspect the staged diff, and create exactly one commit with subject input `add e2e smoke tests`. Verify the resulting subject is exactly `[CHR-5] add e2e smoke tests` and has no message body. If review is pending, leave the task uncommitted.

The Playwright service uses a separate Compose project and project-scoped Postgres volume. Its test runner shares the frontend's network namespace so Chromium can use `http://localhost:5173`; the API allowlist continues to validate that exact local origin. The API and E2E runner receive Clerk's backend key; only the runner receives the dedicated account email, and the frontend receives only the publishable key. Signed-out tests have no Clerk setup dependency; authenticated tests use a separate setup project and stored test session. `Dockerfile.e2e` starts from the pinned Playwright browser image and installs Node 24.20.0 in a private prefix, preserving the workspace engine pin.

**Verification evidence:** frozen pnpm install, zero-warning lint, strict TypeScript typecheck, 103 unit tests, 13 isolated Postgres integration tests, 37 hook tests, and production Vite build all pass. The authenticated Playwright run passes all 4 tests, including a real Clerk sign-in, persisted account ID across reload, inventory loading, and 390 × 844 width. The signed-out-only run passes with the account email explicitly empty. Preflight unit tests pass for missing config and assert that a sentinel secret is never printed. The E2E Docker project removes its uniquely named containers, volumes, and network on success; the existing `chronostasis` development app remains running with its original volumes.

## Task 7: Verified architecture and operational documentation

**Planned commit:** `[CHR-5] document architecture`

**Input to Git (hook adds prefix):** `document architecture`

**Commit boundary:** the listed documentation files only; no production code or dependency changes.

**Interfaces**

- Consumes: verified implementation and recorded command outcomes from Tasks 1–6.
- Produces: accurate operational documentation and a reviewable documentation-only commit; CHR-5 remains pending final reviews and completion approval.

**Files:** README.md, ARCHITECTURE.md, AGENTS.md, design spec and this plan.

- [ ] Write README setup and troubleshooting from the actual tested commands, including Docker-only operation, optional host pnpm, Clerk setup, data retention/reset, migrations, seeds, tests, and hooks.
- [ ] After implementation verification, finalize the existing `ARCHITECTURE.md` to describe actual workspace/runtime/auth/data/test flows, the Tailwind/Vite styling pipeline, and future hosting boundaries. Do not describe undeployed infrastructure as live.
- [ ] Finalize AGENTS.md with actual commands and documentation upkeep. Preserve commit review, subagent permission, subject length excluding prefix, rewriting provenance, and PR restrictions.
- [ ] Review all documentation for ticket-induced changes; mark design decisions changed during execution and checkbox states honestly. Record omitted/deferred scope and credentials-dependent verification.
- [ ] Run `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration`, `pnpm test:hooks`, `pnpm test:e2e`, and `pnpm build`, plus clean Compose startup, restart/persistence, and initializer-failure checks. Record exact outcomes. Do not invoke destructive database resets against developer data.

- [ ] **Review and commit gate:** present this task’s complete unstaged diff, including untracked files, and wait for the user to explicitly confirm review is complete. Do not use `git add -N` without permission. Then stage only this task’s intended changes, inspect the staged diff, and create exactly one commit with subject input `document architecture`. Verify the resulting subject is exactly `[CHR-5] document architecture` and has no message body. If review is pending, leave the task uncommitted.

## Final ticket acceptance (not an additional commit task)

- [ ] Ask the user for permission to run Bugbot and Security Review. Once authorized, run both; resolve findings or obtain explicit user ignores. Rerun affected checks and review fixes within the granted permission.
- [ ] If review requires code changes, update the plan with a new one-commit corrective task and its prepared subject before implementing it, or amend the owning current-agent commit only within the AGENTS.md provenance and unstaged-review rules. Do not silently squash unrelated tasks or rewrite user/pushed commits.
- [ ] Verify the actual commit sequence matches the task boundaries and that every subject has exactly one `[CHR-5]` prefix. No staging or commit is authorized simply because the plan names a subject.
- [ ] Confirm all required checks pass and all findings are resolved or explicitly ignored. Request explicit user approval of ticket completion. Do not create or open a PR unless explicitly requested.

## Self-review and acceptance mapping

- Ticket workflow and hook: Task 1; available before the first planned commit.
- Strict workspace tooling and Tailwind integration/CSS migration: Task 2; additional test commands arrive with their owning implementations.
- Database: Task 3; normalized users/items/chests/eligibility schema, additive migrations, idempotent catalogue seeds, foreign-key/composite-key tests, and persistent local Postgres.
- API/auth/runtime adapters: Task 4; real auth enforcement, safe failures, adapter parity, and internal API service.
- Complete Docker Compose and mobile frontend connectivity: Task 5; startup ordering, hot reload, dependency refresh, persistence, initialization failure, and authenticated POST/GET flow.
- Playwright smoke coverage: Task 6; real Clerk sign-in and no silently skipped acceptance.
- Current architecture and finalized rules: Task 7; `ARCHITECTURE.md` starts as an explicitly labeled current/planned overview and is finalized after implementation verification.
- Each of the seven tasks contains one prepared commit subject, scoped file ownership, verification steps, and its own permission-gated commit checkpoint. Directly related documentation is included in each task; final acceptance is not an extra empty commit.
- Deployment, PWA/native packaging, and product functionality remain deferred.

Recommended execution: native execution in this session after user review. The design builder check is a planning check, not the final Bugbot/Security Review gate. No implementation-review permission is assumed from this plan.

## Task 3 chest extension verification

Seven new catalogue tests failed before the extension and then passed; that checkpoint had 13 Postgres integration tests and 25 unit tests. The tests cover foreign keys, duplicate pairs, restricted deletion, cross-type eligibility, reseeding preservation, and forced seed failure rollback. Security Review is skipped for the current review/commit step at the user’s request. Dedicated Bugbot type is not exposed; the independent review uses the Bugbot instructions and is reported as a fallback.


Task 3 follow-up: independent bug review identified one pg query-parameter destination override. Three regression cases failed before the fix; all 29 unit tests and 13 real-Postgres integration tests now pass. The reviewer confirmed the finding resolved. Lint, type checking, and production build pass. The latest session-provided Git instructions require an imperative subject without a Conventional Commit type and a 36-character total limit; the current Task 3 subject is therefore `[CHR-5] bootstrap local postgres` (input `bootstrap local postgres`). Earlier prepared subjects above record the previously approved convention.
