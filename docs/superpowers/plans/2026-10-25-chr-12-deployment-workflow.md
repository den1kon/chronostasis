# CHR-12 Deployment Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current checkout. Steps use checkbox (`- [ ]`) syntax for tracking. Do not create a separate worktree.

**Goal:** Vercel feature Previews share a persistent Integration Neon database without migrating it; an explicit Integration deployment and each Production deployment prepare their respective persistent database without developer-held hosted credentials.

**Architecture:** Keep the Vercel/Neon Git integration. Set Neon's default branch to persistent Integration and its configured Production branch to persistent Production; disable automatic branch-per-Preview. Keep the managed connection scoped to Production only and configure Preview's persistent Integration URL pair explicitly. Feature/bugfix/maintenance Previews share Integration and never run migrations. A hosted-only runner validates deployment configuration and checks/builds the app; it invokes database preparation only for Production or an explicitly redeployed `integration` Git branch. Preparation serializes migrations and catalogue seeding on a dedicated PostgreSQL connection. Ordinary builds and Docker development keep their current behavior.

**Tech Stack:** Node.js, pnpm workspaces, TypeScript/GTS, Vite, Vercel Functions, Neon PostgreSQL, node-postgres, Drizzle, Vitest, Docker Compose, Clerk.

**Spec:** [CHR-12 design](../specs/2026-10-25-chr-12-deployment-workflow-design.md).

**Status:** Tasks 1–3 are committed as `5a134a3`, `58049bb`, and `8436c71`. Subsequent rollout documentation updates remain unstaged for user review. The full local gate passed after fixes on 2026-10-26. Both permitted independent reviewer agents completed follow-up reviews with no remaining actionable findings; dedicated Bugbot/Security Review agent types were unavailable. Vercel/Neon settings, Clerk DNS/certificates, and separate Clerk environment entries were configured through the dashboards. Production secret verification and hosted deployment acceptance remain pending; see the runbook's evidence table.

## Global Constraints

- Work in `maintenance/CHR-12` in the existing checkout. Preserve unrelated untracked `.agents/`, `skills-lock.json`, and `compose.dbeaver.yaml`.
- Use Node.js `24.20.0` and pnpm `10.34.7` locally; `pnpm install --frozen-lockfile`. Preserve the hosted Node range `>=24.20.0 <25`.
- GTS is authoritative. No new runtime packages should be necessary: reuse pg, Drizzle, tsx, and Node APIs.
- Keep implementation changes unstaged at each task boundary; ask for review and wait for explicit unstaged-review approval before staging or committing. Verify the staged diff contains only that task. No PR creation without an explicit request.
- Each task is one planned commit, with exactly one ticket prefix, at most 36 subject characters, and no commit body. Prepared subjects below are not permission to commit.
- Hosted preparation must use a validated direct endpoint; no local credential files, schema generation, resets, or demo users. Feature Preview builds never prepare databases. Integration/Production hosted preparation must be target-validated. Local `pnpm build` and `pnpm verify:all` must never acquire hosted database dependencies.
- No service configuration changes, purchases, or production database writes as part of writing this plan. Record owner setup and hosted acceptance as pending until observed.

## Review Focus

1. Old unprefixed overrides or missing webhook credentials must fail before writes, rather than silently use production (Task 2).
2. Concurrent/retried preparation must release locks on failures and avoid duplicate catalogue rows (Task 1).
3. Feature Preview builds must skip preparation; explicit `integration` redeployments and `main` Production deployments must use their distinct validated targets (Task 2).
4. Invocation from `apps/web` versus repository root, and build failure, must not change ordering or target selection (Task 2).
5. A matching runtime hostname alone must not hide a different direct endpoint, port, database, or pooled migration URL (Task 2).
6. A successful build cannot prove collaborator deployment eligibility, Clerk token acceptance, or the database inspected in Neon; record real hosted evidence (Task 3).

## File map

- `packages/db/src/preparation.ts`: reusable database preparation on one physical connection and a bounded session lock.
- `packages/db/src/prepare.ts`: command entrypoint, configuration loading, stage messages, safe failure reporting.
- `packages/db/src/client.ts`: shared narrow database-operation type, allowing both pool-backed runtime and client-backed preparation.
- `packages/db/src/migrations.ts`, `packages/db/src/seeding.ts`: accept the shared operation type; preserve existing behavior.
- `packages/db/package.json`, root `package.json`: `db:prepare` commands; root also gets `deploy:build`.
- `packages/db/src/preparation.test.ts`, `packages/db/tests/preparation.integration.test.ts`: orchestration failures and real PostgreSQL concurrency/retry/cleanup coverage.
- `scripts/deployment-env.mjs` and `.d.mts`, `scripts/deploy-build.mjs` and `.d.mts`: pure hosted target policy and sequential process runner; ordinary Preview builds use Integration runtime credentials without preparation, while only an explicitly redeployed `integration` branch and Production prepare databases.
- `scripts/ignore-vercel-build.mjs`: Vercel Ignored Build Step policy that skips automatic Preview deployment of the `integration` branch while allowing other Preview branches and Production; dashboard redeploy can bypass the rule.
- `scripts/deployment-env.test.ts`, `scripts/deploy-build.test.ts`, `scripts/ignore-vercel-build.test.ts`: policy, ignored-build, and process-boundary tests using existing Vitest discovery.
- `apps/web/vercel.json`: wire only the hosted build runner.
- `README.md`, `docs/DEVELOPMENT.md`, `ARCHITECTURE.md`, new `docs/DEPLOYMENT.md`: concise onboarding, complete owner setup, data flow, release/recovery, troubleshooting, and hosted evidence.
- This spec/plan: maintain proposed/implemented/verified status and task progress. Review historical CHR-5/CHR-7 docs for conflicting current instructions; annotate superseded behavior where necessary without rewriting historical evidence.

### Task 1: serialize database preparation

**Prepared subject:** `[CHR-12] serialize database setup`

**Hook input:** `serialize database setup`

**Files:** database preparation/client/migration/seed sources and tests from the file map; root/database manifests; `docs/DEVELOPMENT.md` database-command section.

**Interfaces:**
- Add `DatabaseOperations = {orm: NodePgDatabase<typeof schema>}` in `client.ts`; preserve the existing pool-backed `Database` return type for runtime users. Update `migrateDatabase(database: DatabaseOperations): Promise<void>` and `seedCatalogue(database: DatabaseOperations): Promise<void>` without changing SQL behavior.
- Add `prepareDatabase(connectionString: string): Promise<void>` in `preparation.ts`. It owns a dedicated `pg.Client`, wraps it in Drizzle with the existing schema, and calls existing migration/seed functions through the narrow type.
- Workspace `db:prepare` runs `tsx src/prepare.ts`; root `db:prepare` delegates through pnpm. The command uses `readDatabaseEnv(process.env).migrationDatabaseUrl`. Task 2 supplies validated child configuration for hosted use.

- [x] Write focused failing tests for migration-before-seed ordering; migration failure skips seed; seed failure propagates; safe stage messages do not include synthetic credential/SQL secrets. Mock the external DB boundary only where failure injection is needed.
- [x] Run the focused preparation tests and confirm the expected missing implementation failure.
- [x] Implement preparation with the existing TLS policy and one pinned client. Set a 60-second lock wait limit, acquire session advisory lock `(1128813105, 12)`, migrate, seed, unlock, and close in `finally`. Preserve the primary failure if cleanup fails. Do not wrap the whole operation in an outer transaction: migration and seed code own their transactions.
- [x] Add real Docker integration cases for repeat preparation, preservation of user and catalogue data, lock waiting, concurrent preparation, timeout, failure cleanup, and disconnect cleanup.
- [x] Document `db:prepare` as the combined internal preparation command, with catalogue-only data and safe retry behavior. Keep Compose's existing local startup intact.
- [x] Run focused preparation tests, Docker integration tests, typecheck, lint, and format check; existing migration/catalogue tests passed.
- [x] Present the unstaged Task 1 diff, receive explicit review approval, verify the staged diff, and commit as `5a134a3` with subject `[CHR-12] serialize database setup`.

### Task 2: prepare Integration and Production databases

**Prepared subject:** `[CHR-12] prepare hosted databases`

**Hook input:** `prepare hosted databases`

**Files:** hosted scripts/tests, root `package.json`, `apps/web/vercel.json`, integration ignored-build policy and tests, and directly related Vercel sections in README/development guide/architecture.

**Interfaces:**
- `readDeploymentEnv(env: Readonly<Record<string, string | undefined>>): {environment: 'preview' | 'production'; branch: string; databaseTarget: 'integration' | 'production'; prepareDatabase: boolean; databaseUrl: string; migrationDatabaseUrl: string}` in `scripts/deployment-env.mjs`; pure, without I/O or secret-valued errors. A Preview on branch `integration` prepares Integration; other Preview branches use explicitly configured Preview Integration credentials without preparation. Production maps to the configured Production branch and prepares.
- `runDeployment({env, run}): number` exported from `scripts/deploy-build.mjs`; `run` is an injected synchronous process boundary receiving executable, argument array, and spawn options and returning status/error/signal. The CLI uses `spawnSync`, sets `process.exitCode`, and must not execute when imported by tests.
- `shouldIgnoreDeployment(env): boolean` in `scripts/ignore-vercel-build.mjs`; automatic Preview builds from `integration` are skipped, while Production and other Preview branches build. The deployment runner prepares Integration only when branch is `integration`, which should occur through the dashboard redeploy with “Use project's Ignore Build Step” unchecked.
- Root `deploy:build` runs `node scripts/deploy-build.mjs`; Vercel build command becomes `node ../../scripts/deploy-build.mjs`. Ordinary `build`, verification, and Docker commands remain independent.

- [x] Write table-driven tests for Neon aliases, missing/blank/placeholder values, conflicts, hosted override rejection, URL safety, pooled/direct identity, target markers, branch/environment selection, and ignored-build behavior; assert safe errors.
- [x] Run the focused policy suite before implementation and observe missing-module failures.
- [x] Implement target validation before children, including pooled/direct host normalization, database/port comparison, both markers, and rejection of unsupported environments, missing branch metadata, local hosts, and malformed URLs.
- [x] Implement ignored-build behavior and verify the dashboard redeploy bypass in current Vercel documentation.
- [x] Implement the sequential hosted runner, safe stage logs, explicit DB preparation child URLs, early failure handling, and import-safe CLI.
- [x] Test target selection and process failures with injected runners; invoke the CLI from repository root and `apps/web` with a fake executable and no hosted calls.
- [x] Wire Vercel build/ignore commands and root `deploy:build`; ordinary root build remains separate.
- [x] Replace current manual hosted migration guidance in README, the development guide, and architecture with the automatic Production/explicit Integration flow.
- [x] Run focused script tests, `pnpm test:unit`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and `pnpm build`. Do not run `deploy:build` against live services as local verification.
- [x] Present Task 2 and subsequent comment-policy/comment additions, receive explicit review approval, inspect the staged diff, and commit as `58049bb` with exactly one ticket prefix and no body.

### Task 3: document and validate the contributor release flow

**Prepared subject:** `[CHR-12] finish deployment flow`

**Hook input:** `finish deployment flow`

**Files:** new `docs/DEPLOYMENT.md`, README/development/architecture, this spec/plan, affected historical docs, and review fixes/regressions in database preparation and deployment configuration. No unrelated policy or skill changes. The final task includes the three review findings so its commit covers the validated release flow.

**Interfaces:** the deployed runner/commands from Tasks 1–2; dashboards configured by the owner; manual hosted evidence tied to deployment and Neon branch identifiers, without credentials.

- [x] Write the owner runbook with distinct setup and daily release steps, both host markers, shared Integration behavior, and the selected-commit manual redeploy sequence.
- [x] Explain personal-account, organization/team, and public-fork deployment permissions; require real collaborator Preview evidence before deciding on account changes.
- [x] Document Clerk Production configuration for `chronostasis.tech`, exact issuer/key/origin settings, and the distinction between the Vercel domain attachment and Clerk verification.
- [x] Add stage diagnostics, safe database identity inspection, parent-data/retention guidance, rollback compatibility, and the authenticated UI acceptance procedure.
- [x] Review all tracked Markdown documents and relevant deployment/auth/database references; link current guides and annotate historical CHR-5/CHR-7 records.
- [x] Install from the frozen lockfile and run `pnpm verify:all` with Node 24.20.0 and pnpm 10.34.7: formatting, lint, typecheck, 172 unit tests, 21 database integration tests, 38 hook tests, four authenticated/setup/signed-out Playwright tests, and production build passed after review fixes. Docker and registry access required sandbox escalation; the escalated runs passed.
- [x] Obtain user permission and run independent bug/security reviewer agents, resolve all three findings, rerun the full gate, and obtain clean follow-up reviews. Dedicated Bugbot/Security Review agent types are not exposed by this runtime; the reviews used independent general agents in those roles.
- [ ] Present the unstaged Task 3 diff, wait for explicit review approval, inspect intended staged files, and commit only with authorization. No automatic push or PR creation.

**Review findings resolved in Task 3:** add safe handling for asynchronous preparation-client errors and a real disconnect regression; match pg's `decodeURI` database-name semantics; reject inherited `PGPORT` before any child starts. Each unit regression failed before the corresponding fix and passed afterward. A follow-up formatting run exposed TypeScript callback-flow narrowing in inline failure checks; a closure helper preserves the event-updated failure and passes lint. The final full gate passed all eight stages. All new implementation changes remain unstaged pending review.

## Task 4: pin nested hosted database preparation

**Prepared commit subject:** `[CHR-12] pin preparation pnpm`

**Commit hook input:** `pin preparation pnpm`

- [x] Diagnose the first explicit Integration preparation attempt: Vercel's ambient pnpm 10.28.0 was selected by the nested root script despite the outer Corepack command using pinned pnpm 10.34.7.
- [x] Prefix the root `db:prepare` script with `corepack` so its package dispatch uses the repository's pinned version, matching the existing build script.
- [ ] Verify the change, obtain unstaged-diff review approval, and commit the fix with directly related rollout documentation.
- [ ] Update Git `integration` to the reviewed fix and repeat its explicit Preview deployment; verify migration/seed logs and repeat preparation for retry safety.

## Hosted rollout and acceptance (external evidence, not an extra Git commit)

- [x] Record observed persistent Neon branches, disabled automatic branching, saved hostname guards, Vercel project settings, Clerk DNS/certificates, and separate Clerk environment scopes in the runbook. Canonical application origin is `https://www.chronostasis.tech`; the bare domain redirects there. This records dashboard setup only, not runtime acceptance.
- [ ] Owner verifies the Production Clerk secret; verify both environment key triplets through authenticated deployments. Preview secret presence/scope is confirmed, not its hidden value.
- [ ] Owner confirms the runbook's external settings, including collaborator eligibility, Neon default branch set to Integration, configured Production branch, shared Preview target, disabled branch-per-Preview provisioning, both markers, ignored-build rule, manual integration-branch redeploy action, and Clerk setup. Do not silently change account plans or domains.
- [ ] Deploy a feature Preview and verify it connects to the persistent Integration branch without running database preparation. Record deployment identifier and safe Integration endpoint identity. Verify health and authenticated UI user persistence in the shared database.
  - First owner attempt: pushed committed CHR-12 head `8436c71`; Vercel deployment `DTynKq74EbuF3cp9eHdE4QW97SoU` failed the Integration hostname guard before child stages or database preparation. Investigate saved guard values and injected Preview credentials before retrying. Default-branch selection alone is not evidence of connection retargeting. After scoping the managed connection to Production and owner entry of explicit Preview URLs, retry `AMFWvzgekiyDShKQL7MsFAjT4kQg` reached Ready, passed target validation, ran typecheck/build without preparation, and displayed Clerk Development sign-in. Browser `/api/health` returned `{"status":"ok"}` with `cache-control: no-store`. Authenticated persistence and actual collaborator acceptance remain pending.
- [ ] With Vercel's Skip deployments setting enabled, push an owner-authorized feature-branch commit containing only a harmless additive migration, with no application, catalogue, or configuration edits. Verify Vercel automatically creates and builds its Preview rather than skipping it as unaffected. Record the commit SHA, migration path, and deployment ID; confirm neither database changes because feature Previews do not prepare databases. If skipped, investigate workspace dependency detection and disable the setting as a fallback before repeating the check.
- [ ] Explicitly redeploy the integration-branch commit and inspect named preparation stages. Record deployment/commit identifier and Neon Integration branch identifier. Verify schema/data changes there, while Production remains unchanged.
- [ ] After owner-approved merge to `main`, verify initial production migration/catalogue setup without any production URLs on a laptop. Retain existing application users; check authenticated UI/network behavior on the supported main origin.
- [ ] Have an actual collaborator open a disposable follow-up PR containing a harmless additive migration and catalogue change. Its Preview must not apply the migration. Explicitly deploy that reviewed commit through the integration branch, verify Integration changes while Production stays unchanged, and confirm the Preview sees the new shared schema. Repeat preparation to verify retry safety. No PR or database writes on behalf of the user unless explicitly authorized.
- [ ] Merge that reviewed acceptance PR with authorization; verify production applied its migration and seed independently. Remove test-only objects with a reviewed follow-up migration if appropriate, never by resetting production.
- [ ] Observe a failed Integration preparation on a disposable additive migration and verify it fails deployment without touching Production. Verify ordinary Preview builds remain non-migrating. Keep all unobserved conditions explicitly pending.
- [ ] Record the evidence and obtain the user's explicit ticket-completion approval. Merged code alone does not prove external settings or collaborator acceptance.
