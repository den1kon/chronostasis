# Chronostasis

A mobile-first focus application where completed sessions will unlock chests containing one collectible item.

## Bootstrap status

CHR-5 is in progress on `maintenance/CHR-5`. The ticket workflow and commit hook are committed. The TypeScript workspace and React/Vite/Tailwind shell are committed (`cd62a97`). Task 3 has a verified local Postgres/user/item foundation. Its normalized chest catalogue is implemented with an additive migration, transactional seeds, and relational-constraint tests. Task 3 passed the authorized independent bug review after fixing its single finding; Security Review was skipped for this step as requested. Task 3 is committed as `7dc32f0`. Task 4 implements shared authenticated API handlers, local/Vercel adapters, and the internal API container; these changes are pending unstaged review. Frontend sign-in and browser tests remain later tasks. Deployment is a separate ticket.

- [Design specification](docs/superpowers/specs/2026-10-23-chr-5-bootstrap-design.md)
- [Implementation plan](docs/superpowers/plans/2026-10-23-chr-5-bootstrap.md)
- [Repository instructions](AGENTS.md)
- [Current and planned architecture](ARCHITECTURE.md)

## Local development

Use Node.js **24.20.0** (`.node-version`) and pnpm **10.34.7** (`packageManager` in `package.json`). Engine and peer-dependency checks are strict. Select the pinned Node version with your version manager, and install/select the pinned pnpm version before running commands. Package versions and the lockfile are pinned; TypeScript 6.0.3 is compatible with the configured type-aware lint tooling.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open [the local application](http://localhost:5173). The page is a scaffold: sign-in, focus sessions, chests, and inventory do not work yet. Vite is bound to `0.0.0.0` for the planned container setup, so the development server is accessible on local network interfaces while running.

If port 5173 is occupied or intercepted by another local service, select an available port explicitly:

```sh
pnpm dev --port 5174
```

Vite uses a strict port setting and does not silently choose another port. Restarting or stopping the frontend server does not affect the separately managed Postgres data. The frontend remains disconnected until Task 5 wires Clerk and the API client into the UI.

## Workspace layout

- `apps/web`: React frontend, Vite with the Tailwind CSS plugin, and separate browser/tooling TypeScript configurations.
- `apps/api`: local Node HTTP runtime for the shared API.
- `packages/api`: server configuration, Clerk token verification, shared Request/Response handlers, and local/Vercel adapters.
- `packages/contracts`: Zod public-response schemas and their inferred TypeScript types.
- `packages/db`: server-only Drizzle schema, repository, connection configuration, migrations, seeds, and persistence tests.
- `scripts`: Git-hook processor/installer/tests and the isolated Docker integration-test runner.
- Root configuration: shared strict TypeScript settings, ESLint, Vitest, workspace/package-manager configuration, and the lockfile.
- `docs/superpowers`: the CHR-5 design and implementation plan.

Browser code may not import server API/database packages or use Node globals. Runtime output, dependencies, secrets, and local execution scratch files are excluded from Git; `.dockerignore` also excludes them from future Docker build contexts.

## Local Postgres and migrations

Prerequisite: Docker with Compose and a running Docker daemon. Docker images pin Node 24.20.0 and Postgres 17.11 by digest; pnpm 10.34.7 is installed inside the development image. Application processes run as the image's non-root `node` user. Host pnpm is optional for the Docker-only setup.

Copy the environment example for reference:

```sh
cp .env.example .env
```

Start the current Compose setup:

```sh
docker compose up --build
```

This starts Postgres, the one-shot migration/seed initializer, and the internal API. Fill in the Clerk settings described below before starting the API. Initialization waits for database health, migrates and seeds, then exits successfully; the API starts only after that success. The API and database have no host-published ports. The frontend container arrives in Task 5; `pnpm dev` still shows the disconnected scaffold. To start only the database without Clerk settings, use `docker compose up --build db-init`.

The development database uses the internal hostname `db`, database/user/password `chronostasis`, and a persistent project-owned named volume. These are local fixtures, not deployment credentials. No database port is published to the host. Compose deliberately fixes its database destinations: an exported host `DATABASE_URL` cannot redirect its initializer toward another database. Deployment and Neon resources are a separate ticket.

Run the initializer again safely, or inspect the database:

```sh
docker compose run --rm --build db-init
docker compose exec db psql -U chronostasis -d chronostasis
```

For individual migration/seed commands after the image has been built:

```sh
docker compose run --rm db-init pnpm db:migrate
docker compose run --rm db-init pnpm db:seed
```

`pnpm db:generate --name <description>` generates SQL/snapshot artifacts from `packages/db/src/schema.ts` without a database connection. Review and version these artifacts with the schema change. `pnpm db:migrate` and `pnpm db:seed` also work on the host if you explicitly supply a reachable PostgreSQL `DATABASE_URL`. Host commands do not automatically load `.env`; Compose-internal hostnames are not reachable from the host without an intentional port override. `MIGRATION_DATABASE_URL` is optional and falls back to `DATABASE_URL`; it selects a direct connection for migrations. Clerk configuration is not needed for any database command.

The initial foundation tables are `users` (UUID identity, unique Clerk subject, timezone-aware creation/update timestamps) and `items` (stable catalogue ID/name). The catalogue seed upserts Rusty key, Copper ring, Blue gem, and one Basic chest linked to all three eligible items. Repeated execution does not duplicate catalogue rows or remove later definitions/links. User initialization uses a single conflict-safe SQL upsert; returning users retain their UUID, including concurrent requests. Hosted connections enforce certificate verification; local Compose/loopback connections use the local non-TLS server. Pools are bounded and one-shot commands close them on completion/failure.

### Normalized chest catalogue

Task 3 adds `chests` for reusable chest types and `chest_items` for eligible loot. The seed creates one type, `basic-chest` / Basic chest, linked to the three initial items. Chest names stay in `chests`, item names in `items`; the junction stores only foreign keys and its composite primary key. The same item may belong to multiple chest types, and more chest types can be added without changing the schema.

The three links define possible rewards, not three contents granted on opening. The later opening feature will award exactly one eligible item. Ownership, opening history, and reward selection are not implemented by the catalogue. The additive `0001_chest_catalogue.sql` preserves the original user/item migration. Transactional `seedCatalogue` replaces item-only seeding; foreign keys restrict deletion of referenced definitions and the composite key rejects duplicate links. Integration tests cover these constraints, shared eligibility, reseeding, and rollback.

Stop/recreate containers while retaining data:

```sh
docker compose down
docker compose up --build
```

`docker compose down --volumes` also deletes the development database and should be used only for an intentional data reset. It is never part of integration-test cleanup. After changing dependencies or source at this stage, rebuild the image; source mounts/hot reload for containerized application services are added with those services.

If initialization fails, fix the database settings/service and rerun `docker compose run --rm --build db-init`. The initializer exits nonzero and does not continue to seeds after a migration failure. Error messages omit connection credentials. If the Docker daemon is unavailable or inaccessible, restore daemon access before retrying; avoid changing another project's containers or port forwards.

## Database integration tests

```sh
pnpm test:integration
```

This command creates a unique `chronostasis-test-<id>` Compose project, builds the development image, waits for its separate `db-test` service, and runs Vitest against `chronostasis_test`. It removes only that invocation's test containers/network/volumes on success or failure. It never resets or attaches the normal development volume. To run unit tests without installing host Node/pnpm:

```sh
docker compose run --rm --build db-init pnpm test:unit
```

That example runs unit tests in the application image; integration tests use the dedicated host runner above so their project and cleanup stay isolated. For a manual integration session, use a separately named Compose project with the `test` profile and clean up that project's volumes afterward; do not enable its profile under the normal development project and call that isolated.

The integration suite requires an explicit `TEST_DATABASE_URL`, a local/loopback host or `db-test`, and the exact database name `chronostasis_test`. It refuses the normal `db` hostname, remote hosts, other database names, and a destination equal to `DATABASE_URL`/`MIGRATION_DATABASE_URL`. The Compose test service supplies its isolated URL automatically. Tests apply migrations idempotently and remove only the unique users they created; no truncate, schema reset, or database drop is performed.

## Clerk and the API

Create a **Development** application named Chronostasis in the [Clerk Dashboard](https://dashboard.clerk.com/). Start with email/password; social providers can be enabled later. From **API keys**, copy the development publishable and secret keys. From **Domains**, copy the Frontend API URL for the same instance. Put the values only in the ignored root `.env` file:

```dotenv
VITE_CLERK_PUBLISHABLE_KEY=pk_test_your_key
CLERK_SECRET_KEY=sk_test_your_key
CLERK_ISSUER=https://your-instance.clerk.accounts.dev
CLERK_AUTHORIZED_PARTIES=http://localhost:5173,http://localhost:5174
API_PORT=3001
```

`CLERK_ISSUER` is the Frontend API origin, not `api.clerk.com` or the Account Portal URL. Authorized parties are comma-separated frontend origins with no paths/wildcards; include the actual Vite port. Only the publishable key is browser configuration. The API container receives only the server variables it needs; the secret is never added to a `VITE_` variable, build argument, or image. This integration uses Clerk's backend SDK with the secret key to retrieve verification keys, so a separate `CLERK_JWT_KEY` is not required.

The API serves:

- `GET /api/health`: database probe, returning 200 or safe 503.
- `POST /api/me`: verify a Clerk session bearer token and initialize its user idempotently. Request-body identity is ignored.
- `GET /api/me`: verify the same identity and read the persisted user, or return 404 before initialization.

Missing, malformed, expired, or invalid tokens return 401 before user-repository access. The server verifies the configured issuer, allowed frontend origins, signature, and token lifetime; pending sessions are rejected. JSON user/error responses use `Cache-Control: no-store`. Both adapters preserve raw request bytes and enforce a 64 KiB body limit, including chunked bodies; exactly 65,536 bytes is accepted and larger input receives 413. No CORS bypass is added.

Start and probe the containerized API:

```sh
docker compose up --build -d --wait api
docker compose exec api node -e "fetch('http://localhost:3001/api/health').then(async r => console.log(r.status, await r.json()))"
docker compose exec api node -e "fetch('http://localhost:3001/api/me').then(async r => console.log(r.status, await r.json()))"
```

Expect 200 and 401 respectively. Do not print `docker compose config` or container environment dumps when real keys are configured; `docker compose config --quiet` validates without displaying values.

For optional host API development, `pnpm dev:api` loads the root `.env` and listens on `API_PORT` (default 3001). You must supply a deliberately host-reachable `DATABASE_URL`; the Compose-only `db` hostname is not a host connection. Prefer Docker for the current setup. The frontend starts obtaining fresh Clerk session tokens and calling these routes in Task 5; API startup is not proof of a completed browser sign-in flow.

`apps/web/api/health.ts` and `me.ts` are thin future Vercel Function entrypoints backed by the same handlers. Runtime composition is in `apps/web/server/api.ts`, outside the public function directory. The SPA fallback excludes `/api` and all of its descendants, so missing API routes are never rewritten to HTML. Hosted invocation/deployment remains unverified and belongs to the deployment ticket.

## Styling

Tailwind CSS **4.3.3** and its matching official Vite plugin are pinned in the web workspace. `apps/web/vite.config.ts` registers `@tailwindcss/vite`; `apps/web/src/styles.css` imports Tailwind, declares shared color/font tokens with `@theme`, and applies document-level base styles.

Components use Tailwind utilities for layout, spacing, typography, and borders. Reuse the `forest`, `parchment`, `leaf`, and `outline` theme colors instead of duplicating their values in components. The scaffold's earlier CSS selectors have been replaced with utilities. Vite handles generation during development and production builds; no separate Tailwind CLI, PostCSS configuration, or JavaScript Tailwind config is required.

## Commit hook

Prerequisites: Git, a POSIX shell, and Node.js 24. The hook uses Node built-ins and requires no package installation.

Enable the versioned hook explicitly after cloning, from the repository root:

```sh
pnpm hooks:install
```

Before installing workspace dependencies, the equivalent command is `node scripts/install-hooks.mjs`.

The installer sets repository-local `core.hooksPath` to `.githooks`. Re-running it is safe. It refuses to replace another configured hook path or activate an absent/non-executable hook. Installation changes only local Git configuration; it does not stage or commit files. No package lifecycle script installs hooks automatically.

Use a separate branch for each ticket:

- `feature/CHR-1234`
- `bugfix/CHR-1234`
- `maintenance/CHR-1234`

Supply the Conventional Commit subject without the ticket prefix, for example `feat: add timer`. Git's `commit-msg` hook derives the ticket from the branch and records `[CHR-1234] feat: add timer`.

The hook preserves a matching existing prefix and rejects conflicting or duplicate leading ticket prefixes, including after indentation. Malformed ticket names under the three reserved branch categories are rejected. Unrelated branches and detached HEAD are left unchanged. Empty/comment-only messages remain empty so Git can abort the commit; user-authored bodies, comments, and line endings are preserved. The hook reads the configured comment character/string and recognizes the scissors marker; automatic comment-character selection falls back to `#`.

The hook does not enforce Conventional Commit syntax or subject length. Follow `AGENTS.md`: the subject excluding the ticket prefix must be at most 50 characters, and agent-created commits must have no body. Staging and committing require explicit confirmation that the user has completed the unstaged review.

## Current verification commands

```sh
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:hooks
pnpm build
```

Linting uses type-aware strict TypeScript rules, React Hooks rules, browser/server import boundaries, and zero allowed warnings. Type checking uses strict mode, explicit browser types, and additional indexed-access/optional-property checks. The build produces static assets in `apps/web/dist`. Workspace libraries emit declarations into their ignored `dist` folders for TypeScript project references. Source remains strictly checked in every workspace. `skipLibCheck` is scoped to the database and shared API packages because Drizzle and Clerk publish declaration errors involving optional drivers/modules and exact optional properties. Browser/contracts/tooling and the local API app retain declaration checking; runtime tests exercise the affected libraries.

`pnpm test:unit` runs contract and database-configuration tests without Docker. `pnpm test:integration` covers real persistence, concurrent upserts, user isolation, migrations, and seeds with Docker. Empty test suites fail instead of silently passing. Playwright is added in its later task.

The hook suite can also run without installing dependencies:

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

Playwright smoke-test commands will be documented when that tooling is established. `ARCHITECTURE.md` distinguishes the current implementation from planned features and will be finalized after implementation verification.
