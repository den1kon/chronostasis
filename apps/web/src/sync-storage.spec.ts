import {expect, test, type Page} from '@playwright/test';
import type {SyncOperation, UserSnapshot} from '@chronostasis/contracts';

const snapshot: UserSnapshot = {
  revision: 1,
  catalogueVersion: 'z',
  user: {id: '11212155-574c-4ebe-a35c-d49d66cb3ce4', coins: 0},
  catalogue: {
    chests: [
      {
        id: 'basic',
        price: 0,
        name: 'Chest',
        spriteX: 0,
        spriteY: 0,
        description: '',
      },
    ],
    items: [
      {
        id: 'gem',
        rarity: 'common',
        name: 'Gem',
        spriteX: 0,
        spriteY: 0,
        description: '',
        stats: {},
      },
    ],
    chestItems: [{chestId: 'basic', itemId: 'gem', weight: 1}],
  },
  userChests: [{chestId: 'basic', unlockedAt: '2026-01-01T00:00:00Z'}],
  items: [],
  sessions: [],
};
const buy = (): SyncOperation => ({
  type: 'buy_chest',
  operationId: crypto.randomUUID(),
  chestId: 'basic',
});

// The storage suite loads the real Vite modules on an empty same-origin page.
async function openPage(page: Page) {
  await page.route('**/storage-test', route =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Storage tests</title>',
    }),
  );
  await page.goto('/storage-test');
}
async function engineFor(page: Page, getToken?: () => Promise<string>) {
  if (getToken) await page.exposeFunction('getStorageTestToken', getToken);
  return await page.evaluateHandle(async () => {
    const path = '/src/sync-engine.ts';
    const {createSyncEngine} = (await import(
      path
    )) as typeof import('./sync-engine');
    const engine = createSyncEngine({
      userId: 'user_a',
      getToken:
        (window as Window & {getStorageTestToken?: () => Promise<string>})
          .getStorageTestToken ?? (() => Promise.resolve('memory-only')),
    });
    await engine.initialize();
    return engine;
  });
}

test('reopening preserves account-isolated order; stale responses acknowledge just their matching work', async ({
  page,
}) => {
  await openPage(page);
  const first = buy(),
    second = buy();
  const data = await page.evaluate(
    async ({encoded, first, second}) => {
      const snapshot = JSON.parse(encoded) as UserSnapshot;
      const path = '/src/sync-store.ts';
      const {openSyncStore} = (await import(
        path
      )) as typeof import('./sync-store');
      const initial = await openSyncStore('user_a');
      await initial.saveSnapshot(snapshot);
      await initial.enqueueOperation(first);
      await initial.enqueueOperation(second);
      initial.close();
      const store = await openSyncStore('user_a');
      const before = await store.readPendingOperations();
      await store.applySyncResponse({
        snapshot: {...snapshot, revision: 0},
        outcomes: [
          {
            ...{operationId: first.operationId, type: first.type},
            status: 'accepted',
            retryable: false,
          },
        ],
      });
      const old = await store.loadCachedSnapshot();
      await store.saveSnapshot({...snapshot, catalogueVersion: 'a'});
      const other = await openSyncStore('user_b');
      return {
        before,
        old,
        current: await store.loadCachedSnapshot(),
        pending: await store.readPendingOperations(),
        other: await other.readState(),
      };
    },
    {encoded: JSON.stringify(snapshot), first, second},
  );
  expect(data.before).toEqual([first, second]);
  expect(data.old).toEqual(snapshot);
  expect(data.current).toEqual({...snapshot, catalogueVersion: 'a'});
  expect(data.pending).toEqual([second]);
  expect(data.other).toMatchObject({
    snapshot: null,
    pending: [],
    localSession: null,
  });
});

test('a native transaction abort restores both the previous snapshot and its pending operation', async ({
  page,
}) => {
  await openPage(page);
  const first = buy();
  const result = await page.evaluate(
    async ({encoded, first}) => {
      const snapshot = JSON.parse(encoded) as UserSnapshot;
      const path = '/src/sync-store.ts';
      const {openSyncStore} = (await import(
        path
      )) as typeof import('./sync-store');
      const store = await openSyncStore('user_a');
      await store.saveSnapshot(snapshot);
      await store.enqueueOperation(first);
      // eslint-disable-next-line @typescript-eslint/unbound-method -- The fault injector supplies the native receiver via call.
      const original = IDBObjectStore.prototype.delete;
      IDBObjectStore.prototype.delete = function (key) {
        const request = original.call(this, key);
        request.addEventListener('success', () => {
          this.transaction.abort();
        });
        return request;
      };
      try {
        await store.applySyncResponse({
          snapshot: {...snapshot, revision: 2},
          outcomes: [
            {
              operationId: first.operationId,
              type: first.type,
              status: 'accepted',
              retryable: false,
            },
          ],
        });
        throw new Error('Expected the aborted transaction to reject');
      } catch (error) {
        if (!(error instanceof DOMException)) throw error;
      } finally {
        IDBObjectStore.prototype.delete = original;
      }
      return await store.readState();
    },
    {encoded: JSON.stringify(snapshot), first},
  );
  expect(result).toMatchObject({snapshot, pending: [first]});
});

test('offline completion persists its claim and clears the local timer together across tabs', async ({
  context,
  page,
}) => {
  await page.clock.install();
  await context.route('**/api/sync*', route =>
    route.fulfill({json: {unchanged: false, snapshot}}),
  );
  const peer = await context.newPage();
  await Promise.all([openPage(page), openPage(peer)]);
  const engine = await engineFor(page),
    other = await engineFor(peer);
  await context.setOffline(true);
  await engine.evaluate(e => e.startOfflineSession('basic', 900));
  const running = await engine.evaluate(e => e.getState().localSession);
  expect(running).toBeTruthy();
  if (!running) throw new Error('Expected a running session');
  await expect
    .poll(() => other.evaluate(e => e.getState().localSession))
    .toEqual(running);
  await page.clock.fastForward(900_000);
  const aborted = await engine.evaluate(async (e, id) => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- The fault injector supplies the native receiver via call.
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (value, key) {
      const req = original.call(this, value, key);
      req.addEventListener('success', () => {
        this.transaction.abort();
      });
      return req;
    };
    try {
      await e.completeOfflineSession(id);
      return false;
    } catch {
      return true;
    } finally {
      IDBObjectStore.prototype.add = original;
    }
  }, running.sessionId);
  expect(aborted).toBe(true);
  expect(await engine.evaluate(e => e.getState().localSession)).toEqual(
    running,
  );
  const attempts = await Promise.allSettled([
    engine.evaluate((e, id) => e.completeOfflineSession(id), running.sessionId),
    other.evaluate((e, id) => e.completeOfflineSession(id), running.sessionId),
  ]);
  expect(attempts.filter(a => a.status === 'fulfilled')).toHaveLength(1);
  await expect
    .poll(() => other.evaluate(e => e.getState().pending.length))
    .toBe(1);
  const state = await other.evaluate(e => e.getState());
  expect(state).toMatchObject({
    localSession: null,
    pending: [{type: 'offline_session_claim', sessionId: running.sessionId}],
    view: {items: [{pending: true, isVerified: false}]},
  });
  await engine.evaluate(e => {
    e.dispose();
  });
  const reopened = await engineFor(page);
  expect(await reopened.evaluate(e => e.getState().pending)).toEqual(
    state.pending,
  );
});

test('transport failure keeps the original online start; an early claim survives while later work gets acknowledged', async ({
  page,
  context,
}) => {
  let fail = true;
  const uploads: string[][] = [];
  await context.route('**/api/sync*', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({json: {unchanged: false, snapshot}});
      return;
    }
    const {operations} = route.request().postDataJSON() as {
      operations: SyncOperation[];
    };
    uploads.push(operations.map(op => op.operationId));
    if (fail) {
      await route.fulfill({status: 503});
      return;
    }
    await route.fulfill({
      json: {
        snapshot,
        outcomes: operations.map(op => ({
          operationId: op.operationId,
          type: op.type,
          status: op.type === 'claim_reward' ? 'rejected' : 'accepted',
          retryable: op.type === 'claim_reward',
        })),
      },
    });
  });
  await openPage(page);
  const engine = await engineFor(page);
  const start: SyncOperation = {
    type: 'start_session',
    operationId: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    chestId: 'basic',
    plannedDurationSeconds: 900,
  };
  await engine.evaluate((e, op) => e.submitOperation(op), start);
  expect(await engine.evaluate(e => e.getState())).toMatchObject({
    pending: [start],
    online: false,
  });
  await expect(
    engine.evaluate(e => e.startOfflineSession('basic', 900)),
  ).rejects.toThrow();
  fail = false;
  await engine.evaluate(e => e.sync());
  expect(uploads).toEqual([[start.operationId], [start.operationId]]);
  await context.setOffline(true);
  const claim: SyncOperation = {
    type: 'claim_reward',
    operationId: crypto.randomUUID(),
    sessionId: start.sessionId,
  };
  await engine.evaluate((e, op) => e.submitOperation(op), claim);
  const later = buy();
  await engine.evaluate((e, op) => e.submitOperation(op), later);
  await context.setOffline(false);
  await expect
    .poll(() => engine.evaluate(e => e.getState().pending))
    .toEqual([claim]);
  expect(uploads.slice(2)).toEqual([[claim.operationId, later.operationId]]);
  expect(await engine.evaluate(e => e.getState().view?.items)).toEqual([]);
});

test('one tab can enqueue during another upload; the second request waits for the first commit', async ({
  context,
  page,
}) => {
  let releaseUpload = () => {};
  let markArrived = () => {};
  const held = new Promise<void>(resolve => {
    releaseUpload = resolve;
  });
  const arrived = new Promise<void>(resolve => {
    markArrived = resolve;
  });
  const batches: string[][] = [];
  let active = 0;
  let concurrent = false;
  await context.route('**/api/sync*', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({json: {unchanged: false, snapshot}});
      return;
    }
    if (++active > 1) concurrent = true;
    const {operations} = route.request().postDataJSON() as {
      operations: SyncOperation[];
    };
    batches.push(operations.map(op => op.operationId));
    if (batches.length === 1) {
      markArrived();
      await held;
    }
    active--;
    await route.fulfill({
      json: {
        snapshot,
        outcomes: operations.map(op => ({
          type: op.type,
          operationId: op.operationId,
          status: 'accepted',
          retryable: false,
        })),
      },
    });
  });
  const peer = await context.newPage();
  await Promise.all([openPage(page), openPage(peer)]);
  const a = await engineFor(page),
    b = await engineFor(peer);
  const first = buy(),
    second = buy();
  const req1 = a.evaluate((e, op) => e.submitOperation(op), first);
  await arrived;
  const req2 = b.evaluate((e, op) => e.submitOperation(op), second);
  try {
    await expect
      .poll(() => b.evaluate(e => e.getState().pending))
      .toEqual([first, second]);
  } finally {
    releaseUpload();
  }
  await Promise.all([req1, req2]);
  expect(concurrent).toBe(false);
  expect(batches).toEqual([[first.operationId], [second.operationId]]);
  await expect.poll(() => a.evaluate(e => e.getState().pending)).toEqual([]);
});

test('a token rejection locks saved progress while preserving pending work for the same account', async ({
  context,
  page,
}) => {
  let status = 200;
  await context.route('**/api/sync*', route => {
    if (status !== 200) return route.fulfill({status});
    if (route.request().method() === 'GET')
      return route.fulfill({json: {unchanged: false, snapshot}});
    const {operations} = route.request().postDataJSON() as {
      operations: SyncOperation[];
    };
    return route.fulfill({
      json: {
        snapshot,
        outcomes: operations.map(op => ({
          operationId: op.operationId,
          type: op.type,
          status: 'accepted',
        })),
      },
    });
  });
  const peer = await context.newPage();
  await Promise.all([openPage(page), openPage(peer)]);
  const engine = await engineFor(page),
    other = await engineFor(peer);
  status = 401;
  const op = buy();
  await engine.evaluate((e, op) => e.submitOperation(op), op);
  expect(await engine.evaluate(e => e.getState())).toMatchObject({
    snapshot: null,
    localSession: null,
    view: null,
    unauthorized: true,
    pending: [],
  });
  const persisted = await page.evaluate(async () => {
    const path = '/src/sync-store.ts';
    const {openSyncStore} = (await import(
      path
    )) as typeof import('./sync-store');
    return await (await openSyncStore('user_a')).readState();
  });
  expect(persisted).toMatchObject({snapshot, pending: [op]});
  expect(JSON.stringify(persisted)).not.toContain('memory-only');
  await context.setOffline(true);
  await engine.evaluate(e => e.sync());
  await expect(
    engine.evaluate(e => e.startOfflineSession('basic', 900)),
  ).rejects.toThrow();
  expect(await engine.evaluate(e => e.getState().view)).toBeNull();
  await expect
    .poll(() => other.evaluate(e => e.getState().unauthorized))
    .toBe(true);
  await engine.evaluate(e => {
    e.dispose();
  });
  const reopened = await engineFor(page);
  expect(await reopened.evaluate(e => e.getState())).toMatchObject({
    unauthorized: true,
    view: null,
    pending: [],
  });
  await expect(
    other.evaluate(e => e.startOfflineSession('basic', 900)),
  ).rejects.toThrow();
  status = 200;
  await context.setOffline(false);
  await expect
    .poll(() =>
      reopened.evaluate(e => ({
        locked: e.getState().unauthorized,
        pending: e.getState().pending,
      })),
    )
    .toEqual({locked: false, pending: []});
  await expect
    .poll(() => other.evaluate(e => e.getState().snapshot))
    .toEqual(snapshot);
});

test('a local timer keeps its original reward pool if a reconnect removes chest eligibility', async ({
  context,
  page,
}) => {
  let removed = false;
  await page.clock.install();
  await context.route('**/api/sync*', route =>
    route.fulfill({
      json: {
        unchanged: false,
        snapshot: removed
          ? {
              ...snapshot,
              catalogueVersion: 'new',
              catalogue: {...snapshot.catalogue, chestItems: []},
            }
          : snapshot,
      },
    }),
  );
  await openPage(page);
  const engine = await engineFor(page);
  await context.setOffline(true);
  await engine.evaluate(e => e.startOfflineSession('basic', 900));
  const running = await engine.evaluate(e => e.getState().localSession);
  if (!running) throw new Error('Missing local session');
  removed = true;
  await context.setOffline(false);
  await expect
    .poll(() => engine.evaluate(e => e.getState().snapshot?.catalogueVersion))
    .toBe('new');
  await context.setOffline(true);
  await page.clock.fastForward(900_000);
  await engine.evaluate(
    (e, id) => e.completeOfflineSession(id),
    running.sessionId,
  );
  expect(await engine.evaluate(e => e.getState().pending)).toMatchObject([
    {
      type: 'offline_session_claim',
      itemId: 'gem',
      sessionId: running.sessionId,
    },
  ]);
});

test('offline Mythic-only starts persist a timer only at an eligible duration', async ({
  context,
  page,
}) => {
  const mythic = {
    ...snapshot,
    catalogue: {
      ...snapshot.catalogue,
      items: snapshot.catalogue.items.map(item => ({
        ...item,
        rarity: 'mythic',
      })),
    },
  };
  await context.route('**/api/sync*', route =>
    route.fulfill({json: {unchanged: false, snapshot: mythic}}),
  );
  await openPage(page);
  const engine = await engineFor(page);
  await context.setOffline(true);
  await expect(
    engine.evaluate(e => e.startOfflineSession('basic', 3300)),
  ).rejects.toThrow(/no eligible rewards/i);
  await engine.evaluate(e => {
    e.dispose();
  });
  const reopened = await engineFor(page);
  expect(await reopened.evaluate(e => e.getState().localSession)).toBeNull();
  await reopened.evaluate(e => e.startOfflineSession('basic', 3600));
  await reopened.evaluate(e => {
    e.dispose();
  });
  const afterStart = await engineFor(page);
  expect(
    await afterStart.evaluate(e => e.getState().localSession),
  ).toMatchObject({
    chestId: 'basic',
    plannedDurationSeconds: 3600,
    candidates: [{itemId: 'gem', rarity: 'mythic', weight: 1}],
  });
});

test('a token-refresh network error allows cached offline use with a known identity', async ({
  page,
  context,
}) => {
  await context.route('**/api/sync*', route =>
    route.fulfill({json: {unchanged: false, snapshot}}),
  );
  await openPage(page);
  const previous = await engineFor(page);
  await previous.evaluate(e => {
    e.dispose();
  });
  const state = await page.evaluate(async () => {
    const path = '/src/sync-engine.ts';
    const {createSyncEngine} = (await import(
      path
    )) as typeof import('./sync-engine');
    const engine = createSyncEngine({
      userId: 'user_a',
      getToken: () => Promise.reject(new Error('token service unreachable')),
    });
    await engine.initialize();
    return engine.getState();
  });
  expect(state).toMatchObject({
    online: false,
    unauthorized: false,
    snapshot,
    view: {coins: 0},
  });
});

test('a stalled token request preserves the queued operation and retries it unchanged', async ({
  page,
  context,
}) => {
  await openPage(page);
  await page.clock.install();
  const sent: SyncOperation[] = [];
  await context.route('**/api/sync*', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({json: {unchanged: false, snapshot}});
      return;
    }
    const {operations} = route.request().postDataJSON() as {
      operations: SyncOperation[];
    };
    sent.push(...operations);
    await route.fulfill({
      json: {
        snapshot,
        outcomes: operations.map(op => ({
          operationId: op.operationId,
          type: op.type,
          status: 'already_processed',
          retryable: false,
        })),
      },
    });
  });
  const client = await page.evaluateHandle(async () => {
    const path = '/src/sync-engine.ts';
    const {createSyncEngine} = (await import(
      path
    )) as typeof import('./sync-engine');
    let calls = 0;
    const engine = createSyncEngine({
      userId: 'user_a',
      getToken: () => {
        calls++;
        return calls === 2
          ? new Promise<string>(() => {})
          : Promise.resolve('fixture-token');
      },
    });
    await engine.initialize();
    return {engine, tokenCalls: () => calls};
  });
  const purchase = buy();
  await client.evaluate(({engine}, operation) => {
    void engine.submitOperation(operation);
  }, purchase);
  await expect
    .poll(() => client.evaluate(({tokenCalls}) => tokenCalls()))
    .toBe(2);
  await page.clock.fastForward(15_000);
  await expect
    .poll(() => client.evaluate(({engine}) => engine.getState()), {
      timeout: 2_000,
    })
    .toMatchObject({online: false, syncing: false, pending: [purchase]});
  expect(sent).toEqual([]);
  await client.evaluate(({engine}) => engine.sync());
  expect(sent).toEqual([purchase]);
  expect(await client.evaluate(({engine}) => engine.getState())).toMatchObject({
    online: true,
    pending: [],
  });
});

test('online starts require confirmed chest access and offline purchases require locally available coins', async ({
  context,
  page,
}) => {
  const locked = {
    ...snapshot,
    userChests: [],
    catalogue: {
      ...snapshot.catalogue,
      chests: [
        ...snapshot.catalogue.chests,
        ...snapshot.catalogue.chests.map(chest => ({
          ...chest,
          id: 'expensive',
          price: 1,
        })),
      ],
    },
  };
  let releasePurchase = () => {};
  const held = new Promise<void>(resolve => {
    releasePurchase = resolve;
  });
  const purchase = buy();
  await context.route('**/api/sync*', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({json: {unchanged: false, snapshot: locked}});
      return;
    }
    await held;
    await route.fulfill({
      json: {
        snapshot: {...locked, userChests: snapshot.userChests},
        outcomes: [
          {
            type: purchase.type,
            operationId: purchase.operationId,
            status: 'accepted',
          },
        ],
      },
    });
  });
  await openPage(page);
  const engine = await engineFor(page);
  const op: SyncOperation = {
    type: 'start_session',
    operationId: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    chestId: 'basic',
    plannedDurationSeconds: 900,
  };
  const submission = engine.evaluate(
    (e, op) => e.submitOperation(op),
    purchase,
  );
  try {
    await expect
      .poll(() => engine.evaluate(e => e.getState().view?.unlockedChestIds))
      .toEqual(['basic']);
    await expect(
      engine.evaluate((e, op) => e.submitOperation(op), op),
    ).rejects.toThrow(/unlock|access/i);
  } finally {
    releasePurchase();
  }
  await submission;
  await context.setOffline(true);
  const expensive: SyncOperation = {
    type: 'buy_chest',
    operationId: crypto.randomUUID(),
    chestId: 'expensive',
  };
  await expect(
    engine.evaluate((e, op) => e.submitOperation(op), expensive),
  ).rejects.toThrow(/coins/i);
  expect(await engine.evaluate(e => e.getState().pending)).toEqual([]);
});

test('a failed auth-lock write hides saved progress from live and fresh offline tabs until authentication', async ({
  context,
  page,
}) => {
  let status = 200;
  const uploaded: SyncOperation[] = [];
  await context.route('**/api/sync*', route => {
    if (status !== 200) return route.fulfill({status});
    if (route.request().method() === 'GET')
      return route.fulfill({json: {unchanged: false, snapshot}});
    const {operations} = route.request().postDataJSON() as {
      operations: SyncOperation[];
    };
    uploaded.push(...operations);
    return route.fulfill({
      json: {
        snapshot,
        outcomes: operations.map(op => ({
          type: op.type,
          operationId: op.operationId,
          status: 'accepted',
        })),
      },
    });
  });
  const peer = await context.newPage();
  await Promise.all([openPage(page), openPage(peer)]);
  const engine = await engineFor(page),
    other = await engineFor(peer);
  const op = buy();
  status = 503;
  await engine.evaluate(e => e.sync());
  expect(await engine.evaluate(e => e.getState())).toMatchObject({
    snapshot,
    unauthorized: false,
    online: false,
  });
  await engine.evaluate((e, op) => e.submitOperation(op), op);
  expect(await engine.evaluate(e => e.getState().pending)).toEqual([op]);
  status = 401;
  await engine.evaluate(async e => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Fault injection supplies the native receiver via call.
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      const request = original.call(this, value, key);
      if (key === 'authLocked' && value === true)
        request.addEventListener('success', () => {
          this.transaction.abort();
        });
      return request;
    };
    try {
      await e.sync();
    } finally {
      IDBObjectStore.prototype.put = original;
    }
  });
  expect(await engine.evaluate(e => e.getState())).toMatchObject({
    unauthorized: true,
    snapshot: null,
  });
  await expect
    .poll(() => other.evaluate(e => e.getState().unauthorized))
    .toBe(true);
  status = 503;
  await engine.evaluate(async e => {
    window.dispatchEvent(new Event('focus'));
    await e.sync();
  });
  expect(await engine.evaluate(e => e.getState())).toMatchObject({
    unauthorized: true,
    snapshot: null,
    view: null,
  });
  await expect(
    engine.evaluate(e => e.startOfflineSession('basic', 900)),
  ).rejects.toThrow();
  await Promise.all([
    engine.evaluate(e => {
      e.dispose();
    }),
    other.evaluate(e => {
      e.dispose();
    }),
  ]);
  const freshPage = await context.newPage();
  await openPage(freshPage);
  await freshPage.evaluate(async () => {
    const path = '/src/sync-engine.ts';
    await import(path);
  });
  await context.setOffline(true);
  const fresh = await engineFor(freshPage);
  expect(await fresh.evaluate(e => e.getState())).toMatchObject({
    unauthorized: true,
    snapshot: null,
    view: null,
    pending: [],
  });
  await expect(
    fresh.evaluate(e => e.startOfflineSession('basic', 900)),
  ).rejects.toThrow();
  status = 200;
  await context.setOffline(false);
  await expect
    .poll(() => fresh.evaluate(e => e.getState()))
    .toMatchObject({
      unauthorized: false,
      online: true,
      snapshot,
      pending: [],
    });
  expect(uploaded).toEqual([op]);
});

for (const [actor, method] of [
  ['reconnecting tab', 'GET'],
  ['offline peer', 'GET'],
  ['offline peer', 'POST'],
] as const) {
  test(`a claim queued by the ${actor} during a reconnect ${method} uploads automatically`, async ({
    page,
    context,
  }) => {
    let reconnect = false;
    let reader: Page | undefined;
    let releaseRead = () => {};
    const held = new Promise<void>(resolve => {
      releaseRead = resolve;
    });
    let canonical = snapshot;
    const posted: SyncOperation[] = [];
    await page.clock.install();
    await context.route('**/api/sync*', async route => {
      if (reconnect && route.request().method() === method && !reader) {
        reader = route.request().frame().page();
        await held;
      }
      if (route.request().method() === 'GET') {
        await route.fulfill({json: {unchanged: false, snapshot: canonical}});
        return;
      }
      const {operations} = route.request().postDataJSON() as {
        operations: SyncOperation[];
      };
      if (operations.every(op => op.type === 'buy_chest')) {
        await route.fulfill({
          json: {
            snapshot: canonical,
            outcomes: operations.map(op => ({
              type: op.type,
              operationId: op.operationId,
              status: 'accepted',
            })),
          },
        });
        return;
      }
      posted.push(...operations);
      const claim = operations[0];
      if (claim?.type !== 'offline_session_claim')
        throw new Error('Expected an offline claim');
      canonical = {
        ...snapshot,
        revision: 2,
        items: [
          {
            id: claim.itemInstanceId,
            itemId: claim.itemId,
            sessionId: claim.sessionId,
            acquisitionSource: 'offline_claim',
            receivedAt: claim.endedAt,
            isVerified: false,
          },
        ],
        sessions: [
          {
            id: claim.sessionId,
            chestId: claim.chestId,
            plannedDurationSeconds: claim.plannedDurationSeconds,
            startedAt: claim.startedAt,
            endedAt: claim.endedAt,
            origin: 'offline',
            status: 'completed',
          },
        ],
      };
      await route.fulfill({
        json: {
          snapshot: canonical,
          outcomes: [
            {
              operationId: claim.operationId,
              type: claim.type,
              status: 'accepted_unverified',
            },
          ],
        },
      });
    });
    const pages =
      actor === 'offline peer' ? [page, await context.newPage()] : [page];
    const engines = new Map<Page, Awaited<ReturnType<typeof engineFor>>>();
    for (const tab of pages) {
      await openPage(tab);
      engines.set(tab, await engineFor(tab));
    }
    const initial = engines.get(page);
    if (!initial) throw new Error('Missing initial tab');
    await context.setOffline(true);
    await initial.evaluate(e => e.startOfflineSession('basic', 900));
    const local = await initial.evaluate(e => e.getState().localSession);
    if (!local) throw new Error('Missing local session');
    await page.clock.fastForward(900_000);

    if (method === 'POST')
      await initial.evaluate((e, op) => e.submitOperation(op), buy());
    reconnect = true;
    await context.setOffline(false);
    let saved: SyncOperation[];
    try {
      await expect.poll(() => Boolean(reader)).toBe(true);
      const writer =
        actor === 'reconnecting tab'
          ? reader
          : pages.find(tab => tab !== reader);
      const engine = writer && engines.get(writer);
      if (!engine) throw new Error('Missing writer tab');
      expect(await engine.evaluate(e => e.getState().online)).toBe(false);
      await engine.evaluate(
        (e, id) => e.completeOfflineSession(id),
        local.sessionId,
      );
      saved = await engine.evaluate(e =>
        e.getState().pending.filter(op => op.type === 'offline_session_claim'),
      );
      expect(saved).toMatchObject([
        {type: 'offline_session_claim', sessionId: local.sessionId},
      ]);
      // Close the finishing peer so only the tab already holding the request can upload.
      if (actor === 'offline peer') await writer.close();
    } finally {
      releaseRead();
    }
    const engine = reader && engines.get(reader);
    if (!engine) throw new Error('Missing reconnecting tab');
    await expect
      .poll(() => engine.evaluate(e => e.getState().syncing))
      .toBe(false);
    expect(posted).toEqual(saved);
    expect(await engine.evaluate(e => e.getState())).toMatchObject({
      pending: [],
      view: {
        items: [
          {pending: false, isVerified: false, sessionId: local.sessionId},
        ],
      },
      outcomes: [{status: 'accepted_unverified'}],
    });
  });
}

for (const scenario of [
  {
    name: 'counts ten minutes of device sleep after five minutes awake',
    jump: 600_000,
    remaining: '00:00',
  },
  {
    name: 'honors a forward clock correction across a Focus remount',
    jump: 3_600_000,
    remaining: '00:00',
  },
  {
    name: 'honors a backward clock correction across a document reload',
    jump: -3_600_000,
    remaining: '69:59',
  },
]) {
  test(`the offline timer ${scenario.name}`, async ({page, context}) => {
    let apiAvailable = true;
    await context.route('**/api/sync*', route =>
      route.fulfill(
        apiAvailable ? {json: {unchanged: false, snapshot}} : {status: 503},
      ),
    );
    await openPage(page);
    const start = Date.parse('2026-01-01T12:00:00Z');
    await page.clock.install({time: start - 1_000});
    await page.clock.pauseAt(start);
    let engine = await engineFor(page);
    async function mount() {
      return await engine.evaluateHandle(async e => {
        const path = '/src/sync-focus.fixture.tsx';
        const {mountFocus} = (await import(
          path
        )) as typeof import('./sync-focus.fixture');
        return mountFocus(e);
      });
    }
    apiAvailable = false;
    await engine.evaluate(e => e.sync());
    await engine.evaluate(e => e.startOfflineSession('basic', 900));
    const session = await engine.evaluate(e => e.getState().localSession);
    if (!session) throw new Error('Expected a local timer');
    const unmount = await mount();
    const timer = page.getByRole('timer');
    const claim = page.getByRole('button', {name: 'Claim reward'});
    await expect(timer).toHaveText('15:00');
    await page.clock.fastForward(300_000);
    await expect(timer).toHaveText('10:00');
    await expect(claim).toBeDisabled();
    await expect(
      engine.evaluate(
        (e, id) => e.completeOfflineSession(id),
        session.sessionId,
      ),
    ).rejects.toThrow(/still running/i);

    // System time advances during sleep on devices whose performance clock pauses.
    const before = await page.evaluate(() => performance.now());
    await page.clock.setSystemTime(start + 300_000 + scenario.jump);
    expect(await page.evaluate(() => performance.now())).toBe(before);
    await page.clock.fastForward(1_000);
    await expect(timer).toHaveText(scenario.remaining, {timeout: 2000});
    if (scenario.jump < 0) {
      await page.reload();
      engine = await engineFor(page);
      await mount();
      await expect(timer).toHaveText(scenario.remaining);
      await expect(claim).toBeDisabled();
      await expect(
        engine.evaluate(
          (e, id) => e.completeOfflineSession(id),
          session.sessionId,
        ),
      ).rejects.toThrow(/still running/i);
      await page.clock.fastForward(4_199_000);
    } else if (scenario.jump > 600_000) {
      await unmount.evaluate(fn => {
        fn();
      });
      await mount();
      await expect(timer).toHaveText(scenario.remaining);
    }
    await expect(claim).toBeEnabled();
    const endedAt = await page.evaluate(() => new Date().toISOString());
    await claim.dispatchEvent('click');
    await expect
      .poll(() => engine.evaluate(e => e.getState()))
      .toMatchObject({
        localSession: null,
        pending: [
          {
            type: 'offline_session_claim',
            startedAt: session.startedAt,
            endedAt,
          },
        ],
        view: {items: [{pending: true, isVerified: false}]},
      });
  });
}

for (const retry of ['none', 'token', 'early', 'completed'] as const) {
  test(`cancel withdraws an early claim with ${retry} retry and reconciles the server result`, async ({
    context,
    page,
  }) => {
    const session = {
      id: crypto.randomUUID(),
      origin: 'online',
      status: 'running',
      chestId: 'basic',
      plannedDurationSeconds: 900,
      startedAt: '2026-01-01T12:00:00Z',
      endedAt: null,
    } as const;
    const claim = {
      type: 'claim_reward',
      sessionId: session.id,
      operationId: crypto.randomUUID(),
    } as const;
    const cancel = {
      type: 'cancel_session',
      sessionId: session.id,
      operationId: crypto.randomUUID(),
    } as const;
    const purchase = buy();
    const item = {
      id: crypto.randomUUID(),
      itemId: 'gem',
      sessionId: session.id,
      receivedAt: '2026-01-01T12:15:00Z',
      isVerified: true,
      acquisitionSource: 'session_reward',
    } as const;
    let canonical: UserSnapshot = {...snapshot, sessions: [session]};
    let releaseRetry = () => {};
    const held = new Promise<void>(resolve => {
      releaseRetry = resolve;
    });
    const uploads: SyncOperation[] = [];
    await context.route('**/api/sync*', async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({json: {unchanged: false, snapshot: canonical}});
        return;
      }
      const {operations} = route.request().postDataJSON() as {
        operations: SyncOperation[];
      };
      const result = [];
      for (const op of operations) {
        const identity = {operationId: op.operationId, type: op.type};
        const isRetry = uploads.some(
          prior => prior.operationId === op.operationId,
        );
        uploads.push(op);
        if (op.type === 'claim_reward') {
          if (isRetry) await held;
          if (!isRetry || retry !== 'completed') {
            result.push({
              ...identity,
              status: 'rejected',
              retryable: true,
              code: 'session_too_early',
            });
            continue;
          }
          canonical = {
            ...canonical,
            revision: 2,
            items: [item],
            sessions: [
              {...session, status: 'completed', endedAt: item.receivedAt},
            ],
          };
        }
        if (op.type === 'cancel_session') {
          if (canonical.sessions[0]?.status === 'completed') {
            result.push({
              ...identity,
              status: 'rejected',
              code: 'session_conflict',
            });
            continue;
          }
          canonical = {
            ...canonical,
            revision: 2,
            sessions: [
              {...session, status: 'cancelled', endedAt: item.receivedAt},
            ],
          };
        }
        result.push({...identity, status: 'accepted'});
      }
      await route.fulfill({json: {snapshot: canonical, outcomes: result}});
    });

    await openPage(page);
    let tokenCalls = 0;
    const engine = await engineFor(page, async () => {
      if (++tokenCalls === 3 && retry === 'token') await held;
      return 'test-token';
    });
    await engine.evaluate((e, op) => e.submitOperation(op), claim);
    expect(await engine.evaluate(e => e.getState().pending)).toEqual([claim]);
    // Keep the cancellation durable while disconnected or while the old claim's response is outstanding.
    if (retry === 'none') {
      await context.setOffline(true);
      await engine.evaluate((e, op) => e.submitOperation(op), purchase);
    } else {
      await engine.evaluate(e => {
        void e.sync();
      });
      if (retry === 'token') await expect.poll(() => tokenCalls).toBe(3);
      else await expect.poll(() => uploads).toEqual([claim, claim]);
    }
    try {
      await engine.evaluate((e, op) => {
        void e.submitOperation(op);
      }, cancel);
      await expect
        .poll(() => engine.evaluate(e => e.getState().pending), {timeout: 2000})
        .toEqual(retry === 'none' ? [purchase, cancel] : [cancel]);
      expect(
        await engine.evaluate(e =>
          e.getState().outcomes.some(o => o.retryable),
        ),
      ).toBe(false);
    } finally {
      releaseRetry();
    }
    if (retry === 'none') await context.setOffline(false);
    await expect
      .poll(() => engine.evaluate(e => e.getState()))
      .toMatchObject({
        pending: [],
        syncing: false,
        online: true,
        snapshot: {
          revision: 2,
          sessions: [
            {
              id: session.id,
              status: retry === 'completed' ? 'completed' : 'cancelled',
            },
          ],
          items: retry === 'completed' ? [item] : [],
        },
      });
    expect(
      await engine.evaluate(e => e.getState().outcomes.some(o => o.retryable)),
    ).toBe(false);
    expect(uploads).toEqual([
      claim,
      ...(retry === 'none' ? [purchase] : retry === 'token' ? [] : [claim]),
      cancel,
    ]);
  });
}
