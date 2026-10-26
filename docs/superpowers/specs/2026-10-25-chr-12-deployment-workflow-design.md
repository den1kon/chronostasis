# CHR-12: automatic database preparation for deployments

Status: Tasks 1–3 are committed as `5a134a3`, `58049bb`, and `8436c71`. Subsequent rollout documentation updates remain unstaged. The full local gate passed after fixes on 2026-10-26. Permitted independent bug/security reviewer agents completed follow-up reviews with no remaining actionable findings; dedicated Bugbot/Security Review agent types were unavailable. Dashboard setup is recorded in the deployment runbook; Production secret verification and hosted runtime acceptance remain pending. The canonical application origin is `https://www.chronostasis.tech`, with a redirect from the bare domain; Clerk's authentication domain remains `clerk.chronostasis.tech`.

## Intent

A contributor develops against Docker, pushes a ticket branch, and reviews a Vercel Preview connected to one persistent Integration database. Feature previews do not migrate that shared database. When a reviewed schema change is ready, an owner explicitly redeploys the selected integration-branch commit in Vercel; that deployment applies pending migrations before it is considered ready. Merging reviewed code into `main` prepares the persistent Production database and deploys the application. Neither workflow depends on a developer downloading hosted database credentials or running hosted migrations from a laptop.

## Current state

- `apps/web/vercel.json` invokes the repository deployment runner and ignored-build policy. The runner implementation is present but has not yet been exercised in Vercel.
- The Neon integration is connected, but actual environment/branch settings still need verification. The intended model is one persistent Neon Integration branch shared by Vercel Previews, plus the persistent Production branch; automatic Neon branch-per-Preview must be disabled.
- `packages/db/src/migrations.ts` applies committed Drizzle migrations. The catalogue seed upserts stable item/chest IDs and inserts missing relationships transactionally.
- Local Compose already migrates and seeds its fixed local database. `pnpm build` and `pnpm verify:all` must remain usable without hosted credentials.
- The API verifies Clerk bearer tokens and creates an application user through authenticated requests. Signing into Clerk alone does not insert a Neon user.
- README and the development guide describe shared Integration Previews and automatic Production/explicit Integration preparation. The detailed owner setup, release, recovery, and evidence record is in [DEPLOYMENT.md](../../DEPLOYMENT.md).

## Approach

Use Vercel's existing Git deployments and Neon integration. Add a hosted build runner that validates the target and checks/builds the application. Production deployments and explicitly triggered deployments of the dedicated `integration` Git branch apply migrations and catalogue data before returning success. Other Preview branch deployments never migrate. Vercel holds the database credentials and executes preparation. All Preview branch builds connect to the persistent Integration database through an explicitly scoped Preview connection pair; keep the managed Neon connection scoped to Production only; the `integration` branch is a Vercel Preview deployment, avoiding a Custom Environment plan requirement.

Alternatives considered: a GitHub Actions/Jenkins release pipeline gives more control over approvals and release ordering but adds credentials, integration coordination, and maintenance; laptop commands require service access and miss the required automatic workflow. The user selected the Vercel approach. Implementation details below are the agreed design; hosted settings and acceptance evidence remain open.

## Required behavior

### Local, Preview, integration, and main

1. Local development and integration/E2E tests continue to use isolated Docker PostgreSQL. Local builds never prepare a hosted database.
2. Every non-main Preview deployment uses the same persistent Integration database connection. Ordinary feature/bugfix/maintenance branch builds do not run migrations or seed data.
3. The `integration` Git branch is the shared staging application. Configure Vercel's Ignored Build Step to skip automatic deployments from this branch while allowing normal feature Previews and Production. To request Integration preparation, an owner selects the latest `integration` deployment in Vercel, confirms its commit, chooses Redeploy, and disables “Use project's Ignore Build Step” for that redeploy. That build runs configuration validation → app function typecheck → app build → database preparation. Ordinary feature Preview builds must never migrate. Vercel documents that the ignore step can be bypassed for a dashboard redeploy.
4. Production deployments from `main` run configuration validation → app function typecheck → app build → database preparation against the persistent Production branch. A failure stops the sequence and exits nonzero with the named stage. Later platform packaging can still fail after database preparation.
5. Database preparation acquires a database advisory lock, applies pending committed migrations, runs the catalogue seed, then releases the lock. It runs only for an explicitly triggered Integration deployment and Production.
6. The `integration` branch uses a persistent Neon Integration branch. Automatic database branch-per-Preview creation is disabled, as is Production branch creation per deployment. Integration data is never merged into Production.
7. `main` uses the existing persistent Neon Production branch. A fresh deployment from `main` is the release path. Do not promote an existing Preview artifact with its Preview database/auth configuration to Production.
8. Each preparation retry is safe: migrations keep their journal; catalogue upserts do not duplicate rows or erase users and additional definitions. No database reset, schema generation, or `drizzle-kit push` runs in deployment.
9. Because all feature Previews share Integration schema and data, migrations must remain backward-compatible while old Preview code may still run. Test risky migrations on a temporary Neon branch before changing shared Integration; use expand/contract releases for removals.

### Hosted configuration and target validation

- Add root `deploy:build` and database `db:prepare` commands. `apps/web/vercel.json` calls the root hosted runner through `node ../../scripts/deploy-build.mjs`; the runner resolves all child working directories from its own file location.
- The hosted runner requires `VERCEL=1` and `VERCEL_ENV=preview` or `production`. Unknown/custom environments fail explicitly until supported.
- Read `NEON_POSTGRES_URL` and `NEON_POSTGRES_URL_NON_POOLING`; alternatively accept the complete `NEON_DATABASE_URL` / `NEON_DATABASE_URL_UNPOOLED` pair. Require both runtime and direct values. Multiple configured pairs must identify the same destination; reject ambiguity.
- Reject nonempty hosted `DATABASE_URL`, `MIGRATION_DATABASE_URL`, and `PGPORT` rather than letting old local/manual overrides redirect preparation or runtime. `pg` inherits `PGPORT` for URLs with no explicit port; rejecting it preserves the validated default of 5432. The existing local environment precedence remains unchanged.
- Validate PostgreSQL URLs with the existing destination-override protections. Require the runtime/direct endpoints to identify the same database and port after removing the Neon `-pooler` suffix from the endpoint's first DNS label. Match pg's `decodeURI` database-name semantics, preserving reserved-character encodings. The migration endpoint must be direct. Reject local hosts in the hosted runner.
- Add `DEPLOYMENT_PRODUCTION_DB_HOST` and `DEPLOYMENT_INTEGRATION_DB_HOST`, non-secret hostnames containing the respective **direct** Neon endpoints. Require both in Preview and Production. Production must match the production marker; every Preview must match the Integration marker. Reject malformed values and cross-target connections. These guards catch accidental misconfiguration, not malicious changes by trusted contributors.
- Pass validated runtime and migration URLs to the preparation child as explicit `DATABASE_URL` and `MIGRATION_DATABASE_URL`. Do not print URL values, passwords, tokens, raw SQL errors, or full environment dumps. Errors identify the variable/stage and safe error category.
- No CLI installation, `vercel link`, Neon API token, or hosted database URL in a contributor's local `.env` is required for automatic deployments.

### Concurrency and failure handling

Use a dedicated `pg.Client` and a fixed two-key PostgreSQL session advisory lock `(1128813105, 12)`. Wait at most 60 seconds for the lock; on timeout, fail preparation and allow a deployment retry. Run lock acquisition, Drizzle migration, and catalogue seeding on that same physical connection. Preserve certificate verification. Release/close on success and errors; a disconnected process must not leave a permanent lock.

The lock serializes database preparation, not application deployment publication. Older code may serve traffic while a new migration runs. Require additive, compatible changes first and a later release for destructive removals. Failed builds or application rollbacks do not undo applied migrations. Previously deployed migrations must not be edited; recovery is a reviewed forward migration. Stale deployments/repeated seed versions require care: an old upsert can restore an old catalogue name. Treat catalogue removals and other one-time data transformations as versioned migrations, not repeated destructive seeds. Do not manually run independent migration commands against a database while deployment preparation is running.

### Seed policy

The existing basic chest and three items are required reference data and run in every environment. Preserve their stable IDs and repeatable transaction. Do not create mock Clerk identities or demo user records as part of deployment. Future demo fixtures need a separate explicit non-production command and are outside CHR-12.

## Owner setup checklist

These settings require service access and remain unverified until checked in the dashboards and exercised end to end. Repository changes do not configure accounts or purchase plans.

### Vercel

- [ ] Confirm the project tracks `den1kon/chronostasis`, Production tracks `main`, and the Root Directory is `apps/web` with access to workspace files outside that directory enabled.
- [ ] Keep the Node major at 24; hosted Node accepts `>=24.20.0 <25`. pnpm is `10.34.7`; install with the frozen lockfile.
- [ ] Let committed `apps/web/vercel.json` control the build; remove conflicting dashboard overrides. Confirm migrations/shared packages trigger deployments rather than being skipped as unaffected.
- [ ] Configure an ignored-build rule that skips automatic Preview deployments from branch `integration` while allowing other Preview branches and Production. A manual Redeploy of the integration deployment must bypass that rule explicitly; verify the operator can identify and confirm the commit before triggering it.
- [ ] Enable system environment variables, including `VERCEL_ENV`, `VERCEL_URL`, and `VERCEL_BRANCH_URL`.
- [ ] Keep the managed Neon connection scoped to Production only and explicitly configure the persistent Integration URL pair for Preview; disable automatic database branching. Set Neon's default branch to the persistent Integration branch and its configured Production branch to the persistent Production branch. Verify Vercel Preview variables resolve to Integration and Production variables resolve to Production; remove stale manually defined unprefixed database variables and inconsistent Neon aliases. Keep secrets protected.
- [ ] Set `DEPLOYMENT_PRODUCTION_DB_HOST` and `DEPLOYMENT_INTEGRATION_DB_HOST` to their direct endpoint hostnames in Preview and Production. A target endpoint change requires updating its marker and redeploying.
- [ ] Verify a commit from an actual collaborator creates a usable Preview before merging it. Git provider access and Vercel service access are separate; dashboard team/plan rules may apply.
- [ ] Configure preview access so reviewers can open the URL; retain approval for untrusted fork deployments. Approval runs contributor-controlled code with Preview secrets, so approve only trusted changes.
- [ ] Document the Integration migration action: in Vercel, select the latest deployment for branch `integration`, confirm its commit, choose Redeploy, and uncheck “Use project's Ignore Build Step.” Verify the build uses Integration Preview variables. Feature Preview deployments never prepare the database.
- [ ] Verify deployment retention and Preview cleanup. Integration and Production databases persist independently of Preview deployment retention.

Vercel's Git docs distinguish personal-account collaborators from organization/group private repositories. The private-repository author restriction explicitly excludes collaborators on personal Git accounts. Where team restrictions apply, Hobby requires an eligible owner author and Pro supports team members linked to their Git accounts. Public fork PRs may need owner/team authorization. Therefore do not prescribe a paid plan before checking this repository's account type and testing a collaborator push. Merging triggers a production build, subject to applicable author/access rules; who clicks Merge is not sufficient evidence of eligibility. A main deployment after merge never replaces the Preview needed to review the PR beforehand.

### Neon

- [ ] Keep prefix `NEON`; disable automatic database branches for Preview and Production. Configure persistent Integration and Production branches. Set Integration as Neon's default branch and Production as the Vercel integration's configured Production branch, then confirm Preview and Production receive the corresponding credentials.
- [ ] Confirm feature Preview deployments receive the Integration runtime/direct pair and Production receives its own pair. Inspect deployment-scoped metadata, not only project-level environment entries.
- [ ] Confirm Integration and Production branches each have persistent read-write endpoints. Neon's configured Production branch is distinct from its default branch; verify the default is Integration and the Production branch selector points to Production.
- [ ] Choose a safe parent for Integration. Avoid inheriting personal data; use sanitized or schema-only data where supported. Do not assume changing the default parent changes the configured Production branch.
- [ ] Confirm region alignment and branch/compute limits. Integration data is persistent and shared; document its access and reset/reseed policy.

### Clerk

- [ ] Use a matching development publishable key, secret key, and issuer for Local and Preview; give collaborators development access or appropriate development settings and a dedicated E2E account, never hosted production database credentials.
- [ ] Leave `CLERK_AUTHORIZED_PARTIES` unset in Preview. The existing API derives exact allowed origins from Vercel system variables; no per-ticket URL edits are needed.
- [ ] Set explicit, comma-separated origins in Production, without paths or wildcards. Verify the actual domains assigned to `main`, including `https://chronostasis-denikon.vercel.app` and any other alias intentionally supported, rather than assuming old URLs remain active.
- [ ] Verify Clerk Production domain configuration for `chronostasis.tech`, which is already added to Vercel Production. Confirm DNS/domain verification, production keys, issuer, and authorized origin use that host before public release. A Vercel domain attachment alone does not prove Clerk is configured. A development instance can support a personal test deployment with its documented limitations; use a separate Clerk application's development instance for hosted main if identity isolation is required.
- [ ] Verify all three Clerk settings come from the same instance. Clerk identities live separately from the application `users` table; user persistence must be checked through an authenticated application request.

## Acceptance and evidence

- [ ] An actual collaborator changes UI, pushes a ticket branch, opens a PR, and gets a working Preview connected to Integration without local hosted credentials or manual schema commands. Confirm ordinary Preview build does not run migrations.
- [ ] A disposable change adds an additive migration and catalogue update. Confirm the feature Preview build leaves Integration and Production unchanged. Explicitly redeploy the integration-branch commit, verify Integration receives migration/catalogue data, then verify Preview deployments use that shared schema while Production remains unchanged.
- [ ] Repeat Integration preparation and verify no duplicates. Record the visible manual trigger and exact commit it deploys.
- [x] Local regression tests prove missing credentials, stale unprefixed overrides (including `PGPORT`), pooled-only migration config, mismatched runtime/direct destinations, and Preview pointing at Production fail before children start. Hosted exercise remains pending.
- [x] Local runner/preparation tests prove build failure prevents preparation, migration failure prevents seeding, and seed failure returns failure with safe stage reporting. Hosted exercise remains pending.
- [x] Concurrent preparation jobs serialize, retries remain safe, and locks release after failure/disconnection, proven on Docker PostgreSQL, including loss of the preparation connection itself.
- [ ] `/api/health` returns HTTP 200 and `{"status":"ok"}` on the deployed environment. Sign in through the UI and inspect the app's authenticated `/api/me` network request; verify its user in that exact Preview database. Direct navigation to `/api/me` sends no bearer token and should return 401 even when the browser has a Clerk login.
- [ ] Merge approved code into `main`; Production runs preparation against its persistent branch, preserves existing users, and contains the approved catalogue/schema. Verify health and authenticated account persistence there too.
- [ ] Full repository checks pass, Bugbot and Security Review finish after permission, findings are resolved/ignored explicitly, and the user approves ticket completion. External checks remain pending until actually exercised.

## Scope boundaries

CHR-12 automates deployment/database behavior and documents onboarding. It does not implement timer/inventory features, migrate authentication providers, provision service accounts, buy domains/plans, add Jenkins, or implement a second CI deployment system. `chronostasis.tech` is already added to Vercel Production; verify Clerk Production domain configuration against it. Existing `pnpm verify:all` remains the full local acceptance gate; the hosted build is not a replacement for that test suite.

## Sources checked 2026-10-26

- [Neon Vercel-managed integration](https://neon.com/docs/guides/vercel-managed-integration): deployment-specific credentials, optional Preview branching, Production branch selection, and cleanup.
- [Neon branching workflow primer](https://neon.com/docs/get-started-with-neon/workflow-primer): persistent environment branches and isolated temporary test branches.
- [Neon connection pooling](https://neon.com/docs/connect/connection-pooling): pooled runtime versus direct migration connections.
- [Vercel Git deployment rules](https://vercel.com/docs/git): personal-account exception, team rules, forks, production/preview triggers.
- [Vercel build settings](https://vercel.com/docs/project-configuration/project-settings): Ignored Build Step behavior and bypass during a dashboard redeploy.
- [Vercel secret variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables): protected values and build access.
- [Clerk environments](https://clerk.com/docs/guides/development/managing-environments) and [production setup](https://clerk.com/docs/guides/development/deployment/production): Preview development keys and production domain requirements.
