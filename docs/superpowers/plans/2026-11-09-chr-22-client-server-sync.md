# CHR-22 Client–Server Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver revisioned full-snapshot sync and seamless provisional offline gameplay with server-authoritative verified rewards and purchases.

**Architecture:** Share browser-safe contracts and pure reward selection. Server transactions serialize per-user operations, increment revisions once per new mutation, and return consistent full snapshots; the browser persists canonical state and ordered local work in IndexedDB.

**Tech Stack:** TypeScript, React, Zod, Drizzle, PostgreSQL, IndexedDB, Vitest, Playwright; Node 24.20.0 and pnpm 10.34.7.

**Spec:** `docs/superpowers/specs/2026-11-09-chr-22-client-server-sync.md`

## Global Constraints

- Work on the user-requested normal branch `feature/CHR-22`, created with `git checkout -b` from integration `3e16e73`; no separate worktree.
- CHR-24 already delivered provenance and account grants. Preserve `is_verified` and do not repeat its migrations.
- The user approved the complete unstaged diff and explicitly authorized staging and commits. No PR or push is requested. Use the final commit grouping below; later review fixes are folded into their owning implementation layer.
- Use existing dependencies and patterns, no new runtime dependencies. Install using `pnpm install --frozen-lockfile`.
- Derive authority solely from Clerk authentication; snapshots exclude Clerk subjects. Never trust client balances, prices, verification, or online timestamps.
- User revision begins at zero; a new applied operation adds one transactionally. Rejections/no-ops/retries add zero. Catalogue version is a stable hash of public catalogue content.
- Stale revisions do not reject otherwise valid operations. No deltas/cursors. POST always returns a full snapshot after committed outcomes; GET supports checking both versions.
- Offline rewards stay unverified and give no economic benefits. A server-recorded online start can claim a server-selected verified reward after reconnect.
- The basic chest costs zero and is unlocked by an explicit purchase; users still start with zero coins.
- Request batches preserve order, fit below 64 KiB UTF-8, and contain at most 100 operations.
- Run `pnpm verify:all`; report unavailable checks honestly. Ask permission for Bugbot and Security Review after local verification. Ticket completion needs explicit user approval.

## Review Focus

- Lost responses and concurrent retries cannot duplicate rewards or revision increments (Tasks 1–3, database integration tests).
- Concurrent purchases/starts serialize on the user row; consistent snapshot reads pair data with its actual revision (Task 2).
- A catalogue edit invalidates freshness without a user mutation, including changed weights/prices (Tasks 2–3).
- Crashes and concurrent tabs cannot erase unacknowledged operations or regress cached user revisions (Tasks 4–5, real IndexedDB browser tests).
- Online-start/offline-finish stays server-verified; offline-origin claims never upgrade trust, including forged IDs/timestamps/account switches (Tasks 2–5).

## Contract conventions

Use camelCase JSON. `UserSnapshot` has `revision`, `catalogueVersion`, `user: {id, coins}`, `catalogue: {items, chests, chestItems}`, `userChests`, `items` (owned copies), and `sessions`. Dates are ISO UTC strings; item/chest descriptions/stats are public JSON. Catalogue entities expose id/name/description/rarity/stats/sprite coordinates as relevant; eligibility exposes chestId/itemId/weight. Owned copies expose id/itemId/sessionId/acquisitionSource/isVerified/receivedAt. Sessions expose id/chestId/origin/status/plannedDurationSeconds/startedAt/endedAt.

Every operation has a stable `operationId` for response/outbox correlation (no receipt table). Domain session/item UUIDs enforce mutation idempotency. Variants: `buy_chest {chestId}`, `start_session {sessionId,chestId,plannedDurationSeconds}`, `claim_reward {sessionId}`, `cancel_session {sessionId}`, `offline_session_claim {sessionId,chestId,plannedDurationSeconds,startedAt,endedAt,itemInstanceId,itemId}`. Outcomes have operationId/type/status (`accepted`, `accepted_unverified`, `already_processed`, `rejected`), optional code/message/sessionId/itemInstanceId, and `retryable` default false. Business outcomes contain no private SQL/errors. Stable duplicate IDs must match authenticated owner and original payload.

`SyncRequest = {operations: SyncOperation[], knownRevision?: number}`; `SyncResponse = {outcomes: OperationOutcome[], snapshot: UserSnapshot}`. `SnapshotResponse = {unchanged:false,snapshot}` or `{unchanged:true,revision,catalogueVersion}`. GET query keys `revision` and `catalogueVersion` are optional as a pair. Invalid operation entries get per-entry rejection where correlation fields are valid; malformed envelopes return 400. Infrastructure exceptions abort processing and return safe 500; unacknowledged operations are retried.

### Task 1: Contracts and shared reward selection

**Files:** `packages/contracts/src/index.ts`, new `sync.ts`, `reward-selection.ts`, corresponding unit tests.
**Interfaces:** Export the schemas/types above and `selectChestReward(candidates, plannedDurationSeconds, randomInt)` with candidates `{itemId,rarity,weight}` and injected `randomInt(maxExclusive)`; returns catalogue item ID.

- [x] Write failing schema and selector tests; run focused Vitest and observe missing exports/behavior.
- [x] Implement strict operation validation (UUIDs, 900–10800 seconds in 300-second increments, timestamps), snapshot/outcome schemas, public exports, and selector.
- [x] Pin 10,000-outcome rarity brackets, short-session Mythic→Common, nearest lower rarity fallback then lowest available, relative integer weights, one item, empty pool, invalid random source.
- [x] Run focused unit tests and typecheck; inspect diff. Leave unstaged.

Prepared subject: `[CHR-22] add sync contracts`

Unprefixed hook input: `add sync contracts`

### Task 2: Revisioned sync persistence

**Files:** `packages/db/src/schema.ts`, `users.ts`, `seeding.ts`, `index.ts`; new `sync.ts` and supporting focused repository files if needed; next Drizzle migration `0008_*` and generated metadata; `packages/db/tests/sync.integration.test.ts`, related tests; architecture data model.
**Interfaces:** `createSyncRepository(database)` exposes `getSnapshot(clerkUserId): Promise<UserSnapshot>` and `processOperation(clerkUserId, operation): Promise<OperationOutcome>`. Unknown users fail safely. Task 3 initializes via existing ensureUser first.

- [x] Write failing DB tests for revision baseline/increments, rollback/retry/concurrency, full snapshot isolation, catalogue hash changes, free chest, and rewards/purchases/trust.
- [x] Add nonnegative safe-integer user revision default zero; generate migration metadata and include basic-chest price update. Preserve original CHR-24 migration history.
- [x] Make repeated ensureUser a read instead of timestamp mutation. Seed basic chest at zero, preserve grant behavior.
- [x] Implement repeatable-read read-only full snapshots with deterministic catalogue hash. Lock user first for every write, then target session; validate owner and immutable duplicate payload before returning prior results.
- [x] Implement server-priced atomic purchases; server-timed start/cancel/claim; one reward under session lock; offline completed claim/item insertion with explicit unverified provenance and current chest eligibility. Online claim checks elapsed server time. Too-early claims are retryable. Infrastructure failures roll back and propagate.
- [x] Pin concurrent starts/rewards/purchases, ID conflicts, wrong owners, locked/ineligible claims, empty pools, stale input, no-op revision behavior, and free purchase at zero balance in real PostgreSQL tests.
- [x] Run focused DB integration suite and typecheck; update architecture. Leave unstaged.

Prepared subject: `[CHR-22] add sync persistence`

Unprefixed hook input: `add sync persistence`

### Task 3: Authenticated sync API

**Files:** `packages/api/src/handler.ts`, `production.ts`, handler tests; `apps/web/api` entrypoint for sync; architecture API section.
**Interfaces:** Preserve existing /api/me and health. Add authenticated GET/POST /api/sync wired to Task 2; same-origin adapters retain 64 KiB body limit.

- [x] Add failing handler tests for authentication, request shape, ordered partial outcomes, snapshot freshness, safe failures, method handling, and initialization.
- [x] Initialize the authenticated account, then serve unconditional or version-checked snapshots. GET unchanged only when both versions match.
- [x] Parse bounded POST operations, process sequentially with independent transactions, and return validated outcomes plus snapshot. Validate safe per-entry rejections; never continue past an infrastructure failure. Ignore knownRevision as a write precondition.
- [x] Wire production dependencies and hosted entrypoint; add adapter/route coverage where needed.
- [x] Run focused API tests and typecheck; document trust/freshness semantics. Leave unstaged.

Prepared subject: `[CHR-22] add sync API`

Unprefixed hook input: `add sync API`

### Task 4: Durable browser sync engine

**Files:** `apps/web/src/api.ts` and tests; new `sync-store.ts`, `sync-engine.ts`, `sync-model.ts` and focused tests; real IndexedDB Playwright tests where native browser behavior is required.
**Interfaces:** Store `loadCachedSnapshot`, `saveSnapshot`, `enqueueOperation`, `readPendingOperations`, and atomic `applySyncResponse` per Clerk user; local running session storage. API `getSyncSnapshot(token, signal?)`, `postSyncOperations(token, operations, signal?)`. Engine serializes per-account sync using Web Locks and preserves unknown outcomes.

- [x] Add failing tests for authenticated requests, response parsing, UTF-8 batching, canonical/provisional state replay, retry retention, and acknowledgements.
- [x] Implement native IndexedDB storage, transaction completion/error handling, atomic snapshot/outbox replacement, newer-local-operation retention, monotonic revision installs, and durable offline running sessions.
- [x] Implement single-flight ordered upload in batches below 64 KiB/100 entries. Keep retryable outcomes and transport failures; remove terminal rejections with displayable messages. Recover pending online starts without switching origin.
- [x] Test real browser IndexedDB persistence/account isolation, atomic rollback, stale response handling, and concurrent-tab sync. No token persistence or fallback that silently discards queued work.
- [x] Run focused tests and browser checks; update architecture client flow. Leave unstaged.

Prepared subject: `[CHR-22] add durable sync client`

Unprefixed hook input: `add durable sync client`

### Task 5: Gameplay integration and acceptance

**Files:** `apps/web/src/account-gate.tsx` and tests, `app.tsx`, new focused sync context/gameplay components and tests; `tests/e2e` sync/gameplay flows; README, ARCHITECTURE and other affected docs.
**Interfaces:** Account gate initializes snapshot and provides user-scoped state/actions to Focus and Inventory. Keep Clerk identity available as the prerequisite for cached data; abort on switch/unmount. Loaded-app offline use only; no service worker/auth cold-start guarantee.

- [x] Add failing UI tests for initialization, offline cache access, free purchase, session timer/start/cancel/claim, online pending claim, offline provisional reward, rejection reconciliation, and user switch.
- [x] Bound token/request/body waits to 15 seconds using native cancellation; add hanging-request/token regression coverage, retaining unknown outcomes and enabling cached offline mode.
- [x] Implement gameplay using engine/store; persist local effects before display. Online starts/rewards are server confirmed; offline timers stay local even after reconnect until completed. Distinguish pending, verified, unverified, rejected, and offline account states. Preserve current mobile layout and route headings.
- [x] Integrate real IndexedDB tests and mobile Playwright offline/reconnect acceptance without auth bypass; update old account E2E expectations for snapshot bootstrap. Include account creation token visible in inventory.
- [x] Run `pnpm verify:all` with exact pinned runtimes; inspect every result. Update all affected docs and plan checkboxes/evidence. Report unavailable checks.

Prepared subject: `[CHR-22] add offline gameplay`

Unprefixed hook input: `add offline gameplay`

### Task 6: Enforce the strict Mythic duration minimum

**Files:** `packages/contracts/src/reward-selection.ts` and tests/exports; `packages/db/src/sync.ts` and integration tests; `apps/web/src/sync-engine.ts`, `focus-gameplay.tsx`, UI/native browser tests; affected spec, README and architecture.
**Interfaces:** Export a shared pure duration eligibility rule, such as `isRarityEligibleForDuration(rarity, plannedDurationSeconds)`. Selector, server and client consume that rule. No migration or dependency is required.

- [x] Write failing selector cases for Mythic-only pools at 900/3300 seconds, fallback excluding Mythic, and Mythic becoming available at 3600; preserve all other rarity/weight rules.
- [x] Filter ineligible candidates before selector fallback. Start validation rejects pools with no duration-eligible reward before persisting a server or local timer. Online reward claims recheck the current duration-eligible pool without partially completing the session.
- [x] Reject new offline Mythic claims below 3600 planned seconds without mutation; structurally valid claims at or above 3600 remain unverified and do not prove elapsed time. Matching successful retries still return their committed result.
- [x] Explain and disable a shorter start for a Mythic-only chest in the UI; permit it at one hour. Keep pending and verification states intact.
- [x] Pin unavailable-start, changed-pool-at-claim, short offline claim rejection, and hour-long unverified acceptance with real PostgreSQL tests. Cover the UI and durable local start guard, including exact one-hour boundary.
- [x] Run focused RED/GREEN tests, typecheck and GTS, obtain scoped review, then rerun `pnpm verify:all` on final source. Keep all changes unstaged.

Prepared subject: `[CHR-22] enforce mythic duration`

Unprefixed hook input: `enforce mythic duration`

### Task 7: Preserve offline access during verifier outages

**Files:** `packages/api/src/auth.ts`, a focused safe error type if needed, `handler.ts`, auth/handler/crypto tests, architecture API documentation.
**Interfaces:** A known transient signing-key retrieval failure produces a safe HTTP 503. Invalid or expired credentials still produce 401. No operations run without verified identity.

- [x] Reproduce a real SDK JWKS HTTP 503 and a genuine expired-token failure before changing production behavior.
- [x] Distinguish established verifier transport/service failures from credential rejection without exposing SDK messages, tokens or configuration; map unavailable verification to safe retryable API failure.
- [x] Pin no persistence access on unavailable verification, preserve actual 401 behavior, and verify existing authentication/adapter contracts.
- [x] Run focused RED/GREEN tests, typecheck and GTS; obtain code/security follow-up review.

Prepared subject: `[CHR-22] handle verifier outages`

Unprefixed hook input: `handle verifier outages`

### Task 8: Close browser lifecycle review gaps

**Files:** `apps/web/src/sync-engine.ts`, `sync-store.ts`, focused native helpers if needed, Focus/timer components, UI/unit/native tests, affected client documentation.
**Interfaces:** Preserve the public sync protocol and stable IDs. Shared durable queue drives progress across tabs; offline timing uses a shared persisted wall-clock deadline that counts sleep; cancellation can withdraw a pending early claim safely; auth denial survives engine replacement after an IndexedDB write failure.

- [x] Reproduce a peer completing a timer during a held reconnect POST and closing; make the surviving uploader drain new durable work while attempting retryable claims only once per sync flight.
- [x] Reproduce a fresh offline engine after a failed denial-marker write. Persist a small independent account-scoped denial journal (no tokens or business state) and preserve memory/peer fallback; clear only on successful authenticated sync and retain the outbox.
- [x] Reproduce system sleep by advancing wall time while the performance clock is paused. Use the same persisted wall-clock deadline for the engine and display, so sleep counts. Cover component remount/reload and the explicitly accepted effect of forward/backward device-clock changes; offline rewards remain unverified.
- [x] Reproduce a retryable early online claim followed by cancellation, including cancellation during a retry. Keep cancellation available, durably withdraw queued claim intent as needed, and reconcile races to server state without duplicate rewards or leftover queue entries.
- [x] Run focused RED/GREEN native/UI/unit tests, typecheck and GTS; obtain both authorized follow-up reviews. Parent runs `pnpm verify:all` on final code before unstaged review.

Prepared subject: `[CHR-22] harden sync lifecycle`

Unprefixed hook input: `harden sync lifecycle`

## Final review and handoff

- [x] Finish whole-branch peer review and resolve its material findings.
- [x] Obtain permission for fresh-agent code and security reviews as substitutes for unavailable named launchers.
- [x] Finish both authorized substitute reviews and resolve findings; rerun affected checks.
- [x] Obtain the user’s explicit unstaged diff review before staging or committing.
- [ ] Obtain explicit ticket-completion approval after all required checks and reviews.

## Current handoff status

The complete unstaged diff was reviewed and approved by the user. Implementation, tests and affected documentation have been committed in the five approved groups below. Both authorized substitute reviews have zero open findings. The full local gate passed again on the committed implementation with Node 24.20.0 and pnpm 10.34.7: 346 unit, 66 database, 38 hook and 28 browser tests, plus formatting, lint, typecheck and build. No required checks were skipped. The production build retains its non-failing chunk-size warning. The only subsequent change is this documentation evidence update. No push or PR is authorized. Explicit ticket-completion approval remains pending. Earlier execution entries below describe historical intermediate states.

## Approved final commit grouping

The user approved the full unstaged diff and requested split commits plus documentation updates. Tasks 6–8 are folded into the owning layers below, so each commit contains the final reviewed behavior rather than intermediate implementations. These five groups supersede the original eight prepared boundaries.

| Scope | Prepared subject | Unprefixed hook input |
| --- | --- | --- |
| Contracts, schemas, shared reward selection and tests (Tasks 1, 6) | `[CHR-22] add sync contracts` | `add sync contracts` |
| Revision migration, snapshot repository, operations and DB tests (Tasks 2, 6) | `[CHR-22] add sync persistence` | `add sync persistence` |
| Authenticated sync API, verifier outage handling, tests and deployment docs (Tasks 3, 7) | `[CHR-22] add sync API` | `add sync API` |
| IndexedDB store, browser engine, API client and focused unit tests (Tasks 4, 8) | `[CHR-22] add durable sync client` | `add durable sync client` |
| Account/gameplay integration, native browser and acceptance tests, architecture, spec, plan and developer docs (Tasks 5, 6, 8) | `[CHR-22] add offline gameplay` | `add offline gameplay` |

## Execution record

- Plan reconciled with the approved discussion on 2026-11-25. User authorized immediate implementation; no extra plan approval is required.
- Ruling: initial user revision is zero after account bootstrap; purchases of the free first chest are explicit operations. These choices avoid implicit extra grants and artificial historic increments.
- Ruling: catalogue version is a deterministic content hash; no catalogue counter migration is needed. Outbox acceptance remains server authoritative regardless of knownRevision.
- Commit boundaries above are review grouping guidance; all work remains unstaged until the user's explicit diff review.

- Task 1 evidence: 103 contracts/selector tests passed (including four PostgreSQL boundary regressions), contract declarations/GTS and project typecheck passed; scoped review approved. Full unit suite after Task 1: 269 passed.

- Task 2 evidence: 61 PostgreSQL tests passed across seven suites; first-century timestamp decoding and offline clock-adjustment regressions reproduced before fixes. Focused contracts 57/57, typecheck/GTS passed; scoped review approved.

- Task 3 evidence: 97 focused API tests and all 305 unit tests passed, workspace typecheck/GTS/diff-check passed; scoped review approved. Hosted sync invocation remains unverified.

- Task 4 evidence: 10 native Chromium IndexedDB/Web Locks tests and 18 API/model unit tests passed, typecheck/GTS/diff-check passed; scoped review approved after auth-lock persistence-failure regression. Cold offline app/auth loading remains outside scope.

- Task 5 evidence: authenticated Docker browser suite passed before timeout delta, native deadline suite 11/11 passed afterward; 321 unit tests passed before clock-order fix. Clock-skew UI regression reproduced, fixed, then 14/14 UI tests passed with typecheck/GTS/diff-check; scoped review approved. Final combined verification rerun passed all eight checks.

- Final `pnpm verify:all` on Node 24.20.0 and pnpm 10.34.7 passed: GTS formatting, lint, typecheck, 322 unit tests, 61 PostgreSQL integration tests, 38 hook tests, 17 Playwright tests (real Clerk and native IndexedDB included), and production build. No required checks skipped. Vite emitted a non-failing 500 kB chunk-size warning; hosted CHR-22 acceptance remains unverified.

- User decision: enforce a strict one-hour Mythic minimum. Task 6 supersedes the earlier fallback-only interpretation and extends validation consistently across server and offline client.

- Final source after strict Mythic minimum and reconnect fix: `pnpm verify:all` passed all eight checks on Node 24.20.0/pnpm 10.34.7, including 332 unit, 66 PostgreSQL, 38 hook and 20 Playwright tests. No required checks skipped. Task 6 scoped integration review approved without findings; previous whole-branch reconnect finding resolved with two Chromium regressions.
- Required named Bugbot and Security Review launchers are not exposed in this session. The user approved fresh-agent substitutes; those independent code and security reviews are now in progress. All implementation is unstaged and uncommitted on `feature/CHR-22`.

- Approved substitute review results: four P2 code findings and one medium client privacy finding. Tasks 7–8 resolve them before the final unstaged diff review. The server and browser fix groups have disjoint source ownership and may execute in parallel.

- Task 7 follow-up: verifier-outage finding addressed, including real SDK HTML/JSON 503, truncated JSON, native connection reset and genuine malformed/expired JWT regressions; 110 API tests passed. Security substitute follow-up reports zero open security findings.
- Combined review-fix gate passed 346 unit, 66 PostgreSQL, 38 hook and 27 Playwright tests plus formatting/lint/types/build. Code follow-up cleared the original four findings but identified a browser system-sleep tradeoff in monotonic timing. The user chose sleep-inclusive wall-clock timing, accepting device-clock changes; implement and verify that final policy before handoff.

- Final user timing decision: count device sleep time. The shared offline wall-clock deadline supersedes the intermediate monotonic-only implementation and its clock-correction expectations. Add a paused-performance-clock sleep regression and retain all authentication, retry and cancellation fixes.

- Final sleep-inclusive policy implemented and reviewed: both authorized fresh-agent substitute reviews report zero open findings. Final `pnpm verify:all` exited 0 on Node 24.20.0/pnpm 10.34.7: formatting, lint, typecheck, 346 unit, 66 PostgreSQL integration, 38 hook and 28 Playwright tests, plus production build. No required checks skipped. Vite emitted its non-failing chunk-size warning. All implementation remains unstaged; user diff review and ticket-completion approval remain pending.

- The user explicitly approved the unstaged review and authorized staging, split commits and documentation updates. Ticket-completion approval remains separate and pending. The final combined tree will run `pnpm verify:all` again after the five commits.

- Post-commit verification: `pnpm verify:all` exited 0 after all five implementation commits, with the same 346/66/38/28 test counts and all eight checks passing. The plan evidence was then folded into the last local task commit; no implementation changed. No ticket changes were pushed.
