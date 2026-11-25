import type {
  ChestRewardCandidate,
  OperationOutcome,
  SyncOperation,
  SyncResponse,
  UserSnapshot,
} from '@chronostasis/contracts';

export type OfflineSession = {
  sessionId: string;
  chestId: string;
  plannedDurationSeconds: number;
  startedAt: string;
};
export type StoredState = {
  authLocked: boolean;
  snapshot: UserSnapshot | null;
  pending: SyncOperation[];
  localSession: (OfflineSession & {candidates: ChestRewardCandidate[]}) | null;
  outcomes: OperationOutcome[];
};

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error('Could not access local storage.'));
    };
  });
}

async function readValue<T>(
  store: IDBObjectStore,
  key: string,
): Promise<T | null> {
  return ((await request(store.get(key))) as T | undefined) ?? null;
}

// Removing the local claim intent does not retract a POST already in flight.
// Its snapshot still decides the outcome when that response arrives.
async function withdrawRewardClaims(
  state: IDBObjectStore,
  outbox: IDBObjectStore,
  sessionId: string,
) {
  const pending = (await request(outbox.getAll())) as SyncOperation[];
  const withdrawn = new Set(
    pending
      .filter(op => op.type === 'claim_reward' && op.sessionId === sessionId)
      .map(op => op.operationId),
  );
  if (!withdrawn.size) return;
  const byId = outbox.index('operationId');
  for (const id of withdrawn) {
    const key = await request(byId.getKey(id));
    if (key !== undefined) await request(outbox.delete(key));
  }
  const outcomes = await readValue<OperationOutcome[]>(state, 'outcomes');
  if (outcomes)
    await request(
      state.put(
        outcomes.filter(o => !withdrawn.has(o.operationId)),
        'outcomes',
      ),
    );
}

// Each account has its own database. The outbox's auto-increment keys order even
// simultaneous actions, and its unique index correlates server acknowledgements.
export async function openSyncStore(userId: string) {
  if (!userId.trim()) throw new Error('Sign in to access your saved progress.');
  const open = indexedDB.open('chronostasis-sync:' + userId, 1);
  open.onupgradeneeded = () => {
    open.result.createObjectStore('state');
    open.result
      .createObjectStore('outbox', {autoIncrement: true})
      .createIndex('operationId', 'operationId', {unique: true});
  };
  const db = await request(open);
  db.onversionchange = () => {
    db.close();
  };

  // Resolution requires the transaction's commit event. A synchronous cloning
  // error or a failed asynchronous request rolls back all earlier writes.
  async function transaction<T>(
    mode: IDBTransactionMode,
    run: (state: IDBObjectStore, outbox: IDBObjectStore) => Promise<T>,
  ): Promise<T> {
    const tx = db.transaction(
      ['state', 'outbox'],
      mode,
      mode === 'readwrite' ? {durability: 'strict'} : {},
    );
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => {
        resolve();
      };
      tx.onabort = () => {
        reject(
          tx.error ??
            new DOMException('Local transaction aborted.', 'AbortError'),
        );
      };
    });
    try {
      const results = await Promise.all([
        run(tx.objectStore('state'), tx.objectStore('outbox')),
        done,
      ]);
      return results[0];
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* The transaction has already finished. */
      }
      await done.catch(() => {});
      throw error;
    }
  }
  async function install(state: IDBObjectStore, snapshot: UserSnapshot) {
    const cached = await readValue<UserSnapshot>(state, 'snapshot');
    if (cached && cached.user.id !== snapshot.user.id)
      throw new Error('The server returned a different account.');
    if (!cached || snapshot.revision >= cached.revision)
      await request(state.put(snapshot, 'snapshot'));
    await request(state.put(false, 'authLocked'));
  }

  return {
    close: () => {
      db.close();
    },
    setAuthLocked: (locked: boolean) =>
      transaction('readwrite', async state => {
        await request(state.put(locked, 'authLocked'));
      }),
    loadCachedSnapshot: () =>
      transaction('readonly', state =>
        readValue<UserSnapshot>(state, 'snapshot'),
      ),
    saveSnapshot: (snapshot: UserSnapshot) =>
      transaction('readwrite', state => install(state, snapshot)),
    enqueueOperation: (op: SyncOperation) =>
      transaction('readwrite', async (state, outbox) => {
        if (op.type === 'cancel_session')
          await withdrawRewardClaims(state, outbox, op.sessionId);
        await request(outbox.add(op));
      }),
    readPendingOperations: () =>
      transaction(
        'readonly',
        async (_state, outbox) =>
          (await request(outbox.getAll())) as SyncOperation[],
      ),
    readState: () =>
      transaction('readonly', async (state, outbox): Promise<StoredState> => {
        const [snapshot, pending, localSession, outcomes, authLocked] =
          await Promise.all([
            readValue<UserSnapshot>(state, 'snapshot'),
            request(outbox.getAll()),
            readValue<NonNullable<StoredState['localSession']>>(
              state,
              'localSession',
            ),
            readValue<OperationOutcome[]>(state, 'outcomes'),
            readValue<boolean>(state, 'authLocked'),
          ]);
        return {
          authLocked: authLocked ?? false,
          snapshot,
          pending: pending as SyncOperation[],
          localSession,
          outcomes: outcomes ?? [],
        };
      }),
    startLocalSession: (session: NonNullable<StoredState['localSession']>) =>
      transaction('readwrite', async state => {
        await request(state.add(session, 'localSession'));
      }),
    // A losing tab cannot finish a replacement timer. Clearing and (on
    // completion) enqueueing its stable item claim share a single commit.
    finishLocalSession: (
      sessionId: string,
      claim?: Extract<SyncOperation, {type: 'offline_session_claim'}>,
    ) =>
      transaction('readwrite', async (state, outbox) => {
        const local = await readValue<OfflineSession>(state, 'localSession');
        if (
          local?.sessionId !== sessionId ||
          (claim && claim.sessionId !== sessionId)
        )
          throw new Error('This timer is no longer running.');
        if (claim) await request(outbox.add(claim));
        await request(state.delete('localSession'));
      }),
    applySyncResponse: (response: SyncResponse) =>
      transaction('readwrite', async (state, outbox) => {
        await install(state, response.snapshot);
        const byId = outbox.index('operationId');
        const previous =
          (await readValue<OperationOutcome[]>(state, 'outcomes')) ?? [];
        const matched: OperationOutcome[] = [];
        for (const outcome of response.outcomes) {
          const key = await request(byId.getKey(outcome.operationId));
          if (key === undefined) continue;
          const operation = (await request(outbox.get(key))) as SyncOperation;
          if (operation.type !== outcome.type) continue;
          matched.push(outcome);
          if (!(outcome.status === 'rejected' && outcome.retryable))
            await request(outbox.delete(key));
        }
        // Keep recent rejection explanations visible across subsequent successful batches and reloads.
        const seen = new Set(matched.map(entry => entry.operationId));
        const remaining = previous.filter(
          entry => entry.status === 'rejected' && !seen.has(entry.operationId),
        );
        const pendingRejections = remaining.filter(entry => entry.retryable);
        const recentRejections = remaining
          .filter(entry => !entry.retryable)
          .slice(-20);
        await request(
          state.put(
            [...recentRejections, ...pendingRejections, ...matched],
            'outcomes',
          ),
        );
      }),
  };
}
export type SyncStore = Awaited<ReturnType<typeof openSyncStore>>;
