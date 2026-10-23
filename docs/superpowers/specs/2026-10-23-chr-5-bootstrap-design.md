# CHR-5: Bootstrap design

Status: approved for implementation on 2026-10-23. Task 1 is implemented and verified, pending unstaged review and commit; the application bootstrap remains in progress.

## Intent

Establish a small, understandable foundation for Chronostasis: a mobile-first focus application where completed sessions eventually unlock chests containing one item. CHR-5 proves local frontend → authenticated API → Postgres connectivity and provides repeatable developer tooling. It does not implement the focus or loot product.

The user requested the spec and plan together. The user subsequently approved implementation. This does not authorize staging or committing before the separate unstaged-review gate. Work is on `maintenance/CHR-5`. Nothing is staged or committed without the user's explicit unstaged-diff review approval.

## Requirements and boundaries

- TypeScript, React, Vite, pnpm workspaces, Vercel Functions, Neon, Postgres, Drizzle, and Clerk.
- Working Docker Compose development setup, migrations, seed data, end-to-end persistence, environment configuration, strict lint/type checks, unit tests, and Playwright smoke tests.
- README, design spec, implementation plan, finalized AGENTS.md, and an accurate `ARCHITECTURE.md` after implementation.
- Deployment is a separate ticket: no Vercel project linking, cloud deployment, or Neon resource creation in CHR-5.
- PWA installation/service worker, Capacitor/iOS packaging, notifications, focus timer, chest opening, loot selection, and inventory behavior are deferred.
- The user waived pre-existing testing requirements while tests are being established. There are no test commands today. Missing tooling does not block scaffolding; once established, the new checks remain acceptance criteria. Never report an unavailable or skipped check as passed.
- Final Bugbot and Security Review runs require a separate user permission request after implementation and verification. Findings must be fixed or explicitly ignored by the user, and ticket completion requires explicit user approval.

## Approaches considered

1. Next.js full-stack: fewer explicit runtime boundaries but changes the requested Vite stack and offers limited benefit for the authenticated application. Not selected.
2. Vite plus `vercel dev`: closer to the hosting runtime, but account/project setup can complicate an entirely local Docker bootstrap. Not selected as the default local path.
3. Vite plus shared HTTP handlers, local Node adapter, and thin Vercel adapters: small additional adapter code, with explicit local/cloud boundaries and no Vercel account needed to start locally. Recommended for this spec.

These choices extend the user's selected React/Vite/PWA/Capacitor direction. The local adapter, minimal initial schema, and exact endpoint contracts are proposed engineering decisions for review.

## Repository layout

- `apps/web`: React application and Vite config; `api/` contains thin Vercel Functions adapters. This directory is the intended future Vercel project root.
- `apps/api`: local Node HTTP adapter; development-only runtime, not a second production service.
- `packages/api`: environment validation, authentication, shared HTTP handlers, response/error policy.
- `packages/contracts`: Zod response schemas and shared public types; no server secrets or database imports.
- `packages/db`: Drizzle schema, migrations, seed runner, and Postgres client; server-only.
- `tests/e2e`: Playwright setup and smoke tests.
- `.githooks`: portable shell hook entrypoint; `scripts/prefix-commit.mjs` performs dependency-free message processing. `scripts/` also contains hook installation, shared tooling, and focused hook tests.
- Root workspace, Compose, Dockerfile, lint/TypeScript/test configuration, `.env.example`, `.gitignore`, README, AGENTS.md, and docs.

Use pnpm workspace resolution for source imports during development and explicit build/bundler configuration for Vercel adapters. Do not depend on unpublished workspace packages being globally installed.

## Runtime and hosting boundaries

Browser → Vite development server at `http://localhost:5173` → `/api` proxy → local API on container port 3001 → Compose Postgres on port 5432. Only Vite is exposed on the host by default; optional database debugging uses a Compose override or `docker compose exec`.

The future deployed boundary is browser → Vercel static frontend and `/api` Functions → Neon Postgres. Capacitor can later bundle the frontend and call the same HTTPS API. Neither deployment nor native authentication callbacks are implemented here.

Use standard `pg` pooling with Drizzle for local Postgres and the future pooled Neon Postgres URL. Reuse the pool across warm invocations, set a small connection limit, and require TLS for hosted connections. Never use the Neon HTTP-only driver for the local Postgres container. Migrations take a separate direct database URL, with documented local fallback to the application URL.

## Local startup

Proposed baseline: Node 24 LTS, pnpm 10, Postgres 17. Verify dependency engine compatibility at implementation time; pin exact selected Node/container and package-manager versions and commit the generated lockfile. Do not silently change the baseline if incompatible; report the constraint.

After copying `.env.example` to `.env` and supplying Clerk development credentials, `docker compose up --build` starts:

1. A Postgres service with a persistent named volume and `pg_isready` health check.
2. A one-shot migration-and-seed service, dependent on healthy Postgres.
3. Local API and frontend services, dependent on successful database initialization.

Use a shared development image, non-root application processes where practical, source mounts for hot reload, and container-owned dependency volumes. Include package manifests and lockfile in installation cache layers. If workspace manifests change, document the rebuild/dependency refresh command. Postgres restart retains data; seeds are idempotent. Database initialization failure must prevent application services from reporting ready. Tests use a separate Compose project/volume and must never reset the developer database.

## Environment and authentication

`.env` is ignored. `.env.example` contains safe placeholders, descriptions, and public/server-only distinctions:

- `VITE_CLERK_PUBLISHABLE_KEY`: public frontend key.
- `CLERK_SECRET_KEY`: backend-only development instance key.
- `CLERK_JWT_KEY`: backend public verification key where required by the selected SDK flow.
- `DATABASE_URL`, `MIGRATION_DATABASE_URL`: backend-only connection URLs. Compose provides an internal default for local Postgres; document host-run overrides separately.
- `CLERK_AUTHORIZED_PARTIES`: explicit allowed frontend origins, including `http://localhost:5173` locally.
- `E2E_CLERK_USER_EMAIL`, `E2E_CLERK_USER_PASSWORD`: dedicated development test account, used only by the authenticated smoke-test setup.

Environment validation must distinguish public and server settings and fail with variable names, without logging values. Do not put server variables in Vite's `define`, `VITE_*`, or browser imports. Avoid validating migration-independent Clerk settings when running database scripts.

Clerk remains an external service. The React client obtains a fresh session token and sends `Authorization: Bearer <token>`. The backend verifies the token with the Clerk SDK, expected instance/issuer, lifetime, and authorized party. User identity comes only from verified `sub`, never a request body. Missing/invalid/expired credentials return 401 before a database query. No development authentication bypass, hard-coded token, or test-only login endpoint is shipped. Initial clients are same-origin; no wildcard CORS is added.

## Persistence and API contract

Initial schema deliberately stays small:

- `users`: `id` UUID primary key, unique non-null `clerk_user_id`, `created_at`, and `updated_at` timestamps with timezone. No copied email/profile data is needed.
- `items`: stable text `id` primary key and non-null `name`. Seed three illustrative catalogue records idempotently: `rusty-key` / Rusty key; `copper-ring` / Copper ring; `blue-gem` / Blue gem.

Session/inventory schemas belong to their feature tickets, where their lifecycle rules can be specified.

Shared handlers use the Web `Request`/`Response` interface. Dependencies are injected for unit testing; production adapters always wire real authentication and database clients. Responses are JSON and use `Cache-Control: no-store` for user data/errors.

- `GET /api/health`: 200 `{ "status": "ok" }` when a lightweight database probe succeeds; otherwise 503 `{ "error": { "code": "UNAVAILABLE", "message": "Service unavailable" } }`. No environment/connection details.
- `POST /api/me`: authenticate, insert the user if absent using conflict-safe upsert, and return 200 `{ "user": { "id": "<uuid>", "clerkUserId": "<verified sub>" } }`. Repeated or concurrent requests yield the same row. Accept no client-supplied identity.
- `GET /api/me`: authenticate and return the same persisted representation; 404 `NOT_FOUND` if not initialized.
- Standard error shape: `{ "error": { "code": "<code>", "message": "<safe message>" } }`. Use 401 `UNAUTHORIZED`, 404 `NOT_FOUND`, 405 `METHOD_NOT_ALLOWED` with `Allow`, and 500 `INTERNAL_ERROR` as appropriate. Unexpected errors never disclose tokens, SQL, or stack traces.

The local adapter forwards method, URL, headers, and body to the shared handlers and translates the response back. Vercel adapters do the equivalent conversion through the supported Vercel Node request/response interface. Body forwarding must not parse then inconsistently reserialize requests; method dispatch and headers must agree between adapters. Both adapters enforce a 64 KiB request-body limit; a larger body receives 413 with a safe JSON error, and exactly 64 KiB is accepted.

## Frontend bootstrap behavior

Provide `/sign-in`, `/`, and `/inventory` with accessible mobile-first layout. Signed-out visitors see sign-in; signed-in visitors see a Focus placeholder and Inventory placeholder. Clearly label unimplemented product actions rather than providing working-looking timers or chests.

After authentication, initialize the application user with POST `/api/me`, then GET `/api/me` and display a simple account-ready status. Show retryable errors and loading state. Initialization is idempotent so React development effect re-runs cannot create duplicate users. A direct load of `/inventory` must work locally; later Vercel configuration must preserve API paths before SPA fallback.

## Verification and acceptance evidence

Root commands: `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration`, `pnpm test:hooks`, `pnpm test:e2e`, and `pnpm build`. Strict TypeScript, type-aware ESLint with zero warnings, and no unexplained `any`/blanket lint suppression. Unit tests use Vitest; smoke tests use Playwright Chromium with a mobile viewport.

Unit tests mock auth/database dependency boundaries and cover auth-before-DB behavior, verified identity, safe failures, method restrictions, environment validation, and frontend API error states. Real local Postgres integration tests cover migration/seed repeatability, upsert concurrency, and user isolation. Adapter parity tests execute the same request cases against local and Vercel adapters.

Playwright uses Clerk's supported testing helpers and a dedicated development account, performs real sign-in, proves POST/GET persistence and reload recovery, checks the inventory route on a narrow viewport, and verifies unauthenticated API rejection. Testing tokens bypass bot detection; they do not replace authenticated sessions. Missing Clerk credentials must fail the authenticated suite with an actionable setup error, not silently skip it. Signed-out smoke coverage can run independently, but cannot stand in for authenticated acceptance.

Hook tests run in temporary repositories. On exact `feature/CHR-<digits>`, `bugfix/CHR-<digits>`, and `maintenance/CHR-<digits>` branches, `.githooks/commit-msg` prepends `[CHR-N] ` to an unprefixed subject, preserves one matching prefix, and rejects conflicting/duplicate ticket prefixes. On unrelated branches it leaves the message untouched. It rejects malformed ticket branch names under the three reserved categories. Preserve the message body when processing user-authored messages; the subject-only policy governs agent-created commits. Verify comments/editor templates and empty subjects. The hook need not enforce all style rules; the agent verifies Conventional Commits and the 50-character subject limit excluding the ticket prefix.

Before pnpm exists, activation uses `node scripts/install-hooks.mjs`; Task 2 adds the explicit documented `pnpm hooks:install` alias. Both set repository-local `core.hooksPath=.githooks`. Do not overwrite an existing custom hook path without user approval. Hook installation is separate from package lifecycle scripts. No real commit is needed to test the hook.

## Documentation and completion

README covers prerequisites, external Clerk setup, env variables, container lifecycle, hot reload, data retention/reset, migrations/seeds, test account setup, every verification command, hook activation, and troubleshooting. Add `.dockerignore` so local secrets and `.git` are excluded from build context.

Create `ARCHITECTURE.md` only after implementation and verification, documenting the actual workspace structure, HTTP/auth/data flows, local runtime, future hosting boundary, database ownership, test layers, and remaining limitations. Describe Vercel/Neon as intended hosting until separately deployed. Keep design/plan status aligned with reality; preserve historical decisions while recording material changes.

AGENTS.md requires documentation upkeep, one implementation-plan task per Git commit with a prepared Conventional Commit subject, and executable commands once they exist. Each task includes its tests and directly related documentation. Planned subjects never bypass explicit unstaged-review confirmation before staging or committing. Preserve user edits: the current 50-character limit excludes the ticket prefix. No staging, committing, PR creation, final review dispatch, or completion claim is authorized by writing this spec/plan.

## Sources checked

- [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite): static frontend and API adapters.
- [Vercel local development](https://vercel.com/docs/cli/dev): available alternative to the default local adapter.
- [Clerk Playwright testing](https://clerk.com/docs/guides/development/testing/playwright/overview): real sessions and testing helpers.
- [Clerk token verification](https://clerk.com/docs/reference/backend/verify-token): backend verification and authorized parties.

## Left to the implementer

Choose compatible patch versions, small UI styling details, test helpers, exact migration filenames, and supported Clerk sign-in component configuration. Inspect installed SDK documentation before choosing its current API signatures. Do not add a state-management framework, job queue, cache service, PWA service worker, or additional hosting platform for this ticket.

## Planning review

A fresh Superpowers design builder check reported “nothing important left.” The implementation plan was self-reviewed against every acceptance criterion and the carried-over hook requirement. This is not implementation approval or a substitute for the final permission-gated Bugbot and Security Review runs.
