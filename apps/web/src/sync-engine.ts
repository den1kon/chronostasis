import {
  isRarityEligibleForDuration,
  PlannedDurationSecondsSchema,
  SyncOperationSchema,
  selectChestReward,
  type SyncOperation,
} from '@chronostasis/contracts';
import {ApiClientError, getSyncSnapshot, postSyncOperations} from './api';
import {withSyncDeadline} from './sync-deadline';
import {
  batchOperations,
  projectSnapshot,
  sessionDeadlineMs,
} from './sync-model';
import {
  openSyncStore,
  type OfflineSession,
  type StoredState,
  type SyncStore,
} from './sync-store';

export type SyncState = Omit<StoredState, 'localSession' | 'authLocked'> & {
  localSession: OfflineSession | null;
  view: ReturnType<typeof projectSnapshot> | null;
  online: boolean;
  syncing: boolean;
  initialized: boolean;
  unauthorized: boolean;
  error: string | null;
};
const empty = {
  snapshot: null,
  pending: [],
  localSession: null,
  outcomes: [],
};

function assertStartAvailable(data: StoredState, online: boolean) {
  const running = data.snapshot?.sessions.find(
    s => s.origin === 'online' && s.status === 'running',
  );
  const pendingFinish = data.pending.some(
    op =>
      (op.type === 'claim_reward' || op.type === 'cancel_session') &&
      op.sessionId === running?.id,
  );
  if (
    data.localSession ||
    data.pending.some(op => op.type === 'start_session') ||
    (running && (online || !pendingFinish)) ||
    (online && data.pending.some(op => op.type === 'offline_session_claim'))
  )
    throw new Error(
      'Finish or sync the current session before starting another.',
    );
}

// The caller supplies the current authenticated Clerk subject. No local record
// can identify the signed-in account. Dispose this instance on identity change.
export function createSyncEngine({
  userId,
  getToken,
}: {
  userId: string;
  getToken: () => Promise<string | null>;
}) {
  if (!userId.trim()) throw new Error('Sign in to access your saved progress.');
  const name = 'chronostasis-sync:' + userId;
  const controller = new AbortController();
  const {signal} = controller;
  const subscribers = new Set<() => void>();
  let state: SyncState = {
    ...empty,
    view: null,
    syncing: false,
    online: navigator.onLine,
    initialized: false,
    unauthorized: false,
    error: null,
  };
  let db: Promise<SyncStore> | undefined;
  let channel: BroadcastChannel | undefined;
  let started = false;
  let denialAwaitingPersistence = false;
  const denialKey = name + ':auth-denied';

  // This independent marker contains only denial metadata. An unreadable
  // journal cannot authorize displaying an old, unlocked IndexedDB record.
  function journalDeniesAccess() {
    try {
      return localStorage.getItem(denialKey) !== null;
    } catch {
      return true;
    }
  }
  function setDenialJournal(locked: boolean) {
    try {
      if (locked) localStorage.setItem(denialKey, '1');
      else localStorage.removeItem(denialKey);
    } catch {
      // IndexedDB, the in-memory latch and live-peer notification still apply.
    }
  }
  let flight: Promise<void> | undefined;
  let enqueueGeneration = 0;
  function publish(changes: Partial<SyncState>) {
    if (signal.aborted) return;
    state = {...state, ...changes};
    subscribers.forEach(listener => {
      listener();
    });
  }
  function store() {
    signal.throwIfAborted();
    db ??= openSyncStore(userId).catch((error: unknown) => {
      db = undefined;
      throw error;
    });
    return db;
  }
  function denyAccess() {
    publish({
      ...empty,
      view: null,
      unauthorized: true,
      error: new ApiClientError('UNAUTHORIZED').message,
    });
  }
  async function reload() {
    const {authLocked, ...data} = await (await store()).readState();
    if (authLocked || denialAwaitingPersistence || journalDeniesAccess()) {
      denyAccess();
      return [];
    }
    publish({
      ...data,
      unauthorized: false,
      ...(state.unauthorized ? {error: null} : {}),
      view: data.snapshot ? projectSnapshot(data.snapshot, data.pending) : null,
    });
    return data.pending;
  }
  async function committed() {
    if (signal.aborted) return [];
    channel?.postMessage(null);
    return await reload();
  }
  function localFailure() {
    publish({error: 'Could not access saved progress in this browser.'});
  }
  function peerChanged() {
    void reload().catch(localFailure);
  }
  function connectivityChanged() {
    if (navigator.onLine) void sync();
    else publish({online: false});
  }

  // Local actions and response installation share the action lock. Network IO
  // holds only the sync lock so another tab can durably enqueue while waiting.
  async function actionLock<T>(run: (storage: SyncStore) => Promise<T>) {
    return await navigator.locks.request(
      name + ':actions',
      {signal},
      async () => {
        const storage = await store();
        signal.throwIfAborted();
        return await run(storage);
      },
    );
  }
  async function token() {
    let value: string | null;
    try {
      value = await withSyncDeadline(getToken, signal);
    } catch {
      throw new ApiClientError('NETWORK_ERROR', true);
    }
    signal.throwIfAborted();
    if (!value) throw new ApiClientError('UNAUTHORIZED');
    return value;
  }
  async function syncOnce(attempted: Set<string>) {
    const storage = await store();
    signal.throwIfAborted();
    if (!navigator.onLine) {
      publish({online: false});
      await reload();
      return;
    }
    let readGeneration = enqueueGeneration;
    const data = await storage.readState();
    let pending = data.pending;
    // Bootstrap once. A read-only refresh reuses a cache only if both
    // versions match. A write batch already returns a complete snapshot.
    if (!data.snapshot || !data.pending.length) {
      const response = await getSyncSnapshot(
        await token(),
        signal,
        data.snapshot ?? undefined,
      );
      signal.throwIfAborted();
      if (!response.unchanged) {
        await actionLock(s => s.saveSnapshot(response.snapshot));
      } else if (data.authLocked) {
        await actionLock(s => s.setAuthLocked(false));
      }
      setDenialJournal(false);
      channel?.postMessage(null);
      denialAwaitingPersistence = false;
      publish({online: true, error: null});
      // The GET may have waited while this or another tab added durable work.
      readGeneration = enqueueGeneration;
      pending = await reload();
    }
    // Other tabs can commit and close during a POST. Read the durable queue
    // after each response, skipping even retryable work already sent this flight.
    const unattempted = (op: SyncOperation) => !attempted.has(op.operationId);
    while (pending.some(unattempted)) {
      const accessToken = await token();
      // A cancellation can withdraw an early claim while Clerk obtains the token.
      readGeneration = enqueueGeneration;
      const current = await storage.readPendingOperations();
      const [batch] = batchOperations(current.filter(unattempted));
      if (!batch) break;
      for (const op of batch) attempted.add(op.operationId);
      const response = await postSyncOperations(accessToken, batch, signal);
      signal.throwIfAborted();
      await actionLock(s => s.applySyncResponse(response));
      setDenialJournal(false);
      denialAwaitingPersistence = false;
      publish({online: true, unauthorized: false, error: null});
      readGeneration = enqueueGeneration;
      pending = await committed();
    }
    return readGeneration;
  }
  // A failed IDB write leaves an old unlocked marker on disk. Keep this
  // instance and live peers locked through local reloads and transport errors.
  async function lockAccount() {
    denialAwaitingPersistence = true;
    setDenialJournal(true);
    denyAccess();
    try {
      await actionLock(s => s.setAuthLocked(true));
      denialAwaitingPersistence = false;
      await committed();
    } catch {
      if (signal.aborted) return;
      channel?.postMessage('auth-lock-failed');
      localFailure();
    }
  }
  async function synchronize() {
    publish({syncing: true, error: null});
    try {
      const attempted = new Set<string>();
      let readGeneration: number | undefined;
      do {
        readGeneration = await navigator.locks.request(
          name + ':network',
          {signal},
          async () => {
            try {
              return await syncOnce(attempted);
            } catch (error) {
              if (
                !signal.aborted &&
                error instanceof ApiClientError &&
                error.code === 'UNAUTHORIZED'
              ) {
                await lockAccount();
                return;
              }
              throw error;
            }
          },
        );
      } while (
        readGeneration !== undefined &&
        readGeneration !== enqueueGeneration &&
        state.online &&
        !state.unauthorized &&
        !signal.aborted
      );
    } catch (error) {
      if (signal.aborted) return;
      const unreachable = error instanceof ApiClientError && error.retryable;
      publish({
        online: navigator.onLine && !unreachable,
        error:
          error instanceof ApiClientError
            ? error.message
            : 'Could not sync your saved progress. Please try again.',
      });
      await reload().catch(localFailure);
    } finally {
      flight = undefined;
      publish({syncing: false, initialized: true});
    }
  }
  function sync(): Promise<void> {
    if (signal.aborted) return Promise.resolve();
    flight ??= synchronize();
    return flight;
  }

  async function change(
    run: (s: SyncStore, data: StoredState) => Promise<void>,
    upload: boolean,
  ) {
    await actionLock(async storage => {
      if (!state.initialized || state.unauthorized)
        throw new Error('Sign in to access your saved progress.');
      const data = await storage.readState();
      signal.throwIfAborted();
      if (data.authLocked || denialAwaitingPersistence || journalDeniesAccess())
        throw new ApiClientError('UNAUTHORIZED');
      if (!data.snapshot)
        throw new Error('Connect to download your account first.');
      await run(storage, data);
      if (upload) enqueueGeneration++;
    });
    await committed();
    if (upload && navigator.onLine && state.online) await sync();
  }
  function subscribe(listener: () => void) {
    subscribers.add(listener);
    return () => {
      subscribers.delete(listener);
    };
  }
  return {
    getState: () => state,
    subscribe,
    sync,
    initialize: async () => {
      if (signal.aborted) return;
      if (!started) {
        started = true;
        if (typeof BroadcastChannel !== 'undefined') {
          channel = new BroadcastChannel(name);
          channel.onmessage = (event: MessageEvent<unknown>) => {
            if (event.data === 'auth-lock-failed') {
              denialAwaitingPersistence = true;
              denyAccess();
            } else peerChanged();
          };
        }
        window.addEventListener('focus', peerChanged);
        window.addEventListener('online', connectivityChanged);
        window.addEventListener('offline', connectivityChanged);
      }
      await sync();
    },
    submitOperation: (operation: SyncOperation) =>
      change(async (storage, data) => {
        const op = SyncOperationSchema.parse(operation);
        batchOperations([op]);
        if (op.type === 'start_session') {
          if (!state.online || !navigator.onLine)
            throw new Error('Connect before starting an online session.');
          if (
            !data.snapshot?.userChests.some(
              entry => entry.chestId === op.chestId,
            )
          )
            throw new Error('Confirm the chest unlock before starting online.');
          assertStartAvailable(data, true);
        }
        if (
          op.type === 'buy_chest' &&
          (!state.online || !navigator.onLine) &&
          data.snapshot
        ) {
          const view = projectSnapshot(data.snapshot, data.pending);
          const chest = data.snapshot.catalogue.chests.find(
            entry => entry.id === op.chestId,
          );
          if (!chest) throw new Error('This chest is unavailable.');
          if (
            !view.unlockedChestIds.includes(chest.id) &&
            view.coins < chest.price
          )
            throw new Error('You need more coins for this chest.');
        }
        await storage.enqueueOperation(op);
      }, true),
    startOfflineSession: (chestId: string, plannedDurationSeconds: number) =>
      change(async (storage, data) => {
        assertStartAvailable(data, false);
        if (
          !data.snapshot ||
          !projectSnapshot(
            data.snapshot,
            data.pending,
          ).unlockedChestIds.includes(chestId)
        )
          throw new Error('Unlock this chest before starting a session.');
        if (
          !PlannedDurationSecondsSchema.safeParse(plannedDurationSeconds)
            .success
        )
          throw new Error('Choose a valid focus duration.');
        const catalogue = data.snapshot.catalogue;
        const candidates = catalogue.chestItems
          .filter(entry => entry.chestId === chestId)
          .map(entry => {
            const item = catalogue.items.find(i => i.id === entry.itemId);
            if (!item)
              throw new Error('The saved chest catalogue is incomplete.');
            return {
              itemId: entry.itemId,
              weight: entry.weight,
              rarity: item.rarity,
            };
          })
          .filter(({rarity}) =>
            isRarityEligibleForDuration(rarity, plannedDurationSeconds),
          );
        if (!candidates.length)
          throw new Error(
            'This chest has no eligible rewards for this duration.',
          );
        await storage.startLocalSession({
          sessionId: crypto.randomUUID(),
          chestId,
          plannedDurationSeconds,
          startedAt: new Date().toISOString(),
          candidates,
        });
      }, false),
    completeOfflineSession: (sessionId: string) =>
      change(async (storage, data) => {
        const local = data.localSession;
        if (!local || local.sessionId !== sessionId || !data.snapshot)
          throw new Error('This timer is no longer running.');
        const endedAt = new Date();
        if (endedAt.getTime() < sessionDeadlineMs(local))
          throw new Error('The focus timer is still running.');
        const {candidates, chestId, plannedDurationSeconds, startedAt} = local;
        const itemId = selectChestReward(
          candidates,
          plannedDurationSeconds,
          max => Math.floor(Math.random() * max),
        );
        const claim = {
          sessionId,
          chestId,
          plannedDurationSeconds,
          startedAt,
          type: 'offline_session_claim' as const,
          operationId: crypto.randomUUID(),
          itemInstanceId: crypto.randomUUID(),
          itemId,
          endedAt: endedAt.toISOString(),
        };
        batchOperations([claim]);
        await storage.finishLocalSession(sessionId, claim);
      }, true),
    cancelOfflineSession: (sessionId: string) =>
      change(storage => storage.finishLocalSession(sessionId), false),
    dispose: () => {
      controller.abort();
      channel?.close();
      window.removeEventListener('online', connectivityChanged);
      window.removeEventListener('offline', connectivityChanged);
      window.removeEventListener('focus', peerChanged);
      subscribers.clear();
      state = {...state, ...empty, view: null, initialized: false};
      void db
        ?.then(storage => {
          storage.close();
        })
        .catch(() => {});
    },
  };
}
export type SyncEngine = ReturnType<typeof createSyncEngine>;
