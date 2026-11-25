# CHR-22 Client–Server Sync and Offline Sessions

## Goal

Keep the app usable with and without a network connection while making the server the canonical authority for user data. The client caches a full snapshot and queues explicit operations. The server validates online operations, reconciles offline claims as unverified, persists accepted changes, and returns a full snapshot after each sync.

## Terms and trust

- **Server snapshot:** canonical user and catalogue data read from the database.
- **Client cache:** the last full server snapshot stored locally for display and offline use.
- **Pending operation:** a local action not yet acknowledged by the server.
- **Verified item:** a reward selected and persisted by the server for a valid online session.
- **Unverified item:** an offline reward claim accepted into the server inventory without proof that the session or reward occurred as reported. The database stores this as `is_verified = false`.

The server is authoritative for coins, chest ownership, verified sessions, verified rewards, and canonical inventory. Offline claims may be accepted into canonical inventory, but must remain unverified. A server record is not proof that an offline claim is genuine. Verified online rewards mean the server recorded the start, enforced its elapsed-time rules, and selected the reward; they do not prove attention or detect every form of cheating.

The authenticated Clerk subject determines the user. The server ignores any client-supplied user ID for authorization or ownership.

## Sync protocol

Use the existing authenticated API boundary and add a sync endpoint. `GET /api/sync` returns the initial full snapshot. `POST /api/sync` accepts one or more explicit operations in client queue order, processes each independently, then returns per-operation outcomes and the full canonical snapshot even if some or all operations are rejected. Online actions use the same endpoint; a successful operation is acknowledged only after its database transaction commits. The existing API adapter limits request bodies to 64 KiB, so the client sends bounded batches that fit this limit and preserves operation order across batches.

Do not upload the client’s entire inventory as writable state. The client submits action claims; the server decides what to persist, reject, or accept as unverified. Snapshots are read-only responses. User revisions and catalogue versions identify snapshot freshness. Cursors and delta sync remain out of scope; send the complete snapshot after every successful action batch. An explicit freshness check may return an unchanged response when both versions match.

Each queued operation carries a stable `operationId` UUID for response/outbox correlation. Domain keys enforce mutation idempotency: session operations use the stable session ID, offline copies also use stable item-instance UUIDs, and permanent purchases use the user/chest pair. Retry with the original correlation ID and payload; the correlation ID is not a separate operation receipt. The server returns the existing result on a retry of an already-processed successful operation and rejects reuse of a domain ID with conflicting owner or payload. A generic operation-receipt table is not required for this version: use stable session/item-instance IDs and transactional session state transitions. Rejected operations may be corrected and resubmitted with a new ID where applicable.

Process a batch in order, with one transaction per operation so a rejected claim does not roll back unrelated accepted operations. Return an outcome for every operation (`accepted`, `accepted_unverified`, `rejected`, or `already_processed`) and a full snapshot reflecting all committed operations. Preserve order across batches; in particular, upload a pending chest purchase before offline sessions that depend on that chest.

Incoming timestamps use UTC ISO strings in years 0001–9999, with at most millisecond precision. Reject unsupported timestamps before persistence; standard JavaScript date serialization must not silently merge distinct claim payloads.

## Revisions, consistency, and catalogue freshness

Each user has a server-owned nonnegative safe-integer `revision`, initially zero for the initialized account (including its creation grant). Each newly applied operation increments it by exactly one in the same transaction as all of that operation's writes. Completing a session and granting its item is one operation and one increment. Accepted offline claims also increment it; verification is independent of freshness. Rejections, rollbacks, matching retries, reads, repeated initialization, and purchases of already-owned chests do not increment it. Never trust or increment a client-provided revision as server state.

Treat the client's revision as freshness information, not an operation precondition. Validate stale requests against current authoritative balance, access, session state, catalogue, and identity. A client cannot overwrite state by uploading a snapshot. Lock the user before session rows in every write transaction so concurrent operations serialize revision updates without deadlocks. Read snapshot rows and revision in one repeatable-read, read-only transaction. A snapshot may include another device's committed operations; outcomes identify this request's results separately.

The catalogue has a separate opaque `catalogueVersion`, computed as SHA-256 over deterministically ordered public catalogue data (including chest eligibility and weights). This detects catalogue edits independent of user operations without introducing a manually maintained catalogue counter. A freshness GET supplies both last-known values; return unchanged only when both match. Always send a full snapshot on an unconditional GET and after POST. Include no Clerk subject in snapshots.

## Local durability and reconnect

Store canonical snapshots, pending operations, and provisional offline running sessions per authenticated Clerk user in IndexedDB. Never persist tokens. Persist an operation before submitting it or showing its durable provisional effect. Offline starts are saved locally, including their eligible reward candidates and relative weights, so a catalogue refresh cannot strand a running timer. Only completion enqueues an offline claim with stable session/item IDs. The server still checks the resulting claim against current eligibility. Persist that claim and clear the local running session in one IndexedDB transaction; a crash must not cause a second completion or reroll. Cancelling a provisional offline session discards it locally. An online start with a lost response stays a pending online start; retry its original ID rather than silently creating an offline session.

After each POST, rescan the durable queue for work not yet attempted by the current sync flight, including a peer tab that saved a claim and closed. Attempt a retryable early claim at most once per flight and continue to later independent operations; do not rely only on an uploader-local change counter.

Install a returned snapshot and remove only the acknowledged terminal operations in a single IndexedDB transaction. Preserve operations created while a request was in flight. Ignore snapshots with lower user revisions; still acknowledge matching outcomes. Compare catalogue versions by equality, not lexical ordering, and serialize snapshot installation with network sync using a per-account Web Lock across tabs. Derive displayed provisional state from canonical data plus remaining local work so reconnect does not erase unsent actions or double-apply acknowledged actions. Account switching aborts old work and cannot reveal another account's data. Lock or disable sync when identity is unavailable. A null token or HTTP 401 locks that account cache across tabs and engine restarts, retaining its pending operations. Record a small account-scoped denial marker independently of the IndexedDB snapshot transaction so an aborted cache write cannot make a fresh offline engine forget the denial; never put tokens or business state in that marker. Keep current and live-peer memory latches if persistence is unavailable; only a subsequent successful authenticated sync clears the lock. Local actions recheck the durable lock before writing. Token-provider or response-body transport failures preserve pending work and allow cached offline play for an identified, unlocked account, even when navigator.onLine remains true.

Bound token acquisition and each HTTP request (including response-body reading) to 15 seconds, respecting caller cancellation. A timeout leaves original operations queued and permits cached offline play for an identified, unlocked account. A business rejection is terminal and removed from the outbox with a visible message; transport failures and unknown transaction outcomes keep operations queued for retry. Early online reward claims remain retryable. Unexpected server failures must not be reported as terminal business rejections. Split ordered batches below the adapter's 64 KiB UTF-8 JSON limit, with at most 100 operations per request. One invalid operation must not roll back independent valid operations. Do not process later operations after an unexpected infrastructure error; the client retries unacknowledged work.

Offline support in this ticket covers a loaded application and persisted gameplay data when the application and Clerk identity can load. Installing a service worker and guaranteeing cold offline app/auth startup are separate packaging work.

## Full snapshot

The response includes:

- User identity needed by the client and current `coins` (do not expose `clerk_user_id`).
- The complete public item and chest catalogue, plus chest-to-item eligibility and `chest_items.weight` values. Clients need the weights to produce provisional offline rewards using the same selection rules.
- The user’s unlocked chest types.
- All user item copies, including `acquisition_source` and `is_verified`.
- All focus sessions, including origin and status.

The client replaces its canonical cache with the returned snapshot and keeps only unacknowledged operations in its local outbox. Cache records and outbox entries are scoped by Clerk user ID. Never persist auth tokens in the local store. Lock user data on sign-out/account switch without deleting unacknowledged operations; do not display another account’s cache. If Clerk cannot identify the previously signed-in user while offline, keep cached data inaccessible until identity is available.

## Operations and behavior

### Start an online session

The client creates a stable UUID for the proposed session and submits `start_session` with that ID, chest ID, and planned duration. The server authenticates the user, checks chest ownership, validates duration (900–10800 seconds, divisible by 300), and inserts a `running` online session using server time for `started_at`. A partial unique index prevents concurrent online starts. A duplicate request for the same ID returns the existing session; a different start while one is running is rejected.

The server returns the full snapshot after the insert commits. A network failure may leave the outcome unknown to the client; retry with the same session ID.

### Claim an online reward

The client submits `claim_reward` for a server-created session ID. The server checks ownership, `running` status, chest access, and `now() >= started_at + planned_duration_seconds`. In one transaction, it selects one reward item, inserts a verified `user_items` copy, and marks the session completed with server `ended_at`. Lock the session row and only award when the state is `running`; concurrent or repeated claims then return the item already associated with the completed session and never roll again. A too-early claim is rejected without completing the session; the client may retry later.

If the device goes offline after an online start, the session remains an online/server-created session. The client may finish the timer locally and queue its claim. It shows “reward pending” but does not add a locally selected reward. On reconnect, the server checks its own start timestamp and chooses a verified reward. The elapsed-time check is evaluated when the claim reaches the server; client timestamps do not decide eligibility.

### Buy a chest online or offline

The client submits `buy_chest` with a chest ID. The server reads the current price from `chests`; it never trusts a client-supplied price. In one transaction, it locks the user’s balance, returns `already_processed` without charging if the chest is already unlocked, otherwise checks sufficient coins, deducts the price, and inserts `user_chests`. The composite primary key on `(user_id, chest_id)` prevents duplicate access grants, and the balance deduction and grant commit together.

Offline, the client may optimistically deduct the cached price, mark the chest as **pending purchase**, and use it in a provisional offline session. The client queues the purchase before any dependent session claim. On reconnect, the server processes that purchase first against the current balance and catalogue price. If accepted, the following claim can be evaluated normally (as unverified because its session was offline). If rejected—for example, another device spent the coins—the dependent claim is rejected because the chest is still locked; the canonical snapshot restores the true balance and access. An online session cannot start using a merely pending chest purchase; sync and confirm the purchase first.

This MVP intentionally permits an optimistic offline purchase to be rejected at sync if authoritative balance/access changed elsewhere. If the product later requires offline purchases to be guaranteed, reserve a server-authorized offline spending allowance before disconnection; do not solve it by trusting client balances or allowing negative server balances.

### Start and complete an offline session

An offline start is provisional and stored locally only. The client runs the timer using cached catalogue, chest-access, rarity thresholds, and chest-item weights from the snapshot. The user chose to count device sleep time. Use one persisted wall-clock deadline (`startedAt + plannedDurationSeconds`) for both the timer display and local completion guard, including after backgrounding, system sleep, component remount and document reload. Device-clock changes can advance or delay offline readiness; this is an explicitly accepted offline tradeoff. Keep start/end values as untrusted provenance and keep every offline reward unverified. Online reward eligibility continues to use server time. It does not create a server `running` session. On completion, the client runs the same rarity-bracket and weighted-item selection rules as the server using its local random source, displays the provisional result, and adds that copy to its local inventory as **pending sync / unverified**. With current catalogue data this should look like the online happy path; randomness means it is not expected to match an online roll. The client queues an `offline_session_claim` containing a stable session ID, chest ID, planned duration, client-reported start/end times, and a claimed item-instance UUID plus catalogue item ID. The client-generated UUID remains stable across retries.

On sync, the server verifies the authenticated user, that the referenced chest is currently unlocked, that duration and IDs are structurally valid, and that the claimed item is currently eligible for that chest and its planned duration. In particular, reject Mythic claims below 3600 planned seconds even when the claim is unverified. A forged claim of at least 3600 planned seconds still proves no elapsed time and can only be accepted as unverified. It does not verify the client’s rarity roll, random source, or weight-based selection—even though the snapshot includes weights and the client uses the same rules. It cannot prove actual elapsed time or attention either. Do not require the reported timestamp interval to equal or exceed the planned duration: wall-clock adjustments can change that interval during legitimate offline play. Structurally valid reported times, including short or reversed intervals, remain untrusted provenance and never establish verification. If accepted, it inserts a completed session with `origin = 'offline'` and an item with `acquisition_source = 'offline_claim'` and `is_verified = false`. The session’s client-reported timestamps are untrusted; `created_at` records when the server received it. The item remains unverified permanently, including after sync, and must not be presented as a verified/server-rolled reward.

The client may show an offline item immediately with a pending/unverified badge. On acceptance, it remains visible as unverified. On rejection, remove it from owned inventory and report the rejection; retaining a rejected-claim history is optional and must not make it owned.

Offline session IDs and item-instance primary keys deduplicate retries. A duplicate matching claim returns the previously stored result. Reusing an ID with conflicting user, chest, duration, or item is rejected. The MVP awards one item per session; `user_items.session_id` remains non-unique so the database does not preclude historical or future multi-item rewards.

An offline session that reconnects while still running continues locally and is submitted only after completion. It is never silently converted into an online session. The client should avoid starting a new online session while it knows an offline session is pending. Other devices cannot know about an unsubmitted offline session, so the server cannot enforce a global one-session rule for it. Online uniqueness applies to server-known online running sessions only.

### Cancel

After an online reward claim receives a confirmed retryable too-early outcome, keep the running session cancellable. Enqueueing cancellation atomically withdraws pending reward-claim intent for that session while preserving unrelated queued operations. An in-flight claim may already have committed; reconcile that race to the returned canonical state rather than inventing a rollback.

An online session can be cancelled through a server operation; the server records `cancelled` and server `ended_at`, and a retry is idempotent. An offline provisional session can be discarded locally before submission. Once submitted and accepted as completed, it cannot be converted into a cancellation.

## Rarity and item selection

For planned durations of at least 3600 seconds, final rarity probabilities are Mythic 0.5%, Legendary 1%, Epic 5%, Rare 20%, Common 73.5%. For shorter sessions, Mythic is strictly ineligible and its 0.5% share goes to Common, making Common 74%. Remove Mythic candidates before rarity fallback or weighted selection. Fallback must never promote a shorter session to Mythic. A Mythic-only chest has no eligible reward below 3600 seconds; refuse that start before creating a timer and explain the one-hour minimum in the UI.

Use one server-side roll in 10,000 integer outcomes: Mythic 0–49 (eligible sessions only), Legendary 50–149, Epic 150–649, Rare 650–2649, Common 2650–9999. For shorter sessions, outcomes 0–49 also map to Common. After selecting a rarity, choose among that chest’s eligible items of that rarity by `chest_items.weight` (relative weights; one eligible item is selected deterministically).

If the chest has no items at the rolled rarity, remap that rarity’s probability band to the nearest available lower rarity. If no lower rarity is available, map it to the lowest available rarity. Thus every pool with at least one duration-eligible item can yield an item. At 3600 seconds or longer Mythic can participate in both direct selection and fallback. If the current pool is empty or has no duration-eligible item, return an `empty_reward_pool` operation rejection. This leaves a running online session and its inventory unchanged if the catalogue changes before a claim.

The server and client use the same rarity brackets, strict duration eligibility, fallback rules, and relative chest-item weights through shared pure policy and a selector with injected randomness. Validate duration-eligible pools before starting online or local offline sessions, so an unavailable pool does not strand a newly started timer. The online server supplies its own random source and remains authoritative for verified rewards; the client supplies a local random source for offline display. Shared deterministic fixtures test both paths. The server does not treat an offline roll as verified, even when the client has the same weights. An accepted offline item is always unverified.

## Database implications

The session-origin, chest, acquisition-source, and `is_verified` columns plus the account-creation grant are delivered by CHR-24 (PR #9, merged into integration at `3e16e73`). CHR-22 consumes that schema and must not duplicate its migration or seed/user-initialization changes. The following describes the schema contract CHR-22 relies on:

- `focus_sessions.chest_id text NOT NULL` FK to `chests.id`. Session/reward behavior has not shipped, so the migration requires `focus_sessions` to be empty and must fail clearly if rows exist. Do not invent chest associations, silently delete sessions, or keep nullable legacy-session behavior.
- `focus_sessions.origin text NOT NULL DEFAULT 'online'` constrained to `online`/`offline`.
- `user_items.acquisition_source text NOT NULL` constrained to `account_creation`, `session_reward`, or `offline_claim`.
- `user_items.is_verified boolean NOT NULL DEFAULT false`.
- Add a check constraint enforcing the source/session/trust combinations: `account_creation` requires `session_id IS NULL AND is_verified`; `session_reward` requires `session_id IS NOT NULL AND is_verified`; `offline_claim` requires `session_id IS NOT NULL AND NOT is_verified`.
- Unique partial index on `focus_sessions.user_id` for `origin = 'online' AND status = 'running'`.
- Add a check constraint requiring offline-origin focus sessions to be completed; offline sessions are inserted only when their claim is submitted.
- Do not make `user_items.session_id` unique; the current reward flow awards one item, while the database remains flexible for future multi-item sessions. Serialize reward claims by locking the session row and atomically transitioning it from running to completed.
- Backfill existing session-less welcome items to `acquisition_source = 'account_creation'` and `is_verified = true` before enforcing `acquisition_source NOT NULL` and the source/trust check. New session rewards explicitly set `is_verified = true`; offline claims set it to false.
- No new purchase ledger is needed for permanent chest access: `user_chests(user_id, chest_id)` is the purchase idempotency key, while a transaction locks and updates `users.coins`.
- Preserve and use the composite FK that ensures a session and item belong to the same user. The repository must also ensure `session_reward` references an online-origin session and `offline_claim` references an offline-origin session.

Online session timestamps are server-generated. For an offline-origin completed session, `started_at` and `ended_at` hold client-reported values and are explicitly untrusted; `created_at` is server receipt time. `user_items.received_at` is server acceptance/record time for offline claims; client-reported completion time remains on the session. Existing welcome items are identified as `account_creation` with `is_verified = true`.

No generic operation-receipts table is needed for this MVP. Stable session IDs, stable offline item-instance IDs, `user_chests` uniqueness, status transitions, and payload comparison provide idempotency for the scoped operations. Revisit a receipt table if future operations cannot be safely keyed by a domain entity.

## First chest and account-creation item

The seeded `basic-chest` costs zero; all users continue to start with zero coins. Unlock it through the normal explicit `buy_chest` operation, including provisional offline purchase, rather than adding an implicit initialization grant. Update the deployed catalogue through an additive CHR-22 migration and the repeatable seed so existing and new installations agree. Existing access is preserved and no refunds are invented.


When a new application user is initialized, award one catalogue item such as `creation-token` (“Token of Creation”) in the same database transaction as the `users` insert. Set `user_items.acquisition_source = 'account_creation'`, `session_id = NULL`, and `is_verified = true`. This item is not tied to a focus session, chest, or `chest_items` entry. Repeated user initialization must not award a second copy. Seed the catalogue item, but keep it outside chest reward pools. Existing session-less welcome copies are backfilled as account-creation items; do not award existing users another copy during migration.

## Security, limits, and UX

- Authentication and all ownership checks use the server-derived user. A known signing-key retrieval service/transport failure returns a safe retryable 503 without processing operations; genuine invalid or expired credentials return 401. An upstream verifier outage must not be misrepresented as a credential denial that permanently locks the local cache.
- Client catalogue, timestamps, rarity, and reward selection are untrusted inputs for offline claims.
- Offline claims are accepted as unverified by design; this is provenance/audit information, not cheat prevention.
- Do not allow unverified items to grant coins, purchase chests, or participate in trading until a separate policy permits it.
- Show pending, unverified, rejected, and verified states distinctly.
- Handle stale cached catalogue/access by returning a per-operation rejection and canonical snapshot.
- No background polling is required for a running timer. An abandoned server-known running session needs an explicit cancel path; automatic expiry is out of scope for the first implementation and should be revisited before launch if it can block users indefinitely.

## Acceptance criteria

- Authenticated clients can fetch a full snapshot and submit ordered sync operations. Each new applied operation atomically increments the server-owned user revision once; matching retries, reads, no-ops, rejections, and rollbacks do not.
- Freshness checks compare both user revision and catalogue version. Stale requests are validated against current server state, and snapshots read data and revision consistently.
- The basic chest can be unlocked at zero cost by an account with zero coins.
- Snapshot installation and terminal outbox acknowledgements commit atomically in IndexedDB; concurrent local work survives, and lower-revision responses cannot regress the cache.
- Online start, reward, and cancel operations are server-authoritative, transactional, and retry-safe.
- One online running session per user is enforced by Postgres. A session claim awards one item only once through a locked state transition.
- Chest purchases deduct the server’s current price and create permanent access atomically; retries or concurrent same-chest purchases never double-charge.
- Offline purchases are provisional locally, process before dependent claims, and are reconciled against authoritative coins and current price.
- New-user creation atomically awards one verified account-creation item with no session/chest association; retries do not duplicate it.
- Offline sessions/rewards appear locally before sync as pending/unverified and reconcile to unverified server records when accepted.
- Online-started sessions claimed after reconnect still receive server-selected verified rewards.
- A rejected offline claim is not included in owned inventory.
- Full snapshots include the user, catalogue, chest eligibility and weights, chest unlocks, sessions, item acquisition source, and `is_verified`, without exposing Clerk IDs.
- Local cache/outbox data is isolated by user and auth tokens are not persisted.
- Tests cover constraints, transaction behavior, idempotent retry, stale/invalid claims, network loss, account switching, and the online-start/offline-claim scenario.
- Outbox batches remain within the existing 64 KiB request limit and preserve order; large offline queues are sent across multiple batches.
- Full snapshots are intentionally unpaginated for MVP scale; revisit payload growth before inventory/session history becomes large.

## Implementation status

On 2026-11-25 the user explicitly chose a strict one-hour minimum for Mythic. This supersedes the earlier lowest-pool interpretation: a short Mythic-only chest is unavailable, and short offline Mythic claims are rejected rather than accepted as unverified.

CHR-24 schema and account grants are already merged. CHR-22 adds revisions, the free basic chest, shared selection, authenticated sync operations, and the browser cache/outbox/UI. No generic operation-receipt table is required. The snapshot revision baseline is established by the CHR-22 migration; historic grants do not manufacture operation history.

On the final timing review, the user explicitly chose to count device sleep time, accepting device-clock changes as an offline limitation. This supersedes the intermediate monotonic-only timer design.
