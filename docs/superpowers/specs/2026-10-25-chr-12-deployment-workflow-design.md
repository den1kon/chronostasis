# CHR-12: automatic database preparation for deployments

Status: CHR-12 source was released through `main` as `631d636` on 2026-11-02. Production preparation and retry passed; both databases have four migrations with digest `f02712c5bfe18967ae8eb5b1fe2a0741`, no probe table, and catalogue counts 3 items / 1 chest / 3 relationships. Integration retained two users. After the owner replaced the Production Clerk secret and redeployed, Production Account ready survived reload and its application user count became one. Migration-only triggering, non-migrating Previews, additive application, retry stability, failure isolation, cleanup, full local verification, and permitted independent bug/security follow-up reviews passed. Dedicated reviewer types were unavailable. Actual collaborator acceptance was explicitly waived. Final acceptance evidence is recorded in the runbook; explicit owner ticket-completion approval remains.

## Intent

A contributor develops against Docker, pushes a ticket branch, and reviews a Vercel Preview connected to one persistent Integration database. Feature previews do not migrate that shared database. When a reviewed schema change is ready, an owner explicitly redeploys the selected integration-branch commit in Vercel; that deployment applies pending migrations before it is considered ready. Merging reviewed code into `main` prepares the persistent Production database and deploys the application. Neither workflow depends on a developer downloading hosted database credentials or running hosted migrations from a laptop.

## Current state

- `apps/web/vercel.json` invokes the repository deployment runner and ignored-build policy. Ordinary ticket Preview builds and explicit Integration preparation were exercised in Vercel on 2026-10-26; Production preparation, retry, catalogue, and authenticated persistence subsequently passed on 2026-11-02.
- The Neon environment/branch settings were inspected and configured on 2026-10-26, with persistent Preview targeting confirmed by the deployment guard. The intended model is one persistent Neon Integration branch shared by Vercel Previews, plus the persistent Production branch; automatic Neon branch-per-Preview must be disabled.
- `packages/db/src/migrations.ts` applies committed Drizzle migrations. The catalogue seed upserts stable item/chest IDs and inserts missing relationships transactionally.
- Local Compose already migrates and seeds its fixed local database. `pnpm build` and `pnpm verify:all` must remain usable without hosted credentials.
- The API verifies Clerk bearer tokens and creates an application user through authenticated requests. Signing into Clerk alone does not insert a Neon user.
- README and the development guide describe shared Integration Previews and automatic Production/explicit Integration preparation. The detailed owner setup, release, recovery, and evidence record is in [DEPLOYMENT.md](../../DEPLOYMENT.md).

## Approach

Use Vercel's existing Git deployments and Neon integration. Add a hosted build runner that validates the target and checks/builds the application. Production deployments and explicitly triggered deployments of the dedicated `integration` Git branch apply migrations and catalogue data before returning success. Other Preview branch deployments never migrate. Vercel holds the database credentials and executes preparation. All Preview branch builds connect to the persistent Integration database through an explicitly scoped Preview connection pair; keep the managed Neon connection scoped to Production only; the `integration` branch is a Vercel Preview deployment, avoiding a Custom Environment plan requirement.

Alternatives considered: a GitHub Actions/Jenkins release pipeline gives more control over approvals and release ordering but adds credentials, integration coordination, and maintenance; laptop commands require service access and miss the required automatic workflow. The user selected the Vercel approach. Implementation details below are the agreed design; the runbook distinguishes verified Integration evidence from pending Production acceptance.

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

These settings require service access. The observations below distinguish configured settings and exercised behavior from pending Production runtime acceptance. Repository changes alone do not configure accounts or purchase plans.

### Verified setup and remaining runtime checks

Dashboard observations and deployment identifiers are recorded in [DEPLOYMENT.md](../../DEPLOYMENT.md). Vercel tracks `den1kon/chronostasis`, Production tracks `main`, the root is `apps/web`, outside-root files and system variables are enabled, and the committed build/ignore commands control deployment. Node 24.x and pnpm 10.34.7 were observed in build logs. Migration-only commit `a42e563` automatically built with unaffected-project skipping enabled.

Neon has persistent `integration` (default) and `main` (configured Production) branches with separate read-write endpoints in Frankfurt. Automatic database branching is disabled. The managed `NEON` connection is Production-only; Preview uses an explicit Integration pooled/direct URL pair. Both target markers are configured. Integration originated from main before the checked application tables existed; its subsequent application data is independent. Preview target validation and explicit Integration preparation passed. Production target validation and preparation passed in the released build.

Clerk Development settings support Local and Preview; authenticated Preview persistence passed after the owner corrected its Development secret. Preview derives exact authorized origins from Vercel system variables. Production has separate public key/issuer settings and the exact origin `https://www.chronostasis.tech`; all five Clerk DNS records and both certificates were verified. After the owner corrected the Production secret, authenticated runtime persistence passed after reload; main contained one application user. Clerk identities and application `users` rows are separate; signing into Clerk alone does not create an application row.

The Integration action is documented and exercised: select the intended `integration` commit in Vercel, choose Redeploy, and uncheck “Use project's Ignore Build Step.” Preview retention is one day; persistent database branches are independent of deployment retention. Actual collaborator eligibility and Preview access were waived by the owner, not verified. No plan upgrade or collaborator invitation is implied.

## Acceptance and evidence

- Waived by explicit owner request on 2026-11-02: actual collaborator UI change, ticket push, PR, and Preview acceptance. Owner-led non-migrating Preview behavior was verified separately; collaborator eligibility was not verified.
- [x] Disposable additive migration `a42e563` built automatically without preparing either database, then applied only through explicit Integration preparation. Existing catalogue reseeding/count preservation was exercised; no new catalogue entry was introduced by the hosted experiment. Forward cleanup `9186ea7` removed the empty probe; Production remained unchanged.
- [x] Repeat explicit Integration preparation of `a42e563`: migration digest and all row counts stayed identical. Owner SQL results are recorded; successful experiment redeploy URLs/log excerpts were not supplied.
- [x] Local regression tests prove missing credentials, stale unprefixed overrides (including `PGPORT`), pooled-only migration config, mismatched runtime/direct destinations, and Preview pointing at Production fail before children start. The initial hosted wrong-target attempt also failed before child stages; other malformed configurations were tested locally.
- [x] Local runner/preparation tests prove build failure prevents preparation, migration failure prevents seeding, and seed failure returns failure with safe stage reporting. Hosted migration failure at `e8bafe3` failed deployment, preserved database state, and left the previous Ready Integration deployment serving. Hosted seed-failure injection was not performed.
- [x] Concurrent preparation jobs serialize, retries remain safe, and locks release after failure/disconnection, proven on Docker PostgreSQL, including loss of the preparation connection itself.
- [x] Preview health and authenticated initialize/read identity agreement passed, including reload after cleanup. Integration has two application users; individual SQL identity lookup was not performed. Direct navigation to `/api/me` without a bearer token should return 401.
- [x] Release approved source through `main`; Production preparation/retry, catalogue, health, and authenticated account persistence passed. Production started without application users; the owner then initialized one. Existing-user preservation was tested locally and on Integration, not against pre-existing Production users.
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
