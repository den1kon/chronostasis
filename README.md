# Chronostasis

Chronostasis is a mobile-first focus app foundation. Clerk sign-in and account persistence work locally; Focus and Inventory are placeholders. Timer and rewards are future work. The hosted build validates its Neon target, prepares Integration on an explicit redeploy, and prepares Production automatically; owner-side Vercel/Neon settings and hosted acceptance still need verification.

## Run locally

You need Docker with Compose and a Clerk **development** application. Copy the example environment file, then set `VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `CLERK_ISSUER` (the Frontend API URL) in `.env`:

```sh
cp -n .env.example .env
docker compose up --build -d --wait
```

Open [http://localhost:5173](http://localhost:5173). Include that origin in `CLERK_AUTHORIZED_PARTIES`. If port 5173 is busy, set `WEB_PORT=5174` and add `http://localhost:5174` to the allowed parties.

Compose starts dependency installation and PostgreSQL first, then migrations/seeds, the API, and the frontend. Requests flow browser → Vite frontend → `/api` proxy → authenticated Node API → PostgreSQL. Clerk verifies the signed-in user before the API reads or writes that user's record.

### What Compose runs

| Service | Purpose |
| --- | --- |
| `deps-init` | Installs the locked pnpm workspace dependencies before app services start. |
| `db` | Persistent local PostgreSQL database; its port is not published to the host. |
| `db-init` | Waits for PostgreSQL, applies migrations, and seeds the catalogue. |
| `api` | Node HTTP server for authenticated API routes; reachable inside Compose, not published to the host. |
| `web` | Vite development server, published on loopback at port 5173; proxies `/api` to `api`. |
| `db-test`, `test` | Optional integration-test database and Vitest runner, isolated from the development database. |
| `e2e` | Playwright browser runner in the separate E2E Compose project; exercises signed-out and authenticated flows. |

Frontend and API source hot-reload. After changing package manifests or the lockfile, refresh dependencies without deleting database data:

```sh
docker compose down
docker compose up --build -d --wait
```

Stop the app with `docker compose down`; the database volume remains. Delete it only when you intentionally want a fresh database:

```sh
docker compose down --volumes
```

## Working on the project

Use a ticket branch (`feature/CHR-123`, `bugfix/CHR-123`, or `maintenance/CHR-123`). Install the Python hook runner and enable both repository hooks once per checkout:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
pnpm hooks:install
```

The pre-commit hook runs GTS checks on staged files; the commit-message hook adds or validates the ticket prefix. Use `pnpm format:check` to check formatting and `pnpm format:fix` to apply GTS formatting and automatic fixes.

The main workspaces are `apps/web` (React/Vite), `apps/api` (local Node server), `packages/api` (auth and shared handlers), `packages/contracts` (public schemas), and `packages/db` (Drizzle schema, migrations, and seeds). For schema changes, edit the Drizzle schema, run `pnpm db:generate --name add_focus_session`, then review and commit the generated migration with the schema change. Compose applies migrations and seeds on startup. See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for setup, Docker service roles, database workflow, and commands.

See [ARCHITECTURE.md](ARCHITECTURE.md) for runtime/data boundaries and the [design spec](docs/superpowers/specs/2026-10-23-chr-5-bootstrap-design.md) for detailed requirements.

## Before opening a PR to `main`

Use Node.js **24.20.0** and pnpm **10.34.7** locally. The `.node-version` file pins the local runtime; `package.json` accepts Node.js 24.20.0 and newer patch releases in the 24.x line so Vercel's managed Node runtime can update patches. Install from the lockfile, then run the PR gate:

```sh
pnpm install --frozen-lockfile
pnpm verify:all
```

`verify:all` runs GTS formatting, lint, typecheck, unit tests, PostgreSQL integration tests, hook tests, authenticated Playwright E2E, and the production build, stopping at the first named failure. Integration and E2E need Docker. Authenticated E2E needs Clerk development settings and a dedicated test account in `.env`; see `.env.example`. Do not substitute `pnpm test:e2e:signed-out` for the full suite.

Run `pnpm format:check` for GTS formatting verification. No CI workflow is checked in, so run the local gate before requesting review. For individual commands and the complete contributor flow, see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Local data and credentials

`.env` is ignored by Git. Keep Clerk secrets there; only the publishable key is sent to the browser. Development PostgreSQL credentials are local fixtures. Compose fixes its database destination so host environment variables cannot redirect migrations to another database.

## Vercel and Neon

Use two persistent Neon branches: Integration is the default branch shared by all Vercel Previews, and Production is Vercel's configured Production branch. Disable database branch creation per deployment. The hosted runner accepts either the `NEON_POSTGRES_URL` / `NEON_POSTGRES_URL_NON_POOLING` pair or `NEON_DATABASE_URL` / `NEON_DATABASE_URL_UNPOOLED`; configure both direct-host markers in Preview and Production. Do not set hosted `DATABASE_URL`, `MIGRATION_DATABASE_URL`, or `PGPORT` overrides. Local development keeps using Docker PostgreSQL.

Use Clerk development keys for Vercel Preview and production keys for Production. Keep `CLERK_AUTHORIZED_PARTIES` set to explicit origins locally and in Production. Remove its Preview environment value: the API builds Preview's allowlist from the exact Vercel deployment and branch URLs, so every ticket branch works without per-PR settings changes. Enable Vercel system environment variables for the project. A Clerk Development account can be used locally and on Preview; Production users remain separate.

The Vercel build runner validates the target, typechecks the serverless API, builds the app, then prepares the database only for Production or an explicit `integration` branch redeploy. Feature Previews share Integration and never migrate. Vercel's ignored-build rule skips automatic deployments of the `integration` branch; to prepare Integration, redeploy that branch's latest deployment and uncheck “Use project's Ignore Build Step.” Local `pnpm build` stays independent of hosted credentials. Follow the [deployment runbook](docs/DEPLOYMENT.md) for owner setup, the `chronostasis.tech` Clerk configuration, daily releases, and recovery.
