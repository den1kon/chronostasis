// @vitest-environment jsdom
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {StrictMode, type ReactNode} from 'react';
import {MemoryRouter} from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {SyncEngine, SyncState} from './sync-engine';
import {createSyncEngine} from './sync-engine';
import {projectSnapshot} from './sync-model';
import {App} from './app';

vi.mock('./sync-engine', () => ({createSyncEngine: vi.fn()}));
const getToken = () => Promise.resolve('bound-session-token');
const getActiveToken = () => Promise.resolve('active-session-token');
const signOut = vi.fn(() => Promise.resolve());
const auth = vi.fn();
const session = vi.fn();
vi.mock('@clerk/react', () => ({
  useAuth: () => auth() as unknown,
  useSession: () => session() as unknown,
  ClerkProvider: ({children}: {children: ReactNode}) => children,
  UserButton: () => null,
  SignIn: () => null,
  SignUp: () => null,
}));

const chest = {
  id: 'basic-chest',
  name: 'Basic chest',
  price: 0,
  description: '',
  spriteX: 0,
  spriteY: 0,
};
const account: NonNullable<SyncState['snapshot']> = {
  revision: 0,
  catalogueVersion: 'catalogue',
  user: {id: '5e15220e-96eb-4123-8cd1-3fc37b06446a', coins: 0},
  catalogue: {
    chests: [chest],
    items: [
      {
        id: 'creation-token',
        name: 'Token of Creation',
        rarity: 'common',
        description: '',
        stats: {},
        spriteX: 0,
        spriteY: 0,
      },
      {
        id: 'rusty-key',
        name: 'Rusty key',
        rarity: 'common',
        description: '',
        stats: {},
        spriteX: 0,
        spriteY: 0,
      },
    ],
    chestItems: [{chestId: chest.id, itemId: 'rusty-key', weight: 1}],
  },
  items: [
    {
      id: 'dc49616e-d407-4a2a-984d-4464d4aca129',
      itemId: 'creation-token',
      sessionId: null,
      acquisitionSource: 'account_creation',
      isVerified: true,
      receivedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  sessions: [],
  userChests: [],
};
const unlock = {chestId: chest.id, unlockedAt: '2026-01-01T00:00:00.000Z'};
const running = {
  id: 'e3d2fdf3-bc3d-41d7-bfd5-181726b7947a',
  chestId: chest.id,
  origin: 'online',
  status: 'running',
  plannedDurationSeconds: 900,
  startedAt: '2026-01-01T00:00:00.000Z',
  endedAt: null,
} as const;
const emptyState: SyncState = {
  snapshot: null,
  view: null,
  online: true,
  initialized: false,
  syncing: false,
  unauthorized: false,
  error: null,
  pending: [],
  outcomes: [],
  localSession: null,
};

// Keep canonical and provisional data consistent at the engine's subscription boundary.
function engineFixture(initial: Partial<SyncState> = {}) {
  let data = {...emptyState, initialized: true, ...initial};
  function projectedState() {
    return {
      ...data,
      view: data.snapshot ? projectSnapshot(data.snapshot, data.pending) : null,
    };
  }
  let state = projectedState();
  const listeners = new Set<() => void>();
  const engine = {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    initialize: vi.fn(async () => {}),
    dispose: vi.fn(() => {
      listeners.clear();
    }),
    sync: vi.fn(async () => {}),
    submitOperation: vi.fn<SyncEngine['submitOperation']>(async () => {}),
    startOfflineSession: vi.fn<SyncEngine['startOfflineSession']>(
      async () => {},
    ),
    completeOfflineSession: vi.fn<SyncEngine['completeOfflineSession']>(
      async () => {},
    ),
    cancelOfflineSession: vi.fn<SyncEngine['cancelOfflineSession']>(
      async () => {},
    ),
  } satisfies SyncEngine;
  vi.mocked(createSyncEngine).mockReturnValueOnce(engine);
  return {
    engine,
    update: (patch: Partial<SyncState>) => {
      data = {...data, ...patch};
      state = projectedState();
      act(() => {
        listeners.forEach(listener => {
          listener();
        });
      });
    },
  };
}

function authenticated(sessionId = 'session_a', userId = 'user_a') {
  auth.mockReturnValue({
    isLoaded: true,
    isSignedIn: true,
    userId,
    sessionId,
    getToken: getActiveToken,
    signOut,
  });
  session.mockReturnValue({
    isLoaded: true,
    isSignedIn: true,
    session: {id: sessionId, user: {id: userId}, getToken},
  });
}

function appAt(path = '/') {
  return (
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );
}

async function click(element: HTMLElement) {
  await act(() => {
    fireEvent.click(element);
    return Promise.resolve();
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', 'pk_test_fixture');
  signOut.mockResolvedValue(undefined);
  authenticated();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('account synchronization gate', () => {
  it('waits for the authenticated snapshot and exposes the creation token offline', async () => {
    const {engine, update} = engineFixture({initialized: false});
    render(appAt('/inventory'));
    expect(screen.getByText('Getting your account ready…')).toBeTruthy();
    expect(screen.queryByText('Token of Creation')).toBeNull();
    expect(engine.initialize).toHaveBeenCalledOnce();
    expect(createSyncEngine).toHaveBeenCalledWith({
      userId: 'user_a',
      getToken: expect.any(Function) as unknown,
    });

    const created = vi.mocked(createSyncEngine).mock.calls[0]?.[0];
    await expect(created?.getToken()).resolves.toBe('bound-session-token');

    update({snapshot: account, online: false, initialized: true});
    expect(await screen.findByText('Offline')).toBeTruthy();
    expect(screen.getByText('Token of Creation')).toBeTruthy();
    expect(screen.getByText('Verified', {exact: true})).toBeTruthy();
  });

  it('keeps uncached offline accounts locked and retries with the same engine', async () => {
    const {engine, update} = engineFixture({online: false});
    render(appAt());
    await click(await screen.findByRole('button', {name: 'Try again'}));
    expect(engine.sync).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole('heading', {name: 'Make room for focus.'}),
    ).toBeNull();
    update({snapshot: account, online: true});
    expect(await screen.findByText('Account ready')).toBeTruthy();
    expect(createSyncEngine).toHaveBeenCalledOnce();
  });

  it('hides cached items after an authorization failure and offers sign-in', async () => {
    const {update} = engineFixture({snapshot: account});
    render(appAt('/inventory'));
    await screen.findByText('Token of Creation');
    update({
      snapshot: null,
      unauthorized: true,
      error: 'Please sign in again.',
    });
    expect(screen.queryByText('Token of Creation')).toBeNull();
    await click(screen.getByRole('button', {name: 'Sign in again'}));
    expect(signOut).toHaveBeenCalledWith({redirectUrl: '/sign-in'});
  });

  it('creates a fresh engine after the Strict Mode cleanup', async () => {
    const probe = engineFixture({initialized: false});
    const live = engineFixture({snapshot: account});
    render(<StrictMode>{appAt('/inventory')}</StrictMode>);
    expect(await screen.findByText('Token of Creation')).toBeTruthy();
    expect(probe.engine.dispose).toHaveBeenCalledOnce();
    expect(live.engine.dispose).not.toHaveBeenCalled();
  });

  it('waits for the session resource to match the authenticated identity', () => {
    const probe = engineFixture();
    auth.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      userId: 'user_b',
      sessionId: 'session_b',
      getToken,
      signOut,
    });
    render(appAt('/inventory'));
    expect(screen.getByText('Loading your session…')).toBeTruthy();
    expect(probe.engine.initialize).not.toHaveBeenCalled();
  });

  it('disposes the old engine and hides its cache on session or account switch', async () => {
    const first = engineFixture({snapshot: account});
    const second = engineFixture({snapshot: account});
    const third = engineFixture({initialized: false});
    const rendered = render(appAt('/inventory'));
    await screen.findByText('Token of Creation');

    authenticated('session_b');
    rendered.rerender(appAt('/inventory'));
    expect(first.engine.dispose).toHaveBeenCalledOnce();
    await screen.findByText('Token of Creation');

    authenticated('session_c', 'user_b');
    rendered.rerender(appAt('/inventory'));
    expect(second.engine.dispose).toHaveBeenCalledOnce();
    first.update({snapshot: account});
    expect(await screen.findByText('Getting your account ready…')).toBeTruthy();
    expect(screen.queryByText('Token of Creation')).toBeNull();
    expect(createSyncEngine).toHaveBeenLastCalledWith({
      userId: 'user_b',
      getToken: expect.any(Function) as unknown,
    });
    rendered.unmount();
    expect(third.engine.dispose).toHaveBeenCalledOnce();
  });
});

describe('gameplay', () => {
  it.each([true, false])(
    'requires one hour for a Mythic-only chest with online=%s',
    async online => {
      const mythic = {
        ...account,
        catalogue: {
          ...account.catalogue,
          items: account.catalogue.items.map(item =>
            item.id === 'rusty-key'
              ? {...item, rarity: 'mythic' as const}
              : item,
          ),
        },
        userChests: [unlock],
      };
      const {update} = engineFixture({snapshot: mythic, online});
      render(appAt());
      const start = await screen.findByRole<HTMLButtonElement>('button', {
        name: 'Start focus',
      });
      const duration = screen.getByLabelText('Duration');
      fireEvent.change(duration, {target: {value: '55'}});
      expect(start.disabled).toBe(true);
      expect(
        screen.getByText(/Mythic rewards require at least 1 hour/i),
      ).toBeTruthy();

      fireEvent.change(duration, {target: {value: '60'}});
      expect(start.disabled).toBe(false);
      expect(
        screen.queryByText(/Mythic rewards require at least 1 hour/i),
      ).toBeNull();

      fireEvent.change(duration, {target: {value: '55'}});
      update({
        snapshot: {
          ...mythic,
          catalogue: {
            ...mythic.catalogue,
            chestItems: [
              ...mythic.catalogue.chestItems,
              {chestId: chest.id, itemId: 'creation-token', weight: 1},
            ],
          },
        },
      });
      expect(start.disabled).toBe(false);
    },
  );

  it('explicitly unlocks the free chest and starts online only after canonical access', async () => {
    const {engine, update} = engineFixture({snapshot: account});
    render(appAt());
    const start = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Start focus',
    });
    expect(start.disabled).toBe(true);
    expect(screen.getByText('0 coins')).toBeTruthy();
    await click(screen.getByRole('button', {name: 'Unlock chest'}));
    const purchase = engine.submitOperation.mock.calls[0]?.[0];
    expect(purchase).toMatchObject({
      type: 'buy_chest',
      chestId: chest.id,
      operationId: expect.any(String) as unknown,
    });
    if (!purchase) throw new Error('No purchase was submitted.');
    update({pending: [purchase]});
    expect(screen.getByText('Purchase pending')).toBeTruthy();
    expect(start.disabled).toBe(true);
    update({pending: [], snapshot: {...account, userChests: [unlock]}});
    fireEvent.change(screen.getByLabelText('Duration'), {
      target: {value: '15'},
    });
    await click(start);
    const operation = engine.submitOperation.mock.calls[1]?.[0];
    expect(operation).toMatchObject({
      type: 'start_session',
      chestId: chest.id,
      plannedDurationSeconds: 900,
      operationId: expect.any(String) as unknown,
      sessionId: expect.any(String) as unknown,
    });
    if (!operation) throw new Error('No online start was submitted.');
    update({pending: [operation], online: false});
    expect(screen.getByText('Start pending')).toBeTruthy();
    expect(screen.queryByRole('timer')).toBeNull();
    await click(screen.getByRole('button', {name: 'Sync now'}));
    expect(engine.sync).toHaveBeenCalledOnce();
    expect(engine.submitOperation).toHaveBeenCalledTimes(2);
    expect(engine.startOfflineSession).not.toHaveBeenCalled();
  });

  it('reports a failed local save without exposing storage internals', async () => {
    const {engine} = engineFixture({snapshot: account, online: false});
    engine.submitOperation.mockRejectedValueOnce(
      new DOMException('Internal IndexedDB transaction aborted', 'AbortError'),
    );
    render(appAt());
    await click(await screen.findByRole('button', {name: 'Unlock chest'}));
    expect(screen.getByRole('alert').textContent).toBe(
      'Could not save the action. Please try again.',
    );
    expect(screen.queryByText('Purchase pending')).toBeNull();
  });

  it('discards an offline timer locally even after reconnecting', async () => {
    const {engine} = engineFixture({
      snapshot: {...account, userChests: [unlock]},
      localSession: {
        sessionId: running.id,
        chestId: chest.id,
        plannedDurationSeconds: 900,
        startedAt: new Date().toISOString(),
      },
    });
    render(appAt());
    await click(await screen.findByRole('button', {name: 'Cancel session'}));
    expect(engine.cancelOfflineSession).toHaveBeenCalledWith(running.id);
    expect(engine.submitOperation).not.toHaveBeenCalled();
  });

  it('recovers a running online timer and queues cancellation without showing a new online start', async () => {
    const {engine, update} = engineFixture({
      snapshot: {...account, userChests: [unlock], sessions: [running]},
    });
    render(appAt());
    await click(await screen.findByRole('button', {name: 'Cancel session'}));
    const cancellation = engine.submitOperation.mock.calls[0]?.[0];
    expect(cancellation).toMatchObject({
      type: 'cancel_session',
      sessionId: running.id,
    });
    if (!cancellation) throw new Error('No cancellation was submitted.');
    update({pending: [cancellation]});
    expect(screen.getByText('Cancellation pending')).toBeTruthy();
    expect(screen.queryByRole('button', {name: 'Start focus'})).toBeNull();
  });

  it('offers cancellation of a server-confirmed early reward claim during retry', async () => {
    const claim = {
      type: 'claim_reward',
      operationId: crypto.randomUUID(),
      sessionId: running.id,
    } as const;
    const {engine} = engineFixture({
      snapshot: {...account, userChests: [unlock], sessions: [running]},
      pending: [claim],
      syncing: true,
      outcomes: [
        {
          operationId: claim.operationId,
          type: claim.type,
          status: 'rejected',
          code: 'session_too_early',
          retryable: true,
        },
      ],
    });
    render(appAt());
    await click(await screen.findByRole('button', {name: 'Cancel session'}));
    expect(engine.submitOperation).toHaveBeenCalledWith({
      type: 'cancel_session',
      sessionId: running.id,
      operationId: expect.any(String) as string,
    });
    expect(screen.queryByRole('button', {name: 'Start focus'})).toBeNull();
  });

  it('queues a server claim after losing connection without adding a local reward', async () => {
    const {engine, update} = engineFixture({
      snapshot: {...account, userChests: [unlock], sessions: [running]},
      online: false,
    });
    render(appAt());
    expect((await screen.findByRole('timer')).textContent).toBe('00:00');
    await click(screen.getByRole('button', {name: 'Claim reward'}));
    const rewardClaim = engine.submitOperation.mock.calls[0]?.[0];
    expect(rewardClaim).toMatchObject({
      type: 'claim_reward',
      sessionId: running.id,
    });
    expect(engine.completeOfflineSession).not.toHaveBeenCalled();
    if (!rewardClaim) throw new Error('No claim was submitted.');
    update({pending: [rewardClaim]});
    expect(screen.getByText('Reward pending')).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>('button', {name: 'Start focus'})
        .disabled,
    ).toBe(false);
    await click(screen.getByRole('link', {name: 'Inventory'}));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('Token of Creation')).toBeTruthy();
  });

  it('keeps an offline timer local when it reconnects and blocks new online starts while the claim is queued', async () => {
    const purchase = {
      type: 'buy_chest',
      chestId: chest.id,
      operationId: crypto.randomUUID(),
    } as const;
    const localClaim = {
      chestId: chest.id,
      plannedDurationSeconds: 900,
      startedAt: running.startedAt,
      type: 'offline_session_claim',
      sessionId: running.id,
      operationId: crypto.randomUUID(),
      itemInstanceId: crypto.randomUUID(),
      itemId: 'rusty-key',
      endedAt: '2026-01-01T00:15:00.000Z',
    } as const;
    const {engine, update} = engineFixture({
      snapshot: account,
      pending: [purchase],
      online: false,
    });
    render(appAt());
    const start = await screen.findByRole('button', {name: 'Start focus'});
    fireEvent.change(screen.getByLabelText('Duration'), {
      target: {value: '15'},
    });
    await click(start);
    expect(engine.startOfflineSession).toHaveBeenCalledWith(chest.id, 900);

    update({
      snapshot: {...account, userChests: [unlock]},
      pending: [],
      localSession: {...running, sessionId: running.id},
      online: true,
    });
    expect(screen.getByText('Offline session')).toBeTruthy();
    await click(screen.getByRole('button', {name: 'Claim reward'}));
    expect(engine.completeOfflineSession).toHaveBeenCalledWith(running.id);
    expect(engine.submitOperation).not.toHaveBeenCalled();

    update({pending: [localClaim], localSession: null});
    expect(screen.getByText('Rusty key')).toBeTruthy();
    expect(screen.getByText('Unverified')).toBeTruthy();
    expect(screen.getByText('Pending sync')).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>('button', {name: 'Start focus'})
        .disabled,
    ).toBe(true);
  });

  it('shows the newly queued offline reward when the device clock moves back', async () => {
    const offlineClaim = {
      type: 'offline_session_claim',
      chestId: chest.id,
      plannedDurationSeconds: 900,
      startedAt: running.startedAt,
      endedAt: '2026-01-01T00:15:00.000Z',
      sessionId: running.id,
      operationId: crypto.randomUUID(),
      itemInstanceId: crypto.randomUUID(),
      itemId: 'blue-gem',
    } as const;
    const earlierClaim = {
      ...offlineClaim,
      startedAt: '2026-01-02T00:00:00.000Z',
      endedAt: '2026-01-02T00:15:00.000Z',
      sessionId: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      itemInstanceId: crypto.randomUUID(),
      itemId: 'rusty-key',
    };
    const {update} = engineFixture({
      online: false,
      localSession: {
        sessionId: offlineClaim.sessionId,
        chestId: chest.id,
        plannedDurationSeconds: 900,
        startedAt: offlineClaim.startedAt,
      },
      pending: [earlierClaim],
      snapshot: {
        ...account,
        userChests: [unlock],
        catalogue: {
          ...account.catalogue,
          chestItems: [
            ...account.catalogue.chestItems,
            {chestId: chest.id, itemId: 'blue-gem', weight: 1},
          ],
          items: [
            ...account.catalogue.items,
            {
              id: 'blue-gem',
              name: 'Blue gem',
              rarity: 'epic',
              description: '',
              stats: {},
              spriteX: 2,
              spriteY: 0,
            },
          ],
        },
        items: [
          ...account.items,
          {
            id: crypto.randomUUID(),
            itemId: 'rusty-key',
            sessionId: crypto.randomUUID(),
            acquisitionSource: 'session_reward',
            isVerified: true,
            receivedAt: '2026-01-03T00:00:00.000Z',
          },
        ],
      },
    });
    render(appAt());
    await click(await screen.findByRole('button', {name: 'Claim reward'}));
    update({localSession: null, pending: [earlierClaim, offlineClaim]});

    expect(screen.getByText('Blue gem')).toBeTruthy();
    expect(screen.getByText('Unverified')).toBeTruthy();
    expect(screen.getByText('Pending sync')).toBeTruthy();
  });

  it('removes a rejected reward and restores the canonical balance and chest access', async () => {
    const pricedAccount = {
      ...account,
      user: {...account.user, coins: 0},
      catalogue: {...account.catalogue, chests: [{...chest, price: 5}]},
    };
    const purchase = {
      type: 'buy_chest',
      chestId: chest.id,
      operationId: crypto.randomUUID(),
    } as const;
    const claim = {
      type: 'offline_session_claim',
      sessionId: running.id,
      operationId: crypto.randomUUID(),
      itemInstanceId: crypto.randomUUID(),
      itemId: 'rusty-key',
      chestId: chest.id,
      plannedDurationSeconds: 900,
      startedAt: running.startedAt,
      endedAt: '2026-01-01T00:15:00.000Z',
    } as const;
    const {update} = engineFixture({
      snapshot: {...pricedAccount, user: {...account.user, coins: 7}},
      pending: [purchase, claim],
      online: false,
    });
    render(appAt('/inventory'));
    expect(await screen.findByText('Rusty key')).toBeTruthy();
    expect(screen.getByText('Pending sync')).toBeTruthy();

    update({
      snapshot: pricedAccount,
      online: true,
      pending: [],
      outcomes: [
        {
          operationId: purchase.operationId,
          type: 'buy_chest',
          status: 'rejected',
          retryable: false,
          message: 'You need more coins to unlock this chest.',
        },
        {
          operationId: claim.operationId,
          type: 'offline_session_claim',
          status: 'rejected',
          retryable: false,
          message: 'Unlock this chest first.',
        },
      ],
    });
    expect(screen.queryByText('Rusty key')).toBeNull();
    expect(
      screen.getByText('Offline reward rejected. Unlock this chest first.'),
    ).toBeTruthy();
    await click(screen.getByRole('link', {name: 'Focus'}));
    expect(screen.getByText('0 coins')).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>('button', {name: 'Start focus'})
        .disabled,
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>('button', {name: 'Unlock chest'})
        .disabled,
    ).toBe(true);
  });
});
