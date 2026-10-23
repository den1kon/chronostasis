# Chronostasis

A mobile-first focus application where completed sessions will unlock chests containing one collectible item.

## Bootstrap status

CHR-5 is in progress on `maintenance/CHR-5`. The ticket workflow and commit hook are committed. The TypeScript workspace and minimal React/Vite/Tailwind shell are implemented and pending unstaged review. Docker Compose services, authentication, the database, and automated browser tests are not yet implemented. Deployment is a separate ticket.

- [Design specification](docs/superpowers/specs/2026-10-23-chr-5-bootstrap-design.md)
- [Implementation plan](docs/superpowers/plans/2026-10-23-chr-5-bootstrap.md)
- [Repository instructions](AGENTS.md)

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

Vite uses a strict port setting and does not silently choose another port. Restarting or stopping the server does not modify application data; no database exists yet.

## Workspace layout

- `apps/web`: React frontend, Vite with the Tailwind CSS plugin, and separate browser/tooling TypeScript configurations.
- `scripts`: dependency-free Git-hook processor, installer, and behavior tests.
- Root configuration: shared strict TypeScript settings, ESLint, Vitest, workspace/package-manager configuration, and the lockfile.
- `docs/superpowers`: the CHR-5 design and implementation plan.

Future API, public-contract, and database workspaces will be introduced with their implementations. Browser code may not import server API/database packages or use Node globals. Runtime output, dependencies, secrets, and local execution scratch files are excluded from Git; `.dockerignore` also excludes them from future Docker build contexts.

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
pnpm test:hooks
pnpm build
```

Linting uses type-aware strict TypeScript rules, React Hooks rules, browser/server import boundaries, and zero allowed warnings. Type checking uses strict mode, explicit browser types, and additional indexed-access/optional-property checks. The build produces static assets in `apps/web/dist`.

`pnpm test:unit` runs Vitest. At this scaffold stage there are no application unit tests, so it intentionally exits nonzero with “No test files found.” It does not silently report success. Behavioral tests are added with the API/database/frontend logic in subsequent tasks. Playwright and database integration commands do not exist yet.

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

Database integration and Playwright smoke-test commands will be documented as those tools are established. `ARCHITECTURE.md` will describe the verified application architecture after implementation.
