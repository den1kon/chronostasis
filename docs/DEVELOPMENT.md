# Development guide

This guide covers the local workflow for Chronostasis. For service boundaries and data flow, see [ARCHITECTURE.md](../ARCHITECTURE.md).

## Prerequisites and setup

- Node.js 24.20.0 and pnpm 10.34.7 locally (`.node-version` pins Node; `package.json` accepts Node.js >=24.20.0 and <25 to allow compatible 24.x patch updates on managed hosts such as Vercel).
- Docker with Compose for PostgreSQL integration tests and browser E2E tests.
- Python 3.9 or newer for the pinned pre-commit 3.8.0 runner.
- A Clerk development application. Authenticated browser tests also need the dedicated test user described below.

Install dependencies and prepare the local environment:

```sh
pnpm install --frozen-lockfile
cp -n .env.example .env
```

Set `VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `CLERK_ISSUER` in `.env`. Add `http://localhost:5173` to `CLERK_AUTHORIZED_PARTIES`. If using another `WEB_PORT`, add that origin instead. Keep secrets in `.env`; it is ignored by Git. Authenticated E2E also needs `E2E_CLERK_USER_EMAIL` set to a dedicated Clerk development account; `E2E_CLERK_USER_PASSWORD` is optional.

To run the repository hooks, install pre-commit in a local Python environment and enable the shared `.githooks` directory:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
pnpm hooks:install
```

The pre-commit hook checks staged files with the pinned GTS hook. The existing `commit-msg` hook adds or validates the `[CHR-n]` prefix. The installer requires pre-commit to be available before changing Git configuration.

## Start the app with Docker Compose

```sh
docker compose up --build -d --wait
```

Open [http://localhost:5173](http://localhost:5173). Browser requests go to the Vite server, which proxies `/api` to the authenticated Node API; the API uses Drizzle to access PostgreSQL.

Compose services:

| Service | Role |
| --- | --- |
| `deps-init` | Installs locked workspace dependencies into the shared container volume before application startup. |
| `db` | Persistent development PostgreSQL; it is reachable only inside the Compose network. |
| `db-init` | Waits for PostgreSQL, applies migrations, then seeds the catalogue. |
| `api` | Local Node adapter for the shared authenticated API handlers. |
| `web` | Vite development server, published on loopback at port 5173, with hot reload and the `/api` proxy. |
| `db-test`, `test` | Optional isolated PostgreSQL database and Vitest integration runner. |
| `e2e` | Playwright browser runner using its own Compose project and test database. |

Stop services with `docker compose down`; the development database volume remains. Use `docker compose down --volumes` only when you want to delete that data. When package manifests or the lockfile change, rebuild with `docker compose up --build -d --wait`.

## Code and database workflow

The pnpm workspaces are `apps/web` (React/Vite UI), `apps/api` (local Node server), `packages/api` (shared handlers and auth), `packages/contracts` (browser-safe schemas), and `packages/db` (Drizzle schema and persistence). `tests/e2e` contains browser coverage; `scripts` contains verification and hook tooling.

For a database change, edit `packages/db/src/schema.ts`, generate and review a migration, update seed/repository code if needed, then test against the isolated database:

```sh
pnpm db:generate --name add_focus_session
pnpm test:integration
```

Commit a migration with the schema change. Compose applies pending migrations and seeds when its `db-init` service starts. Integration tests create and remove their own Compose project and database volume; they do not reset the development database.

For Vercel, configure the Neon integration with the `NEON_` prefix and enable preview database branches. The integration supplies `NEON_DATABASE_URL` (pooled runtime connection) and `NEON_DATABASE_URL_UNPOOLED` (direct migration connection). The database environment helper prefers explicit `DATABASE_URL` / `MIGRATION_DATABASE_URL` values and falls back to the Neon variables, so Compose and hosted functions use their respective databases.

After linking the checkout to the Vercel project, apply migrations and seed the production catalogue through the Production environment:

```sh
vercel env run -e production -- pnpm db:migrate
vercel env run -e production -- pnpm db:seed
```

These commands are manual; deployments do not run them automatically. Repeat schema migrations for any Neon preview branch that needs a newer schema.

## Format, lint, and test

GTS is authoritative for JavaScript and TypeScript formatting and general lint rules. Run its check or explicit autofix with:

```sh
pnpm format:check
pnpm format:fix
```

`pnpm lint` runs ESLint without fixing files. The ESLint config includes GTS, strict type-aware TypeScript checks, React Hooks checks, and browser/server import boundaries. `pnpm typecheck` runs TypeScript project checks. The GTS pre-commit hook checks staged files; to run it manually across the repository, use `pre-commit run --all-files`.

The full PR gate is:

```sh
pnpm verify:all
```

It runs GTS formatting, lint, typecheck, unit tests, PostgreSQL integration tests, hook tests, authenticated Playwright E2E, and the production build in order. It stops at the first failure and names the check. Integration and E2E need Docker. Authenticated E2E also requires Clerk development settings and a dedicated test account in `.env`; see `.env.example` for the required variable names. `pnpm test:e2e:signed-out` checks only public routes and does not replace the authenticated suite.

The underlying focused commands are `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration`, `pnpm test:hooks`, `pnpm test:e2e`, and `pnpm build`. Run `pnpm format:check` as well when changing JavaScript or TypeScript. There is no Jenkins pipeline yet; a future pipeline can invoke `pnpm verify:all`.

## Typical contribution flow

Create the ticket branch (`feature/CHR-123`, `bugfix/CHR-123`, or `maintenance/CHR-123`), install dependencies and hooks, make a focused change with its tests and docs, run `pnpm format:fix` when needed, then run `pnpm verify:all`. Review the resulting diff before staging and commit with the ticket-prefixed subject. Open a PR to `main` only after the local gate passes.
